import * as Sentry from "@sentry/tanstackstart-react";
import { env } from "#/env";

// DSN comes from the environment only — never commit a project id.
if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1,
    // A push backend fails asynchronously and silently; keep the breadcrumbs.
    sendDefaultPii: false,
  });
}
