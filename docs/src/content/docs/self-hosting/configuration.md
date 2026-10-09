---
title: Configuration reference
description: Every environment variable Jolt Server and its compose files read, with defaults and where each one applies.
---

Jolt Server is configured with environment variables. With the root
`compose.yaml` you set them in a `.env` file next to it, and Compose passes the
relevant ones into each container. The server validates its own variables
(`src/env.ts`) when it starts. A value that fails validation, such as a
`BETTER_AUTH_SECRET` shorter than 32 characters or an unknown
`PUSH_TIME_ZONE`, stops the server instead of being guessed at.

Start from [`.env.example`](https://github.com/petrleocompel/jolt-server/blob/main/.env.example).
Never commit `.env` or an APNs `.p8` key; the repository's `.gitignore`
excludes both.

## Summary

"Compose" below means the root `compose.yaml`, the one the
[quick start](/jolt-server/getting-started/quick-start/) uses.

| Variable                                                       | Required             | Default                     | Applies to                        |
| -------------------------------------------------------------- | -------------------- | --------------------------- | --------------------------------- |
| [`APP_HOST`](#app_host)                                        | Yes, for Compose     | none                        | Compose: Caddy, public URL        |
| [`PUBLIC_URL`](#public_url)                                    | No                   | `https://$APP_HOST`         | Compose: `BETTER_AUTH_URL`        |
| [`BETTER_AUTH_SECRET`](#better_auth_secret)                    | Yes                  | none                        | Server                            |
| [`BETTER_AUTH_URL`](#better_auth_url)                          | No                   | `http://127.0.0.1:3000`     | Server (`pnpm dev`)               |
| [`TRUSTED_ORIGINS`](#trusted_origins)                          | No                   | empty                       | Server                            |
| [`POSTGRES_USER`](#postgres_user-postgres_db)                  | No                   | `jolt`                      | Compose: `db` and database URL    |
| [`POSTGRES_PASSWORD`](#postgres_password)                      | Yes, for Compose     | none                        | Compose: `db` and database URL    |
| [`POSTGRES_DB`](#postgres_user-postgres_db)                    | No                   | `jolt`                      | Compose: `db` and database URL    |
| [`DATABASE_URL`](#database_url)                                | Yes, outside Compose | none                        | Server (`pnpm dev`, scripts)      |
| [`POSTGRES_HOST_PORT`](#postgres_host_port)                    | No                   | `5432`                      | `deploy/docker-compose.dev.yml`   |
| [`NODE_ENV`](#node_env)                                        | No                   | `development`               | Server (`pnpm dev`)               |
| [`APNS_KEY_ID`](#apns_key_id-apns_team_id-apns_key_p8)         | No                   | empty                       | Server                            |
| [`APNS_TEAM_ID`](#apns_key_id-apns_team_id-apns_key_p8)        | No                   | empty                       | Server                            |
| [`APNS_KEY_P8`](#apns_key_id-apns_team_id-apns_key_p8)         | No                   | empty                       | Server                            |
| [`APNS_BUNDLE_ID`](#apns_bundle_id)                            | No                   | `cz.peelco.jolt`            | Server                            |
| [`APNS_ENV`](#apns_env)                                        | No                   | see entry                   | Server                            |
| [`PUSH_RELAY_URL`](#push_relay_url)                            | No                   | none                        | Server                            |
| [`PUSH_RELAY_ENABLED`](#push_relay_enabled)                    | No                   | unset (automatic)           | Server                            |
| [`PUSH_RELAY_SERVER_NAME`](#push_relay_server_name-push_relay_public_url) | No        | none                        | Server                            |
| [`PUSH_RELAY_PUBLIC_URL`](#push_relay_server_name-push_relay_public_url)  | No        | none                        | Server                            |
| [`PUSH_RELAY_PRIVATE_KEY`](#push_relay_private_key)            | No                   | generated, in the database  | Server                            |
| [`PUSH_TIME_ZONE`](#push_time_zone)                            | No                   | `UTC`                       | Server                            |
| [`SENTRY_DSN`](#sentry_dsn)                                    | No                   | empty                       | Server                            |
| [`AUTOMATION_CONSENT_REQUIRED`](#automation_consent_required)  | No                   | unset                       | Server                            |
| [`POKE_EVENT_RETENTION_DAYS`](#poke_event_retention_days)      | No                   | `90`                        | Server, `cron`                    |
| [`FRIEND_REQUEST_EXPIRY_DAYS`](#friend_request_expiry_days)    | No                   | `30`                        | Server, `cron`                    |
| [`ADMIN_EMAIL`, `ADMIN_PASSWORD`](#admin_email-admin_password) | For seeding only     | none                        | `pnpm db:seed-admin`              |
| [`ADMIN_NAME`, `ADMIN_HANDLE`](#admin_name-admin_handle)       | No                   | `Admin`, `admin`            | `pnpm db:seed-admin`              |
| [`JOLT_VERSION`](#jolt_version)                                | No                   | `latest`                    | Compose: image tag                |
| [`JOLT_IMAGE`](#jolt_image)                                    | No                   | `jolt-server:local`         | `deploy/docker-compose.yml`       |
| [`JOLT_SERVER_VERSION`](#jolt_server_version)                  | Set by the image     | `dev`                       | Server                            |
| [`PORT`](#port)                                                | Set by Compose       | `3000`                      | Server                            |

### Only for development and seeding

Some values in `.env.example` exist for running the server on your own
machine with `pnpm dev`, and Compose does not pass them to the containers:

- `DATABASE_URL`: the containers build their own from the `POSTGRES_*` values.
- `NODE_ENV`: Compose always sets `production`.
- `BETTER_AUTH_URL`: Compose sets it from `PUBLIC_URL`, or `https://$APP_HOST`.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `ADMIN_HANDLE`: read only by
  the seed script, from its own process environment. In a container, pass them
  with `docker compose exec -e`.

## Public address

### `APP_HOST`

The public domain the server is reached on, without a scheme, for example
`jolt.example.com`.

- **Required** by `compose.yaml`. Compose refuses to start without it, even if
  you set `PUBLIC_URL` and do not run Caddy, because the inline Caddyfile
  refers to it.
- Used as the Caddy site address, so Caddy requests a certificate for it.
- Used to build the default public URL, `https://$APP_HOST`, which becomes
  `BETTER_AUTH_URL` inside the `app` and `cron` containers.

```dotenv
APP_HOST=jolt.example.com
```

### `PUBLIC_URL`

Optional. The full public origin, including the scheme and any port. It
overrides `https://$APP_HOST` as `BETTER_AUTH_URL` in the containers.

Set it when you terminate TLS somewhere else, or run plain HTTP on a LAN.
Better Auth builds callback URLs from this value and issues cookies scoped to
it, so it has to match the origin that clients actually reach. A mismatch
produces logins that appear to succeed and then immediately fail.

```dotenv
PUBLIC_URL=http://192.168.1.10:7385
```

## Authentication

### `BETTER_AUTH_SECRET`

**Required.** The secret Better Auth uses for sessions. At least 32
characters. Generate one with:

```bash
openssl rand -base64 48
```

Changing it logs everyone out. On a server that uses the
[push relay](/jolt-server/self-hosting/push-notifications/#the-push-relay), it
also makes the stored payload keys unreadable, since they are encrypted with a
key derived from this secret: relay pushes fail until each app starts again
and re-registers, which it does by itself.

### `BETTER_AUTH_URL`

The server's own public origin, as Better Auth sees it. Default
`http://127.0.0.1:3000`, which suits `pnpm dev`. This origin is always trusted
for sign-in.

Compose does not read this from `.env`: it sets it from `PUBLIC_URL`, or
`https://$APP_HOST` when `PUBLIC_URL` is unset.

### `TRUSTED_ORIGINS`

Optional. Extra origins browsers may sign in from, comma-separated. Better Auth
refuses a sign-in from any origin that is neither `BETTER_AUTH_URL` nor listed
here, and the login form can only report it as a failed login. Set this if the
server answers to more than one name, such as a LAN IP or a `www.` alias.
Wildcard patterns such as `https://*.example.com` are passed through to Better
Auth as they are.

When `NODE_ENV` is not `production`, the loopback aliases of
`BETTER_AUTH_URL` (`localhost`, `127.0.0.1`, `[::1]` on the same port) are
trusted automatically.

```dotenv
TRUSTED_ORIGINS=http://192.168.1.10:7385,https://www.jolt.example.com
```

## Database

### `POSTGRES_USER`, `POSTGRES_DB`

The Postgres user and database name, both defaulting to `jolt`. Used to
initialise the `db` container and to build the database URL the other
containers use.

### `POSTGRES_PASSWORD`

**Required** by `compose.yaml`. The Postgres password, used to initialise the
`db` container and in the database URL of `migrate`, `app` and `cron`. The
database is not published on a host port, so it is only reachable inside the
compose network.

`.env.example` ships with `jolt`. Change it for anything internet-facing. The
build-from-source file `deploy/docker-compose.yml` also falls back to `jolt`
when it is unset.

### `DATABASE_URL`

The Postgres connection string the server, the migrations and the scripts
connect to. Required by the server itself (`src/env.ts`), but you only set it
by hand when running outside the containers, for example `pnpm dev` against
the development database:

```dotenv
DATABASE_URL=postgres://jolt:jolt@127.0.0.1:5432/jolt
```

`compose.yaml` ignores it and builds
`postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@db:5432/$POSTGRES_DB` instead, so
a host-side value cannot leak into the containers.
`deploy/docker-compose.yml` does use a `DATABASE_URL` from its environment if
one is set; see [Building from source](/jolt-server/development/building-from-source/).

### `POSTGRES_HOST_PORT`

Only used by the development overlay `deploy/docker-compose.dev.yml`, which
publishes Postgres on `127.0.0.1:$POSTGRES_HOST_PORT`. Default `5432`. Change
it if that port is taken on your machine.

## Runtime

### `NODE_ENV`

`development`, `test` or `production`. Default `development`. Compose always
sets `production` in the containers. It decides:

- whether loopback aliases are trusted for sign-in (not in `production`);
- whether a server with neither APNs credentials nor a push relay is logged as
  a warning at startup (only in `production`);
- the Sentry environment name and trace sample rate (10% in `production`, all
  traces otherwise).

### `PORT`

The port the server listens on inside the container. Both compose files set it
to `3000`; it is not read from `.env`. The image exposes port 3000.

## Push notifications

See [Push notifications](/jolt-server/self-hosting/push-notifications/) for
how the two ways of delivering pushes compare, and how to get APNs
credentials from Apple.

Which way the server delivers is decided at startup:

| APNs credentials | `PUSH_RELAY_URL` | `PUSH_RELAY_ENABLED` | Apps register with | Devices already on the relay |
| --- | --- | --- | --- | --- |
| no  | no  | unset or `false` | nothing (console sender) | console sender |
| no  | set | unset or `true`  | the relay                | the relay |
| yes | no  | unset or `false` | APNs, directly           | console sender |
| yes | set | unset            | APNs, directly           | the relay |
| yes | set | `true`           | the relay                | the relay |
| any | set | `false`          | APNs, or nothing         | console sender |

`PUSH_RELAY_ENABLED=true` without a relay URL stops the server from starting.

### `PUSH_RELAY_URL`

The base URL of the Jolt push relay, for example `https://relay.example/`.
There is no public relay yet, so there is no default: until it has an address,
the relay is only used when you set this. With a URL and no APNs credentials,
the server uses the relay on its own.

```dotenv
PUSH_RELAY_URL=https://relay.example/
```

### `PUSH_RELAY_ENABLED`

Optional. Unset or empty: the relay is used when there are no APNs
credentials and a relay URL is known. `true`: apps are told to register with
the relay even if APNs credentials are set. `false`: the server never contacts
the relay, and devices registered with it get the console sender. Accepts
`true`/`false`, `1`/`0`, `yes`/`no` or `on`/`off`; anything else stops the
server from starting.

### `PUSH_RELAY_SERVER_NAME`, `PUSH_RELAY_PUBLIC_URL`

Optional, and **opt-in**: the relay only learns these if you set them. A name
for your server (at most 80 characters) and its public `https` address, so the
relay operator can recognise it. Without them the relay knows your server only
by its key. See [Push relay privacy](/jolt-server/self-hosting/push-relay-privacy/).

```dotenv
PUSH_RELAY_SERVER_NAME=Our family server
PUSH_RELAY_PUBLIC_URL=https://jolt.example.com
```

### `PUSH_RELAY_PRIVATE_KEY`

Optional. The server's Ed25519 identity at the relay. Unset, the server
generates one the first time it needs it and keeps it in the database, which
is what almost everyone wants. Set it only to keep the same identity across a
database you rebuild from scratch: a new identity means every phone has to
register again.

It accepts a PKCS#8 PEM, on one line with literal `\n` or as is, or the raw
32-byte seed in base64 or base64url. A value it cannot read stops the server
from starting, rather than letting it silently become a different server.

```bash
openssl genpkey -algorithm ed25519
```

### `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8`

Optional. Token-based APNs credentials: the ID of an APNs auth key, your Apple
team ID, and the full contents of the `.p8` key file. **All three are needed.**
If any is missing, the server uses its console sender, which logs what it would
have sent instead of contacting Apple. Everything except delivery to a
backgrounded app keeps working.

`APNS_KEY_P8` holds the whole key on one line. Write the line breaks as literal
`\n`; the server turns them back into newlines.

```dotenv
APNS_KEY_ID=ABC123DEFG
APNS_TEAM_ID=XXXXXXXXXX
APNS_KEY_P8=-----BEGIN PRIVATE KEY-----\nMIG...\n-----END PRIVATE KEY-----
```

### `APNS_BUNDLE_ID`

The bundle identifier of the app build on the phone. Default `cz.peelco.jolt`.
If you build the app yourself under your own team, use your own identifier.

### `APNS_ENV`

`sandbox` or `production`: which APNs environment to push to. It has to match
the build on the phone. A debug build run from Xcode is `sandbox`; TestFlight
and App Store builds are `production`.

The defaults differ by where you look, so set it explicitly:

- the server's own default is `sandbox`;
- `compose.yaml` defaults to `production` when the variable is unset;
- but `.env.example` sets `APNS_ENV=sandbox`, so a `.env` copied from it uses
  `sandbox` until you change it.

### `PUSH_TIME_ZONE`

The IANA time zone used for the time in notification text, for example
`zapped you — 30% x2 at 14:32 UTC`. Default `UTC`. Alert text is built on the
server, which has no recipient locale, so the zone name is always printed next
to the time. An invalid zone stops the server from starting.

```dotenv
PUSH_TIME_ZONE=Europe/Prague
```

`compose.yaml` passes it to the `app` container. The build-from-source file
`deploy/docker-compose.yml` does not, so there the time is always in UTC.

## Policies and retention

### `AUTOMATION_CONSENT_REQUIRED`

Optional. Whether a friend's personal access tokens may poke someone who has
not answered that question for them. Accepts `true`/`false`, `1`/`0`,
`yes`/`no` or `on`/`off`. Unset or empty leaves the decision to an admin at
`/admin/settings`. Anything else stops the server from starting. See
[Automated pokes policy](/jolt-server/self-hosting/automated-pokes/).

### `POKE_EVENT_RETENTION_DAYS`

How many days of poke history to keep. Default `90`; must be a positive whole
number. The hourly `prune-poke-events` job deletes older poke events.

### `FRIEND_REQUEST_EXPIRY_DAYS`

How many days a friend request may stay unanswered. Default `30`; must be a
positive whole number. The hourly `expire-friend-requests` job marks older
pending requests as rejected.

## Error reporting

### `SENTRY_DSN`

Optional. A Sentry DSN. When set, server errors are reported to Sentry, without
default PII. When empty, Sentry is not initialised.

## Seeding the first admin

### `ADMIN_EMAIL`, `ADMIN_PASSWORD`

Read only by `pnpm db:seed-admin`, which creates an admin account or promotes
an existing account with that email. `ADMIN_EMAIL` must be a valid email
address and `ADMIN_PASSWORD` at least 12 characters. The script exits with an
error if either is missing.

The seed script reads its own process environment. Compose does not pass these
values to the `app` container, so give them on the command line:

```bash
docker compose exec -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='at-least-12-chars' app pnpm db:seed-admin
```

### `ADMIN_NAME`, `ADMIN_HANDLE`

Optional. The display name and `@handle` of a newly created admin. Defaults
`Admin` and `admin`. A handle must match `^[a-z0-9_]{3,20}$`.

## Images

### `JOLT_VERSION`

The tag of `ghcr.io/petrleocompel/jolt-server` that `compose.yaml` runs.
Default `latest`. Set it to pin a release; see
[Upgrading](/jolt-server/self-hosting/upgrading/).

### `JOLT_SERVER_VERSION`

The jolt-server version the server reports to the push relay when it
registers. The published image sets it to the tag or branch it was built from;
a local build reports `dev`. There is no reason to set it yourself.

### `JOLT_IMAGE`

Only for the build-from-source files in `deploy/`. The full image reference
that `deploy/docker-compose.yml` runs. Default `jolt-server:local`, which
Compose builds from the repository's `Dockerfile`. `compose.yaml` does not read
it. See [Building from source](/jolt-server/development/building-from-source/).
