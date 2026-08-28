import { createFileRoute } from "@tanstack/react-router";
import { handler, json, parseBody, parseQuery, requireUser } from "#/api/http";
import { PokesQuery, SendPokeBody } from "#/api/schemas";
import { listPokes, sendPoke } from "#/services/pokes";

export const Route = createFileRoute("/api/v1/pokes/")({
  server: {
    handlers: {
      GET: handler(async (request) => {
        const me = await requireUser(request);
        const query = parseQuery(request, PokesQuery);
        return json(await listPokes(me.id, query));
      }),
      POST: handler(async (request) => {
        const me = await requireUser(request);
        const body = await parseBody(request, SendPokeBody);
        return json(await sendPoke(me.id, body.friendId, body.stimulus), 201);
      }),
    },
  },
});
