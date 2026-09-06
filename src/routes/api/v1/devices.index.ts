import { createFileRoute } from "@tanstack/react-router";
import { handler, json, requireUser } from "#/api/http";
import { listDevices } from "#/services/devices";

export const Route = createFileRoute("/api/v1/devices/")({
  server: {
    handlers: {
      GET: handler(async (request) => {
        const me = await requireUser(request);
        return json(await listDevices(me.id));
      }),
    },
  },
});
