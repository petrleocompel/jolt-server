import { createFileRoute } from "@tanstack/react-router";
import { handler, json, requireUser } from "#/api/http";
import { presentMe } from "#/api/present";

export const Route = createFileRoute("/api/v1/me")({
  server: {
    handlers: {
      GET: handler(async (request) => json(presentMe(await requireUser(request)))),
    },
  },
});
