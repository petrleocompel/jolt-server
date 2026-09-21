import { createFileRoute } from "@tanstack/react-router";
import { handler, json, parseBody, requireUser } from "#/api/http";
import { CreateApiTokenBody } from "#/api/schemas";
import { createApiToken, listApiTokens } from "#/services/api-tokens";

/**
 * Session only, deliberately: a personal access token that could mint another
 * personal access token would survive its own revocation.
 */
export const Route = createFileRoute("/api/v1/me/tokens/")({
  server: {
    handlers: {
      GET: handler(async (request) => json(await listApiTokens((await requireUser(request)).id))),
      POST: handler(async (request) => {
        const me = await requireUser(request);
        const body = await parseBody(request, CreateApiTokenBody);
        return json(await createApiToken(me.id, body), 201);
      }),
    },
  },
});
