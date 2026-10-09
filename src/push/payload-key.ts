import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { fromBase64url } from "#/push/envelope";

/**
 * Keeps relay payload keys sealed in `device_token.payload_key`.
 *
 * A payload key is what lets a phone read a push the relay forwarded, so a
 * leaked database must not hand them out alongside the relay tokens they
 * belong to. They are encrypted with AES-256-GCM under a key derived from
 * BETTER_AUTH_SECRET with HKDF, and bound to the row's relay token, so a
 * sealed key copied onto another row does not open.
 *
 * Rotating BETTER_AUTH_SECRET makes the stored keys unreadable. That costs a
 * relay device its pushes only until the app next starts and registers again
 * with a fresh key, which it does on every launch.
 */

const VERSION = "v1";
const NONCE_BYTES = 12;

export function atRestKey(secret: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", secret, "jolt-server", "device_token.payload_key v1", 32),
  );
}

/** `v1.<nonce>.<ciphertext+tag>`, all base64url. */
export function sealPayloadKey(atRest: Buffer, relayToken: string, payloadKey: Buffer): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", atRest, nonce);
  cipher.setAAD(Buffer.from(relayToken, "utf8"));
  const sealed = Buffer.concat([cipher.update(payloadKey), cipher.final(), cipher.getAuthTag()]);
  return `${VERSION}.${nonce.toString("base64url")}.${sealed.toString("base64url")}`;
}

/** Null when the value cannot be opened — a rotated secret, or a hand-edited row. */
export function openPayloadKey(atRest: Buffer, relayToken: string, stored: string): Buffer | null {
  try {
    const [version, nonce, sealed] = stored.split(".");
    if (version !== VERSION || !nonce || !sealed) return null;
    const body = fromBase64url(sealed);
    const decipher = createDecipheriv("aes-256-gcm", atRest, fromBase64url(nonce));
    decipher.setAAD(Buffer.from(relayToken, "utf8"));
    decipher.setAuthTag(body.subarray(body.length - 16));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
  } catch {
    return null;
  }
}
