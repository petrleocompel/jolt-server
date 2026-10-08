import { createFileRoute } from "@tanstack/react-router";
// Bundled at build time, so the served contract is always the one this build
// was checked against — no runtime read from a path the image may not have.
import spec from "../../openapi/jolt-v1.yaml?raw";

export const Route = createFileRoute("/openapi.yaml")({
  server: {
    handlers: {
      GET: () =>
        new Response(spec, {
          headers: {
            "content-type": "application/yaml; charset=utf-8",
            // Lets Swagger Editor, codegen and other hosted tools fetch it.
            "access-control-allow-origin": "*",
            "cache-control": "public, max-age=300",
          },
        }),
    },
  },
});
