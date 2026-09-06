import { ApiError } from "#/api/errors";
import type { StimulusConfig, TestPushAck, TestPushStatus } from "#/api/schemas";
import { hasApnsCredentials } from "#/env";
import { pushSender } from "#/push";
import { markUnregistered, targetsFor } from "#/services/devices";

/**
 * "Did my notifications actually arrive?" — the diagnostic behind
 * /dashboard/devices on the web and Settings → Notifications in the app.
 *
 * Unlike a poke this is not persisted. A test is interesting for the minute
 * you are watching it and worthless afterwards, and a `push_test` table would
 * be one more thing to migrate, retain and reap for no lasting value. The
 * consequence is deliberate and worth knowing:
 *
 *   - a redeploy forgets every in-flight test (the UI then shows "no
 *     confirmation", which is indistinguishable from a genuinely lost push);
 *   - it assumes ONE `app` container. Behind two replicas the ack would land
 *     on the instance that didn't send, and every test would look undelivered.
 *     deploy/docker-compose.yml runs a single instance; if that ever changes,
 *     this needs Redis or a table.
 */

/** How long a finished test stays queryable. */
const RECORD_TTL_MS = 10 * 60 * 1000;

/** Cheap abuse ceiling: pushes cost Apple's goodwill, not just our CPU. */
const RATE_LIMIT_MS = 5_000;

/**
 * Hard cap on the map so a pathological caller can't grow it without bound
 * between TTL sweeps. Oldest go first.
 */
const MAX_RECORDS = 1_000;

interface TestRecord {
  /** Owner. Kept beside the status rather than in it — never goes on the wire. */
  userId: string;
  status: TestPushStatus;
  /** Epoch ms, for TTL eviction — `status.sentAt` is an ISO string. */
  sentAtMs: number;
}

const records = new Map<string, TestRecord>();
const lastSendByUser = new Map<string, number>();

function prune(now: number): void {
  for (const [testID, record] of records) {
    if (now - record.sentAtMs > RECORD_TTL_MS) records.delete(testID);
  }
  for (const [userId, at] of lastSendByUser) {
    if (now - at > RATE_LIMIT_MS) lastSendByUser.delete(userId);
  }
  // Insertion order is send order, so the first keys are the oldest.
  while (records.size > MAX_RECORDS) {
    const oldest = records.keys().next();
    if (oldest.done) break;
    records.delete(oldest.value);
  }
}

export interface SendTestPushOptions {
  userId: string;
  /** Omit to fan out to every active device. */
  deviceId?: string;
  /**
   * Omit for a notification-only test — nothing fires on the wearable, so
   * APNs delivery can be checked with no device connected. Present means the
   * phone also fires it, testing the whole chain.
   */
  stimulus?: StimulusConfig;
  source: "web" | "app";
}

export async function sendTestPush(options: SendTestPushOptions): Promise<TestPushStatus> {
  const now = Date.now();
  prune(now);

  const previous = lastSendByUser.get(options.userId);
  if (previous !== undefined && now - previous < RATE_LIMIT_MS) {
    const wait = Math.ceil((RATE_LIMIT_MS - (now - previous)) / 1000);
    throw ApiError.tooManyRequests(`Too many test pushes — try again in ${wait}s.`);
  }

  const targets = await targetsFor(options.userId, options.deviceId);
  if (targets.length === 0) {
    throw ApiError.notFound(
      "No registered devices. Open the app and allow notifications first.",
    );
  }
  lastSendByUser.set(options.userId, now);

  const testID = crypto.randomUUID();
  const sentAt = new Date(now).toISOString();
  const results = await pushSender().sendTest(targets, {
    testID,
    sentAt,
    source: options.source,
    stimulus: options.stimulus,
  });

  const dead = results.filter((r) => r.reason === "unregistered").map((r) => r.targetId);
  await markUnregistered(dead);

  const status: TestPushStatus = {
    testID,
    sentAt,
    source: options.source,
    stimulus: options.stimulus,
    apnsConfigured: hasApnsCredentials,
    devices: results.map((result) => ({
      deviceId: result.targetId,
      ok: result.ok,
      reason: result.reason,
      detail: result.detail,
    })),
    acks: [],
  };

  records.set(testID, { userId: options.userId, status, sentAtMs: now });
  return status;
}

/** Throws 404 for an unknown, expired, or someone else's test. */
export function testPushStatus(userId: string, testID: string): TestPushStatus {
  prune(Date.now());
  const record = records.get(testID);
  if (!record || record.userId !== userId) {
    throw ApiError.notFound("No test push with that id — it may have expired.");
  }
  return record.status;
}

/**
 * Records that a push arrived. Idempotent per (device, path): the alert and
 * the background copy of the same test are two separate confirmations — that
 * is the point, they exercise different iOS code paths — but a second ack for
 * the same pair (a tap after the banner was already seen) is a no-op.
 */
export function ackTestPush(
  userId: string,
  testID: string,
  ack: { deviceId?: string; path: TestPushAck["path"]; status?: TestPushAck["status"] },
): TestPushStatus {
  const status = testPushStatus(userId, testID);

  const already = status.acks.some(
    (existing) => existing.deviceId === (ack.deviceId ?? null) && existing.path === ack.path,
  );
  if (already) return status;

  const receivedAt = new Date();
  status.acks.push({
    deviceId: ack.deviceId ?? null,
    path: ack.path,
    status: ack.status,
    receivedAt: receivedAt.toISOString(),
    elapsedMs: Math.max(0, receivedAt.getTime() - new Date(status.sentAt).getTime()),
  });
  return status;
}

/** Test seam — the module-level maps outlive a single vitest case otherwise. */
export function resetPushTestStore(): void {
  records.clear();
  lastSendByUser.clear();
}
