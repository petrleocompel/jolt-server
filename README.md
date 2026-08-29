# Jolt Server

Backend for [Jolt](https://petrleocompel.github.io/jolt-server/), the independent iOS
client for Pavlok wearables. Handles accounts, friends, per-stimulus
permissions, and pokes delivered over APNs.

TanStack Start (SSR web UI + API routes), Drizzle/Postgres, Better Auth.

**Running your own?** See [docs/SELFHOSTING.md](docs/SELFHOSTING.md). The iOS
app takes a server URL in Settings, so it can point at your instance instead of
ours.

## The contract comes first

`openapi/jolt-v1.yaml` is canonical. The mobile client's `MockSocialBackend`
implements the same contract in-memory, so this server is meant to be a
drop-in replacement for it — no client changes beyond swapping the repository
implementation and setting a base URL.

`src/api/schemas.ts` is the runtime mirror the server validates against.
`pnpm openapi:check` compares the two and fails CI when they drift: component
properties, required fields, enum members, and whether every spec path has a
route file behind it.

**Base path is `/api/v1`**, not the `/v1` the spec originally declared — the
`servers:` entry was updated to match. Better Auth keeps its own surface at
`/api/auth/*`; the mobile client never touches it, because `/api/v1/auth/*`
adapts it to the `{ token, user }` shape the contract specifies.

## Setup

```bash
cp .env.example .env          # then fill BETTER_AUTH_SECRET at minimum
docker compose -f deploy/docker-compose.yml up -d db
pnpm install
pnpm db:generate && pnpm db:migrate
pnpm db:seed-admin            # needs ADMIN_EMAIL + ADMIN_PASSWORD
pnpm dev                      # http://127.0.0.1:3000
```

Generate a secret with `openssl rand -base64 48`.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Dev server on :3000 |
| `pnpm typecheck` / `pnpm lint` | TS and ESLint |
| `pnpm test` | Vitest unit tests |
| `pnpm test:e2e` | Playwright, incl. the full contract walk |
| `pnpm e2e:up` / `pnpm e2e:down` | Throwaway Postgres on :5433 for e2e |
| `pnpm openapi:check` | Fail on spec/Zod drift |
| `pnpm openapi:generate` | Print the structural signatures |
| `pnpm db:generate` / `db:migrate` / `db:studio` | Drizzle |
| `pnpm cron --list` | List retention jobs |
| `pnpm cron --once <job>` | Run one job |

## Push notifications

`POST /api/v1/pokes` sends **two separate** APNs pushes per poke:

1. an alert push (`apns-push-type: alert`, priority 10) so the recipient
   definitely finds out;
2. a silent push (`apns-push-type: background`, priority 5) that can fire the
   stimulus without interaction — best effort, iOS gives no delivery guarantee.

They cannot be merged: iOS suppresses the background wake when an `alert` is
present in the same payload.

Without `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_KEY_P8`, the server falls back
to `ConsolePushSender`, which logs what it would have sent. Everything else —
permission checks, cooldowns, event rows, acks — works unchanged, so the whole
flow is testable with no Apple credentials. The admin dashboard says loudly
when APNs is unconfigured.

Tokens that come back `410 Unregistered` are marked disabled immediately and
deleted by the `cull-dead-tokens` cron job.

## Poke lifecycle

A poke is created `pending` and only the recipient's device moves it to a
terminal state via `POST /pokes/{id}/ack` (`fired`, `deviceNotConnected`,
`notAllowed`, `muted`). Acking is idempotent — first ack wins — because the
same poke may be acked twice, once from the silent push and once from a
notification tap.

`pending` was **added to `PokeDeliveryStatus`** during implementation: the
original enum had only terminal values, leaving nothing honest to record
between accepting a poke and hearing back from the device. Clients should
treat a long-`pending` poke as undelivered.

## Permissions

Per stimulus (`zap`/`vibe`/`beep`), each with its own allow flag, intensity
cap and cooldown, always edited from the **granter's** side. Accepting a
friend request seeds all six rows (3 stimuli x 2 directions) disabled.

The composer clamps intensity client-side for UX only. The server re-checks
permission, cap and cooldown on every send and is authoritative.

## No discovery, by design

There is no user search endpoint. A friend request always targets someone
specific, by exact `@handle` or by an invite code shared out-of-band. The
public `/invite/$code` page deliberately does not confirm whether a code is
real before sign-in — doing so would recreate the discovery endpoint the
product decision rules out.

## Deploy

```bash
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.selfhost.yml up -d
```

Requires `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `APP_HOST`, and the
`APNS_*` values in the environment. Caddy terminates TLS; the `cron` service
runs the retention jobs hourly off the same image.

Never commit `.env` or the `.p8` auth key — `*.p8` is gitignored.
