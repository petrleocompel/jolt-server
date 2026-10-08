---
title: Building from source
description: Build the Jolt Server image yourself and run it with the compose files in deploy/.
---

The [quick start](/jolt-server/getting-started/quick-start/) runs the published
image. To run your own build instead, use the compose files in `deploy/`. They
build the image from the repository's `Dockerfile`.

## The compose files

| File                                     | What it does                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `deploy/docker-compose.yml`              | Base stack: `db`, `migrate`, `app`, `cron`. Every overlay builds on it. Publishes nothing.       |
| `deploy/docker-compose.selfhost.yml`     | Adds Caddy on ports 80 and 443 with `deploy/Caddyfile`, for TLS with Let's Encrypt.              |
| `deploy/docker-compose.dev.yml`          | Publishes Postgres on `127.0.0.1:${POSTGRES_HOST_PORT:-5432}` for local development.             |
| `deploy/docker-compose.e2e.yml`          | Standalone throwaway Postgres on port 5433 for Playwright. Not an overlay.                       |
| `deploy/docker-compose.test.yml`         | The project's own test deployment behind Traefik. Requires `JOLT_IMAGE`. Not needed to self-host. |
| `deploy/docker-compose.test-dbaccess.yml`| Publishes that test deployment's Postgres for debugging. Not needed to self-host.                |

Without `JOLT_IMAGE`, the base stack tags the image it builds
`jolt-server:local`. Set `JOLT_IMAGE` to run an image from a registry
instead.

## Run it

```bash
git clone https://github.com/petrleocompel/jolt-server
cd jolt-server
cp .env.example .env
```

Edit `.env`: set `APP_HOST`, `BETTER_AUTH_SECRET` and `POSTGRES_PASSWORD` as in
the quick start, and **delete the `DATABASE_URL` line**. Then:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml -f deploy/docker-compose.selfhost.yml up -d --build
```

This builds the image, starts Postgres, runs the migrations to completion,
starts the API and the hourly cron, and puts Caddy in front.

Differences from the root `compose.yaml` worth knowing:

- **Pass `--env-file .env`.** With `-f deploy/…`, Compose looks for `.env` in
  `deploy/`, not in the repository root.
- **Remove `DATABASE_URL` from `.env`.** `deploy/docker-compose.yml` uses a
  `DATABASE_URL` from its environment when one is set. The one in
  `.env.example` points at `127.0.0.1`, which inside a container is the
  container itself, so the app could not reach the database.
- `POSTGRES_PASSWORD` falls back to `jolt` here instead of being required.
- `PUSH_TIME_ZONE` is not passed to the `app` container, so notification times
  are always in UTC.

Create the first admin the same way as with the published image:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml exec \
  -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='at-least-12-chars' app pnpm db:seed-admin
```

## Behind an existing reverse proxy

Leave out `docker-compose.selfhost.yml` and add your own overlay that publishes
the app. Compose does not pick up override files automatically when you pass
`-f`, so name it explicitly:

```yaml
# deploy/docker-compose.override.yml
services:
  app:
    ports:
      - "127.0.0.1:7385:3000"
```

```bash
docker compose --env-file .env -f deploy/docker-compose.yml -f deploy/docker-compose.override.yml up -d --build
```

Then follow the requirements in
[Reverse proxy & TLS](/jolt-server/self-hosting/reverse-proxy/#use-an-existing-reverse-proxy):
forward the `Authorization` header and set `PUBLIC_URL`.

## Upgrading

```bash
git pull
docker compose --env-file .env -f deploy/docker-compose.yml -f deploy/docker-compose.selfhost.yml up -d --build
```

Migrations run automatically before the new API starts. Back up first:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml exec -T db pg_dump -U jolt jolt | gzip > jolt-$(date +%F).sql.gz
```

## The image

The `Dockerfile` builds on `node:22-alpine` in three stages: install
dependencies with `pnpm install --frozen-lockfile`, run `pnpm build`, then copy
the build output into the runtime image. The runtime image also keeps the
migrations, the OpenAPI spec, the scripts and the source, so `pnpm db:migrate`,
`pnpm db:seed-admin` and `pnpm cron` work inside it. It exposes port 3000 and
starts `node .output/server/index.mjs`.

To build it on its own:

```bash
docker build -t jolt-server:local .
```
