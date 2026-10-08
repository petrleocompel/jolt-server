import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "#/db";
import { apiToken, apiTokenFriend, user as userTable } from "#/db/schema";
import { ApiError } from "#/api/errors";
import { friendIdsOf } from "#/services/friends";
import { readScopes } from "#/services/token-access";
import type { ApiTokenContext } from "#/services/token-access";
import type { ApiTokenRow, User } from "#/db/schema";
import type { ApiToken, ApiTokenCreated, CreateApiTokenBody } from "#/api/schemas";

/**
 * Personal access tokens — the credential behind "jolt me from my own
 * scripts", and, given the scopes for it, "let my scripts poke my friends".
 * A user mints one in the dashboard, pastes it into whatever they are wiring
 * up, and that integration can then call the endpoints its scopes name as
 * them — see `requireCaller` in src/api/http.ts.
 *
 * Deliberately *not* a Better Auth session: a session expires, is minted by
 * a password, and carries the whole account with it. A PAT is long-lived,
 * revocable one at a time, and reaches only what it was minted for. Token
 * management, devices, friend requests, permission editing and acks stay
 * session-only whatever the scopes say.
 *
 * Only the hash is stored. `jolt_pat_` makes a leaked token greppable in a
 * repo or a log, and lets the authenticator tell a PAT from a session token
 * without a database round trip.
 */

const TOKEN_PREFIX = "jolt_pat_";

/** 32 bytes — a token has to survive being public-ish in a CI variable. */
const SECRET_BYTES = 32;

/** Enough of the secret to recognise a row, not enough to shorten a guess. */
const PREFIX_LENGTH = 6;

/**
 * `lastUsedAt` answers "is this token still in use?", not "when exactly was
 * the last call" — so a busy integration writes to it once a minute rather
 * than on every request.
 */
const LAST_USED_RESOLUTION_MS = 60_000;

/** True for anything shaped like one of our tokens, valid or not. */
export function isApiTokenCandidate(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A fresh secret plus what the row needs to store about it. */
export function generateApiToken(): { token: string; tokenHash: string; prefix: string } {
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const token = `${TOKEN_PREFIX}${secret}`;
  return { token, tokenHash: hashToken(token), prefix: secret.slice(0, PREFIX_LENGTH) };
}

function toApi(row: ApiTokenRow, friendIds: Array<string>): ApiToken {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    scopes: readScopes(row.scopes),
    friendScope: row.friendScope,
    friendIds: row.friendScope === "selected" ? [...friendIds].sort() : [],
    allowedKinds: row.allowedKinds,
    maxIntensity: row.maxIntensity,
    minIntervalSeconds: row.minIntervalSeconds,
  };
}

export async function createApiToken(
  userId: string,
  input: CreateApiTokenBody,
): Promise<ApiTokenCreated> {
  const { token, tokenHash, prefix } = generateApiToken();
  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
    : null;
  const scopes = [...new Set(input.scopes)];

  // Presence, not length, is what makes a token `selected`: an explicit
  // empty list is a token that reaches nobody, never one that reaches all.
  const friendIds = input.friendIds ? [...new Set(input.friendIds)] : null;
  if (friendIds && friendIds.length > 0) {
    const friends = new Set(await friendIdsOf(userId));
    const stranger = friendIds.find((id) => !friends.has(id));
    if (stranger) {
      // Same wording whether the id is a stranger or nobody at all, as with
      // every other friend lookup — no account discovery through tokens.
      throw ApiError.badRequest(`friendIds: ${stranger} is not one of your friends.`);
    }
  }

  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(apiToken)
      .values({
        userId,
        name: input.name.trim(),
        tokenHash,
        prefix,
        expiresAt,
        scopes,
        friendScope: friendIds ? "selected" : "all",
        allowedKinds: input.allowedKinds ? [...new Set(input.allowedKinds)] : null,
        maxIntensity: input.maxIntensity ?? null,
        minIntervalSeconds: input.minIntervalSeconds ?? 1,
      })
      .returning();
    if (!inserted) return null;
    if (friendIds && friendIds.length > 0) {
      await tx
        .insert(apiTokenFriend)
        .values(friendIds.map((friendId) => ({ tokenId: inserted.id, friendId })));
    }
    return inserted;
  });

  if (!row) throw ApiError.badRequest("Could not create the token.");

  // The only time the secret is ever returned. There is no way to recover it
  // afterwards — a lost token is replaced, not looked up.
  return { ...toApi(row, friendIds ?? []), token };
}

/** Allowlists for a set of tokens, keyed by token id. */
async function friendIdsByToken(tokenIds: Array<string>): Promise<Map<string, Array<string>>> {
  const byToken = new Map<string, Array<string>>();
  if (tokenIds.length === 0) return byToken;
  const rows = await db
    .select()
    .from(apiTokenFriend)
    .where(inArray(apiTokenFriend.tokenId, tokenIds));
  for (const row of rows) {
    const list = byToken.get(row.tokenId) ?? [];
    list.push(row.friendId);
    byToken.set(row.tokenId, list);
  }
  return byToken;
}

export async function listApiTokens(userId: string): Promise<Array<ApiToken>> {
  const rows = await db
    .select()
    .from(apiToken)
    .where(eq(apiToken.userId, userId))
    .orderBy(desc(apiToken.createdAt));
  const allowlists = await friendIdsByToken(
    rows.filter((row) => row.friendScope === "selected").map((row) => row.id),
  );
  return rows.map((row) => toApi(row, allowlists.get(row.id) ?? []));
}

/** Revoking is deleting: a token nobody can present is not worth keeping. */
export async function revokeApiToken(userId: string, tokenId: string): Promise<void> {
  const deleted = await db
    .delete(apiToken)
    .where(and(eq(apiToken.id, tokenId), eq(apiToken.userId, userId)))
    .returning({ id: apiToken.id });

  // Someone else's token id 404s exactly like one that never existed.
  if (deleted.length === 0) throw ApiError.notFound("No API token with that id.");
}

/**
 * The account and token behind a presented secret, or null. Expired tokens
 * are rejected here rather than deleted — the row is what tells the user in
 * the dashboard why their integration stopped working.
 */
export async function authenticateApiToken(
  presented: string,
): Promise<{ user: User; token: ApiTokenContext } | null> {
  const tokenHash = hashToken(presented);

  const [match] = await db
    .select({ token: apiToken, account: userTable })
    .from(apiToken)
    .innerJoin(userTable, eq(userTable.id, apiToken.userId))
    .where(eq(apiToken.tokenHash, tokenHash))
    .limit(1);

  if (!match) return null;

  // The lookup above is by hash, so this compares two equal-length digests
  // of a value an attacker already has to have guessed; it costs nothing and
  // keeps the comparison constant-time if that lookup ever loosens.
  const stored = Buffer.from(match.token.tokenHash, "hex");
  const offered = Buffer.from(tokenHash, "hex");
  if (stored.length !== offered.length || !timingSafeEqual(stored, offered)) return null;

  if (match.token.expiresAt && match.token.expiresAt.getTime() <= Date.now()) return null;

  // Read per request, not cached with the token: unfriending someone has to
  // take them off every allowlist at once, not whenever a cache expires.
  const friendIds =
    match.token.friendScope === "selected"
      ? ((await friendIdsByToken([match.token.id])).get(match.token.id) ?? [])
      : [];

  await touch(match.token.id);
  return { user: match.account, token: toContext(match.token, friendIds) };
}

function toContext(row: ApiTokenRow, friendIds: Array<string>): ApiTokenContext {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: readScopes(row.scopes),
    friendScope: row.friendScope,
    friendIds: new Set(friendIds),
    allowedKinds: row.allowedKinds,
    maxIntensity: row.maxIntensity,
    minIntervalSeconds: row.minIntervalSeconds,
  };
}

/**
 * Claims this token's next firing slot, or throws 429 with how long to wait.
 *
 * One conditional UPDATE, so the check and the claim are the same statement:
 * two requests racing on two instances cannot both see a free slot, and a
 * restart forgets nothing — the slot lives in `api_token.last_fired_at`, not
 * in a process. Call it as late as possible, after every other reason to
 * refuse has been checked, so a refusal does not cost the caller their slot.
 *
 * Returns a release for the one failure left after that point — the insert
 * itself. It puts back the previous value, but only if the slot is still
 * ours: a request that has claimed it since keeps it.
 */
export async function reserveTokenFire(
  token: Pick<ApiTokenContext, "id">,
): Promise<() => Promise<void>> {
  // `before` is read in the same statement, so the release can put back
  // exactly what was there. Both go out as text: a timestamp round-tripped
  // through a JS Date loses its microseconds and would never compare equal.
  const claimed = await db.execute<{ previous: string | null; reserved: string }>(sql`
    update ${apiToken} as t
    set last_fired_at = now()
    from (select last_fired_at from ${apiToken} where id = ${token.id}) as before
    where t.id = ${token.id}
      and (
        t.last_fired_at is null
        or t.last_fired_at <= now() - make_interval(secs => t.min_interval_seconds)
      )
    returning before.last_fired_at::text as previous, t.last_fired_at::text as reserved
  `);

  const slot = claimed[0];
  if (!slot) {
    const [state] = await db.execute<{ wait: number; interval: number }>(sql`
      select
        greatest(1, ceil(extract(epoch from
          last_fired_at + make_interval(secs => min_interval_seconds) - now()
        )))::int as wait,
        min_interval_seconds as interval
      from ${apiToken}
      where id = ${token.id}
    `);
    // Revoked between authenticating and firing.
    if (!state) throw ApiError.unauthorized("Invalid or expired API token.");
    throw ApiError.tooManyRequests(
      `Too fast — this token fires at most once every ${state.interval}s. ` +
        `Try again in ${state.wait}s.`,
    );
  }

  return async () => {
    try {
      await db.execute(sql`
        update ${apiToken}
        set last_fired_at = ${slot.previous}::timestamptz
        where id = ${token.id} and last_fired_at = ${slot.reserved}::timestamptz
      `);
    } catch (error) {
      // Worst case the caller waits one interval for nothing; the request
      // is already failing for a better reason than this.
      console.error("[api-tokens] could not release a firing slot", token.id, error);
    }
  };
}

/** Best-effort, and coarse on purpose — see LAST_USED_RESOLUTION_MS. */
async function touch(tokenId: string): Promise<void> {
  const now = new Date();
  const stale = new Date(now.getTime() - LAST_USED_RESOLUTION_MS);
  try {
    await db
      .update(apiToken)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(apiToken.id, tokenId),
          or(isNull(apiToken.lastUsedAt), lt(apiToken.lastUsedAt, stale)),
        ),
      );
  } catch (error) {
    // A failed bookkeeping write must never cost the caller their request.
    console.error("[api-tokens] could not record last use", tokenId, error);
  }
}

/** Retention job: expired tokens are dead weight once they stop working. */
export async function deleteExpiredBefore(cutoff: Date): Promise<number> {
  const rows = await db
    .delete(apiToken)
    .where(and(sql`${apiToken.expiresAt} is not null`, lt(apiToken.expiresAt, cutoff)))
    .returning({ id: apiToken.id });
  return rows.length;
}
