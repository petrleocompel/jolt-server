import { describe, expect, it, vi } from "vitest";

/**
 * The service talks to Postgres for everything except minting and
 * recognising a token, which is the part worth pinning down here — the
 * database-backed half (ownership, expiry, revocation) is covered end to end
 * in tests/e2e/contract.spec.ts, against a real database.
 *
 * `#/db` is stubbed because importing it parses the server environment, which
 * a unit test has no reason to have.
 */
vi.mock("#/db", () => ({ db: {} }));

const { generateApiToken, hashToken, isApiTokenCandidate } = await import(
  "#/services/api-tokens"
);

describe("generateApiToken", () => {
  it("marks the token so a leak is greppable and a session is distinguishable", () => {
    const { token } = generateApiToken();
    expect(token.startsWith("jolt_pat_")).toBe(true);
    expect(isApiTokenCandidate(token)).toBe(true);
    // A Better Auth session token must not be mistaken for one of ours.
    expect(isApiTokenCandidate("kP3n8x2Qw9dZ7vB1")).toBe(false);
  });

  it("mints 32 bytes of entropy, never the same twice", () => {
    const secrets = new Set(
      Array.from({ length: 50 }, () => generateApiToken().token.replace("jolt_pat_", "")),
    );
    expect(secrets.size).toBe(50);
    // base64url of 32 bytes, unpadded.
    for (const secret of secrets) expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("stores a hash, and a prefix that is only the start of the secret", () => {
    const { token, tokenHash, prefix } = generateApiToken();

    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(hashToken(token));
    // The row must never be enough to reconstruct the credential.
    expect(token).not.toContain(tokenHash);
    expect(prefix).toHaveLength(6);
    expect(token).toBe(`jolt_pat_${prefix}${token.slice(9 + prefix.length)}`);
  });
});

describe("hashToken", () => {
  it("is stable, and differs for tokens that differ by one character", () => {
    expect(hashToken("jolt_pat_abc")).toBe(hashToken("jolt_pat_abc"));
    expect(hashToken("jolt_pat_abc")).not.toBe(hashToken("jolt_pat_abd"));
  });
});
