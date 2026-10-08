import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "#/db";
import {
  apiToken,
  apiTokenFriend,
  friendPermission,
  friendRequest,
  friendship,
  user as userTable,
} from "#/db/schema";
import type { FriendPermission, User } from "#/db/schema";
import { ApiError } from "#/api/errors";
import { normalizeHandle } from "#/lib/invite";
import { automationConsentPolicy, effectiveAutomationAllowed } from "#/services/settings";
import { tokenReachesFriend } from "#/services/token-access";
import type { ApiTokenContext } from "#/services/token-access";
import type {
  Friend,
  FriendPermissionSet,
  FriendRequest,
  StimulusKind,
  StimulusPermission,
  StimulusPermissionUpdate,
} from "#/api/schemas";

const KINDS = ["zap", "vibe", "beep"] as const;

/** Friendships are stored one row per pair in a canonical order. */
function pair(a: string, b: string): { userA: string; userB: string } {
  return a < b ? { userA: a, userB: b } : { userA: b, userB: a };
}

/**
 * A stored grant as the API reports it. `consentRequired` is the server
 * policy, needed to say what a null automation answer currently means.
 */
export function presentPermission(
  row: Pick<FriendPermission, "isAllowed" | "maxIntensity" | "cooldownSeconds" | "automationAllowed">,
  consentRequired: boolean,
): StimulusPermission {
  return {
    isAllowed: row.isAllowed,
    maxIntensity: row.maxIntensity,
    cooldownSeconds: row.cooldownSeconds,
    automationAllowed: row.automationAllowed,
    automationAllowedEffective: effectiveAutomationAllowed(row.automationAllowed, consentRequired),
  };
}

/** What a missing row means: nothing allowed, no automation answer yet. */
const DISABLED = { isAllowed: false, maxIntensity: 0, cooldownSeconds: 0, automationAllowed: null };

export function emptyPermissionSet(consentRequired: boolean): FriendPermissionSet {
  return {
    zap: presentPermission(DISABLED, consentRequired),
    vibe: presentPermission(DISABLED, consentRequired),
    beep: presentPermission(DISABLED, consentRequired),
  };
}

/**
 * The columns a `PUT .../permissions/{kind}` writes. The grant keys always
 * overwrite. `automationAllowed` is written only when the body has the key:
 * an app that predates it sends the three grant keys alone, and that must
 * never wipe an answer the user gave somewhere else. `null` is a real value
 * here — "back to the server default" — and is written.
 */
export function permissionWrite(value: StimulusPermissionUpdate): {
  isAllowed: boolean;
  maxIntensity: number;
  cooldownSeconds: number;
  automationAllowed?: boolean | null;
} {
  return {
    isAllowed: value.isAllowed,
    maxIntensity: value.maxIntensity,
    cooldownSeconds: value.cooldownSeconds,
    ...(value.automationAllowed !== undefined ? { automationAllowed: value.automationAllowed } : {}),
  };
}

function toApiUser(row: Pick<User, "id" | "handle" | "name">) {
  return { id: row.id, handle: row.handle, displayName: row.name };
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  const { userA, userB } = pair(a, b);
  const [row] = await db
    .select({ id: friendship.id })
    .from(friendship)
    .where(and(eq(friendship.userA, userA), eq(friendship.userB, userB)))
    .limit(1);
  return Boolean(row);
}

/** Everyone the user is currently friends with, as ids. */
export async function friendIdsOf(userId: string): Promise<Array<string>> {
  const links = await db
    .select()
    .from(friendship)
    .where(or(eq(friendship.userA, userId), eq(friendship.userB, userId)));
  return links.map((l) => (l.userA === userId ? l.userB : l.userA));
}

/**
 * The caller's friends with both directions of permission. Through a token
 * whose friend scope is `selected`, only the friends it reaches — an
 * integration allowed to poke one person does not get the whole friend list.
 */
export async function listFriends(
  userId: string,
  token: ApiTokenContext | null = null,
): Promise<Array<Friend>> {
  const friendIds = (await friendIdsOf(userId)).filter(
    (id) => !token || tokenReachesFriend(token, id),
  );
  if (friendIds.length === 0) return [];

  const [people, permissions, policy] = await Promise.all([
    db.select().from(userTable).where(inArray(userTable.id, friendIds)),
    db
      .select()
      .from(friendPermission)
      .where(
        or(
          and(eq(friendPermission.granterId, userId), inArray(friendPermission.granteeId, friendIds)),
          and(eq(friendPermission.granteeId, userId), inArray(friendPermission.granterId, friendIds)),
        ),
      ),
    automationConsentPolicy(),
  ]);

  const byId = new Map(people.map((p) => [p.id, p]));

  // permissionsIGranted: I am the granter. permissionsGrantedToMe: they are.
  const granted = new Map<string, FriendPermissionSet>();
  const receivedFrom = new Map<string, FriendPermissionSet>();
  for (const id of friendIds) {
    granted.set(id, emptyPermissionSet(policy.value));
    receivedFrom.set(id, emptyPermissionSet(policy.value));
  }

  for (const row of permissions) {
    const value = presentPermission(row, policy.value);
    if (row.granterId === userId) {
      granted.get(row.granteeId)![row.kind] = value;
    } else {
      receivedFrom.get(row.granterId)![row.kind] = value;
    }
  }

  return friendIds
    .map((id) => {
      const person = byId.get(id);
      if (!person) return null;
      return {
        ...toApiUser(person),
        permissionsGrantedToMe: receivedFrom.get(id)!,
        permissionsIGranted: granted.get(id)!,
      } satisfies Friend;
    })
    .filter((f): f is Friend => f !== null)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function getFriend(userId: string, friendId: string): Promise<Friend> {
  const friends = await listFriends(userId);
  const found = friends.find((f) => f.id === friendId);
  if (!found) throw ApiError.notFound("Not friends with that user.");
  return found;
}

export async function unfriend(userId: string, friendId: string): Promise<void> {
  const { userA, userB } = pair(userId, friendId);
  await db.transaction(async (tx) => {
    await tx
      .delete(friendship)
      .where(and(eq(friendship.userA, userA), eq(friendship.userB, userB)));
    // Permissions are directional, so both directions have to go.
    await tx
      .delete(friendPermission)
      .where(
        or(
          and(eq(friendPermission.granterId, userId), eq(friendPermission.granteeId, friendId)),
          and(eq(friendPermission.granterId, friendId), eq(friendPermission.granteeId, userId)),
        ),
      );
    // So do token allowlist entries, on both people's tokens. Re-friending
    // later must not quietly re-arm an integration aimed at the old
    // friendship; a `selected` token emptied here reaches nobody.
    const tokensOf = (owner: string) =>
      tx.select({ id: apiToken.id }).from(apiToken).where(eq(apiToken.userId, owner));
    await tx
      .delete(apiTokenFriend)
      .where(
        or(
          and(eq(apiTokenFriend.friendId, friendId), inArray(apiTokenFriend.tokenId, tokensOf(userId))),
          and(eq(apiTokenFriend.friendId, userId), inArray(apiTokenFriend.tokenId, tokensOf(friendId))),
        ),
      );
  });
}

export async function setPermission(
  granterId: string,
  granteeId: string,
  kind: StimulusKind,
  value: StimulusPermissionUpdate,
): Promise<StimulusPermission> {
  if (!(await areFriends(granterId, granteeId))) {
    throw ApiError.notFound("Not friends with that user.");
  }

  const write = permissionWrite(value);
  const [row] = await db
    .insert(friendPermission)
    .values({ granterId, granteeId, kind, ...write, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [friendPermission.granterId, friendPermission.granteeId, friendPermission.kind],
      set: { ...write, updatedAt: new Date() },
    })
    .returning();

  if (!row) throw ApiError.notFound("Not friends with that user.");

  return presentPermission(row, (await automationConsentPolicy()).value);
}

// ---------------------------------------------------------------------------
// Requests
//
// No discovery by design: a request always names someone specific, by exact
// handle or by an invite code shared out-of-band.
// ---------------------------------------------------------------------------

async function resolveTarget(input: { handle?: string; inviteCode?: string }): Promise<User> {
  const [found] = input.handle
    ? await db
        .select()
        .from(userTable)
        .where(eq(userTable.handle, normalizeHandle(input.handle)))
        .limit(1)
    : await db
        .select()
        .from(userTable)
        .where(eq(userTable.inviteCode, input.inviteCode!.trim().toUpperCase()))
        .limit(1);

  if (!found) throw ApiError.notFound("No account with that handle or invite code.");
  return found;
}

function toApiRequest(
  row: { id: string; createdAt: Date },
  person: Pick<User, "id" | "handle" | "name">,
  direction: "incoming" | "outgoing",
): FriendRequest {
  return {
    id: row.id,
    handle: person.handle,
    displayName: person.name,
    direction,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function sendRequest(
  fromUserId: string,
  input: { handle?: string; inviteCode?: string },
): Promise<FriendRequest> {
  const target = await resolveTarget(input);

  // Not covered by the spec's 404/409 wording, but it has to land somewhere.
  if (target.id === fromUserId) {
    throw ApiError.conflict("You can't send a friend request to yourself.");
  }
  if (await areFriends(fromUserId, target.id)) {
    throw ApiError.conflict("You're already friends.");
  }

  // A pending request in *either* direction blocks a new one — otherwise two
  // people adding each other at once end up with two rows and two inboxes.
  const [existing] = await db
    .select({ id: friendRequest.id })
    .from(friendRequest)
    .where(
      and(
        eq(friendRequest.status, "pending"),
        or(
          and(eq(friendRequest.fromUserId, fromUserId), eq(friendRequest.toUserId, target.id)),
          and(eq(friendRequest.fromUserId, target.id), eq(friendRequest.toUserId, fromUserId)),
        ),
      ),
    )
    .limit(1);
  if (existing) throw ApiError.conflict("A friend request is already pending.");

  const [row] = await db
    .insert(friendRequest)
    .values({ fromUserId, toUserId: target.id })
    .returning();

  if (!row) throw ApiError.conflict("A friend request is already pending.");

  return toApiRequest(row, target, "outgoing");
}

export async function listRequests(
  userId: string,
): Promise<{ incoming: Array<FriendRequest>; outgoing: Array<FriendRequest> }> {
  // Two queries rather than one self-join: each direction joins the *other*
  // participant, and expressing that as a single ON clause is unreadable.
  const [incomingRows, outgoingRows] = await Promise.all([
    db
      .select({
        id: friendRequest.id,
        createdAt: friendRequest.createdAt,
        handle: userTable.handle,
        name: userTable.name,
      })
      .from(friendRequest)
      .innerJoin(userTable, eq(userTable.id, friendRequest.fromUserId))
      .where(and(eq(friendRequest.toUserId, userId), eq(friendRequest.status, "pending"))),
    db
      .select({
        id: friendRequest.id,
        createdAt: friendRequest.createdAt,
        handle: userTable.handle,
        name: userTable.name,
      })
      .from(friendRequest)
      .innerJoin(userTable, eq(userTable.id, friendRequest.toUserId))
      .where(and(eq(friendRequest.fromUserId, userId), eq(friendRequest.status, "pending"))),
  ]);

  const shape = (
    rows: typeof incomingRows,
    direction: "incoming" | "outgoing",
  ): Array<FriendRequest> =>
    rows
      .map((row) => ({
        id: row.id,
        handle: row.handle,
        displayName: row.name,
        direction,
        createdAt: row.createdAt.toISOString(),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    incoming: shape(incomingRows, "incoming"),
    outgoing: shape(outgoingRows, "outgoing"),
  };
}

export async function acceptRequest(userId: string, requestId: string): Promise<Friend> {
  const [request] = await db
    .select()
    .from(friendRequest)
    .where(
      and(
        eq(friendRequest.id, requestId),
        eq(friendRequest.toUserId, userId),
        eq(friendRequest.status, "pending"),
      ),
    )
    .limit(1);

  if (!request) throw ApiError.notFound("No pending request with that id.");

  const otherId = request.fromUserId;
  const { userA, userB } = pair(userId, otherId);

  await db.transaction(async (tx) => {
    await tx
      .update(friendRequest)
      .set({ status: "accepted", respondedAt: new Date() })
      .where(eq(friendRequest.id, requestId));

    await tx.insert(friendship).values({ userA, userB }).onConflictDoNothing();

    // Both sides start with every stimulus disabled until each grants
    // permissions — seeding all six rows keeps later PUTs a plain upsert.
    // `automation_allowed` starts null: no answer yet, so the server policy
    // decides until the person does.
    await tx
      .insert(friendPermission)
      .values(
        KINDS.flatMap((kind) => [
          { granterId: userId, granteeId: otherId, kind },
          { granterId: otherId, granteeId: userId, kind },
        ]),
      )
      .onConflictDoNothing();
  });

  return getFriend(userId, otherId);
}

/** Rejects an incoming request, or cancels one the caller sent. */
export async function rejectRequest(userId: string, requestId: string): Promise<void> {
  const result = await db
    .update(friendRequest)
    .set({ status: "rejected", respondedAt: new Date() })
    .where(
      and(
        eq(friendRequest.id, requestId),
        eq(friendRequest.status, "pending"),
        or(eq(friendRequest.toUserId, userId), eq(friendRequest.fromUserId, userId)),
      ),
    )
    .returning({ id: friendRequest.id });

  if (result.length === 0) throw ApiError.notFound("No pending request with that id.");
}
