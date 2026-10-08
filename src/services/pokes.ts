import { and, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "#/db";
import { apiToken, friendPermission, pokeEvent, user as userTable } from "#/db/schema";
import type { PokeEvent as PokeEventRow } from "#/db/schema";
import { ApiError } from "#/api/errors";
import { presentPokeEvent } from "#/api/present";
import { pushSender } from "#/push";
import type { AckableStatus, PokeEvent, StimulusConfig } from "#/api/schemas";
import { activeTargets, markUnregistered } from "#/services/devices";
import { areFriends } from "#/services/friends";
import { reserveTokenFire } from "#/services/api-tokens";
import { automationConsentPolicy, effectiveAutomationAllowed } from "#/services/settings";
import {
  describeToken,
  pokeVisibility,
  tokenReachesFriend,
  tokenStimulusViolation,
} from "#/services/token-access";
import type { ApiTokenContext } from "#/services/token-access";

/** The sending token's name, for a viewer allowed to see it — else null. */
async function tokenNameFor(row: PokeEventRow, viewerId: string): Promise<string | null> {
  if (!row.apiTokenId || row.senderId !== viewerId) return null;
  const [found] = await db
    .select({ name: apiToken.name })
    .from(apiToken)
    .where(eq(apiToken.id, row.apiTokenId))
    .limit(1);
  return found?.name ?? null;
}

/**
 * The poke already recorded under a client-chosen id, if the same sender
 * recorded it. A retry is answered from here, before any check that could
 * now fail — a cooldown started *by the original*, a grant withdrawn since —
 * because the poke it asks about has already been sent.
 */
async function replayOf(
  pokeId: string,
  senderId: string,
): Promise<{ event: PokeEvent; replayed: true } | null> {
  const [existing] = await db.select().from(pokeEvent).where(eq(pokeEvent.id, pokeId)).limit(1);
  if (!existing) return null;
  // Someone else's id is a conflict, not a replay — and says nothing about it.
  if (existing.senderId !== senderId) throw ApiError.conflict("That poke id is already in use.");
  const [recipient] = await db
    .select()
    .from(userTable)
    .where(eq(userTable.id, existing.recipientId))
    .limit(1);
  if (!recipient) throw ApiError.notFound("Not friends with that user.");
  console.log(`[pokes] ${pokeId}: retried — already recorded, not sent again`);
  return {
    event: presentPokeEvent(existing, senderId, recipient, await tokenNameFor(existing, senderId)),
    replayed: true,
  };
}

/**
 * Sends a poke. The composer clamps client-side for UX, but that is not
 * authoritative — permission, intensity cap and cooldown are all re-checked
 * here before anything is recorded or pushed.
 *
 * `pokeId` makes it idempotent: a client that lost the connection before the
 * answer arrived can send the same request again, and gets back the poke
 * that was recorded instead of a second one on its friend's wrist.
 *
 * `token` is the personal access token the request came in on, or null for
 * the account holder in person. A token only ever narrows what the grant
 * allows: fewer friends, fewer kinds, a lower cap, and a firing interval of
 * its own on top of the recipient's cooldown.
 */
export async function sendPoke(
  senderId: string,
  friendId: string,
  stimulus: StimulusConfig,
  options: { pokeId?: string; token?: ApiTokenContext | null } = {},
): Promise<{ event: PokeEvent; replayed: boolean }> {
  const { pokeId, token = null } = options;
  if (senderId === friendId) {
    throw ApiError.forbidden("You can't poke yourself.");
  }
  if (pokeId) {
    const replay = await replayOf(pokeId, senderId);
    if (replay) return replay;
  }
  // Before the friendship check, and worded about the token: the allowlist
  // is the owner's own choice, so saying it excludes someone tells the
  // integration nothing its owner doesn't know.
  if (token && !tokenReachesFriend(token, friendId)) {
    throw ApiError.forbidden("This token isn't allowed to poke that friend.");
  }
  const violation = token ? tokenStimulusViolation(token, stimulus) : null;
  if (violation) throw ApiError.forbidden(violation);
  if (!(await areFriends(senderId, friendId))) {
    // Deliberately the same 403 as a missing grant: a non-friend learns
    // nothing about whether the account exists.
    throw ApiError.forbidden("They haven't allowed that stimulus.");
  }

  // The grant runs recipient -> sender: what the *recipient* allows to be
  // sent to them.
  const [grant] = await db
    .select()
    .from(friendPermission)
    .where(
      and(
        eq(friendPermission.granterId, friendId),
        eq(friendPermission.granteeId, senderId),
        eq(friendPermission.kind, stimulus.kind),
      ),
    )
    .limit(1);

  if (!grant?.isAllowed) {
    throw ApiError.forbidden("They haven't allowed that stimulus.");
  }
  // A grant to a friend is not automatically a grant to their scripts: the
  // recipient answers that separately, per friend and kind, and the server
  // policy decides while they haven't. Self-stimuli never get here.
  if (token) {
    const policy = await automationConsentPolicy();
    if (!effectiveAutomationAllowed(grant.automationAllowed, policy.value)) {
      throw ApiError.forbidden("They haven't allowed automated pokes of that stimulus.");
    }
  }
  if (stimulus.intensity > grant.maxIntensity) {
    throw ApiError.forbidden(
      `Intensity exceeds their cap of ${grant.maxIntensity}.`,
    );
  }

  if (grant.cooldownSeconds > 0) {
    const cutoff = new Date(Date.now() - grant.cooldownSeconds * 1000);
    const [recent] = await db
      .select({ createdAt: pokeEvent.createdAt })
      .from(pokeEvent)
      .where(
        and(
          eq(pokeEvent.senderId, senderId),
          eq(pokeEvent.recipientId, friendId),
          eq(pokeEvent.kind, stimulus.kind),
          gte(pokeEvent.createdAt, cutoff),
        ),
      )
      .orderBy(desc(pokeEvent.createdAt))
      .limit(1);

    if (recent) {
      const readyAt = recent.createdAt.getTime() + grant.cooldownSeconds * 1000;
      const waitSeconds = Math.max(1, Math.ceil((readyAt - Date.now()) / 1000));
      throw ApiError.forbidden(`Too soon — try again in ${waitSeconds}s.`);
    }
  }

  const [sender] = await db.select().from(userTable).where(eq(userTable.id, senderId)).limit(1);
  const [recipient] = await db.select().from(userTable).where(eq(userTable.id, friendId)).limit(1);
  if (!sender || !recipient) throw ApiError.notFound("Not friends with that user.");

  // Last, so nothing above can refuse a poke that has already spent the
  // token's slot. Only the insert can still fail, and it gives the slot back.
  const release = token ? await reserveTokenFire(token) : null;

  let row: PokeEventRow | undefined;
  try {
    [row] = await db
      .insert(pokeEvent)
      .values({
        ...(pokeId ? { id: pokeId } : {}),
        senderId,
        recipientId: friendId,
        kind: stimulus.kind,
        intensity: stimulus.intensity,
        repetitions: stimulus.repetitions,
        status: "pending",
        ...(token ? { source: "api_token" as const, apiTokenId: token.id } : {}),
      })
      // Two copies of the same retry racing each other: exactly one inserts,
      // the other finds it below and answers as a replay.
      .onConflictDoNothing({ target: pokeEvent.id })
      .returning();
  } catch (error) {
    await release?.();
    throw error;
  }

  if (!row) {
    // The poke this retry asks about was fired — and paid for — by the copy
    // that won the race. This one fired nothing.
    await release?.();
    const replay = pokeId ? await replayOf(pokeId, senderId) : null;
    if (replay) return replay;
    throw ApiError.notFound("Could not record the poke.");
  }

  // One line per accepted poke, naming both ends. Without it a "why did my
  // phone just fire?" report has nothing to check against: the push itself
  // leaves no trace, and `poke_event` alone can't say which request made it.
  console.log(
    `[pokes] ${row.id}: @${sender.handle} -> @${recipient.handle} ` +
      `${stimulus.kind} ${stimulus.intensity}% x${stimulus.repetitions}` +
      (token ? ` via ${describeToken(token)}` : ""),
  );

  // Delivery is best-effort and must not fail the request: the event is
  // already recorded, and the recipient's ack is what settles the status.
  void deliver(row.id, friendId, {
    pokeID: row.id,
    senderHandle: sender.handle,
    senderDisplayName: sender.name,
    recipientHandle: recipient.handle,
    stimulus,
    sentAt: row.createdAt.toISOString(),
    viaApiToken: token !== null,
  }).catch((error) => console.error("[pokes] delivery failed", row.id, error));

  return {
    event: presentPokeEvent(row, senderId, recipient, token?.name ?? null),
    replayed: false,
  };
}

/**
 * Minimum gap between self-stimuli. A poke is rate limited by the recipient's
 * cooldown; nobody sets a cooldown against themselves, so a looping script
 * would otherwise hammer APNs on the user's behalf until Apple noticed.
 */
const SELF_STIMULUS_INTERVAL_MS = 1_000;

const lastSelfStimulusAt = new Map<string, number>();

/**
 * Fires a stimulus at your own devices — the endpoint behind "let my own code
 * jolt me" (`POST /me/stimulus`, usable with a personal access token).
 *
 * No friendship and no permission grant, because the only person involved is
 * the one holding the credential. It is still recorded as a `poke_event` from
 * you to you, so it shows up in the activity feed, acks through the same
 * endpoint, and is delivered as an ordinary poke push — which is what lets
 * every existing client fire it with no changes.
 */
export async function sendSelfStimulus(
  userId: string,
  stimulus: StimulusConfig,
  token: ApiTokenContext | null = null,
): Promise<PokeEvent> {
  // The token's own limits first: they need no I/O, and a stimulus the token
  // may never send should not take the account's one-per-second slot.
  const violation = token ? tokenStimulusViolation(token, stimulus) : null;
  if (violation) throw ApiError.forbidden(violation);

  const now = Date.now();
  for (const [id, at] of lastSelfStimulusAt) {
    if (now - at > SELF_STIMULUS_INTERVAL_MS) lastSelfStimulusAt.delete(id);
  }

  const previous = lastSelfStimulusAt.get(userId);
  if (previous !== undefined && now - previous < SELF_STIMULUS_INTERVAL_MS) {
    throw ApiError.tooManyRequests("Too fast — one self-stimulus per second.");
  }

  // Reserved here rather than after the inserts below: three awaits separate
  // the check from the write, and two requests arriving inside that window
  // would both read an empty slot and both fire. Restored on the way out if
  // this attempt never becomes a stimulus — a rejected call must not eat the
  // caller's next second.
  lastSelfStimulusAt.set(userId, now);

  let releaseToken: (() => Promise<void>) | null = null;
  try {
    const [me] = await db.select().from(userTable).where(eq(userTable.id, userId)).limit(1);
    if (!me) throw ApiError.unauthorized();

    // Checked up front rather than left to the fire-and-forget delivery
    // below: an integration that gets 201 for a stimulus nobody could
    // possibly receive has been told the opposite of what happened.
    const targets = await activeTargets(userId);
    if (targets.length === 0) {
      throw ApiError.notFound(
        "No registered devices. Open the app and allow notifications first.",
      );
    }

    // The token's interval, held in the database, on top of the per-account
    // second held here. Claimed after the device check for the same reason
    // the account slot is restored below: a refusal must not cost a slot.
    if (token) releaseToken = await reserveTokenFire(token);

    const [row] = await db
      .insert(pokeEvent)
      .values({
        senderId: userId,
        recipientId: userId,
        kind: stimulus.kind,
        intensity: stimulus.intensity,
        repetitions: stimulus.repetitions,
        status: "pending",
        ...(token ? { source: "api_token" as const, apiTokenId: token.id } : {}),
      })
      .returning();

    if (!row) throw ApiError.notFound("Could not record the stimulus.");

    // Logged as loudly as a real poke, and marked: a self-stimulus is the one
    // thing that fires at the account that asked for it, so it is the first
    // thing to rule out when somebody is poked by their own send.
    console.log(
      `[pokes] ${row.id}: @${me.handle} -> @${me.handle} (self) ` +
        `${stimulus.kind} ${stimulus.intensity}% x${stimulus.repetitions}` +
        (token ? ` via ${describeToken(token)}` : ""),
    );

    void deliver(row.id, userId, {
      pokeID: row.id,
      senderHandle: me.handle,
      senderDisplayName: me.name,
      recipientHandle: me.handle,
      stimulus,
      sentAt: row.createdAt.toISOString(),
      viaApiToken: token !== null,
    }).catch((error) => console.error("[pokes] self delivery failed", row.id, error));

    return presentPokeEvent(row, userId, me, token?.name ?? null);
  } catch (error) {
    if (previous === undefined) lastSelfStimulusAt.delete(userId);
    else lastSelfStimulusAt.set(userId, previous);
    await releaseToken?.();
    throw error;
  }
}

/** Test seam — the rate-limit map outlives a single vitest case otherwise. */
export function resetSelfStimulusLimit(): void {
  lastSelfStimulusAt.clear();
}

async function deliver(
  pokeId: string,
  recipientId: string,
  payload: Parameters<ReturnType<typeof pushSender>["sendPoke"]>[1],
): Promise<void> {
  const targets = await activeTargets(recipientId);
  if (targets.length === 0) {
    console.warn(`[pokes] ${pokeId}: recipient has no registered devices`);
    return;
  }

  const results = await pushSender().sendPoke(targets, payload);
  const dead = results.filter((r) => r.reason === "unregistered").map((r) => r.targetId);
  await markUnregistered(dead);
}

/**
 * Records what the recipient's device actually did. Idempotent by contract:
 * the same poke may be acked twice (once from the silent push, once from a
 * notification tap) and the first ack wins.
 */
export async function ackPoke(
  userId: string,
  pokeId: string,
  status: AckableStatus,
): Promise<PokeEvent> {
  const [existing] = await db
    .select()
    .from(pokeEvent)
    .where(and(eq(pokeEvent.id, pokeId), eq(pokeEvent.recipientId, userId)))
    .limit(1);

  if (!existing) throw ApiError.notFound("No poke with that id.");

  // Conditional update: only an un-acked poke moves. Two concurrent acks race
  // here and exactly one wins, without a transaction.
  const [updated] = await db
    .update(pokeEvent)
    .set({ status, ackedAt: new Date() })
    .where(and(eq(pokeEvent.id, pokeId), isNull(pokeEvent.ackedAt)))
    .returning();

  const row = updated ?? existing;
  const [sender] = await db.select().from(userTable).where(eq(userTable.id, row.senderId)).limit(1);
  if (!sender) throw ApiError.notFound("No poke with that id.");

  // The recipient never sees the token's name — unless they sent it to
  // themselves, which a self-stimulus is.
  return presentPokeEvent(row, userId, sender, await tokenNameFor(row, userId));
}

/**
 * Activity log, sent and received, newest first. Through a token, only what
 * `pokeVisibility` lets it see — filtered in the query, so `limit` still
 * means "this many events the token may see" rather than "this many, minus
 * the ones it may not".
 */
export async function listPokes(
  userId: string,
  options: { limit: number; before?: string },
  token: ApiTokenContext | null = null,
): Promise<Array<PokeEvent>> {
  const filters = [or(eq(pokeEvent.senderId, userId), eq(pokeEvent.recipientId, userId))!];
  if (token) {
    const visible = pokeVisibility(token);
    const self = and(eq(pokeEvent.senderId, userId), eq(pokeEvent.recipientId, userId))!;
    const withFriends =
      visible.friends === "all"
        ? ne(pokeEvent.senderId, pokeEvent.recipientId)
        : visible.friends.length === 0
          ? sql`false`
          : or(
              and(eq(pokeEvent.senderId, userId), inArray(pokeEvent.recipientId, visible.friends)),
              and(eq(pokeEvent.recipientId, userId), inArray(pokeEvent.senderId, visible.friends)),
            )!;
    filters.push(visible.includeSelf ? or(withFriends, self)! : withFriends);
  }
  if (options.before) {
    filters.push(lt(pokeEvent.createdAt, new Date(options.before)));
  }

  const rows = await db
    .select({ event: pokeEvent, tokenName: apiToken.name })
    .from(pokeEvent)
    .leftJoin(apiToken, eq(apiToken.id, pokeEvent.apiTokenId))
    .where(and(...filters))
    .orderBy(desc(pokeEvent.createdAt))
    .limit(options.limit);

  if (rows.length === 0) return [];

  const otherIds = [
    ...new Set(
      rows.map(({ event }) => (event.senderId === userId ? event.recipientId : event.senderId)),
    ),
  ];
  const people = await db.select().from(userTable).where(inArray(userTable.id, otherIds));
  const byId = new Map(people.map((p) => [p.id, p]));

  return rows
    .map(({ event, tokenName }) => {
      const other = byId.get(event.senderId === userId ? event.recipientId : event.senderId);
      return other ? presentPokeEvent(event, userId, other, tokenName) : null;
    })
    .filter((e): e is PokeEvent => e !== null);
}

export async function deleteEventsBefore(cutoff: Date): Promise<number> {
  const rows = await db
    .delete(pokeEvent)
    .where(lt(pokeEvent.createdAt, cutoff))
    .returning({ id: pokeEvent.id });
  return rows.length;
}

/** Admin dashboard: delivery-status breakdown across all pokes. */
export async function statusBreakdown(): Promise<Array<{ status: string; count: number }>> {
  return db
    .select({ status: pokeEvent.status, count: sql<number>`count(*)::int` })
    .from(pokeEvent)
    .groupBy(pokeEvent.status);
}
