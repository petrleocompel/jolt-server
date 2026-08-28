import { createFileRoute } from "@tanstack/react-router";
import { handler, json, parseBody, requireParam, requireUser } from "#/api/http";
import { AckBody } from "#/api/schemas";
import { ackPoke } from "#/services/pokes";

export const Route = createFileRoute("/api/v1/pokes/$pokeId/ack")({
  server: {
    handlers: {
      POST: handler(async (request, params) => {
        const me = await requireUser(request);
        const body = await parseBody(request, AckBody);
        return json(await ackPoke(me.id, requireParam(params, "pokeId"), body.status));
      }),
    },
  },
});
