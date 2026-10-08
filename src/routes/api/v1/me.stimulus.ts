import { createFileRoute } from "@tanstack/react-router";
import { handler, json, parseBody, requireCaller } from "#/api/http";
import { SelfStimulusBody } from "#/api/schemas";
import { sendSelfStimulus } from "#/services/pokes";

export const Route = createFileRoute("/api/v1/me/stimulus")({
  server: {
    handlers: {
      POST: handler(async (request) => {
        const { user, token } = await requireCaller(request, { scope: "stimulus:self" });
        const body = await parseBody(request, SelfStimulusBody);
        return json(await sendSelfStimulus(user.id, body.stimulus, token), 201);
      }),
    },
  },
});
