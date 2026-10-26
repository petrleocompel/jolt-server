import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { fromBase64url } from "#/push/envelope";

/**
 * Secrets the server keeps in its own database, sealed so a dump of that
 * database alone does not give them away: AES-256-GCM under a key derived
 * with HKDF from a secret that lives only in the environment. `aad` binds a
 * sealed value to where it is stored, so it does not open anywhere else.
 */

const VERSION = "v1";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** A 32-byte key for one purpose, named by `info`. */
export function deriveSealingKey(secret: string, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "jolt-server", info, 32));
}

/** `v1.<nonce>.<ciphertext+tag>`, all base64url. */
export function seal(key: Buffer, aad: string, plaintext: Buffer): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const sealed = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return `${VERSION}.${nonce.toString("base64url")}.${sealed.toString("base64url")}`;
}

/** Null when the value cannot be opened — another secret, or a hand-edited row. */
export function open(key: Buffer, aad: string, stored: string): Buffer | null {
  try {
    const [version, nonce, sealed] = stored.split(".");
    if (version !== VERSION || !nonce || !sealed) return null;
    const body = fromBase64url(sealed);
    const decipher = createDecipheriv("aes-256-gcm", key, fromBase64url(nonce));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(body.subarray(0, body.length - TAG_BYTES)),
      decipher.final(),
    ]);
  } catch {
    return null;
  }
}
