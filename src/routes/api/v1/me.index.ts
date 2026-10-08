import { createFileRoute } from "@tanstack/react-router";
import { handler, json, requireCaller } from "#/api/http";
import { presentMe } from "#/api/present";

export const Route = createFileRoute("/api/v1/me/")({
  server: {
    handlers: {
      // Readable with any valid personal access token, whatever its scopes:
      // an integration usually needs the account's id or handle before it
      // can do anything useful, and "whose token is this?" leaks nothing the
      // token's holder could not already do with it.
      GET: handler(async (request) =>
        json(presentMe((await requireCaller(request, { anyScope: true })).user)),
      ),
    },
  },
});
