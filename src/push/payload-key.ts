import { deriveSealingKey, open, seal } from "#/lib/sealed";

/**
 * Keeps relay payload keys sealed in `device_token.payload_key`.
 *
 * A payload key is what lets a phone read a push the relay forwarded, so a
 * leaked database must not hand them out alongside the relay tokens they
 * belong to. They are sealed (src/lib/sealed.ts) under a key derived from
 * BETTER_AUTH_SECRET, and bound to the row's relay token, so a sealed key
 * copied onto another row does not open.
 *
 * Rotating BETTER_AUTH_SECRET makes the stored keys unreadable. That costs a
 * relay device its pushes only until the app next starts and registers again
 * with a fresh key, which it does on every launch.
 */

export function atRestKey(secret: string): Buffer {
  return deriveSealingKey(secret, "device_token.payload_key v1");
}

export function sealPayloadKey(atRest: Buffer, relayToken: string, payloadKey: Buffer): string {
  return seal(atRest, relayToken, payloadKey);
}

/** Null when the value cannot be opened — a rotated secret, or a hand-edited row. */
export function openPayloadKey(atRest: Buffer, relayToken: string, stored: string): Buffer | null {
  return open(atRest, relayToken, stored);
}
