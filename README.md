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
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.dev.yml up -d db
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

The alert reads `Alice` / `zapped you — 30% x2 at 14:32 UTC`: how hard and
when, because a poke arrives on a locked phone and "zapped you" alone does not
say which of the last three it is. The time is rendered server-side in
`PUSH_TIME_ZONE` (default `UTC`) and always names its zone — a client that
wants the recipient's own local time has the raw `sentAt` in the payload and
should prefer it.

Without `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_KEY_P8`, the server falls back
to `ConsolePushSender`, which logs what it would have sent. Everything else —
permission checks, cooldowns, event rows, acks — works unchanged, so the whole
flow is testable with no Apple credentials. The admin dashboard says loudly
when APNs is unconfigured.

Tokens that come back `410 Unregistered` are marked disabled immediately and
deleted by the `cull-dead-tokens` cron job.

### Testing delivery

`POST /api/v1/devices/test-push` sends the same alert + silent pair to your
own devices, with a `type: "test"` payload instead of a poke — no friendship,
no permission, no `poke_event`. Send `stimulus` to have the phone fire it too,
or omit it for a notification-only test that needs no wearable connected.

Users run it from **Dashboard → Devices**; the app has the same button under
Settings → Notifications. Admins can push to *someone else's* devices from
`/admin/devices` (same service, not scoped to the caller).

The device confirms receipt with `POST /devices/test-push/{testID}/ack`, and
`GET /devices/test-push/{testID}` reports the round trip, so "delivered in
1.2 s" means the phone genuinely got it — not just that Apple accepted it.

Tests are held **in memory for 10 minutes**, not in the database: a test is
only interesting while you are watching it. That assumes a single `app`
container (which `deploy/docker-compose.yml` runs); behind two replicas an ack
would land on the instance that didn't send, and every test would look
undelivered. Rate limited to one per 5 s per account.

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

## Your own integrations

A **personal access token** (`jolt_pat_…`) lets your own code act for you —
jolt you when a build fails, or poke a friend from a home automation. Mint one
under **Dashboard → API tokens** (or at `POST /api/v1/me/tokens`, with a
session) and paste it into whatever you are wiring up. A token is never
editable: to change what it may do, mint another and revoke the old one.

Only the sha256 of a token is stored, so the secret is returned exactly once,
at creation, and a lost one is replaced rather than looked up. The dashboard
page shows the secret once, with ready-made curl lines for what it may do, and
lists every token with its scopes, friends, limits and when it was last used,
so a forgotten integration is visible rather than merely remembered.

### Scopes

Each token says what it may do. `scopes` is required when minting:

| Scope | Unlocks |
|---|---|
| `stimulus:self` | `POST /me/stimulus` — fire at your own devices |
| `pokes:send` | `POST /pokes` — poke friends, within what each allows you |
| `friends:read` | `GET /friends` |
| `pokes:read` | `GET /pokes` |
| `*` | every scope, including any added later |

`GET /me` works with any valid token. A token missing the scope an endpoint
needs gets `403 This token lacks the "pokes:send" scope.` Everything else —
minting, listing and revoking tokens, devices, friend requests, editing
permissions, acks — is session-only, whatever the scopes; a token there is a
**403, not a 401**, so an integrator is told the token is fine and the
endpoint is not. A token that could mint another would survive its own
revocation. Tokens minted before scopes existed were migrated to
`stimulus:self`, which is all they could ever do.

### Which friends

By default a token reaches every friend, including ones added later. Send
`friendIds` when minting and it reaches only those (`friendScope:
"selected"`). Each must be a current friend. Unfriending someone removes them
from every token on both sides — and re-friending does not put them back — so
a `selected` token whose list has emptied reaches **nobody**, never
everybody. Such a token sees only its friends in `GET /friends`, and only
pokes with them in `GET /pokes`. A token's `GET /pokes` includes your own
self-stimuli only if it may fire them (`stimulus:self` or `*`).

```bash
curl -X POST https://jolt.example/api/v1/pokes \
  -H "Authorization: Bearer jolt_pat_…" \
  -H "Content-Type: application/json" \
  -d '{"friendId":"<their id from GET /friends>","stimulus":{"kind":"vibe","intensity":20,"repetitions":1}}'
```

### Limits

A token can also be minted with limits on what it fires, at you or at a
friend: `allowedKinds` (default every kind), `maxIntensity` (default: only the
recipient's cap) and `minIntervalSeconds` (default 1, at least 1, at most a
day). They narrow the recipient's grant, never widen it — the lower cap wins,
and both the token's interval and the friend's cooldown must have passed. The
interval is claimed with one conditional `UPDATE` on `api_token.last_fired_at`
as the last check before the poke is recorded, so it holds across instances
and restarts, a burst lands exactly once (`429`, with how long to wait), and a
poke refused for any other reason costs no slot. A retried `pokeId` is still
answered before any of it.

### What the other side sees

A poke sent with a token is recorded as such (`poke_event.source =
'api_token'`). Both ends see `viaApiToken: true` in `PokeEvent`; the sender
also sees `apiTokenName`, the recipient never does. The push carries
`viaApiToken` too, and its alert ends in `(automation)`. Server logs name the
token by id prefix and name.

### Self-stimulus

`POST /api/v1/me/stimulus` fires a stimulus at your own devices. No friend and
no permission grant, because the only person in the request is the one holding
the credential:

```bash
curl -X POST https://jolt.example/api/v1/me/stimulus \
  -H "Authorization: Bearer jolt_pat_…" \
  -H "Content-Type: application/json" \
  -d '{"stimulus":{"kind":"vibe","intensity":20,"repetitions":1}}'
```

The body is **strict**: an unknown field is a 400. It differs from
`POST /pokes` by one field, and a caller that means to poke a friend but posts
`{ friendId, stimulus }` here would otherwise have `friendId` stripped and be
told 201 — for a stimulus fired at itself.

The stimulus is recorded as a `poke_event` from you to you, so it appears in
your activity feed and acks through `POST /pokes/{id}/ack` like any other poke,
and it is delivered as an ordinary poke push — which is what lets existing
clients fire it with no changes. Rate limited to one per second. With no
registered device it is a 404 rather than a silent success, because an
integration told "201" for a stimulus nobody could receive has been told the
opposite of what happened.

## Permissions

Per stimulus (`zap`/`vibe`/`beep`), each with its own allow flag, intensity
cap and cooldown, always edited from the **granter's** side. Accepting a
friend request seeds all six rows (3 stimuli x 2 directions) disabled.

The composer clamps intensity client-side for UX only. The server re-checks
permission, cap and cooldown on every send and is authoritative.

### Automated pokes

Allowing a friend a stimulus does not by itself allow their *scripts*. Each
grant also has `automationAllowed`: `true`, `false`, or `null` for "no answer
yet", which follows the server policy — allowed, unless the operator requires
consent (`Me.policies.automationConsentRequired`). An explicit answer always
wins and is never rewritten by a policy change. Only pokes sent with a token
are subject to it; a refused one is `403 They haven't allowed automated pokes
of that stimulus.`

It is set through the same `PUT /friends/{id}/permissions/{kind}`, with one
difference from the other three keys: an **absent** `automationAllowed`
leaves the stored answer unchanged — apps built before it send only the three
as a full overwrite and must not wipe it — while `null` resets it to the
default. Responses carry both `automationAllowed` and
`automationAllowedEffective`. The web dashboard has a Default/Allow/Block
control per friend and stimulus.

The policy is the `AUTOMATION_CONSENT_REQUIRED` environment variable when set
(then shown locked), otherwise an admin's choice at **/admin/settings**,
otherwise "not required". Before requiring consent, that page says how many
allowed-but-unanswered grants will start refusing automated pokes.

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
