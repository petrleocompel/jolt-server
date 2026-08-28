import type { User } from "#/db/schema";
import type { Me } from "#/api/schemas";

/** DB row -> the `Me` component. `displayName` is Better Auth's `name`. */
export function presentMe(row: User): Me {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.name,
    email: row.email,
    inviteCode: row.inviteCode,
  };
}
