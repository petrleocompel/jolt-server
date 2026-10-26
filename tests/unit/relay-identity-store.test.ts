import { beforeEach, describe, expect, it, vi } from "vitest";
import { base64url, fromBase64url } from "#/push/envelope";
import { identityFromSeed } from "#/push/relay-identity";
import serverIdVector from "./vectors/server-id.json";

/**
 * Where a generated relay identity is kept: sealed under
 * PUSH_RELAY_IDENTITY_SECRET in `server_setting`, so a database dump alone
 * cannot sign as this server, with plaintext seeds from before the secret
 * existed sealed in place and the serverId unchanged.
 */

const SECRET = "s".repeat(48);
const SEED = base64url(Buffer.from(serverIdVector.ed25519SeedHex, "hex"));

interface Mocked {
  env: { PUSH_RELAY_IDENTITY_SECRET?: string };
  /** The `relay_identity` row's value, or null when there is none. */
  value: unknown;
}

const mocked = vi.hoisted((): Mocked => ({ env: {}, value: null }));

vi.mock("#/env", () => ({ env: mocked.env }));
vi.mock("#/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (mocked.value === null ? [] : [{ value: mocked.value }]) }),
      }),
    }),
    insert: () => ({
      values: (row: { value: unknown }) => ({
        onConflictDoNothing: async () => {
          mocked.value ??= row.value;
        },
      }),
    }),
    update: () => ({
      set: (next: { value: unknown }) => ({
        where: async () => {
          mocked.value = next.value;
        },
      }),
    }),
  },
}));

const { relayIdentitySeed } = await import("#/services/settings");

beforeEach(() => {
  mocked.env.PUSH_RELAY_IDENTITY_SECRET = SECRET;
  mocked.value = null;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("relayIdentitySeed", () => {
  it("stores a generated seed sealed, never as plaintext", async () => {
    expect(await relayIdentitySeed(() => SEED)).toBe(SEED);

    const stored = JSON.stringify(mocked.value);
    expect(stored).not.toContain(SEED);
    expect(mocked.value).toMatchObject({ sealed: expect.stringMatching(/^v1\./) });
    expect(await relayIdentitySeed(() => "never used")).toBe(SEED);
  });

  it("seals a plaintext seed stored before the secret existed, keeping its serverId", async () => {
    mocked.value = { seed: SEED, createdAt: "2026-10-01T00:00:00.000Z" };

    const seed = await relayIdentitySeed(() => "never used");

    expect(identityFromSeed(fromBase64url(seed)).serverId).toBe(serverIdVector.serverId);
    expect(mocked.value).toMatchObject({ sealed: expect.any(String), createdAt: "2026-10-01T00:00:00.000Z" });
    expect(JSON.stringify(mocked.value)).not.toContain(SEED);
    expect(await relayIdentitySeed(() => "never used")).toBe(SEED);
  });

  it("refuses a sealed seed under another secret, or none, rather than replacing it", async () => {
    await relayIdentitySeed(() => SEED);
    const sealed = mocked.value;

    mocked.env.PUSH_RELAY_IDENTITY_SECRET = "t".repeat(48);
    await expect(relayIdentitySeed(() => "other")).rejects.toThrow(/not the secret/);
    mocked.env.PUSH_RELAY_IDENTITY_SECRET = undefined;
    await expect(relayIdentitySeed(() => "other")).rejects.toThrow(/not set/);
    expect(mocked.value).toBe(sealed);
  });

  it("keeps plaintext in development without a secret", async () => {
    mocked.env.PUSH_RELAY_IDENTITY_SECRET = undefined;
    expect(await relayIdentitySeed(() => SEED)).toBe(SEED);
    expect(mocked.value).toMatchObject({ seed: SEED });
  });
});
