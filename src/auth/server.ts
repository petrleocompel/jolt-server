import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { randomUUID } from "node:crypto";
import { buildTrustedOrigins } from "#/auth/origins";
import { db } from "#/db";
import * as schema from "#/db/schema";
import { env } from "#/env";
import { generateInviteCode, isValidHandle, normalizeHandle } from "#/lib/invite";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),

  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: buildTrustedOrigins({
    baseURL: env.BETTER_AUTH_URL,
    extra: env.TRUSTED_ORIGINS,
    isDevelopment: env.NODE_ENV !== "production",
  }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },

  // The mobile client authenticates with `Authorization: Bearer <token>`
  // rather than cookies; the bearer plugin accepts that on every route.
  plugins: [bearer()],

  user: {
    additionalFields: {
      handle: { type: "string", required: true, input: true },
      // Server-assigned — a client must not be able to choose its own code.
      inviteCode: { type: "string", required: false, input: false },
      role: { type: "string", required: false, input: false, defaultValue: "user" },
    },
  },

  advanced: {
    database: {
      // The OpenAPI contract types every id as `format: uuid`, so we override
      // Better Auth's default id generator rather than weaken the spec.
      generateId: () => randomUUID(),
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async (data) => {
          const handle = normalizeHandle(String(data.handle ?? ""));
          if (!isValidHandle(handle)) {
            throw new Error("handle must match ^[a-z0-9_]{3,20}$");
          }
          return {
            data: {
              ...data,
              handle,
              inviteCode: data.inviteCode ?? generateInviteCode(),
            },
          };
        },
      },
    },
  },
});

export type Auth = typeof auth;
