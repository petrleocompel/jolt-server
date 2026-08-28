import { createServerFn } from "@tanstack/react-start";
import { currentUser } from "#/server/session.server";

export const fetchSession = createServerFn({ method: "GET" }).handler(async () => {
  const row = await currentUser();
  return row
    ? {
        id: row.id,
        handle: row.handle,
        displayName: row.name,
        email: row.email,
        inviteCode: row.inviteCode,
        role: row.role,
      }
    : null;
});

export type SessionUser = Awaited<ReturnType<typeof fetchSession>>;
