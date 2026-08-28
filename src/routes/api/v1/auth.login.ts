import { createFileRoute } from "@tanstack/react-router";
import { login } from "#/api/auth-bridge";
import { handler, json, parseBody } from "#/api/http";
import { LoginBody } from "#/api/schemas";

export const Route = createFileRoute("/api/v1/auth/login")({
  server: {
    handlers: {
      POST: handler(async (request) => json(await login(await parseBody(request, LoginBody)))),
    },
  },
});
