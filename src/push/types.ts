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
  /**
   * Who the poke is addressed to. A device is registered to one account at a
   * time, but a stale registration used to be undetectable from the payload:
   * the push arrived, fired, and the only trace was an ack the server 404'd.
   * A client that knows its own handle can drop a poke meant for somebody
   * else instead of shocking the wrong wrist.
   */
  recipientHandle: string;
  stimulus: StimulusConfig;
  /**
   * When the server accepted the poke, ISO-8601. The alert body already
   * carries a rendered time, but that one is in the server's configured zone
   * — a client that wants the recipient's own local time formats this.
   */
  sentAt: string;
}

/**
 * The `test` object inside a diagnostic push — see `TestPushPayload` in
 * openapi/jolt-v1.yaml. Sent by "test my notifications" from the web
 * dashboard or the app's Settings screen, and deliberately NOT a poke: it has
 * no `poke_event` row behind it, so the device acks it to
 * `/devices/test-push/{testID}/ack` rather than to the poke ack endpoint.
 *
 * `stimulus` is what makes the caller's choice explicit — absent means
 * "notification only, leave the wearable alone", present means "fire this
 * too", so APNs delivery can be tested from a desk with no device connected.
 */
export interface TestPushPayload {
  testID: string;
  /** Which device this copy went to, echoed back in the ack. */
  deviceID: string;
  sentAt: string;
  source: "web" | "app";
  stimulus?: StimulusConfig;
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

  /**
   * The same alert + silent pair for a diagnostic test push. Takes a payload
   * *per target* rather than one for all of them, because each device is told
   * its own `deviceID` so its ack can be attributed.
   */
  sendTest: (
    targets: Array<PushTarget>,
    payload: Omit<TestPushPayload, "deviceID">,
  ) => Promise<Array<PushResult>>;
  close: () => Promise<void>;
}

/** How strong it was, as the alert says it: "30% x2", or just "30%". */
export function formatStimulus(stimulus: StimulusConfig): string {
  const repeats = stimulus.repetitions > 1 ? ` x${stimulus.repetitions}` : "";
  return `${stimulus.intensity}%${repeats}`;
}

/**
 * When it was sent, as the alert says it: "14:32 UTC".
 *
 * Rendered server-side, so it is in the server's configured zone rather than
 * the recipient's — hence the zone name, which is the whole reason it is
 * printed. A client that wants local time has the raw `sentAt` in the payload
 * and should prefer it. Returns "" for a timestamp we cannot parse, so a bad
 * clock costs the time, not the notification.
 */
export function formatSendTime(sentAt: string | undefined, timeZone = "UTC"): string {
  if (!sentAt) return "";
  const at = new Date(sentAt);
  if (Number.isNaN(at.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
      timeZoneName: "short",
    }).format(at);
  } catch {
    // An unknown zone is a misconfiguration, not a reason to drop the push.
    return formatSendTime(sentAt, "UTC");
  }
}

/**
 * Human-readable alert text, e.g. "Alice" / "zapped you — 30% x2 at 14:32 UTC".
 *
 * The strength and the time are in the body deliberately: a poke arrives
 * while the phone is locked, and "zapped you" alone tells the recipient
 * neither how hard nor — once a few pile up, or the push is delivered late —
 * which one they are looking at.
 */
export function alertTextFor(
  payload: PokePushPayload,
  timeZone?: string,
): { title: string; body: string } {
  const verb: Record<StimulusKind, string> = {
    zap: "zapped you",
    vibe: "buzzed you",
    beep: "beeped you",
  };
  const at = formatSendTime(payload.sentAt, timeZone);
  return {
    title: payload.senderDisplayName || `@${payload.senderHandle}`,
    body: `${verb[payload.stimulus.kind]} — ${formatStimulus(payload.stimulus)}${at ? ` at ${at}` : ""}`,
  };
}

/** Alert text for a diagnostic push. Says which half of the test it is. */
export function testAlertTextFor(
  payload: { stimulus?: StimulusConfig; sentAt?: string },
  timeZone?: string,
): { title: string; body: string } {
  const at = formatSendTime(payload.sentAt, timeZone);
  const sentAt = at ? `, sent ${at}` : "";
  if (!payload.stimulus) {
    return { title: "Jolt", body: `Test notification — push delivery works${sentAt}.` };
  }
  return {
    title: "Jolt test",
    body: `Delivery works — firing ${payload.stimulus.kind} ${formatStimulus(payload.stimulus)}${sentAt}.`,
  };
}
