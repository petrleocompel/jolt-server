import { createFileRoute } from "@tanstack/react-router";
import { handler, json, requireParam, requireUser } from "#/api/http";
import { acceptRequest } from "#/services/friends";

export const Route = createFileRoute("/api/v1/friends/requests/$requestId/accept")({
  server: {
    handlers: {
      POST: handler(async (request, params) => {
        const me = await requireUser(request);
        return json(await acceptRequest(me.id, requireParam(params, "requestId")));
      }),
    },
  },
});
