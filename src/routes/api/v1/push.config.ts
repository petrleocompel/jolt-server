import { createFileRoute } from "@tanstack/react-router";
import { handler, json, requireUser } from "#/api/http";
import { pushConfig } from "#/push";

export const Route = createFileRoute("/api/v1/push/config")({
  server: {
    handlers: {
      // Signed in, like the registration it precedes: the relay address and
      // this server's id are nobody else's business.
      GET: handler(async (request) => {
        await requireUser(request);
        return json(await pushConfig());
      }),
    },
  },
});
