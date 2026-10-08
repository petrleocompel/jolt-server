import type { PokeEvent as PokeEventRow, User } from "#/db/schema";
import type { Me, PokeEvent, ServerPolicies } from "#/api/schemas";

/** DB row -> the `Me` component. `displayName` is Better Auth's `name`. */
export function presentMe(row: User, policies: ServerPolicies): Me {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.name,
    email: row.email,
    inviteCode: row.inviteCode,
    policies,
  };
}

/**
 * DB row -> the `PokeEvent` component, as `viewerId` sees it. `direction` is
 * derived per viewer rather than stored, so a poke can never disagree with
 * itself across the two activity feeds.
 *
 * `tokenName` is the name of the token that sent it, if one did and still
 * exists. It is shown to the sender only: the recipient learns that a poke
 * was automated (`viaApiToken`), not what their friend called the script.
 */
export function presentPokeEvent(
  row: PokeEventRow,
  viewerId: string,
  other: Pick<User, "handle" | "name">,
  tokenName: string | null = null,
): PokeEvent {
  return {
    id: row.id,
    direction: row.senderId === viewerId ? "sent" : "received",
    friendHandle: other.handle,
    friendDisplayName: other.name,
    stimulus: {
      kind: row.kind,
      intensity: row.intensity,
      repetitions: row.repetitions,
    },
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    ackedAt: row.ackedAt?.toISOString() ?? null,
    viaApiToken: row.source === "api_token",
    apiTokenName: row.senderId === viewerId ? tokenName : null,
  };
}
