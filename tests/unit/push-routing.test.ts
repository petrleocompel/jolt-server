import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoutingPushSender, resolvePushRouting } from "#/push/routing";
import type { PokePushPayload, PushResult, PushSender, PushTarget } from "#/push/types";
import serverIdVector from "./vectors/server-id.json";

/**
 * Which way each push goes: the precedence between the server's own APNs
 * credentials and the relay, the per-device split, and what
 * `GET /push/config` tells the app.
 */

describe("resolvePushRouting", () => {
  const url = "https://relay.example/";

  it.each([
    // [has APNs, PUSH_RELAY_ENABLED, relay URL] -> advertised transport, relay used
    [false, undefined, undefined, "none", false],
    [true, undefined, undefined, "apns", false],
    [false, undefined, url, "relay", true],
    // Own credentials win by default, but devices already on the relay keep it.
    [true, undefined, url, "apns", true],
    [true, true, url, "relay", true],
    [false, false, url, "none", false],
    [true, false, url, "apns", false],
  ] as const)(
    "APNs %s, enabled %s, URL %s -> %s (relay %s)",
    (hasApnsCredentials, relayEnabled, relayUrl, transport, relayUsed) => {
      const routing = resolvePushRouting({ hasApnsCredentials, relayEnabled, relayUrl });
      expect(routing.transport).toBe(transport);
      expect(routing.relayUrl !== undefined).toBe(relayUsed);
    },
  );
});

function fakeSender(name: string, calls: Array<[string, Array<string>]>): PushSender {
  const answer = async (targets: Array<PushTarget>): Promise<Array<PushResult>> => {
    calls.push([name, targets.map((t) => t.id)]);
    return targets.map((t) =>
      t.id === "dead" ? { targetId: t.id, ok: false, reason: "unregistered" } : { targetId: t.id, ok: true },
    );
  };
  return { sendPoke: answer, sendTest: answer, close: async () => undefined };
}

const poke: PokePushPayload = {
  pokeID: "poke-1",
  senderHandle: "alice",
  senderDisplayName: "Alice",
  recipientHandle: "bob",
  stimulus: { kind: "vibe", intensity: 10, repetitions: 1 },
  sentAt: "2026-10-09T12:00:00.000Z",
  viaApiToken: false,
};

describe("RoutingPushSender", () => {
  it("sends each device the way it registered, answering in the original order", async () => {
    const calls: Array<[string, Array<string>]> = [];
    const sender = new RoutingPushSender({
      apns: fakeSender("apns", calls),
      relay: fakeSender("relay", calls),
    });

    const results = await sender.sendPoke(
      [
        { id: "a1", token: "aaa", transport: "apns" },
        { id: "dead", token: "rt_x", transport: "relay", payloadKey: Buffer.alloc(32) },
        { id: "a2", token: "bbb", transport: "apns" },
        { id: "r2", token: "rt_y", transport: "relay", payloadKey: Buffer.alloc(32) },
      ],
      poke,
    );

    expect(calls.sort()).toEqual([
      ["apns", ["a1", "a2"]],
      ["relay", ["dead", "r2"]],
    ]);
    // An unregistered relay device comes back keyed to its row, which is
    // all the poke and test services need to disable it.
    expect(results).toEqual([
      { targetId: "a1", ok: true },
      { targetId: "dead", ok: false, reason: "unregistered" },
      { targetId: "a2", ok: true },
      { targetId: "r2", ok: true },
    ]);
  });

  it("leaves a sender with no devices alone", async () => {
    const calls: Array<[string, Array<string>]> = [];
    const sender = new RoutingPushSender({
      apns: fakeSender("apns", calls),
      relay: fakeSender("relay", calls),
    });
    await sender.sendTest([{ id: "a1", token: "aaa", transport: "apns" }], {
      testID: "t",
      sentAt: "2026-10-09T12:00:00.000Z",
      source: "web",
    });
    expect(calls).toEqual([["apns", ["a1"]]]);
  });

  it("closes a sender shared by both transports once", async () => {
    const close = vi.fn(async () => undefined);
    const shared = { ...fakeSender("console", []), close };
    await new RoutingPushSender({ apns: shared, relay: shared }).close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

interface Mocked {
  env: Record<string, unknown>;
  hasApnsCredentials: boolean;
  pushRouting: { transport: "apns" | "relay" | "none"; relayUrl: string | undefined };
  seed: string;
}

const mocked = vi.hoisted(
  (): Mocked => ({
    env: {
      NODE_ENV: "test",
      APNS_ENV: "production",
      PUSH_TIME_ZONE: "UTC",
      JOLT_SERVER_VERSION: "9.9.9",
    },
    hasApnsCredentials: false,
    pushRouting: { transport: "none", relayUrl: undefined },
    seed: "",
  }),
);

vi.mock("#/env", () => ({
  env: mocked.env,
  get hasApnsCredentials() {
    return mocked.hasApnsCredentials;
  },
  pushRouting: mocked.pushRouting,
}));
vi.mock("#/services/settings", () => ({
  relayIdentitySeed: async () => mocked.seed,
}));

describe("pushConfig", () => {
  const fetchMock = vi.fn(async () =>
    Response.json({ serverId: serverIdVector.serverId, status: "active" }, { status: 201 }),
  );

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocked.seed = Buffer.from(serverIdVector.ed25519SeedHex, "hex").toString("base64url");
  });

  it("names the relay and this server's id, registering first", async () => {
    Object.assign(mocked.pushRouting, { transport: "relay", relayUrl: "https://relay.example/" });
    const { pushConfig } = await import("#/push");

    expect(await pushConfig()).toEqual({
      transport: "relay",
      relay: { url: "https://relay.example/", serverId: serverIdVector.serverId },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toBe(
      "https://relay.example/v1/servers",
    );
  });

  it.each([
    ["cannot be reached", () => Promise.reject(new TypeError("fetch failed"))],
    ["fails", async () => Response.json({ error: "internal" }, { status: 500 })],
    ["has blocked this server", async () => Response.json({ error: "server_blocked" }, { status: 403 })],
  ])("answers 503 rather than relay when the relay %s", async (_label, reply) => {
    Object.assign(mocked.pushRouting, { transport: "relay", relayUrl: "https://relay.example/" });
    fetchMock.mockImplementationOnce(reply);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { pushConfig } = await import("#/push");

    await expect(pushConfig()).rejects.toMatchObject({ status: 503 });
  });

  it("names the APNs environment for a server with its own credentials", async () => {
    Object.assign(mocked.pushRouting, { transport: "apns", relayUrl: undefined });
    const { pushConfig } = await import("#/push");
    expect(await pushConfig()).toEqual({ transport: "apns", apnsEnvironment: "production" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says none when the server delivers nothing", async () => {
    Object.assign(mocked.pushRouting, { transport: "none", relayUrl: undefined });
    const { pushConfig } = await import("#/push");
    expect(await pushConfig()).toEqual({ transport: "none" });
  });
});
