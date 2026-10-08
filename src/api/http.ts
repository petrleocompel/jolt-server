import { z } from "zod";
import { auth } from "#/auth/server";
import { ApiError } from "#/api/errors";
import { db } from "#/db";
import { user as userTable } from "#/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiToken, isApiTokenCandidate } from "#/services/api-tokens";
import { tokenHasScope } from "#/services/token-access";
import type { ApiTokenContext, RequiredScope } from "#/services/token-access";
import type { User } from "#/db/schema";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** The `Error` schema from the contract — `{ message }`, nothing else. */
export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return json({ message: error.message }, error.status);
  }
  if (error instanceof z.ZodError) {
    const first = error.issues[0];
    const path = first?.path.join(".");
    return json(
      { message: path ? `${path}: ${first?.message}` : (first?.message ?? "Invalid request.") },
      400,
    );
  }
  console.error("[api] unhandled", error);
  return json({ message: "Internal server error." }, 500);
}

/**
 * Wraps a route handler so thrown ApiError/ZodError become spec-shaped
 * responses. Path params arrive on the handler context — `Route.useParams()`
 * is a React hook and is not available server-side.
 */
export function handler(
  fn: (request: Request, params: Record<string, string>) => Promise<Response>,
) {
  return async (ctx: {
    request: Request;
    params?: Record<string, string>;
  }): Promise<Response> => {
    try {
      return await fn(ctx.request, ctx.params ?? {});
    } catch (error) {
      return errorResponse(error);
    }
  };
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer") return null;
  return rest.join(" ").trim() || null;
}

/**
 * What a token-accepting endpoint asks of a personal access token: one named
 * scope, or — for `GET /me` alone — merely that the token is valid.
 */
export type TokenAccess = { scope: RequiredScope } | { anyScope: true };

/** Who is calling, and through which token. `token` is null for a session. */
export interface Caller {
  user: User;
  token: ApiTokenContext | null;
}

/**
 * The same 403 every session-only endpoint gives a token: the token is fine,
 * the endpoint is not — so an integrator does not go hunting for a bad
 * secret the way a bare 401 would send them.
 */
function tokenNotAccepted(): ApiError {
  return ApiError.forbidden(
    "API tokens can't be used here — this endpoint needs a signed-in session.",
  );
}

async function sessionUser(request: Request): Promise<User> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user.id) throw ApiError.unauthorized();

  const [row] = await db.select().from(userTable).where(eq(userTable.id, session.user.id)).limit(1);
  if (!row) throw ApiError.unauthorized();
  return row;
}

/**
 * Resolves the caller from the bearer token (or session cookie, which is what
 * the web UI uses). Throws 401 when there is no valid session.
 *
 * Session only. A personal access token is a long-lived credential someone
 * pasted into a third-party integration, so it must never mint another token,
 * register a device, make or accept a friend, edit what friends may send, or
 * ack a poke on the owner's behalf — every endpoint that uses this instead of
 * `requireCaller` answers a token with 403.
 */
export async function requireUser(request: Request): Promise<User> {
  const presented = bearerToken(request);
  // A PAT is recognisable by its prefix, so it never reaches Better Auth.
  if (presented && isApiTokenCandidate(presented)) throw tokenNotAccepted();
  return sessionUser(request);
}

/**
 * Like `requireUser`, but also accepts a personal access token that carries
 * `access.scope` (or `*`). The token comes back with the user because the
 * scope is only the first check: whom it may reach, and how hard and how
 * often it may fire, are the services' to enforce, and they need the token
 * to do it. A session caller gets `token: null` and is not limited at all.
 */
export async function requireCaller(request: Request, access: TokenAccess): Promise<Caller> {
  const presented = bearerToken(request);
  if (!presented || !isApiTokenCandidate(presented)) {
    return { user: await sessionUser(request), token: null };
  }

  const match = await authenticateApiToken(presented);
  if (!match) throw ApiError.unauthorized("Invalid or expired API token.");
  if ("scope" in access && !tokenHasScope(match.token.scopes, access.scope)) {
    throw ApiError.forbidden(`This token lacks the "${access.scope}" scope.`);
  }
  return match;
}

export async function requireAdmin(request: Request): Promise<User> {
  const current = await requireUser(request);
  if (current.role !== "admin") throw ApiError.forbidden("Admin only.");
  return current;
}

export async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw ApiError.badRequest("Body must be valid JSON.");
  }
  return schema.parse(raw);
}

/**
 * Path params are typed `string | undefined` because the router cannot prove
 * a segment matched. A missing one means the route file and its path
 * disagree, which is a 400 rather than a crash.
 */
export function requireParam(params: Record<string, string>, name: string): string {
  const value = params[name];
  if (!value) throw ApiError.badRequest(`Missing ${name} in the request path.`);
  return value;
}

/**
 * Like `requireParam`, but for a path segment that identifies a `user` row.
 * IDs are generated with `crypto.randomUUID()` (lowercase) and stored in
 * case-sensitive `text` columns, but a client is free to send any casing
 * (Foundation's `UUID.uuidString` is uppercase) — lowercase here so every
 * caller compares correctly regardless of what the client sent.
 */
export function requireIdParam(params: Record<string, string>, name: string): string {
  return requireParam(params, name).toLowerCase();
}

export function parseQuery<T extends z.ZodType>(request: Request, schema: T): z.infer<T> {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  return schema.parse(params);
}
