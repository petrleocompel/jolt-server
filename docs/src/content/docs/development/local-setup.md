---
title: Local setup
description: Run Jolt Server from source on your own machine for development.
---

## Prerequisites

- Node.js 22 (the image and the build use `node:22-alpine`).
- pnpm 10. The repository pins `pnpm@10.33.0` in `package.json`; with
  Corepack enabled (`corepack enable`), the right version is used
  automatically.
- Docker with the Compose plugin, for Postgres.

You do not need Apple credentials. Without them the server uses its console
push sender, which logs what it would have sent, and every other part of the
poke flow works.

## Setup

```bash
git clone https://github.com/petrleocompel/jolt-server
cd jolt-server
cp .env.example .env          # then fill BETTER_AUTH_SECRET at minimum
docker compose --env-file .env -f deploy/docker-compose.yml -f deploy/docker-compose.dev.yml up -d db
pnpm install
pnpm db:generate && pnpm db:migrate
pnpm db:seed-admin            # needs ADMIN_EMAIL + ADMIN_PASSWORD
pnpm dev                      # http://127.0.0.1:3000
```

Generate a secret with `openssl rand -base64 48`.

A few things that are easy to trip over:

- **`--env-file .env` is needed.** With `-f deploy/…`, Compose looks for
  `.env` in `deploy/`, not in the repository root. Without the flag it stops
  with `required variable BETTER_AUTH_SECRET is missing a value`, even when
  only starting `db`.
- **The dev overlay publishes Postgres** on `127.0.0.1:5432` (or
  `POSTGRES_HOST_PORT`), which is what the `DATABASE_URL` in `.env.example`
  points at. The base stack never publishes the database.
- **Scripts read only their process environment.** `pnpm db:seed-admin` and
  `pnpm cron` run through `tsx`, which does not load `.env`. Export the values
  into your shell first, for example `set -a; . ./.env; set +a`, or pass them
  inline: `ADMIN_EMAIL=… ADMIN_PASSWORD=… pnpm db:seed-admin`.
- **An empty `ADMIN_PASSWORD=` counts as set.** If it is in the environment,
  it must be at least 12 characters, or every process that loads the server
  configuration refuses to start. Fill it in or delete the line.
- **Loopback names are trusted.** With `NODE_ENV=development`, the server
  accepts sign-ins from `localhost`, `127.0.0.1` and `[::1]` on the same port
  as `BETTER_AUTH_URL` (default `http://127.0.0.1:3000`), so following the
  `localhost` link `pnpm dev` prints works.

## Routes are generated

TanStack Router generates `src/routeTree.gen.ts` from the files in
`src/routes/`. The dev server and the build do this for you. Before running
`pnpm typecheck` on a fresh checkout, run `pnpm generate-routes`. The file is
not committed.

## Where to go next

- [Scripts](/jolt-server/development/scripts/): every `pnpm` command.
- [Testing](/jolt-server/development/testing/): unit and end-to-end tests.
- [Architecture](/jolt-server/reference/architecture/): how the code is laid
  out.
- [Contract-first OpenAPI](/jolt-server/reference/openapi-contract/): change
  the spec first.
