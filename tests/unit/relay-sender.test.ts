import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPublicKey } from "node:crypto";
import { jwtVerify } from "jose";
import { base64url, openEnvelope } from "#/push/envelope";
import type { EnvelopeV1 } from "#/push/envelope";
import { RelayPushSender, classifyRelayStatus } from "#/push/relay";
import { RelayClient, identityFromSeed } from "#/push/relay-identity";
import type { PokePushPayload, PushTarget } from "#/push/types";
import serverIdVector from "./vectors/server-id.json";

/**
 * The relay sender against a fake relay: what it sends, in how many
 * requests, and how every answer the contract allows comes back as a
 * delivery result.
 */

const identity = identityFromSeed(Buffer.from(serverIdVector.ed25519SeedHex, "hex"));
const SERVER_ID = serverIdVector.serverId;

interface Call {
  method: string;
  path: string;
  authorization: string;
  body: any;
}

type Reply = { status: number; body?: unknown } | Error;

/**
 * A relay that answers registrations 201 by default and each `/v1/send`
 * from the queue, or `ok` for every message once the queue is empty.
 */
function fakeRelay() {
  const calls: Array<Call> = [];
  const servers: Array<Reply> = [];
  const sends: Array<Reply | ((messages: Array<any>) => Reply)> = [];

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      method: init?.method ?? "GET",
      path: url.pathname,
      authorization: new Headers(init?.headers).get("authorization") ?? "",
      body,
    });
    let reply: Reply;
    if (url.pathname === "/v1/servers") {
      reply = servers.shift() ?? {
        status: 201,
        body: { serverId: SERVER_ID, status: "active", limits: { perRegistrationPerDay: 500, perServerPerDay: 20000 } },
      };
    } else {
      const next = sends.shift();
      reply =
        typeof next === "function"
          ? next(body.messages)
          : (next ?? {
              status: 200,
              body: { results: body.messages.map((m: any) => ({ relayToken: m.relayToken, status: "ok" })) },
            });
    }
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return { calls, servers, sends, fetchImpl };
}

function keyFor(index: number): Buffer {
  return Buffer.alloc(32, index + 1);
}

function relayTargets(count: number): Array<PushTarget> {
  return Array.from({ length: count }, (_, index) => ({
    id: `device-${index}`,
    token: `rt_${base64url(Buffer.alloc(32, index))}`,
    transport: "relay" as const,
    payloadKey: keyFor(index),
  }));
}

const poke: PokePushPayload = {
  pokeID: "7d6f0c1e-2b3a-4c5d-8e9f-0a1b2c3d4e5f",
  senderHandle: "alice",
  senderDisplayName: "Alice",
  recipientHandle: "bob",
  stimulus: { kind: "zap", intensity: 30, repetitions: 2 },
  sentAt: "2026-10-09T12:32:00.000Z",
  viaApiToken: false,
};

let relay: ReturnType<typeof fakeRelay>;

function makeClient(extra: { name?: string; publicUrl?: string } = {}) {
  return new RelayClient({
    url: "https://relay.example",
    loadIdentity: async () => identity,
    version: "1.2.3",
    fetch: relay.fetchImpl,
    ...extra,
  });
}

beforeEach(() => {
  relay = fakeRelay();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("classifyRelayStatus", () => {
  it.each([
    ["ok", undefined],
    ["unregistered", "unregistered"],
    ["rate_limited", "transient"],
    ["transient", "transient"],
    ["rejected", "rejected"],
    ["something new", "rejected"],
  ])("maps %s to %s", (status, reason) => {
    expect(classifyRelayStatus(status)).toBe(reason);
  });
});

describe("RelayPushSender", () => {
  it("registers once, lazily, then sends a sealed poke per device", async () => {
    const sender = new RelayPushSender(makeClient());
    const targets = relayTargets(2);

    const results = await sender.sendPoke(targets, poke);

    expect(results).toEqual([
      { targetId: "device-0", ok: true },
      { targetId: "device-1", ok: true },
    ]);
    expect(relay.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /v1/servers",
      "POST /v1/send",
    ]);
    // Opt-in fields stay home unless the operator set them.
    expect(relay.calls[0]!.body).toEqual({ publicKey: serverIdVector.publicKey, version: "1.2.3" });

    const messages = relay.calls[1]!.body.messages;
    expect(messages).toHaveLength(2);
    messages.forEach((message: { relayToken: string; kind: string; envelope: EnvelopeV1; ttlSeconds: number; collapseId: string }, index: number) => {
      expect(message).toMatchObject({
        relayToken: targets[index]!.token,
        kind: "poke",
        ttlSeconds: 300,
        collapseId: poke.pokeID,
      });
      const plaintext = openEnvelope({
        payloadKey: keyFor(index),
        serverId: SERVER_ID,
        kind: "poke",
        envelope: message.envelope,
      });
      expect(JSON.parse(plaintext)).toEqual({ type: "poke", poke: { ...poke, serverId: SERVER_ID } });
    });

    await sender.sendPoke(targets, poke);
    expect(relay.calls.filter((c) => c.path === "/v1/servers")).toHaveLength(1);
  });

  it("sends name and publicUrl only when the operator opted in", async () => {
    await new RelayPushSender(
      makeClient({ name: "Home", publicUrl: "https://jolt.example.com" }),
    ).sendPoke(relayTargets(1), poke);
    expect(relay.calls[0]!.body).toEqual({
      publicKey: serverIdVector.publicKey,
      version: "1.2.3",
      name: "Home",
      publicUrl: "https://jolt.example.com",
    });
  });

  it("signs every request as this server, for jolt-relay", async () => {
    await new RelayPushSender(makeClient()).sendPoke(relayTargets(1), poke);
    for (const call of relay.calls) {
      const jwt = call.authorization.replace(/^Bearer /, "");
      const { payload } = await jwtVerify(jwt, createPublicKey(identity.privateKey), {
        issuer: SERVER_ID,
        audience: "jolt-relay",
      });
      expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(300);
    }
  });

  it("tells each device its own id in a test push", async () => {
    const targets = relayTargets(2);
    await new RelayPushSender(makeClient()).sendTest(targets, {
      testID: "3c2b1a09-8765-4321-a0b1-c2d3e4f5a6b7",
      sentAt: "2026-10-09T12:33:00.000Z",
      source: "app",
    });
    const messages = relay.calls[1]!.body.messages;
    messages.forEach((message: { kind: string; envelope: EnvelopeV1 }, index: number) => {
      expect(message.kind).toBe("test");
      const plaintext = JSON.parse(
        openEnvelope({ payloadKey: keyFor(index), serverId: SERVER_ID, kind: "test", envelope: message.envelope }),
      );
      expect(plaintext).toEqual({
        type: "test",
        test: {
          testID: "3c2b1a09-8765-4321-a0b1-c2d3e4f5a6b7",
          sentAt: "2026-10-09T12:33:00.000Z",
          source: "app",
          deviceID: `device-${index}`,
          serverId: SERVER_ID,
        },
      });
    });
  });

  it("maps every per-message status from the contract's table", async () => {
    relay.sends.push({
      status: 200,
      body: {
        results: ["ok", "unregistered", "rate_limited", "transient", "rejected"].map((status) => ({ status })),
      },
    });
    const results = await new RelayPushSender(makeClient()).sendPoke(relayTargets(5), poke);
    expect(results.map((r) => [r.ok, r.reason])).toEqual([
      [true, undefined],
      [false, "unregistered"],
      [false, "transient"],
      [false, "transient"],
      [false, "rejected"],
    ]);
  });

  it("sends at most 100 messages per request, one registration for all of them", async () => {
    const results = await new RelayPushSender(makeClient()).sendPoke(relayTargets(250), poke);
    const sends = relay.calls.filter((c) => c.path === "/v1/send");
    expect(sends.map((c) => c.body.messages.length)).toEqual([100, 100, 50]);
    expect(relay.calls.filter((c) => c.path === "/v1/servers")).toHaveLength(1);
    expect(results).toHaveLength(250);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results[249]!.targetId).toBe("device-249");
  });

  it("registers again and retries once when the relay has forgotten the server", async () => {
    relay.sends.push({ status: 404, body: { error: "unknown_server" } });
    const results = await new RelayPushSender(makeClient()).sendPoke(relayTargets(1), poke);
    expect(results).toEqual([{ targetId: "device-0", ok: true }]);
    expect(relay.calls.map((c) => c.path)).toEqual([
      "/v1/servers",
      "/v1/send",
      "/v1/servers",
      "/v1/send",
    ]);
  });

  it("gives up after one retry, as transient", async () => {
    relay.sends.push(
      { status: 404, body: { error: "unknown_server" } },
      { status: 404, body: { error: "unknown_server" } },
    );
    const client = makeClient();
    const [result] = await new RelayPushSender(client).sendPoke(relayTargets(1), poke);
    expect(result).toMatchObject({ ok: false, reason: "transient" });
    expect(relay.calls.filter((c) => c.path === "/v1/send")).toHaveLength(2);
    expect((await client.status()).lastError?.message).toContain("unknown_server");
  });

  it.each([
    [{ status: 401, body: { error: "invalid_token" } }, "rejected"],
    [{ status: 413 }, "rejected"],
    [{ status: 422, body: { error: "invalid_request" } }, "rejected"],
    [{ status: 429 }, "transient"],
    [{ status: 503 }, "transient"],
    [{ status: 200, body: { results: [] } }, "transient"],
    [new TypeError("fetch failed"), "transient"],
  ] as Array<[Reply, string]>)("maps a whole-request %j to %s for every message", async (reply, reason) => {
    relay.sends.push(reply);
    const client = makeClient();
    const results = await new RelayPushSender(client).sendPoke(relayTargets(2), poke);
    expect(results.map((r) => r.reason)).toEqual([reason, reason]);
    expect((await client.status()).lastError).not.toBeNull();
  });

  it("stops at a blocked server, and says so", async () => {
    relay.sends.push({ status: 403, body: { error: "server_blocked" } });
    const client = makeClient();
    const [result] = await new RelayPushSender(client).sendPoke(relayTargets(1), poke);
    expect(result).toMatchObject({ ok: false, reason: "rejected" });
    expect((await client.status()).registration).toBe("blocked");
  });

  it("sends nothing when registration is refused, and reports why", async () => {
    relay.servers.push({ status: 403, body: { error: "server_blocked" } });
    const client = makeClient();
    const [result] = await new RelayPushSender(client).sendPoke(relayTargets(1), poke);
    expect(result).toMatchObject({ ok: false, reason: "rejected" });
    expect(relay.calls.map((c) => c.path)).toEqual(["/v1/servers"]);
    expect(await client.status()).toMatchObject({ serverId: SERVER_ID, registration: "blocked" });

    // Still rejected, not transient, while the failed registration is not retried.
    const [again] = await new RelayPushSender(client).sendPoke(relayTargets(1), poke);
    expect(again).toMatchObject({ ok: false, reason: "rejected" });
    expect(relay.calls).toHaveLength(1);
  });

  it("treats an unreachable relay as transient, and does not hammer it", async () => {
    relay.servers.push(new TypeError("fetch failed"));
    const client = makeClient();
    const sender = new RelayPushSender(client);
    expect((await sender.sendPoke(relayTargets(1), poke))[0]).toMatchObject({ reason: "transient" });
    expect((await sender.sendPoke(relayTargets(1), poke))[0]).toMatchObject({ reason: "transient" });
    // The second poke within the back-off does not try to register again.
    expect(relay.calls).toHaveLength(1);
    expect(await client.status()).toMatchObject({ registration: "failed" });
  });

  it("rejects a device whose payload key could not be unsealed, and sends the rest", async () => {
    const [good, bad] = relayTargets(2);
    const results = await new RelayPushSender(makeClient()).sendPoke(
      [good!, { ...bad!, payloadKey: undefined }],
      poke,
    );
    expect(results[0]).toEqual({ targetId: "device-0", ok: true });
    expect(results[1]).toMatchObject({ ok: false, reason: "rejected" });
    expect(relay.calls[1]!.body.messages).toHaveLength(1);
  });

  it("shares one registration between concurrent sends", async () => {
    const sender = new RelayPushSender(makeClient());
    await Promise.all([sender.sendPoke(relayTargets(1), poke), sender.sendPoke(relayTargets(1), poke)]);
    expect(relay.calls.filter((c) => c.path === "/v1/servers")).toHaveLength(1);
  });

  it("does nothing at all for no devices", async () => {
    expect(await new RelayPushSender(makeClient()).sendPoke([], poke)).toEqual([]);
    expect(relay.calls).toEqual([]);
  });
});
