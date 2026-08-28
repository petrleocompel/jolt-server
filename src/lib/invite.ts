import { randomInt } from "node:crypto";

/**
 * Crockford-ish alphabet: no I, L, O, U, or digits that look like letters, so
 * a code read aloud or typed off a QR-less screenshot doesn't get mangled.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ";

/** e.g. `JOLT-K7QM-4821`. Matches the shape the mock backend used. */
export function generateInviteCode(): string {
  let letters = "";
  for (let i = 0; i < 4; i += 1) {
    letters += ALPHABET[randomInt(ALPHABET.length)];
  }
  const digits = String(randomInt(10000)).padStart(4, "0");
  return `JOLT-${letters}-${digits}`;
}

export const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;

/** Trim + lowercase, matching the client's own normalisation before send. */
export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

export function isValidHandle(handle: string): boolean {
  return HANDLE_PATTERN.test(handle);
}
