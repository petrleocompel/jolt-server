import { createFileRoute } from "@tanstack/react-router";
import { handler, noContent, requireIdParam, requireUser } from "#/api/http";
import { revokeApiToken } from "#/services/api-tokens";

export const Route = createFileRoute("/api/v1/me/tokens/$tokenId")({
  server: {
    handlers: {
      DELETE: handler(async (request, params) => {
        const me = await requireUser(request);
        await revokeApiToken(me.id, requireIdParam(params, "tokenId"));
        return noContent();
      }),
    },
  },
});
