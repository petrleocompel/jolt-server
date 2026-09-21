import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "#/db";
import { apiToken, user as userTable } from "#/db/schema";
import { ApiError } from "#/api/errors";
import type { ApiTokenRow, User } from "#/db/schema";
import type { ApiToken, ApiTokenCreated } from "#/api/schemas";

/**
 * Personal access tokens — the credential behind "jolt me from my own
 * scripts". A user mints one in the dashboard, pastes it into whatever they
 * are wiring up, and that integration can then call the handful of
 * self-only endpoints as them.
 *
 * Deliberately *not* a Better Auth session: a session expires, is minted by
 * a password, and carries the whole account with it. A PAT is long-lived,
 * revocable one at a time, and reaches only the caller's own account — see
 * `allowApiToken` in src/api/http.ts for the endpoints that accept one.
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

function toApi(row: ApiTokenRow): ApiToken {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

export async function createApiToken(
  userId: string,
  input: { name: string; expiresInDays?: number },
): Promise<ApiTokenCreated> {
  const { token, tokenHash, prefix } = generateApiToken();
  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const [row] = await db
    .insert(apiToken)
    .values({ userId, name: input.name.trim(), tokenHash, prefix, expiresAt })
    .returning();

  if (!row) throw ApiError.badRequest("Could not create the token.");

  // The only time the secret is ever returned. There is no way to recover it
  // afterwards — a lost token is replaced, not looked up.
  return { ...toApi(row), token };
}

export async function listApiTokens(userId: string): Promise<Array<ApiToken>> {
  const rows = await db
    .select()
    .from(apiToken)
    .where(eq(apiToken.userId, userId))
    .orderBy(desc(apiToken.createdAt));
  return rows.map(toApi);
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
 * The account behind a presented token, or null. Expired tokens are rejected
 * here rather than deleted — the row is what tells the user in the dashboard
 * why their integration stopped working.
 */
export async function userForApiToken(presented: string): Promise<User | null> {
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

  await touch(match.token.id);
  return match.account;
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
