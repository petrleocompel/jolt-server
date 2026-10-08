import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiTokenContext } from "#/services/token-access";

/**
 * The auth boundary for personal access tokens: which endpoints a token may
 * reach at all, and the 403 that names the missing scope. Better Auth, the
 * database and the token lookup are stubbed — the lookup itself is covered
 * end to end in tests/e2e/contract.spec.ts.
 */

const session = vi.fn();
const lookup = vi.fn();
const sessionUser = { id: "6f1c1a52-6f0e-4c39-9d6c-6a0e8c1f0a01", handle: "alice" };

vi.mock("#/auth/server", () => ({ auth: { api: { getSession: session } } }));
vi.mock("#/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [sessionUser] }) }) }) },
}));
vi.mock("#/services/api-tokens", () => ({
  isApiTokenCandidate: (value: string) => value.startsWith("jolt_pat_"),
  authenticateApiToken: lookup,
}));

const { requireCaller, requireUser } = await import("#/api/http");

function request(bearer?: string): Request {
  return new Request("http://jolt.test/api/v1/pokes", {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

function token(scopes: ApiTokenContext["scopes"]): ApiTokenContext {
  return {
    id: "0b6c7c55-5d2b-4d3e-9a51-0e7c3c3f7e10",
    name: "ci",
    prefix: "abcdef",
    scopes,
    friendScope: "all",
    friendIds: new Set(),
  };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { status: number; message: string };
  }
  throw new Error("expected a rejection");
}

beforeEach(() => {
  session.mockReset();
  lookup.mockReset();
});

describe("requireUser (session only)", () => {
  it("answers a token with 403, not 401 — the token is fine, the endpoint is not", async () => {
    const error = await rejection(requireUser(request("jolt_pat_whatever")));
    expect(error.status).toBe(403);
    // Never looked up: a session-only endpoint has no use for it.
    expect(lookup).not.toHaveBeenCalled();
  });

  it("still lets a session through", async () => {
    session.mockResolvedValue({ user: { id: sessionUser.id } });
    expect((await requireUser(request("session-token"))).id).toBe(sessionUser.id);
  });
});

describe("requireCaller", () => {
  it("passes a session through with no token and no limits", async () => {
    session.mockResolvedValue({ user: { id: sessionUser.id } });
    const caller = await requireCaller(request("session-token"), { scope: "pokes:send" });
    expect(caller.token).toBeNull();
    expect(caller.user.id).toBe(sessionUser.id);
  });

  it("accepts a token that carries the scope, and hands the token to the handler", async () => {
    const t = token(["pokes:send"]);
    lookup.mockResolvedValue({ user: sessionUser, token: t });
    const caller = await requireCaller(request("jolt_pat_x"), { scope: "pokes:send" });
    expect(caller.token).toBe(t);
  });

  it("names the missing scope in a 403", async () => {
    lookup.mockResolvedValue({ user: sessionUser, token: token(["stimulus:self"]) });
    const error = await rejection(requireCaller(request("jolt_pat_x"), { scope: "pokes:send" }));
    expect(error.status).toBe(403);
    expect(error.message).toBe('This token lacks the "pokes:send" scope.');
  });

  it("lets a wildcard token through every scope", async () => {
    lookup.mockResolvedValue({ user: sessionUser, token: token(["*"]) });
    for (const scope of ["stimulus:self", "pokes:send", "friends:read", "pokes:read"] as const) {
      await expect(requireCaller(request("jolt_pat_x"), { scope })).resolves.toBeTruthy();
    }
  });

  it("lets any valid token read GET /me, whatever its scopes", async () => {
    lookup.mockResolvedValue({ user: sessionUser, token: token(["pokes:read"]) });
    await expect(requireCaller(request("jolt_pat_x"), { anyScope: true })).resolves.toBeTruthy();
  });

  it("401s an unknown or expired token", async () => {
    lookup.mockResolvedValue(null);
    const error = await rejection(requireCaller(request("jolt_pat_x"), { anyScope: true }));
    expect(error.status).toBe(401);
  });
});
