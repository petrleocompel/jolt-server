import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "#/env";
import * as schema from "#/db/schema";

// One pooled client per process. Migrations use their own single-connection
// client (see src/db/migrate.ts) so a failed migration can't poison the pool.
const client = postgres(env.DATABASE_URL);

export const db = drizzle(client, { schema });
export { schema };
