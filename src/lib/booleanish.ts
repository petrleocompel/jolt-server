/**
 * Reads a yes/no environment variable the way a person writes one.
 *
 * Not `z.coerce.boolean()`, which is `Boolean(value)` — so `"false"` and
 * `"0"` both come out `true`, and an operator who sets
 * `AUTOMATION_CONSENT_REQUIRED=false` gets the opposite of what they asked
 * for. Anything not recognised is null, so the caller can refuse to start
 * rather than guess.
 */
export function parseBooleanish(raw: string): boolean | null {
  const value = raw.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(value)) return true;
  if (["false", "0", "no", "off"].includes(value)) return false;
  return null;
}
