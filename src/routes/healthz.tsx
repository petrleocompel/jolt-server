import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { db } from "#/db";

export const Route = createFileRoute("/healthz")({
  server: {
    handlers: {
      GET: async () => {
        try {
          await db.execute(sql`select 1`);
          return new Response(JSON.stringify({ status: "ok", db: "up" }), {
            headers: { "content-type": "application/json" },
          });
        } catch {
          return new Response(JSON.stringify({ status: "degraded", db: "down" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});
