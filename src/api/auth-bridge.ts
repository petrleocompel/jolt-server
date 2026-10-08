import { APIError } from "better-auth/api";
import { auth } from "#/auth/server";
import { ApiError } from "#/api/errors";
import { presentMe } from "#/api/present";
import { serverPolicies } from "#/services/settings";
import { db } from "#/db";
import { user as userTable } from "#/db/schema";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { AuthResponse, LoginBody, SignupBody } from "#/api/schemas";

/**
 * The contract exposes /auth/signup, /auth/login and /auth/logout returning
 * `{ token, user }`. Better Auth's own surface is /api/auth/sign-up/email
 * etc., so these three functions are the adapter between them. The mobile
 * client never sees Better Auth's shapes.
 */

/** Postgres unique-violation, raised when handle or email is taken. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

async function loadMe(userId: string) {
  const [row] = await db.select().from(userTable).where(eq(userTable.id, userId)).limit(1);
  if (!row) throw ApiError.unauthorized();
  return presentMe(row, await serverPolicies());
}

export async function signup(body: z.infer<typeof SignupBody>): Promise<AuthResponse> {
  try {
    const result = await auth.api.signUpEmail({
      body: {
        email: body.email,
        password: body.password,
        name: body.displayName,
        handle: body.handle,
      },
      asResponse: false,
    });

    if (!result.token) throw ApiError.unauthorized("Sign-up did not return a session.");
    return { token: result.token, user: await loadMe(result.user.id) };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isUniqueViolation(error)) {
      throw ApiError.conflict("Email or handle already taken.");
    }
    if (error instanceof APIError) {
      // Better Auth reports an existing email as 422/400 depending on version;
      // the contract only has 409 for this case.
      const message = String(error.body?.message ?? error.message);
      if (/exist|taken|already/i.test(message)) {
        throw ApiError.conflict("Email or handle already taken.");
      }
      throw ApiError.badRequest(message);
    }
    throw error;
  }
}

export async function login(body: z.infer<typeof LoginBody>): Promise<AuthResponse> {
  try {
    const result = await auth.api.signInEmail({
      body: { email: body.email, password: body.password },
      asResponse: false,
    });

    if (!result.token) throw ApiError.unauthorized("Invalid email or password.");
    return { token: result.token, user: await loadMe(result.user.id) };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof APIError) {
      // Never distinguish "no such email" from "wrong password".
      throw ApiError.unauthorized("Invalid email or password.");
    }
    throw error;
  }
}

export async function logout(request: Request): Promise<void> {
  try {
    await auth.api.signOut({ headers: request.headers });
  } catch (error) {
    // Signing out an already-dead session is not an error worth surfacing —
    // the contract's only documented response is 204.
    if (!(error instanceof APIError)) throw error;
  }
}
