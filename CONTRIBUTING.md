# Contributing

Thanks for wanting to improve Jolt Server. Bug reports, fixes, docs and
features are all welcome; for anything larger than a fix, open an issue first
so we can agree on the shape before you spend time on it.

## Ground rules

- **The contract comes first.** `openapi/jolt-v1.yaml` is canonical and the
  iOS app is built against it. Change the spec and `src/api/schemas.ts`
  together; `pnpm openapi:check` fails when they drift.
- **The server is authoritative.** Permission, intensity cap and cooldown are
  re-checked on every send, whatever a client claims.
- **No discovery.** There is deliberately no way to search for users. Changes
  that would let someone find out who has an account will not be merged.

## Development setup

Node 22, pnpm (the version pinned in `package.json`, via `corepack enable`) and
Docker for Postgres.

```bash
cp .env.example .env          # set BETTER_AUTH_SECRET: openssl rand -base64 48
docker compose --env-file .env -f deploy/docker-compose.yml -f deploy/docker-compose.dev.yml up -d db
pnpm install
pnpm db:migrate
pnpm dev                      # http://127.0.0.1:3000
```

## Before you open a pull request

```bash
pnpm lint
pnpm generate-routes && pnpm typecheck
pnpm openapi:check
pnpm test
```

API changes also need the end-to-end contract walk:

```bash
pnpm e2e:up && pnpm test:e2e; pnpm e2e:down
```

Schema changes come with a migration from `pnpm db:generate`. Add or update
tests for behaviour you change, and the docs in `docs/` when it is
user-visible. CI runs the checks above on every pull request.

## Commit messages

Describe the change from the user's point of view in the subject ("Let a poke
be retried without landing twice"), and explain the why in the body.

## Contributor License Agreement

The first time you open a pull request, a bot asks you to sign the
[CLA](CLA.md) by posting a comment. You keep the copyright in your work; the
agreement lets the maintainer use contributions beyond the AGPL as well, for
example in a hosted service. It covers all your future contributions too.

## The iOS app

The iOS app is built and shipped by the maintainer's private pipeline and is
not part of this repository. Server contributions go through GitHub pull
requests here.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
