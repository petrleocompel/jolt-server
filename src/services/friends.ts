import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "#/db";
import {
  friendPermission,
  friendRequest,
  friendship,
  user as userTable,
} from "#/db/schema";
import type { User } from "#/db/schema";
import { ApiError } from "#/api/errors";
import { normalizeHandle } from "#/lib/invite";
import type {
  Friend,
  FriendPermissionSet,
  FriendRequest,
  StimulusKind,
  StimulusPermission,
} from "#/api/schemas";

const KINDS = ["zap", "vibe", "beep"] as const;

/** Friendships are stored one row per pair in a canonical order. */
function pair(a: string, b: string): { userA: string; userB: string } {
  return a < b ? { userA: a, userB: b } : { userA: b, userB: a };
}

const DISABLED: StimulusPermission = { isAllowed: false, maxIntensity: 0, cooldownSeconds: 0 };

export function emptyPermissionSet(): FriendPermissionSet {
  return { zap: { ...DISABLED }, vibe: { ...DISABLED }, beep: { ...DISABLED } };
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

export async function listFriends(userId: string): Promise<Array<Friend>> {
  const links = await db
    .select()
    .from(friendship)
    .where(or(eq(friendship.userA, userId), eq(friendship.userB, userId)));

  const friendIds = links.map((l) => (l.userA === userId ? l.userB : l.userA));
  if (friendIds.length === 0) return [];

  const [people, permissions] = await Promise.all([
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
  ]);

  const byId = new Map(people.map((p) => [p.id, p]));

  // permissionsIGranted: I am the granter. permissionsGrantedToMe: they are.
  const granted = new Map<string, FriendPermissionSet>();
  const receivedFrom = new Map<string, FriendPermissionSet>();
  for (const id of friendIds) {
    granted.set(id, emptyPermissionSet());
    receivedFrom.set(id, emptyPermissionSet());
  }

  for (const row of permissions) {
    const value: StimulusPermission = {
      isAllowed: row.isAllowed,
      maxIntensity: row.maxIntensity,
      cooldownSeconds: row.cooldownSeconds,
    };
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
  });
}

export async function setPermission(
  granterId: string,
  granteeId: string,
  kind: StimulusKind,
  value: StimulusPermission,
): Promise<StimulusPermission> {
  if (!(await areFriends(granterId, granteeId))) {
    throw ApiError.notFound("Not friends with that user.");
  }

  const [row] = await db
    .insert(friendPermission)
    .values({ granterId, granteeId, kind, ...value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [friendPermission.granterId, friendPermission.granteeId, friendPermission.kind],
      set: { ...value, updatedAt: new Date() },
    })
    .returning();

  if (!row) throw ApiError.notFound("Not friends with that user.");

  return {
    isAllowed: row.isAllowed,
    maxIntensity: row.maxIntensity,
    cooldownSeconds: row.cooldownSeconds,
  };
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
