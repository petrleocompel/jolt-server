import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { db } from "#/db";
import { deviceToken } from "#/db/schema";
import { ApiError } from "#/api/errors";
import type { Device } from "#/api/schemas";
import type { PushTarget } from "#/push";

/**
 * Called once per launch after the app receives its APNs token. A device may
 * move between accounts (re-login on the same phone), so the token — not the
 * user — is the conflict target: the row is reassigned rather than duplicated.
 */
export async function registerToken(
  userId: string,
  token: string,
  platform: "ios" = "ios",
): Promise<void> {
  const now = new Date();
  await db
    .insert(deviceToken)
    .values({ userId, token, platform, lastSeenAt: now })
    .onConflictDoUpdate({
      target: deviceToken.token,
      set: { userId, platform, lastSeenAt: now, disabledAt: null },
    });
}

/** Every live device for a user — poke pushes fan out to all of them. */
export async function activeTargets(userId: string): Promise<Array<PushTarget>> {
  const rows = await db
    .select({ id: deviceToken.id, token: deviceToken.token })
    .from(deviceToken)
    .where(and(eq(deviceToken.userId, userId), isNull(deviceToken.disabledAt)));
  return rows;
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
    .select({ id: deviceToken.id, token: deviceToken.token })
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
  return rows;
}

/** APNs said 410 Unregistered — stop sending, let cron reap the row later. */
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
