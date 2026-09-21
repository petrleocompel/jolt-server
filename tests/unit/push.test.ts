import { describe, expect, it, vi } from "vitest";
import {
  buildPokePayloadBodies,
  buildTestPayloadBodies,
  classifyApnsOutcome,
  deliverToTarget,
} from "#/push/apns";
import { ConsolePushSender } from "#/push/console";
import { alertTextFor, formatSendTime, testAlertTextFor } from "#/push/types";
import type { ApnsSendOutcome } from "#/push/apns";
import type { PokePushPayload, PushTarget, TestPushPayload } from "#/push/types";

const payload: PokePushPayload = {
  pokeID: "poke-1",
  senderHandle: "alice",
  senderDisplayName: "Alice Example",
  stimulus: { kind: "zap", intensity: 30, repetitions: 2 },
  sentAt: "2026-09-21T14:32:00.000Z",
};

const target: PushTarget = { id: "device-1", token: "abc123deadbeef" };

const testPayload: TestPushPayload = {
  testID: "test-1",
  deviceID: "device-1",
  sentAt: "2026-09-07T10:15:00.000Z",
  source: "web",
};

describe("formatSendTime", () => {
  it("renders the wall clock of the configured zone, naming it", () => {
    expect(formatSendTime("2026-09-21T14:32:00.000Z")).toBe("14:32 UTC");
    // The abbreviation itself is ICU's to choose (CEST here, GMT+2 on a
    // trimmed build) — the shifted wall clock is what this pins down.
    expect(formatSendTime("2026-09-21T14:32:00.000Z", "Europe/Prague")).toMatch(/^16:32 \S+$/);
  });

  it("falls back to UTC rather than throwing on a bad zone", () => {
    // Misconfiguration costs the zone, never the notification.
    expect(formatSendTime("2026-09-21T14:32:00.000Z", "Mars/Olympus")).toBe("14:32 UTC");
  });

  it("returns nothing for a timestamp it cannot parse", () => {
    expect(formatSendTime(undefined)).toBe("");
    expect(formatSendTime("not a date")).toBe("");
  });
});

describe("alertTextFor", () => {
  it("maps each stimulus kind to its verb", () => {
    const verbs = (["zap", "vibe", "beep"] as const).map((kind) =>
      alertTextFor({ ...payload, stimulus: { ...payload.stimulus, kind } }).body,
    );
    expect(verbs).toEqual([
      "zapped you — 30% x2 at 14:32 UTC",
      "buzzed you — 30% x2 at 14:32 UTC",
      "beeped you — 30% x2 at 14:32 UTC",
    ]);
  });

  it("says how hard and when, in the configured zone", () => {
    expect(alertTextFor(payload, "Europe/Prague").body).toMatch(
      /^zapped you — 30% x2 at 16:32 \S+$/,
    );
  });

  it("leaves the repetition count out of a single poke", () => {
    expect(
      alertTextFor({ ...payload, stimulus: { ...payload.stimulus, repetitions: 1 } }).body,
    ).toBe("zapped you — 30% at 14:32 UTC");
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

    expect(alert.aps.alert).toEqual({
      title: "Alice Example",
      body: "zapped you — 30% x2 at 14:32 UTC",
    });
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

describe("testAlertTextFor", () => {
  it("says delivery works when nothing will fire", () => {
    expect(testAlertTextFor({})).toEqual({
      title: "Jolt",
      body: "Test notification — push delivery works.",
    });
    expect(testAlertTextFor({ sentAt: testPayload.sentAt }).body).toBe(
      "Test notification — push delivery works, sent 10:15 UTC.",
    );
  });

  it("names the stimulus and the send time when one is coming", () => {
    expect(
      testAlertTextFor({
        stimulus: { kind: "zap", intensity: 30, repetitions: 2 },
        sentAt: testPayload.sentAt,
      }).body,
    ).toBe("Delivery works — firing zap 30% x2, sent 10:15 UTC.");
    expect(
      testAlertTextFor({ stimulus: { kind: "vibe", intensity: 20, repetitions: 1 } }).body,
    ).toBe("Delivery works — firing vibe 20%.");
  });
});

describe("buildTestPayloadBodies", () => {
  it('marks the payload type "test", not "poke"', () => {
    // The client routes on this: a test acks to /devices/test-push/{id}/ack
    // and has no poke_event behind it.
    const { alertBody, silentBody } = buildTestPayloadBodies(testPayload);
    for (const body of [alertBody, silentBody]) {
      const parsed = JSON.parse(body);
      expect(parsed.type).toBe("test");
      expect(parsed.poke).toBeUndefined();
      expect(parsed.test).toEqual(testPayload);
    }
  });

  it("keeps the alert off the silent body", () => {
    const { alertBody, silentBody } = buildTestPayloadBodies(testPayload);
    expect(JSON.parse(alertBody).aps.alert.title).toBe("Jolt");
    expect(JSON.parse(silentBody).aps.alert).toBeUndefined();
    expect(JSON.parse(silentBody).aps["content-available"]).toBe(1);
  });

  it("carries the stimulus through when one was asked for", () => {
    const stimulus = { kind: "beep", intensity: 10, repetitions: 1 } as const;
    const { alertBody } = buildTestPayloadBodies({ ...testPayload, stimulus });
    expect(JSON.parse(alertBody).test.stimulus).toEqual(stimulus);
  });
});

describe("deliverToTarget", () => {
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

    const result = await deliverToTarget(target, bodies, base, payload.pokeID, sendOne);

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

    const result = await deliverToTarget(target, bodies, base, payload.pokeID, sendOne);

    expect(sendOne).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ targetId: "device-1", ok: false, reason: "unregistered" });
  });

  it("still succeeds when only the best-effort silent push fails", async () => {
    const sendOne = vi.fn(async (_token: string, _body: string, headers: Record<string, string | number>) => {
      if (headers["apns-push-type"] === "background") throw new Error("silent boom");
      return { status: 200 } satisfies ApnsSendOutcome;
    });

    const result = await deliverToTarget(target, bodies, base, payload.pokeID, sendOne);

    expect(result).toEqual({ targetId: "device-1", ok: true });
  });

  it("reports a thrown alert send as transient rather than throwing", async () => {
    const sendOne = vi.fn(async () => {
      throw new Error("network down");
    });

    const result = await deliverToTarget(target, bodies, base, payload.pokeID, sendOne);

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

  it("logs a test push without leaking the token either", async () => {
    const lines: Array<string> = [];
    const sender = new ConsolePushSender((message) => lines.push(message));

    const results = await sender.sendTest([target], {
      testID: "test-1",
      sentAt: testPayload.sentAt,
      source: "app",
    });

    expect(results).toEqual([{ targetId: "device-1", ok: true }]);
    expect(lines.join("\n")).toContain("notification only");
    expect(lines.join("\n")).not.toContain(target.token);
  });
});
