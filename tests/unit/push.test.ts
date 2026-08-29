import { describe, expect, it, vi } from "vitest";
import {
  buildPokePayloadBodies,
  classifyApnsOutcome,
  deliverPokeToTarget,
} from "#/push/apns";
import { ConsolePushSender } from "#/push/console";
import { alertTextFor } from "#/push/types";
import type { ApnsSendOutcome } from "#/push/apns";
import type { PokePushPayload, PushTarget } from "#/push/types";

const payload: PokePushPayload = {
  pokeID: "poke-1",
  senderHandle: "alice",
  senderDisplayName: "Alice Example",
  stimulus: { kind: "zap", intensity: 30, repetitions: 2 },
};

const target: PushTarget = { id: "device-1", token: "abc123deadbeef" };

describe("alertTextFor", () => {
  it("maps each stimulus kind to its verb", () => {
    const verbs = (["zap", "vibe", "beep"] as const).map(
      (kind) => alertTextFor({ ...payload, stimulus: { ...payload.stimulus, kind } }).body,
    );
    expect(verbs).toEqual(["zapped you!", "buzzed you!", "beeped you!"]);
  });

  it("titles with the display name, falling back to @handle", () => {
    expect(alertTextFor(payload).title).toBe("Alice Example");
    expect(alertTextFor({ ...payload, senderDisplayName: "" }).title).toBe("@alice");
  });
});

describe("classifyApnsOutcome", () => {
  it.each([
    [{ status: 200 }, undefined],
    [{ status: 410 }, "unregistered"],
    [{ status: 400, reason: "BadDeviceToken" }, "unregistered"],
    [{ status: 400, reason: "BadTopic" }, "rejected"],
    [{ status: 403 }, "rejected"],
    [{ status: 429 }, "transient"],
    [{ status: 500 }, "transient"],
    [{ status: 503 }, "transient"],
  ] satisfies Array<[ApnsSendOutcome, string | undefined]>)(
    "classifies %j as %s",
    (outcome, expected) => {
      expect(classifyApnsOutcome(outcome)).toBe(expected);
    },
  );
});

describe("buildPokePayloadBodies", () => {
  it("puts an alert (with sound) on the alert body only", () => {
    const { alertBody, silentBody } = buildPokePayloadBodies(payload);
    const alert = JSON.parse(alertBody);
    const silent = JSON.parse(silentBody);

    expect(alert.aps.alert).toEqual({ title: "Alice Example", body: "zapped you!" });
    expect(alert.aps.sound).toBe("default");
    // The load-bearing invariant: no alert on the silent push, or iOS drops
    // the background wake.
    expect(silent.aps.alert).toBeUndefined();
    expect(silent.aps["content-available"]).toBe(1);
  });

  it("carries the self-contained poke in both bodies", () => {
    const { alertBody, silentBody } = buildPokePayloadBodies(payload);
    for (const body of [alertBody, silentBody]) {
      const parsed = JSON.parse(body);
      expect(parsed.type).toBe("poke");
      expect(parsed.poke).toEqual(payload);
    }
  });
});

describe("deliverPokeToTarget", () => {
  const bodies = buildPokePayloadBodies(payload);
  const base = { authorization: "bearer t", "apns-topic": "cz.peelco.jolt" };

  it("sends the alert then the silent push on success", async () => {
    const order: Array<string> = [];
    const byType = new Map<unknown, Record<string, string | number>>();
    const sendOne = vi.fn(async (_token: string, _body: string, headers: Record<string, string | number>) => {
      order.push(String(headers["apns-push-type"]));
      byType.set(headers["apns-push-type"], headers);
      return { status: 200 } satisfies ApnsSendOutcome;
    });

    const result = await deliverPokeToTarget(target, bodies, base, payload.pokeID, sendOne);

    expect(result).toEqual({ targetId: "device-1", ok: true });
    // Alert first (it is what guarantees delivery), then the silent wake.
    expect(order).toEqual(["alert", "background"]);

    const alert = byType.get("alert");
    const silent = byType.get("background");
    expect(alert?.["apns-priority"]).toBe(10);
    expect(alert?.["apns-id"]).toBe("poke-1");
    expect(silent?.["apns-priority"]).toBe(5);
    // Only the alert may carry apns-id, or APNs collapses the pair.
    expect(silent?.["apns-id"]).toBeUndefined();
  });

  it("skips the silent push when the token is unregistered", async () => {
    const sendOne = vi.fn(async () => ({ status: 410 }) satisfies ApnsSendOutcome);

    const result = await deliverPokeToTarget(target, bodies, base, payload.pokeID, sendOne);

    expect(sendOne).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ targetId: "device-1", ok: false, reason: "unregistered" });
  });

  it("still succeeds when only the best-effort silent push fails", async () => {
    const sendOne = vi.fn(async (_token: string, _body: string, headers: Record<string, string | number>) => {
      if (headers["apns-push-type"] === "background") throw new Error("silent boom");
      return { status: 200 } satisfies ApnsSendOutcome;
    });

    const result = await deliverPokeToTarget(target, bodies, base, payload.pokeID, sendOne);

    expect(result).toEqual({ targetId: "device-1", ok: true });
  });

  it("reports a thrown alert send as transient rather than throwing", async () => {
    const sendOne = vi.fn(async () => {
      throw new Error("network down");
    });

    const result = await deliverPokeToTarget(target, bodies, base, payload.pokeID, sendOne);

    expect(result).toMatchObject({ ok: false, reason: "transient", detail: "network down" });
  });
});

describe("ConsolePushSender", () => {
  it("reports success for every target and never logs the full token", async () => {
    const lines: Array<string> = [];
    const sender = new ConsolePushSender((message) => lines.push(message));

    const results = await sender.sendPoke([target, { id: "device-2", token: "zzz" }], payload);

    expect(results).toEqual([
      { targetId: "device-1", ok: true },
      { targetId: "device-2", ok: true },
    ]);
    expect(lines.join("\n")).not.toContain(target.token);
  });

  it("returns nothing for no targets", async () => {
    const sender = new ConsolePushSender(() => {});
    expect(await sender.sendPoke([], payload)).toEqual([]);
  });
});
