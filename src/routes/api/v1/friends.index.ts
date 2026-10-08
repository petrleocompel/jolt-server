import { createFileRoute } from "@tanstack/react-router";
import { handler, json, requireCaller } from "#/api/http";
import { listFriends } from "#/services/friends";

export const Route = createFileRoute("/api/v1/friends/")({
  server: {
    handlers: {
      GET: handler(async (request) => {
        const { user, token } = await requireCaller(request, { scope: "friends:read" });
        return json(await listFriends(user.id, token));
      }),
    },
  },
});
