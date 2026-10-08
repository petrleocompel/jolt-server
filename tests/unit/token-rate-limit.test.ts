import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/**
 * `reserveTokenFire` against a stubbed `db.execute`. What is pinned here is
 * the control flow around the one conditional UPDATE — a claimed slot can be
 * given back, a refused one is a 429 that says how long to wait. The UPDATE
 * itself, and that it holds under concurrency, is exercised against Postgres
 * in tests/e2e/contract.spec.ts.
 */

const execute = vi.fn();
vi.mock("#/db", () => ({ db: { execute } }));
// Reached through the friends service, which reads the server policy; the
// environment itself is beside the point here.
vi.mock("#/env", () => ({ env: {} }));

const { reserveTokenFire } = await import("#/services/api-tokens");

const token = { id: "0b6c7c55-5d2b-4d3e-9a51-0e7c3c3f7e10" };

/** The nth statement handed to `db.execute`, rendered as Postgres would get it. */
function statement(call: number): { sql: string; params: Array<unknown> } {
  return new PgDialect().sqlToQuery(execute.mock.calls[call]?.[0] as SQL);
}

beforeEach(() => execute.mockReset());

describe("reserveTokenFire", () => {
  it("claims the slot in one conditional update", async () => {
    execute.mockResolvedValueOnce([{ previous: null, reserved: "2026-10-08 12:00:00.123456+00" }]);
    await reserveTokenFire(token);
    expect(execute).toHaveBeenCalledTimes(1);
    const { sql, params } = statement(0);
    expect(sql).toMatch(/set last_fired_at = now\(\)/);
    expect(sql).toMatch(/last_fired_at is null/);
    expect(sql).toMatch(/make_interval\(secs => t\.min_interval_seconds\)/);
    expect(params).toEqual([token.id, token.id]);
  });

  it("gives the slot back only while it is still the one it claimed", async () => {
    execute.mockResolvedValueOnce([
      { previous: "2026-10-08 11:59:00+00", reserved: "2026-10-08 12:00:00.123456+00" },
    ]);
    const release = await reserveTokenFire(token);
    execute.mockResolvedValueOnce([]);
    await release();
    expect(execute).toHaveBeenCalledTimes(2);
    // Restores the previous value, guarded by the exact reserved timestamp —
    // a request that claimed the slot since keeps it.
    const { sql, params } = statement(1);
    expect(sql).toMatch(/where id = \$2 and last_fired_at = \$3::timestamptz/);
    expect(params).toEqual([
      "2026-10-08 11:59:00+00",
      token.id,
      "2026-10-08 12:00:00.123456+00",
    ]);
  });

  it("answers a taken slot with 429 and the wait", async () => {
    execute.mockResolvedValueOnce([]).mockResolvedValueOnce([{ wait: 4, interval: 5 }]);
    await expect(reserveTokenFire(token)).rejects.toMatchObject({
      status: 429,
      message: "Too fast — this token fires at most once every 5s. Try again in 4s.",
    });
  });

  it("answers a token revoked mid-request with 401, not a wait", async () => {
    execute.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(reserveTokenFire(token)).rejects.toMatchObject({ status: 401 });
  });

  it("never fails the request over a release that could not be written", async () => {
    execute.mockResolvedValueOnce([{ previous: null, reserved: "x" }]);
    const release = await reserveTokenFire(token);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    execute.mockRejectedValueOnce(new Error("connection reset"));
    await expect(release()).resolves.toBeUndefined();
    quiet.mockRestore();
  });
});
