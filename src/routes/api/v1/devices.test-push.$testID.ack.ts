import { createFileRoute } from "@tanstack/react-router";
import { handler, json, parseBody, requireUser } from "#/api/http";
import { TestPushAckBody } from "#/api/schemas";
import { ackTestPush } from "#/services/push-test";

export const Route = createFileRoute("/api/v1/devices/test-push/$testID/ack")({
  server: {
    handlers: {
      POST: handler(async (request, params) => {
        const me = await requireUser(request);
        const body = await parseBody(request, TestPushAckBody);
        return json(ackTestPush(me.id, params.testID ?? "", body));
      }),
    },
  },
});
