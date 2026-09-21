import { createFileRoute } from "@tanstack/react-router";
import { handler, json, requireUser } from "#/api/http";
import { presentMe } from "#/api/present";

export const Route = createFileRoute("/api/v1/me/")({
  server: {
    handlers: {
      // Readable with a personal access token: an integration usually needs
      // the account's id or handle before it can do anything useful.
      GET: handler(async (request) =>
        json(presentMe(await requireUser(request, { allowApiToken: true }))),
      ),
    },
  },
});
