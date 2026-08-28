import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { db } from "#/db";
import { deviceToken } from "#/db/schema";
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
