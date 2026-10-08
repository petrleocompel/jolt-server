---
title: Requirements
description: What you need before running your own Jolt Server.
---

The Jolt iOS app can point at any Jolt Server. To run one you need:

- **A machine with Docker and the Compose plugin.** Check with
  `docker compose version`. Every service runs in a container: Postgres 16
  (`postgres:16-alpine`), the Jolt Server image, and Caddy (`caddy:2-alpine`).
- **A domain pointing at that machine.** Apple requires HTTPS for the app to
  talk to your server at all, so a bare IP address will not work unless you
  build the app yourself with an App Transport Security exception.
- **Ports 80 and 443 reachable from the internet**, if you use the built-in
  Caddy. Port 80 is not optional: it is how the Let's Encrypt (ACME) challenge
  is answered. If you already run a reverse proxy, see
  [Reverse proxy & TLS](/jolt-server/self-hosting/reverse-proxy/) instead.
- **Optional: an Apple Developer account**, if you want pokes to reach a phone
  whose app is in the background. Without it everything else works, and the
  pushes the server would have sent are logged instead. APNs keys only work for
  an app build signed by the same Apple team, so this also means using your own
  build of the app. See
  [Push notifications](/jolt-server/self-hosting/push-notifications/).

## What runs

| Service   | Image                                     | Purpose                                                                            |
| --------- | ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `db`      | `postgres:16-alpine`                      | The database. Data lives in the `pgdata` volume. Not published on a host port.     |
| `migrate` | `ghcr.io/petrleocompel/jolt-server`       | Runs `pnpm db:migrate` once and exits. `app` and `cron` wait for it to succeed.     |
| `app`     | `ghcr.io/petrleocompel/jolt-server`       | Web UI and API on port 3000 inside the compose network. Health check on `/healthz`. |
| `cron`    | `ghcr.io/petrleocompel/jolt-server`       | Runs `pnpm cron` every hour: the retention and cleanup jobs.                       |
| `caddy`   | `caddy:2-alpine`                          | Terminates TLS on ports 80 and 443 and proxies to `app:3000`.                      |

The `app` container runs one process. The test push feature keeps its state in
memory, so it assumes a single `app` container; see
[Testing push delivery](/jolt-server/guides/push-testing/#one-app-container).

Next: the [quick start](/jolt-server/getting-started/quick-start/), or the full
[configuration reference](/jolt-server/self-hosting/configuration/).
