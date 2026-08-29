import http2 from "node:http2";
import { SignJWT, importPKCS8 } from "jose";
import type {
  PokePushPayload,
  PushFailureReason,
  PushResult,
  PushSender,
  PushTarget,
} from "#/push/types";
import { alertTextFor } from "#/push/types";

const HOSTS = {
  sandbox: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com",
} as const;

/**
 * Apple rejects provider tokens refreshed more often than once per 20 minutes
 * (TooManyProviderTokenUpdates) and rejects tokens older than 60 minutes. 50
 * minutes sits safely between the two.
 */
const TOKEN_TTL_MS = 50 * 60 * 1000;

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  bundleId: string;
  /** Full .p8 contents. Literal `\n` escapes are tolerated (CI variables). */
  keyP8: string;
  environment: "sandbox" | "production";
}

export interface ApnsSendOutcome {
  status: number;
  reason?: string;
}

/**
 * Maps an APNs HTTP response onto our retry taxonomy. Pure and exported so the
 * rules (410 and 400/BadDeviceToken are both terminal; 429 and 5xx are worth
 * retrying; anything else is our bug) are unit-testable without a live session.
 */
export function classifyApnsOutcome(outcome: ApnsSendOutcome): PushFailureReason | undefined {
  if (outcome.status >= 200 && outcome.status < 300) return undefined;
  // 410 Unregistered, and 400/BadDeviceToken, both mean: stop using this token.
  if (outcome.status === 410) return "unregistered";
  if (outcome.status === 400 && outcome.reason === "BadDeviceToken") return "unregistered";
  if (outcome.status === 429 || outcome.status >= 500) return "transient";
  return "rejected";
}

/**
 * The two JSON bodies for one poke. The silent body deliberately omits `alert`
 * — iOS drops the background wake if an `alert` is present, which is the whole
 * reason a poke is two pushes rather than one.
 */
export function buildPokePayloadBodies(payload: PokePushPayload): {
  alertBody: string;
  silentBody: string;
} {
  const alert = alertTextFor(payload);
  const alertBody = JSON.stringify({
    aps: { alert: { title: alert.title, body: alert.body }, sound: "default" },
    type: "poke",
    poke: payload,
  });
  const silentBody = JSON.stringify({
    aps: { "content-available": 1 },
    type: "poke",
    poke: payload,
  });
  return { alertBody, silentBody };
}

/**
 * Sends the alert push, then — only when the token is still good — the silent
 * push, folding the pair into one result keyed on the alert (the push that
 * guarantees the recipient finds out). Extracted from the class, and taking
 * `sendOne` as a parameter, so the ordering and the skip-silent-when-
 * unregistered rule are testable with a fake transport.
 */
export async function deliverPokeToTarget(
  target: PushTarget,
  bodies: { alertBody: string; silentBody: string },
  base: Record<string, string | number>,
  pokeID: string,
  sendOne: (
    deviceToken: string,
    body: string,
    headers: Record<string, string | number>,
  ) => Promise<ApnsSendOutcome>,
): Promise<PushResult> {
  try {
    const alertOutcome = await sendOne(target.token, bodies.alertBody, {
      ...base,
      // apns-id must be unique per push, so only the alert carries the poke
      // id; reusing it would let APNs collapse the two.
      "apns-id": pokeID,
      "apns-push-type": "alert",
      "apns-priority": 10,
    });

    const reason = classifyApnsOutcome(alertOutcome);

    // No point spending a request on a device APNs just told us is gone.
    if (reason !== "unregistered") {
      await sendOne(target.token, bodies.silentBody, {
        ...base,
        "apns-push-type": "background",
        "apns-priority": 5,
      }).catch(() => undefined);
    }

    return reason
      ? { targetId: target.id, ok: false, reason, detail: alertOutcome.reason }
      : { targetId: target.id, ok: true };
  } catch (error) {
    return {
      targetId: target.id,
      ok: false,
      reason: "transient" satisfies PushFailureReason,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export class ApnsPushSender implements PushSender {
  private session: http2.ClientHttp2Session | null = null;
  private cachedToken: { value: string; expiresAt: number } | null = null;
  private signingKey: Promise<CryptoKey> | null = null;

  constructor(private readonly config: ApnsConfig) {}

  private getSigningKey(): Promise<CryptoKey> {
    this.signingKey ??= importPKCS8(
      this.config.keyP8.replace(/\\n/g, "\n").trim(),
      "ES256",
    );
    return this.signingKey;
  }

  private async providerToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now) {
      return this.cachedToken.value;
    }
    const value = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.config.keyId })
      .setIssuer(this.config.teamId)
      .setIssuedAt()
      .sign(await this.getSigningKey());

    this.cachedToken = { value, expiresAt: now + TOKEN_TTL_MS };
    return value;
  }

  private getSession(): http2.ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed) {
      return this.session;
    }
    const session = http2.connect(HOSTS[this.config.environment]);
    // Without this an APNs-side disconnect surfaces as an unhandled 'error'
    // event and takes the process down.
    session.on("error", () => {
      if (this.session === session) this.session = null;
    });
    session.on("close", () => {
      if (this.session === session) this.session = null;
    });
    this.session = session;
    return session;
  }

  private send(
    deviceToken: string,
    body: string,
    headers: Record<string, string | number>,
  ): Promise<ApnsSendOutcome> {
    return new Promise((resolve, reject) => {
      const req = this.getSession().request({
        ":method": "POST",
        ":path": `/3/device/${deviceToken}`,
        "content-type": "application/json",
        ...headers,
      });

      let status = 0;
      let raw = "";

      req.setEncoding("utf8");
      req.on("response", (res) => {
        status = Number(res[":status"] ?? 0);
      });
      req.on("data", (chunk: string) => {
        raw += chunk;
      });
      req.on("error", reject);
      req.on("end", () => {
        let reason: string | undefined;
        if (raw) {
          try {
            reason = (JSON.parse(raw) as { reason?: string }).reason;
          } catch {
            reason = raw.slice(0, 200);
          }
        }
        resolve({ status, reason });
      });

      req.setTimeout(10_000, () => req.destroy(new Error("APNs request timed out")));
      req.end(body);
    });
  }

  async sendPoke(
    targets: Array<PushTarget>,
    payload: PokePushPayload,
  ): Promise<Array<PushResult>> {
    if (targets.length === 0) return [];

    const token = await this.providerToken();
    const bodies = buildPokePayloadBodies(payload);

    const base = {
      authorization: `bearer ${token}`,
      "apns-topic": this.config.bundleId,
      // A poke is worthless if it arrives an hour late.
      "apns-expiration": Math.floor(Date.now() / 1000) + 300,
    };

    return Promise.all(
      targets.map((target) =>
        deliverPokeToTarget(target, bodies, base, payload.pokeID, (deviceToken, body, headers) =>
          this.send(deviceToken, body, headers),
        ),
      ),
    );
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.session || this.session.closed) return resolve();
      this.session.close(() => resolve());
    });
    this.session = null;
  }
}
