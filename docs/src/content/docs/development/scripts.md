---
title: Scripts
description: The pnpm scripts in Jolt Server's package.json.
---

| Command                                 | Purpose                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm dev`                              | Dev server on port 3000                                                 |
| `pnpm build`                            | Production build into `.output/`                                        |
| `pnpm start`                            | Run the production build (`node .output/server/index.mjs`)              |
| `pnpm preview`                          | Vite preview of the build                                               |
| `pnpm generate-routes`                  | Generate `src/routeTree.gen.ts` from `src/routes/`                      |
| `pnpm typecheck`                        | TypeScript, no emit                                                     |
| `pnpm lint`                             | ESLint                                                                  |
| `pnpm check`                            | Prettier, check only                                                    |
| `pnpm format`                           | Prettier write, then `eslint --fix`                                     |
| `pnpm test`                             | Vitest unit tests, once                                                 |
| `pnpm test:watch`                       | Vitest in watch mode                                                    |
| `pnpm test:e2e`                         | Playwright, including the full contract walk                            |
| `pnpm e2e:up` / `pnpm e2e:down`         | Start or remove a throwaway Postgres on port 5433 for e2e               |
| `pnpm openapi:check`                    | Fail on drift between the OpenAPI spec and the Zod schemas              |
| `pnpm openapi:generate`                 | Print the structural signatures the check compares                      |
| `pnpm db:generate`                      | Generate a SQL migration in `drizzle/` from `src/db/schema.ts`          |
| `pnpm db:migrate`                       | Apply pending migrations to `DATABASE_URL`                              |
| `pnpm db:studio`                        | Open Drizzle Studio                                                     |
| `pnpm db:seed-admin`                    | Create an admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD`, or promote an existing account |
| `pnpm cron`                             | Run every retention job once                                            |
| `pnpm cron --list`                      | List the retention jobs                                                 |
| `pnpm cron --once <job>`                | Run one job                                                             |

Outside `package.json`, `scripts/setup-apns.sh` is an interactive wizard for
the APNs credentials; see
[Push notifications](/jolt-server/self-hosting/push-notifications/#option-1-the-setup-wizard).

## In the container

The published image contains the scripts, the source and the migrations, so
the same commands work inside the `app` container:

```bash
docker compose exec app pnpm cron --list
docker compose exec app pnpm cron --once prune-poke-events
```

The `migrate` service runs `pnpm db:migrate`, and the `cron` service runs
`pnpm cron` once an hour.
