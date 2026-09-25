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
        const { event, replayed } = await sendPoke(me.id, body.friendId, body.stimulus, body.pokeId);
        // 200, not 201, for a `pokeId` already on record: nothing was created.
        return json(event, replayed ? 200 : 201);
      }),
    },
  },
});
