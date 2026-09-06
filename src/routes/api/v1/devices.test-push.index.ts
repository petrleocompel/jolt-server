import { createFileRoute } from "@tanstack/react-router";
import { handler, json, parseBody, requireUser } from "#/api/http";
import { TestPushBody } from "#/api/schemas";
import { sendTestPush } from "#/services/push-test";

export const Route = createFileRoute("/api/v1/devices/test-push/")({
  server: {
    handlers: {
      POST: handler(async (request) => {
        const me = await requireUser(request);
        const body = await parseBody(request, TestPushBody);
        return json(
          await sendTestPush({
            userId: me.id,
            deviceId: body.deviceId,
            stimulus: body.stimulus,
            source: "app",
          }),
        );
      }),
    },
  },
});
