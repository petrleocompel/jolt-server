import { createFileRoute } from "@tanstack/react-router";
import { handler, noContent, parseBody, requireUser } from "#/api/http";
import { ForgetPushTokenBody, PushTokenBody } from "#/api/schemas";
import { registerToken, unregisterToken } from "#/services/devices";

export const Route = createFileRoute("/api/v1/devices/push-token")({
  server: {
    handlers: {
      POST: handler(async (request) => {
        const me = await requireUser(request);
        const body = await parseBody(request, PushTokenBody);
        await registerToken(me.id, body);
        return noContent();
      }),
      // Sign-out. Without it the row outlives the session, and the account
      // keeps this phone as a poke target until something re-registers the
      // token under whoever signs in next.
      DELETE: handler(async (request) => {
        const me = await requireUser(request);
        const body = await parseBody(request, ForgetPushTokenBody);
        await unregisterToken(me.id, "token" in body ? body.token : body.relayToken);
        return noContent();
      }),
    },
  },
});
