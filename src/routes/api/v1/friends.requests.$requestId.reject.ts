import { createFileRoute } from "@tanstack/react-router";
import { handler, noContent, requireParam, requireUser } from "#/api/http";
import { rejectRequest } from "#/services/friends";

export const Route = createFileRoute("/api/v1/friends/requests/$requestId/reject")({
  server: {
    handlers: {
      POST: handler(async (request, params) => {
        const me = await requireUser(request);
        await rejectRequest(me.id, requireParam(params, "requestId"));
        return noContent();
      }),
    },
  },
});
