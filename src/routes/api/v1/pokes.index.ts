import { createFileRoute } from "@tanstack/react-router";
import { handler, json, parseBody, parseQuery, requireCaller } from "#/api/http";
import { PokesQuery, SendPokeBody } from "#/api/schemas";
import { listPokes, sendPoke } from "#/services/pokes";

export const Route = createFileRoute("/api/v1/pokes/")({
  server: {
    handlers: {
      GET: handler(async (request) => {
        const { user, token } = await requireCaller(request, { scope: "pokes:read" });
        const query = parseQuery(request, PokesQuery);
        return json(await listPokes(user.id, query, token));
      }),
      POST: handler(async (request) => {
        const { user, token } = await requireCaller(request, { scope: "pokes:send" });
        const body = await parseBody(request, SendPokeBody);
        const { event, replayed } = await sendPoke(user.id, body.friendId, body.stimulus, {
          pokeId: body.pokeId,
          token,
        });
        // 200, not 201, for a `pokeId` already on record: nothing was created.
        return json(event, replayed ? 200 : 201);
      }),
    },
  },
});
