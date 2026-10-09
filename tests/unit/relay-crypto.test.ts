import { describe, expect, it } from "vitest";
import { createPublicKey } from "node:crypto";
import { decodeProtectedHeader, jwtVerify } from "jose";
import {
  base64url,
  fromBase64url,
  openEnvelope,
  payloadKeyId,
  sealEnvelope,
} from "#/push/envelope";
import type { EnvelopeKind } from "#/push/envelope";
import {
  base32,
  identityFromSeed,
  parseIdentityKey,
  serverIdFor,
  signRelayJwt,
} from "#/push/relay-identity";
import envelopeVectors from "./vectors/envelope-v1.json";
import serverIdVector from "./vectors/server-id.json";

/**
 * The relay protocol's cryptography, checked against the normative vectors
 * every implementation shares (tests/unit/vectors, copied from jolt-relay).
 * If these pass here and in the apps, a push sealed by this server opens on
 * the phone.
 */

const key = fromBase64url(envelopeVectors.keyB64u);
const cases = Object.fromEntries(envelopeVectors.cases.map((c) => [c.name, c]));

describe("envelope v1", () => {
  it("derives the vector's kid from the key", () => {
    expect(payloadKeyId(key)).toBe(envelopeVectors.kid);
  });

  it.each(envelopeVectors.cases)("seals $name to exactly the vector", (vector) => {
    const envelope = sealEnvelope({
      payloadKey: key,
      serverId: vector.serverId,
      kind: vector.kind as EnvelopeKind,
      plaintext: vector.plaintext,
      nonce: fromBase64url(vector.envelope.n),
    });
    expect(envelope).toEqual(vector.envelope);
  });

  it.each(envelopeVectors.cases)("opens the $name vector", (vector) => {
    expect(
      openEnvelope({
        payloadKey: key,
        serverId: vector.serverId,
        kind: vector.kind as EnvelopeKind,
        envelope: { ...vector.envelope, v: 1 },
      }),
    ).toBe(vector.plaintext);
  });

  it.each(envelopeVectors.negative)("refuses $name", (negative) => {
    const source = cases[negative.envelopeOf]!;
    expect(() =>
      openEnvelope({
        payloadKey: key,
        serverId: negative.serverId ?? source.serverId,
        kind: (negative.kind ?? source.kind) as EnvelopeKind,
        envelope: { ...source.envelope, v: 1 },
      }),
    ).toThrow();
  });

  it("refuses a tampered ciphertext and a different key", () => {
    const source = cases.poke!;
    const ct = fromBase64url(source.envelope.ct);
    ct[0] = (ct[0] ?? 0) ^ 1;
    const options = { serverId: source.serverId, kind: "poke" as const };
    expect(() =>
      openEnvelope({ ...options, payloadKey: key, envelope: { ...source.envelope, v: 1, ct: base64url(ct) } }),
    ).toThrow();
    expect(() =>
      openEnvelope({ ...options, payloadKey: Buffer.alloc(32, 7), envelope: { ...source.envelope, v: 1 } }),
    ).toThrow(/kid/);
  });

  it("never reuses a nonce on its own", () => {
    const options = { payloadKey: key, serverId: "srv_x", kind: "poke" as const, plaintext: "{}" };
    expect(sealEnvelope(options).n).not.toBe(sealEnvelope(options).n);
  });

  it("refuses a key of the wrong length", () => {
    expect(() =>
      sealEnvelope({ payloadKey: Buffer.alloc(16), serverId: "srv_x", kind: "poke", plaintext: "{}" }),
    ).toThrow();
  });
});

describe("serverId", () => {
  const seed = Buffer.from(serverIdVector.ed25519SeedHex, "hex");

  it("derives the vector's public key and serverId from its seed", () => {
    const identity = identityFromSeed(seed);
    expect(base64url(identity.publicKey)).toBe(serverIdVector.publicKey);
    expect(identity.serverId).toBe(serverIdVector.serverId);
    expect(serverIdFor(fromBase64url(serverIdVector.publicKey))).toBe(serverIdVector.serverId);
  });

  it("is 30 characters of srv_ and lowercase base32", () => {
    expect(serverIdVector.serverId).toMatch(/^srv_[a-z2-7]{26}$/);
    expect(base32(Buffer.from("foobar"))).toBe("mzxw6ytboi");
  });

  it("reads PUSH_RELAY_PRIVATE_KEY as a seed or as a PEM", () => {
    expect(parseIdentityKey(base64url(seed)).serverId).toBe(serverIdVector.serverId);
    expect(parseIdentityKey(seed.toString("base64")).serverId).toBe(serverIdVector.serverId);
    const pem = identityFromSeed(seed).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    expect(parseIdentityKey(pem).serverId).toBe(serverIdVector.serverId);
    expect(parseIdentityKey(pem.replace(/\n/g, "\\n")).serverId).toBe(serverIdVector.serverId);
  });

  it("refuses a key it cannot read rather than becoming another server", () => {
    expect(() => parseIdentityKey("not a key")).toThrow();
    expect(() => parseIdentityKey(base64url(Buffer.alloc(31)))).toThrow();
  });
});

describe("relay JWT", () => {
  const identity = identityFromSeed(Buffer.from(serverIdVector.ed25519SeedHex, "hex"));

  it("is an EdDSA token for jolt-relay, issued by and keyed to the serverId", async () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signRelayJwt(identity, now);

    expect(decodeProtectedHeader(jwt)).toEqual({
      alg: "EdDSA",
      typ: "JWT",
      kid: serverIdVector.serverId,
    });
    const { payload } = await jwtVerify(jwt, createPublicKey(identity.privateKey), {
      audience: "jolt-relay",
      issuer: serverIdVector.serverId,
    });
    expect(payload).toEqual({
      iss: serverIdVector.serverId,
      aud: "jolt-relay",
      iat: now,
      exp: now + 300,
    });
  });
});
