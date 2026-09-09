import { createFileRoute } from "@tanstack/react-router";
import { handler, noContent, requireIdParam, requireUser } from "#/api/http";
import { unfriend } from "#/services/friends";

export const Route = createFileRoute("/api/v1/friends/$friendId")({
  server: {
    handlers: {
      DELETE: handler(async (request, params) => {
        const me = await requireUser(request);
        await unfriend(me.id, requireIdParam(params, "friendId"));
        return noContent();
      }),
    },
  },
});
