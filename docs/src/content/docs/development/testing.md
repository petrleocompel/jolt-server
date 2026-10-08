---
title: Testing
description: Unit tests with Vitest and end-to-end tests with Playwright against a real Postgres.
---

## Unit tests

```bash
pnpm test          # once
pnpm test:watch    # watch mode
```

Vitest runs `src/**/*.test.ts` and `tests/unit/**/*.test.ts` in a Node
environment. They need no database. They cover, among other things, token
access rules and rate limits, the automation settings, trusted origins,
invite codes, push formatting and the test-push service.

## End-to-end tests

The API contract is covered end to end by Playwright against a real server and
a real Postgres. `tests/e2e/contract.spec.ts` walks the whole mobile flow:
sign-up, friend request, accept, grant a permission, poke, ack. It is the test
that catches spec violations the type system cannot. The other specs cover the
sign-in forms and a smoke test.

```bash
pnpm e2e:up      # throwaway Postgres on port 5433
DATABASE_URL=postgres://jolt:jolt@127.0.0.1:5433/jolt_e2e pnpm db:migrate
pnpm test:e2e
pnpm e2e:down    # remove it again
```

- `pnpm e2e:up` starts `postgres:16-alpine` from
  `deploy/docker-compose.e2e.yml` as the Compose project `jolt-server-e2e`,
  with database `jolt_e2e`, user and password `jolt`, on port 5433 so it never
  collides with the dev database. Its data lives on a tmpfs, so it starts empty
  every time and `pnpm e2e:down` throws it away.
- Playwright starts `pnpm dev` itself, pointed at
  `postgres://jolt:jolt@127.0.0.1:5433/jolt_e2e`. Override the database with
  `E2E_DATABASE_URL`.
- Outside CI, Playwright **reuses** a server already listening on port 3000.
  Stop your own `pnpm dev` first, or the tests run against your development
  database.
- To test a server that is already running somewhere, set `E2E_BASE_URL`;
  Playwright then starts nothing.
- Tests run one at a time (one worker), because the contract test shares one
  database.

## Before sending a change

```bash
pnpm lint
pnpm generate-routes && pnpm typecheck
pnpm openapi:check
pnpm test
```

If you changed the API, see
[Contract-first OpenAPI](/jolt-server/reference/openapi-contract/#changing-the-api).
