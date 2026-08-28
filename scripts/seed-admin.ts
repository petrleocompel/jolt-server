/**
 * Idempotent admin bootstrap — password hashing goes through Better Auth so
 * the account is a normal account that happens to have role=admin.
 *
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm db:seed-admin
 */
import { eq } from "drizzle-orm";
import { auth } from "#/auth/server";
import { db } from "#/db";
import { user as userTable } from "#/db/schema";
import { env } from "#/env";

const email = env.ADMIN_EMAIL;
const password = env.ADMIN_PASSWORD;

if (!email || !password) {
  console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD (min 12 chars) first.");
  process.exit(1);
}

const [existing] = await db.select().from(userTable).where(eq(userTable.email, email)).limit(1);

if (existing) {
  if (existing.role !== "admin") {
    await db.update(userTable).set({ role: "admin" }).where(eq(userTable.id, existing.id));
    console.log(`[seed-admin] promoted existing user ${email} to admin`);
  } else {
    console.log(`[seed-admin] ${email} is already an admin — nothing to do`);
  }
} else {
  const result = await auth.api.signUpEmail({
    body: {
      email,
      password,
      name: env.ADMIN_NAME ?? "Admin",
      handle: env.ADMIN_HANDLE ?? "admin",
    },
    asResponse: false,
  });
  await db.update(userTable).set({ role: "admin" }).where(eq(userTable.id, result.user.id));
  console.log(`[seed-admin] created admin ${email}`);
}

process.exit(0);
