import { createFileRoute } from "@tanstack/react-router";
import { handler, json, requireUser } from "#/api/http";
import { listFriends } from "#/services/friends";

export const Route = createFileRoute("/api/v1/friends/")({
  server: {
    handlers: {
      GET: handler(async (request) => json(await listFriends((await requireUser(request)).id))),
    },
  },
});
