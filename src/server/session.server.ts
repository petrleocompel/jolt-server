import { getRequest } from "@tanstack/react-start/server";
import { redirect } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { auth } from "#/auth/server";
import { db } from "#/db";
import { user as userTable } from "#/db/schema";
import type { User } from "#/db/schema";

/**
 * Server-only session helpers. Kept out of src/server/session.ts because
 * these are plain exported functions — the bundler cannot tree-shake them
 * out of the client graph the way it can a createServerFn handler body, so
 * importing `auth`/`db` here from a route module would leak them.
 */

/** Current user or null. Cookie-based — the web UI, not the mobile client. */
export async function currentUser(): Promise<User | null> {
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session?.user.id) return null;
  const [row] = await db.select().from(userTable).where(eq(userTable.id, session.user.id)).limit(1);
  return row ?? null;
}

/** Throws a redirect to /login when signed out — for use in route loaders. */
export async function requireUserOrRedirect(): Promise<User> {
  const row = await currentUser();
  if (!row) throw redirect({ to: "/login" });
  return row;
}

export async function requireAdminOrRedirect(): Promise<User> {
  const row = await requireUserOrRedirect();
  if (row.role !== "admin") throw redirect({ to: "/dashboard" });
  return row;
}
