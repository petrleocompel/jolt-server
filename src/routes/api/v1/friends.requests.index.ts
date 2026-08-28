import { createFileRoute } from "@tanstack/react-router";
import { handler, json, parseBody, requireUser } from "#/api/http";
import { SendFriendRequestBody } from "#/api/schemas";
import { listRequests, sendRequest } from "#/services/friends";

export const Route = createFileRoute("/api/v1/friends/requests/")({
  server: {
    handlers: {
      GET: handler(async (request) => json(await listRequests((await requireUser(request)).id))),
      POST: handler(async (request) => {
        const me = await requireUser(request);
        const body = await parseBody(request, SendFriendRequestBody);
        return json(await sendRequest(me.id, body), 201);
      }),
    },
  },
});
