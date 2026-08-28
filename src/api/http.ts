import { z } from "zod";
import { auth } from "#/auth/server";
import { ApiError } from "#/api/errors";
import { db } from "#/db";
import { user as userTable } from "#/db/schema";
import { eq } from "drizzle-orm";
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

/**
 * Resolves the caller from the bearer token (or session cookie, which is what
 * the web UI uses). Throws 401 when there is no valid session.
 */
export async function requireUser(request: Request): Promise<User> {
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

export function parseQuery<T extends z.ZodType>(request: Request, schema: T): z.infer<T> {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  return schema.parse(params);
}
