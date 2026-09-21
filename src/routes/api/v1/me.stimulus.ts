import { createFileRoute } from "@tanstack/react-router";
import { handler, json, parseBody, requireUser } from "#/api/http";
import { SelfStimulusBody } from "#/api/schemas";
import { sendSelfStimulus } from "#/services/pokes";

export const Route = createFileRoute("/api/v1/me/stimulus")({
  server: {
    handlers: {
      POST: handler(async (request) => {
        const me = await requireUser(request, { allowApiToken: true });
        const body = await parseBody(request, SelfStimulusBody);
        return json(await sendSelfStimulus(me.id, body.stimulus), 201);
      }),
    },
  },
});
