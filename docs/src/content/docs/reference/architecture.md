---
title: Architecture
description: How Jolt Server is put together, from an HTTP request down to Postgres, APNs and the push relay.
---

Jolt Server is one TypeScript application that serves both the web UI and the
JSON API, backed by Postgres.

| Concern         | Built with                                                                  |
| --------------- | --------------------------------------------------------------------------- |
| Web UI and API  | [TanStack Start](https://tanstack.com/start): server-rendered React routes and server route handlers |
| Server runtime  | Nitro, via its Vite plugin; the build output is `.output/server/index.mjs`  |
| Database        | Postgres 16 through Drizzle ORM (`postgres` driver); migrations by drizzle-kit |
| Authentication  | Better Auth: email and password, with the bearer plugin for the mobile app  |
| Validation      | Zod, mirroring the OpenAPI contract                                         |
| Push            | The Jolt push relay, APNs over HTTP/2 with token-based (`.p8`) auth, or a console stub |
| UI              | React 19, Tailwind CSS 4, Radix UI                                          |
| Error reporting | Sentry, when `SENTRY_DSN` is set                                            |

## Source layout

```text
src/
  server.ts            server entry: TanStack Start's handler, plus logging of client hang-ups
  env.ts               environment variables, validated with Zod at startup
  routes/              file-based routes (TanStack Router)
    api/v1/*.ts        the JSON API, one file per path
    api/auth/$.tsx     Better Auth's own endpoints at /api/auth/*
    dashboard.*.tsx    the signed-in web dashboard
    admin.*.tsx        the admin dashboard
    healthz.tsx        GET /healthz
    openapi[.]yaml.ts  GET /openapi.yaml
  api/                 HTTP layer: auth guards, error mapping, Zod schemas, response shaping
  services/            business logic: pokes, friends, devices, tokens, settings, test pushes
  server/              server functions the web UI calls (createServerFn)
  auth/                Better Auth configuration and trusted origins
  db/                  Drizzle schema and connection
  push/                push senders (APNs, relay, console), the routing between them, relay crypto
  cron/                retention and cleanup jobs
scripts/               seed-admin, cron runner, OpenAPI drift check, APNs setup wizard
drizzle/               SQL migrations
openapi/jolt-v1.yaml   the API contract
```

## The path of an API request

Take `POST /api/v1/pokes`:

1. **Entry.** `src/server.ts` hands the request to TanStack Start. If the
   client hangs up mid-request, it logs which request it was and answers
   `499` instead of a `500`.
2. **Route.** `src/routes/api/v1/pokes.index.ts` matches the path. Every API
   handler is wrapped in `handler()` from `src/api/http.ts`, which turns thrown
   errors into the contract's `{ "message": … }` body: `ApiError` keeps its
   status, a Zod validation error becomes a `400`, anything else a `500`.
3. **Authentication.** `requireUser()` accepts only a Better Auth session,
   from the bearer token or the web UI's cookie, and answers a personal access
   token with `403`. `requireCaller()` also accepts a personal access token
   that carries the scope the endpoint asks for. Tokens are recognised by their
   `jolt_pat_` prefix and never reach Better Auth. `requireAdmin()` adds the
   admin role check.
4. **Validation.** `parseBody()` and `parseQuery()` validate input against the
   Zod schemas in `src/api/schemas.ts`, the runtime mirror of the OpenAPI spec.
5. **Service.** `sendPoke()` in `src/services/pokes.ts` does the work: replay
   check for a repeated `pokeId`, token limits, friendship, the recipient's
   grant, automation consent, intensity cap and cooldown, then the token's
   firing interval. It records a `poke_event` row with status `pending`.
6. **Push.** Delivery runs after the response is decided and does not hold it
   up. `pushSender()` in `src/push/index.ts` sends each of the recipient's
   devices the way it registered: directly to APNs, or through the push relay
   (see [Push](#push)). Devices that APNs or the relay report as gone are
   marked disabled.
7. **Response.** `src/api/present.ts` shapes database rows into contract
   objects such as `PokeEvent`, and the handler returns JSON.

The recipient's device later calls `POST /api/v1/pokes/{pokeId}/ack`, which
moves the poke out of `pending`.

## The web UI

The dashboard and admin pages are server-rendered React routes in
`src/routes/`. They do not call the JSON API. They call server functions in
`src/server/` (TanStack Start's `createServerFn`), which use the same services
in `src/services/`. Both paths enforce the same rules because the rules live in
the services.

Signing in on the web goes through Better Auth at `/api/auth/*` and uses a
session cookie. The app goes through `/api/v1/auth/*`, which adapts Better
Auth to the `{ token, user }` shape of the contract (`src/api/auth-bridge.ts`).

## Database

`src/db/schema.ts` defines the tables:

| Table                                              | Holds                                                         |
| -------------------------------------------------- | ------------------------------------------------------------- |
| `user`, `session`, `account`, `verification`       | Better Auth's tables. `user` adds `handle`, `inviteCode` and `role`. |
| `friendship`                                       | Accepted friendships                                          |
| `friend_request`                                   | Pending, accepted and rejected requests                       |
| `friend_permission`                                | One grant per granter, grantee and stimulus kind              |
| `poke_event`                                       | Every poke and self-stimulus, with its delivery status        |
| `device_token`                                     | Registered devices: an APNs token, or a relay token with its sealed payload key |
| `api_token`, `api_token_friend`                    | Personal access tokens (hashed) and their friend allowlists   |
| `server_setting`                                   | Admin-changed server settings, and the server's relay identity |

Migrations are SQL files in `drizzle/`, generated from the schema with
`pnpm db:generate` and applied with `pnpm db:migrate` (drizzle-kit). In the
compose stack, the `migrate` service applies them before `app` starts.

## Push

`src/push/types.ts` defines the `PushSender` interface. There are three
implementations, and a router in front of them:

- `ApnsPushSender` (`src/push/apns.ts`) talks to `api.push.apple.com` or
  `api.sandbox.push.apple.com` over one shared HTTP/2 session, with a JWT
  signed by the `.p8` key. Each poke sends an alert push and a separate silent
  push to every active device of the recipient.
- `RelayPushSender` (`src/push/relay.ts`) sends through the Jolt push relay,
  which holds the APNs key of the official app builds. It seals each payload
  for each device (`src/push/envelope.ts`: AES-256-GCM under the payload key
  the app registered, bound to the server ID and the message kind) and posts
  them to the relay's `/v1/send` in batches of at most 100. The relay sends
  the alert and silent pair to Apple.
- `ConsolePushSender` (`src/push/console.ts`) logs what it would have sent and
  reports success. It stands in for any transport the server cannot deliver,
  so the whole flow can be exercised with no Apple account.
- `RoutingPushSender` (`src/push/routing.ts`) is what `pushSender()` returns.
  It splits a poke's devices by their `transport` column and hands each group
  to its sender, so one user can have a phone on each.

`src/env.ts` decides the routing at startup (`resolvePushRouting`): which
transport `GET /api/v1/push/config` tells apps to register with, and whether
devices already registered with the relay can still be reached. The
[configuration reference](/jolt-server/self-hosting/configuration/#push-notifications)
has the table.

### The relay identity

`src/push/relay-identity.ts` holds the server's side of the relay protocol
(specified in the jolt-relay repository, `spec/protocol-v1.md`):

- The server is an Ed25519 key pair, from `PUSH_RELAY_PRIVATE_KEY` or
  generated on first use and stored as the `relay_identity` server setting.
  Its ID is `srv_` and the base32 of the first 16 bytes of SHA-256 of the
  public key.
- Every request to the relay carries a JWT signed with that key, valid for
  five minutes.
- `RelayClient` registers the server with `POST /v1/servers` the first time
  it is needed (a push, or an app asking `GET /push/config`), and again if the
  relay answers `404 unknown_server`. Its state is what the admin overview
  shows.

The payload keys apps register are stored sealed with AES-256-GCM under a key
derived from `BETTER_AUTH_SECRET` with HKDF (`src/push/payload-key.ts`), and
unsealed only on the way to the relay sender. The envelope and the server ID
are tested against the shared vectors in `tests/unit/vectors/`, copied from
jolt-relay.

Test pushes (`src/services/push-test.ts`) use the same senders and keep their
state in memory for ten minutes.

## Cron jobs

The `cron` container runs `pnpm cron` once an hour, which runs every job in
`src/cron/index.ts` once:

| Job                        | What it does                                                                    |
| -------------------------- | ------------------------------------------------------------------------------- |
| `prune-poke-events`        | Deletes poke events older than `POKE_EVENT_RETENTION_DAYS` (default 90).        |
| `expire-friend-requests`   | Rejects pending friend requests older than `FRIEND_REQUEST_EXPIRY_DAYS` (default 30). |
| `prune-expired-api-tokens` | Deletes personal access tokens that expired more than a week ago.              |
| `cull-dead-tokens`         | Deletes device tokens APNs or the relay reported as unregistered more than a week ago. |

`pnpm cron --list` lists them and `pnpm cron --once <job>` runs one.

## Settings

Server-wide settings (`src/services/settings.ts`) resolve in a fixed order:
the environment variable if set, otherwise the value an admin chose at
`/admin/settings`, otherwise the default. They are read from the database on
each use rather than cached, so an admin's change reaches every instance at
once. Today there is one: the
[automated pokes policy](/jolt-server/self-hosting/automated-pokes/).
