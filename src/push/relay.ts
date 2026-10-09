import { sealEnvelope } from "#/push/envelope";
import type { EnvelopeKind, EnvelopeV1 } from "#/push/envelope";
import { RelayError } from "#/push/relay-identity";
import type { RelayClient } from "#/push/relay-identity";
import type {
  PokePushPayload,
  PushFailureReason,
  PushResult,
  PushSender,
  PushTarget,
  TestPushPayload,
} from "#/push/types";

/**
 * Delivers pushes through the Jolt push relay — section 5 of the relay
 * protocol (jolt-relay/spec/protocol-v1.md).
 *
 * The relay holds the APNs key for the official app builds, so a self-hosted
 * server needs no Apple credentials of its own. What it forwards is sealed
 * per device (see src/push/envelope.ts): the relay learns which server sent
 * how much to which registration, and never what a poke says. It sends the
 * same alert + silent pair the direct sender does, with localized fallback
 * text the app replaces once it has decrypted the payload.
 */

/** The relay accepts at most this many messages per `/v1/send`. */
export const RELAY_BATCH_SIZE = 100;

/**
 * Same budget as the direct sender's `apns-expiration`: a poke is worthless
 * if it arrives an hour late, and a test push the user is watching for even
 * more so.
 */
const TTL_SECONDS = 300;

export type RelayMessageStatus = "ok" | "unregistered" | "rate_limited" | "transient" | "rejected";

interface RelayMessage {
  relayToken: string;
  kind: EnvelopeKind;
  envelope: EnvelopeV1;
  ttlSeconds: number;
  collapseId?: string;
}

/**
 * The contract's table, as our retry taxonomy. `unregistered` also covers a
 * registration that belongs to another server — deliberately the same
 * answer, and for us the same outcome: stop using that token.
 */
export function classifyRelayStatus(status: string): PushFailureReason | undefined {
  switch (status) {
    case "ok":
      return undefined;
    case "unregistered":
      return "unregistered";
    case "rate_limited":
    case "transient":
      return "transient";
    default:
      return "rejected";
  }
}

/** A whole `/v1/send` that failed: the same outcome for every message in it. */
class BatchFailure extends Error {
  constructor(
    readonly reason: PushFailureReason,
    message: string,
  ) {
    super(message);
  }
}

/** A blocked server is refused for good; anything else may pass on its own. */
function failureReasonOf(error: unknown): PushFailureReason {
  if (error instanceof BatchFailure) return error.reason;
  if (error instanceof RelayError && error.code === "server_blocked") return "rejected";
  return "transient";
}

function errorCodeOf(body: unknown): string | undefined {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return undefined;
}

export class RelayPushSender implements PushSender {
  constructor(
    private readonly client: RelayClient,
    private readonly batchSize = RELAY_BATCH_SIZE,
  ) {}

  sendPoke(targets: Array<PushTarget>, payload: PokePushPayload): Promise<Array<PushResult>> {
    // One plaintext for every device: a poke says the same thing to each.
    let plaintext: string | null = null;
    return this.deliver(targets, "poke", payload.pokeID, (serverId) => {
      plaintext ??= JSON.stringify({ type: "poke", poke: { ...payload, serverId } });
      return plaintext;
    });
  }

  sendTest(
    targets: Array<PushTarget>,
    payload: Omit<TestPushPayload, "deviceID">,
  ): Promise<Array<PushResult>> {
    // Per target: each device is told its own id so its ack can be attributed.
    return this.deliver(targets, "test", payload.testID, (serverId, target) =>
      JSON.stringify({ type: "test", test: { ...payload, deviceID: target.id, serverId } }),
    );
  }

  async close(): Promise<void> {}

  private async deliver(
    targets: Array<PushTarget>,
    kind: EnvelopeKind,
    collapseId: string,
    plaintextFor: (serverId: string, target: PushTarget) => string,
  ): Promise<Array<PushResult>> {
    if (targets.length === 0) return [];

    let serverId: string;
    try {
      serverId = (await this.client.getIdentity()).serverId;
      await this.client.ensureRegistered();
    } catch (error) {
      return targets.map((target) => ({
        targetId: target.id,
        ok: false,
        reason: failureReasonOf(error),
        detail: error instanceof Error ? error.message : String(error),
      }));
    }

    const results = new Map<string, PushResult>();
    const sendable: Array<{ target: PushTarget; message: RelayMessage }> = [];
    for (const target of targets) {
      if (!target.payloadKey) {
        results.set(target.id, {
          targetId: target.id,
          ok: false,
          reason: "rejected",
          detail: "The device's payload key cannot be read; it has to register again.",
        });
        continue;
      }
      sendable.push({
        target,
        message: {
          relayToken: target.token,
          kind,
          envelope: sealEnvelope({
            payloadKey: target.payloadKey,
            serverId,
            kind,
            plaintext: plaintextFor(serverId, target),
          }),
          ttlSeconds: TTL_SECONDS,
          collapseId,
        },
      });
    }

    for (let start = 0; start < sendable.length; start += this.batchSize) {
      const batch = sendable.slice(start, start + this.batchSize);
      const statuses = await this.sendBatch(batch.map((entry) => entry.message)).catch(
        (error: unknown) => {
          this.client.recordError(error);
          // Spelled as the relay's own statuses, which the classification
          // below maps back to the same reason.
          const status: RelayMessageStatus = failureReasonOf(error);
          const detail = error instanceof Error ? error.message : String(error);
          return batch.map(() => ({ status, detail }));
        },
      );
      batch.forEach(({ target }, index) => {
        const outcome = statuses[index];
        const reason = outcome ? classifyRelayStatus(outcome.status) : "transient";
        results.set(
          target.id,
          reason
            ? {
                targetId: target.id,
                ok: false,
                reason,
                detail: outcome?.detail ?? outcome?.status ?? "The relay gave no result for it.",
              }
            : { targetId: target.id, ok: true },
        );
      });
    }

    return targets.map((target) => results.get(target.id)!);
  }

  /**
   * One `/v1/send`. A relay that no longer knows this server (its database
   * was reset, or it forgot an idle server) answers 404 `unknown_server`:
   * register again and retry once.
   */
  private async sendBatch(
    messages: Array<RelayMessage>,
    retried = false,
  ): Promise<Array<{ status: string; detail?: string }>> {
    const response = await this.client.request("POST", "v1/send", { messages });
    const body: unknown = await response.json().catch(() => null);

    if (response.status === 200) {
      const results =
        body && typeof body === "object" && "results" in body && Array.isArray(body.results)
          ? (body.results as Array<{ status?: unknown }>)
          : null;
      if (results?.length !== messages.length) {
        throw new BatchFailure("transient", "The relay answered with a malformed result list.");
      }
      return results.map((result) => ({ status: String(result.status) }));
    }

    const code = errorCodeOf(body);
    const what = `Relay send failed: HTTP ${response.status}${code ? ` ${code}` : ""}`;
    if (response.status === 404 && code === "unknown_server" && !retried) {
      this.client.forgetRegistration();
      await this.client.ensureRegistered({ force: true });
      return this.sendBatch(messages, true);
    }
    if (response.status === 403 && code === "server_blocked") {
      this.client.markBlocked();
      throw new BatchFailure("rejected", "The relay has blocked this server.");
    }
    if (response.status === 429 || response.status >= 500 || response.status === 404) {
      throw new BatchFailure("transient", what);
    }
    // 401 (a signature or clock the relay will not accept), 413, 422: our
    // bug or misconfiguration, and retrying would only repeat it.
    throw new BatchFailure("rejected", what);
  }
}
