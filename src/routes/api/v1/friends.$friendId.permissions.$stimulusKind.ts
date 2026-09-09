import { createFileRoute } from "@tanstack/react-router";
import { handler, json, parseBody, requireIdParam, requireParam, requireUser } from "#/api/http";
import { StimulusKind, StimulusPermission } from "#/api/schemas";
import { setPermission } from "#/services/friends";

export const Route = createFileRoute(
  "/api/v1/friends/$friendId/permissions/$stimulusKind",
)({
  server: {
    handlers: {
      PUT: handler(async (request, params) => {
        const me = await requireUser(request);
        const body = await parseBody(request, StimulusPermission);
        // Always edits *your* grant to them — never the reverse.
        const updated = await setPermission(
          me.id,
          requireIdParam(params, "friendId"),
          StimulusKind.parse(requireParam(params, "stimulusKind")),
          body,
        );
        return json(updated);
      }),
    },
  },
});
