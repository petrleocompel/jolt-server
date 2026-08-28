export type StimulusKind = "zap" | "vibe" | "beep";

export interface StimulusConfig {
  kind: StimulusKind;
  intensity: number;
  repetitions: number;
}

/**
 * The `poke` object inside the APNs payload — see `PokePushPayload` in
 * openapi/jolt-v1.yaml and `PokePushPayload(userInfo:)` in the mobile client.
 * Deliberately self-contained: the silent-push handler has to act inside
 * iOS's tight background budget, with no time for a round-trip API call.
 */
export interface PokePushPayload {
  pokeID: string;
  senderHandle: string;
  senderDisplayName: string;
  stimulus: StimulusConfig;
}

export interface PushTarget {
  /** device_token.id, so a failure can be traced back to a row. */
  id: string;
  token: string;
}

export type PushFailureReason =
  /** APNs 410, or 400/BadDeviceToken — the token is dead, stop using it. */
  | "unregistered"
  /** Transient: network, 429, 5xx. Worth retrying later. */
  | "transient"
  /** Our bug or misconfiguration: bad topic, bad auth key, malformed payload. */
  | "rejected";

export interface PushResult {
  targetId: string;
  ok: boolean;
  reason?: PushFailureReason;
  detail?: string;
}

export interface PushSender {
  /**
   * Sends both pushes for one poke to every target:
   *   1. an alert push  (apns-push-type: alert, priority 10)
   *   2. a silent push  (apns-push-type: background, priority 5)
   *
   * They cannot be combined into one payload — iOS suppresses the background
   * wake whenever an `alert` is present.
   *
   * Resolves with one result per target, keyed on the *alert* push, since
   * that is the one that guarantees the recipient finds out. Never throws for
   * per-device failures; a rejected token is a result, not an exception.
   */
  sendPoke: (targets: Array<PushTarget>, payload: PokePushPayload) => Promise<Array<PushResult>>;
  close: () => Promise<void>;
}

/** Human-readable alert text, e.g. "Alice" / "zapped you!". */
export function alertTextFor(payload: PokePushPayload): { title: string; body: string } {
  const verb: Record<StimulusKind, string> = {
    zap: "zapped you!",
    vibe: "buzzed you!",
    beep: "beeped you!",
  };
  return {
    title: payload.senderDisplayName || `@${payload.senderHandle}`,
    body: verb[payload.stimulus.kind],
  };
}
