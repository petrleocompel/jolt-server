import { createFileRoute } from "@tanstack/react-router";
import { signup } from "#/api/auth-bridge";
import { handler, json, parseBody } from "#/api/http";
import { SignupBody } from "#/api/schemas";

export const Route = createFileRoute("/api/v1/auth/signup")({
  server: {
    handlers: {
      POST: handler(async (request) => json(await signup(await parseBody(request, SignupBody)), 201)),
    },
  },
});
