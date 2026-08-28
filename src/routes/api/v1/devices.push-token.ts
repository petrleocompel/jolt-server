import { createFileRoute } from "@tanstack/react-router";
import { handler, noContent, parseBody, requireUser } from "#/api/http";
import { PushTokenBody } from "#/api/schemas";
import { registerToken } from "#/services/devices";

export const Route = createFileRoute("/api/v1/devices/push-token")({
  server: {
    handlers: {
      POST: handler(async (request) => {
        const me = await requireUser(request);
        const body = await parseBody(request, PushTokenBody);
        await registerToken(me.id, body.token, body.platform);
        return noContent();
      }),
    },
  },
});
