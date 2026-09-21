import { z } from "zod";
import { auth } from "#/auth/server";
import { ApiError } from "#/api/errors";
import { db } from "#/db";
import { user as userTable } from "#/db/schema";
import { eq } from "drizzle-orm";
import { isApiTokenCandidate, userForApiToken } from "#/services/api-tokens";
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

export interface AuthOptions {
  /**
   * Also accept a personal access token. Only for endpoints that act on the
   * caller's own account: a PAT is a long-lived credential someone pasted
   * into a third-party integration, so it must never be able to mint another
   * token, change the account, or reach anybody else's data.
   */
  allowApiToken?: boolean;
}

/**
 * Resolves the caller from the bearer token (or session cookie, which is what
 * the web UI uses). Throws 401 when there is no valid session.
 */
export async function requireUser(
  request: Request,
  options: AuthOptions = {},
): Promise<User> {
  const presented = bearerToken(request);

  // A PAT is recognisable by its prefix, so it never reaches Better Auth —
  // and an endpoint that does not opt in says so rather than returning the
  // bare 401 that would send an integrator hunting for a bad token.
  if (presented && isApiTokenCandidate(presented)) {
    if (!options.allowApiToken) {
      throw ApiError.forbidden(
        "API tokens only work on your own account's endpoints. Sign in for this one.",
      );
    }
    const row = await userForApiToken(presented);
    if (!row) throw ApiError.unauthorized("Invalid or expired API token.");
    return row;
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user.id) throw ApiError.unauthorized();

  const [row] = await db.select().from(userTable).where(eq(userTable.id, session.user.id)).limit(1);
  if (!row) throw ApiError.unauthorized();
  return row;
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
