import { createFileRoute } from "@tanstack/react-router";
import { handler, json, requireUser } from "#/api/http";
import { testPushStatus } from "#/services/push-test";

export const Route = createFileRoute("/api/v1/devices/test-push/$testID/")({
  server: {
    handlers: {
      GET: handler(async (request, params) => {
        const me = await requireUser(request);
        return json(testPushStatus(me.id, params.testID ?? ""));
      }),
    },
  },
});
