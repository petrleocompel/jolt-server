import { createFileRoute } from "@tanstack/react-router";
import { logout } from "#/api/auth-bridge";
import { handler, noContent } from "#/api/http";

export const Route = createFileRoute("/api/v1/auth/logout")({
  server: {
    handlers: {
      POST: handler(async (request) => {
        await logout(request);
        return noContent();
      }),
    },
  },
});
