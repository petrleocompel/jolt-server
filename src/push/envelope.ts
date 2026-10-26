import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Payload envelope v1 — section 6 of the relay protocol
 * (jolt-relay/spec/protocol-v1.md).
 *
 * Everything a push carries through the relay is sealed with AES-256-GCM
 * under a key only this server and the app hold, so the relay forwards
 * ciphertext it cannot read. The additional data binds the ciphertext to the
 * sending server and the message kind: a poke envelope replayed as a test,
 * or under another server's id, fails to open on the phone.
 */

export type EnvelopeKind = "poke" | "test";

export interface EnvelopeV1 {
  v: 1;
  /** base64url of the first 8 bytes of SHA-256(payloadKey). */
  kid: string;
  /** base64url of the 12-byte nonce. */
  n: string;
  /** base64url of ciphertext || 16-byte GCM tag. */
  ct: string;
}

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
export const PAYLOAD_KEY_BYTES = 32;

/** RFC 4648 §5, no padding — the only base64 the protocol uses. */
export function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Decodes base64url, refusing anything that does not round-trip. Node's own
 * decoder skips characters it does not know, so "not base64 at all" would
 * otherwise come out as a shorter, perfectly usable buffer.
 */
export function fromBase64url(text: string): Buffer {
  const bytes = Buffer.from(text, "base64url");
  if (bytes.toString("base64url") !== text) {
    throw new Error("not canonical base64url");
  }
  return bytes;
}

/** The `kid` of a payload key: which of a device's keys sealed an envelope. */
export function payloadKeyId(payloadKey: Uint8Array): string {
  return base64url(createHash("sha256").update(payloadKey).digest().subarray(0, 8));
}

export function envelopeAad(serverId: string, kind: EnvelopeKind): Buffer {
  return Buffer.from(`jolt-push-v1|${serverId}|${kind}`, "utf8");
}

/**
 * Seals one plaintext for one registration. `nonce` is for the test vectors
 * only: in production every envelope must get a fresh random one, or GCM
 * leaks the XOR of two plaintexts and the authentication key with them.
 */
export function sealEnvelope(options: {
  payloadKey: Uint8Array;
  serverId: string;
  kind: EnvelopeKind;
  plaintext: string;
  nonce?: Uint8Array;
}): EnvelopeV1 {
  if (options.payloadKey.length !== PAYLOAD_KEY_BYTES) {
    throw new Error(`payload key must be ${PAYLOAD_KEY_BYTES} bytes`);
  }
  const nonce = options.nonce ?? randomBytes(NONCE_BYTES);
  if (nonce.length !== NONCE_BYTES) throw new Error(`nonce must be ${NONCE_BYTES} bytes`);

  const cipher = createCipheriv("aes-256-gcm", options.payloadKey, nonce, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(envelopeAad(options.serverId, options.kind));
  const ciphertext = Buffer.concat([
    cipher.update(options.plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  return {
    v: 1,
    kid: payloadKeyId(options.payloadKey),
    n: base64url(nonce),
    ct: base64url(ciphertext),
  };
}

/**
 * The receiving side, as the apps implement it. The server never opens an
 * envelope in production; this exists so the tests can check the sealing
 * against the shared vectors from both directions. Throws when the key, the
 * server id or the kind does not match what sealed it.
 */
export function openEnvelope(options: {
  payloadKey: Uint8Array;
  serverId: string;
  kind: EnvelopeKind;
  envelope: { v: number; kid: string; n: string; ct: string };
}): string {
  const { envelope } = options;
  if (envelope.v !== 1) throw new Error(`unsupported envelope version ${String(envelope.v)}`);
  if (envelope.kid !== payloadKeyId(options.payloadKey)) throw new Error("kid mismatch");

  const nonce = fromBase64url(envelope.n);
  const sealed = fromBase64url(envelope.ct);
  if (nonce.length !== NONCE_BYTES || sealed.length < TAG_BYTES) {
    throw new Error("malformed envelope");
  }

  const decipher = createDecipheriv("aes-256-gcm", options.payloadKey, nonce, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(envelopeAad(options.serverId, options.kind));
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
  return Buffer.concat([
    decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
}
