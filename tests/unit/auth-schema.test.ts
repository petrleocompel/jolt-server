import { getAuthTables } from "better-auth/db";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "#/db/schema";

/**
 * Better Auth derives its SQL from the Drizzle tables we hand the adapter. If
 * it expects a field our table doesn't have, it throws at *runtime* — on the
 * first sign-up, not at build or type-check time.
 *
 * That is exactly how registration broke: Better Auth 1.7 added `issuer` to
 * `account`, our schema didn't have it, and every sign-up (mobile API and web
 * form alike) returned 500 while lint, typecheck and the unit suite all stayed
 * green. The e2e contract test would have caught it but does not run in CI.
 *
 * So: assert the mapping here, cheaply, in the suite that does run. A Better
 * Auth upgrade that adds a field now fails this test with the field's name
 * instead of failing in production.
 */
describe("Better Auth ↔ Drizzle schema", () => {
  const tables = getAuthTables({});
  const ours = {
    user: schema.user,
    session: schema.session,
    account: schema.account,
    verification: schema.verification,
  } as const;

  for (const [model, table] of Object.entries(ours)) {
    const expected = tables[model];
    if (!expected) continue;

    it(`"${model}" has every field Better Auth expects`, () => {
      // Drizzle's property names are what the adapter looks up, not the
      // snake_case column names.
      const columns = new Set(Object.keys(getTableColumns(table)));
      const missing = Object.keys(expected.fields).filter((field) => !columns.has(field));
      expect(missing, `missing on "${model}": ${missing.join(", ")}`).toEqual([]);
    });
  }
});
