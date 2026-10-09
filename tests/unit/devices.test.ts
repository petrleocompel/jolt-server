import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "#/api/errors";
import { atRestKey, openPayloadKey, sealPayloadKey } from "#/push/payload-key";
import { fromBase64url } from "#/push/envelope";
import envelopeVectors from "./vectors/envelope-v1.json";

/**
 * Registering a relay device: the key is checked against its id, stored
 * sealed, and unsealed again only on the way to the relay sender.
 */

const SECRET = "x".repeat(48);
const RELAY_TOKEN = `rt_${"B".repeat(43)}`;

interface Mocked {
  inserted: Array<Record<string, unknown>>;
  conflicts: Array<{ set: Record<string, unknown>; setWhere?: unknown }>;
  rows: Array<Record<string, unknown>>;
  /** The token already has a row, and it is disabled: the update matches nothing. */
  disabledRowExists: boolean;
}

const mocked = vi.hoisted(
  (): Mocked => ({ inserted: [], conflicts: [], rows: [], disabledRowExists: false }),
);

vi.mock("#/env", () => ({ env: { BETTER_AUTH_SECRET: "x".repeat(48) } }));
vi.mock("#/db", () => ({
  db: {
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        onConflictDoUpdate: (options: { set: Record<string, unknown>; setWhere?: unknown }) => {
          mocked.inserted.push(row);
          mocked.conflicts.push(options);
          // Awaitable as is (the APNs branch), or with `.returning()` (the
          // relay branch), which comes back empty when a `setWhere` excluded
          // the existing row.
          return Object.assign(Promise.resolve(), {
            returning: async () =>
              mocked.disabledRowExists && options.setWhere ? [] : [{ id: "row-1" }],
          });
        },
      }),
    }),
    select: () => ({ from: () => ({ where: async () => mocked.rows }) }),
  },
}));

const { activeTargets, registerToken } = await import("#/services/devices");

beforeEach(() => {
  mocked.inserted = [];
  mocked.conflicts = [];
  mocked.rows = [];
  mocked.disabledRowExists = false;
});

describe("payload keys at rest", () => {
  const key = Buffer.alloc(32, 9);

  it("open with the same secret and token only", () => {
    const sealed = sealPayloadKey(atRestKey(SECRET), RELAY_TOKEN, key);
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain(key.toString("base64url"));
    expect(openPayloadKey(atRestKey(SECRET), RELAY_TOKEN, sealed)).toEqual(key);
    expect(openPayloadKey(atRestKey(`${SECRET}!`), RELAY_TOKEN, sealed)).toBeNull();
    expect(openPayloadKey(atRestKey(SECRET), `rt_${"C".repeat(43)}`, sealed)).toBeNull();
    expect(openPayloadKey(atRestKey(SECRET), RELAY_TOKEN, "garbage")).toBeNull();
  });
});

describe("registerToken", () => {
  it("stores a relay device with its key sealed", async () => {
    await registerToken("user-1", {
      transport: "relay",
      platform: "android",
      relayToken: RELAY_TOKEN,
      payloadKey: envelopeVectors.keyB64u,
      keyId: envelopeVectors.kid,
    });

    const [row] = mocked.inserted;
    expect(row).toMatchObject({
      userId: "user-1",
      token: RELAY_TOKEN,
      platform: "android",
      transport: "relay",
      keyId: envelopeVectors.kid,
    });
    expect(openPayloadKey(atRestKey(SECRET), RELAY_TOKEN, String(row!.payloadKey))).toEqual(
      fromBase64url(envelopeVectors.keyB64u),
    );
    // Re-registering an active token replaces its key, and only an active one.
    expect(mocked.conflicts[0]!.set).toMatchObject({ transport: "relay", userId: "user-1" });
    expect(mocked.conflicts[0]!.set.payloadKey).toBe(row!.payloadKey);
    expect(mocked.conflicts[0]!.set).not.toHaveProperty("disabledAt");
    expect(mocked.conflicts[0]!.setWhere).toBeDefined();
  });

  it("answers 410 relay_token_revoked for a token the relay revoked, without reviving it", async () => {
    mocked.disabledRowExists = true;
    const attempt = registerToken("user-1", {
      transport: "relay",
      platform: "ios",
      relayToken: RELAY_TOKEN,
      payloadKey: envelopeVectors.keyB64u,
      keyId: envelopeVectors.kid,
    });
    await expect(attempt).rejects.toMatchObject({ status: 410, code: "relay_token_revoked" });
  });

  it("still revives a disabled APNs token, as before", async () => {
    mocked.disabledRowExists = true;
    await registerToken("user-1", { token: "abc123", platform: "ios" });
    expect(mocked.conflicts[0]).toMatchObject({ set: { disabledAt: null } });
    expect(mocked.conflicts[0]!.setWhere).toBeUndefined();
  });

  it("refuses a keyId that is not derived from the key", async () => {
    await expect(
      registerToken("user-1", {
        transport: "relay",
        platform: "ios",
        relayToken: RELAY_TOKEN,
        payloadKey: envelopeVectors.keyB64u,
        keyId: "AAAAAAAAAAA",
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(mocked.inserted).toEqual([]);
  });

  it("keeps the original APNs registration as it was, clearing any relay key", async () => {
    await registerToken("user-1", { token: "abc123", platform: "ios" });
    expect(mocked.inserted[0]).toMatchObject({
      token: "abc123",
      transport: "apns",
      payloadKey: null,
      keyId: null,
    });
  });
});

describe("activeTargets", () => {
  it("unseals relay keys, and leaves out one that no longer opens", async () => {
    const key = Buffer.alloc(32, 3);
    mocked.rows = [
      { id: "a", token: "abc", transport: "apns", payloadKey: null },
      {
        id: "r",
        token: RELAY_TOKEN,
        transport: "relay",
        payloadKey: sealPayloadKey(atRestKey(SECRET), RELAY_TOKEN, key),
      },
      {
        id: "stale",
        token: RELAY_TOKEN,
        transport: "relay",
        payloadKey: sealPayloadKey(atRestKey("an older secret, since rotated"), RELAY_TOKEN, key),
      },
    ];

    expect(await activeTargets("user-1")).toEqual([
      { id: "a", token: "abc", transport: "apns" },
      { id: "r", token: RELAY_TOKEN, transport: "relay", payloadKey: key },
      { id: "stale", token: RELAY_TOKEN, transport: "relay" },
    ]);
  });
});
