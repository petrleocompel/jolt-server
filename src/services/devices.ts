import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { db } from "#/db";
import { deviceToken } from "#/db/schema";
import { ApiError } from "#/api/errors";
import type { Device, PushTokenBody } from "#/api/schemas";
import { env } from "#/env";
import type { PushTarget } from "#/push";
import { fromBase64url, payloadKeyId } from "#/push/envelope";
import { atRestKey, openPayloadKey, sealPayloadKey } from "#/push/payload-key";

let cachedAtRestKey: Buffer | null = null;

/** Derived once: HKDF is cheap, but every poke would otherwise repeat it. */
function payloadKeyAtRest(): Buffer {
  cachedAtRestKey ??= atRestKey(env.BETTER_AUTH_SECRET);
  return cachedAtRestKey;
}

/**
 * Called once per launch after the app receives its APNs token, or its
 * relay token. A device may move between accounts (re-login on the same
 * phone), so the token — not the user — is the conflict target: the row is
 * reassigned rather than duplicated. A relay registration also replaces the
 * payload key, since the app may have generated a new one.
 */
export async function registerToken(userId: string, body: PushTokenBody): Promise<void> {
  const now = new Date();
  if (body.transport === "relay") {
    const payloadKey = fromBase64url(body.payloadKey);
    // The id is derived, not chosen, and every envelope names it. One that
    // does not match would have the app look up a key it never stored.
    if (payloadKeyId(payloadKey) !== body.keyId) {
      throw ApiError.badRequest("keyId: does not match payloadKey.");
    }
    const relay = {
      userId,
      platform: body.platform,
      transport: "relay" as const,
      payloadKey: sealPayloadKey(payloadKeyAtRest(), body.relayToken, payloadKey),
      keyId: body.keyId,
      lastSeenAt: now,
    };
    await db
      .insert(deviceToken)
      .values({ ...relay, token: body.relayToken })
      .onConflictDoUpdate({
        target: deviceToken.token,
        set: { ...relay, disabledAt: null },
      });
    return;
  }

  const apns = {
    userId,
    platform: body.platform,
    transport: "apns" as const,
    payloadKey: null,
    keyId: null,
    lastSeenAt: now,
  };
  await db
    .insert(deviceToken)
    .values({ ...apns, token: body.token })
    .onConflictDoUpdate({
      target: deviceToken.token,
      set: { ...apns, disabledAt: null },
    });
}

/**
 * The other half of `registerToken`: this phone is no longer this account's.
 *
 * Called on sign-out, because the row survives it otherwise. A phone that
 * signed in as someone else and then signed out stayed a delivery target for
 * that account until something re-registered the token — so a poke sent *to*
 * that account fired on a wrist that had nothing to do with it.
 *
 * Scoped to the caller: a token that belongs to somebody else is left alone
 * and reported as gone all the same, since a 404 here would only tell an
 * attacker which tokens are live.
 */
export async function unregisterToken(userId: string, token: string): Promise<void> {
  await db
    .delete(deviceToken)
    .where(and(eq(deviceToken.userId, userId), eq(deviceToken.token, token)));
}

const targetColumns = {
  id: deviceToken.id,
  token: deviceToken.token,
  transport: deviceToken.transport,
  payloadKey: deviceToken.payloadKey,
};

/** A row as the push senders want it: the relay payload key unsealed. */
function toTarget(row: {
  id: string;
  token: string;
  transport: PushTarget["transport"];
  payloadKey: string | null;
}): PushTarget {
  if (row.transport !== "relay") return { id: row.id, token: row.token, transport: row.transport };
  const payloadKey = row.payloadKey
    ? openPayloadKey(payloadKeyAtRest(), row.token, row.payloadKey)
    : null;
  return {
    id: row.id,
    token: row.token,
    transport: row.transport,
    ...(payloadKey ? { payloadKey } : {}),
  };
}

/** Every live device for a user — poke pushes fan out to all of them. */
export async function activeTargets(userId: string): Promise<Array<PushTarget>> {
  const rows = await db
    .select(targetColumns)
    .from(deviceToken)
    .where(and(eq(deviceToken.userId, userId), isNull(deviceToken.disabledAt)));
  return rows.map(toTarget);
}

/**
 * The signed-in user's own devices, for the "test my notifications" screens.
 * Only the last 8 characters of the token are exposed — enough for a phone to
 * recognise itself in the list, useless to anyone who shouldn't have it.
 */
export async function listDevices(userId: string): Promise<Array<Device>> {
  const rows = await db
    .select()
    .from(deviceToken)
    .where(eq(deviceToken.userId, userId))
    .orderBy(desc(deviceToken.lastSeenAt));

  return rows.map((row) => ({
    id: row.id,
    platform: row.platform,
    transport: row.transport,
    tokenSuffix: row.token.slice(-8),
    isActive: row.disabledAt === null,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  }));
}

/**
 * Push targets for one test send: a single device when `deviceId` is given,
 * every live one otherwise. A device id that isn't yours 404s exactly like
 * one that doesn't exist — device ids are not something to probe for.
 */
export async function targetsFor(
  userId: string,
  deviceId?: string,
): Promise<Array<PushTarget>> {
  if (!deviceId) return activeTargets(userId);

  const rows = await db
    .select(targetColumns)
    .from(deviceToken)
    .where(
      and(
        eq(deviceToken.id, deviceId),
        eq(deviceToken.userId, userId),
        isNull(deviceToken.disabledAt),
      ),
    )
    .limit(1);

  if (rows.length === 0) throw ApiError.notFound("No active device with that id.");
  return rows.map(toTarget);
}

/**
 * APNs said 410 Unregistered, or the relay said `unregistered` — stop
 * sending, let cron reap the row later.
 */
export async function markUnregistered(ids: Array<string>): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(deviceToken)
    .set({ disabledAt: new Date() })
    .where(inArray(deviceToken.id, ids));
}

export async function deleteDisabledBefore(cutoff: Date): Promise<number> {
  const rows = await db
    .delete(deviceToken)
    .where(and(lt(deviceToken.disabledAt, cutoff)))
    .returning({ id: deviceToken.id });
  return rows.length;
}
