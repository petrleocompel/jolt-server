# Self-hosting Jolt Server

Jolt's iOS app can point at any Jolt Server. This guide gets you from a bare
Linux box to a server the app can sign in to.

Nothing here talks to Peelco infrastructure. Your instance holds your accounts,
your friend graph, and your poke history.

## What you need

- A machine with Docker and the Compose plugin (`docker compose version`).
- A domain pointing at it. Apple requires HTTPS for the app to talk to you at
  all, so a bare IP will not do unless you build the app yourself with an ATS
  exception.
- Optional: an Apple Developer account, if you want pokes to reach a phone
  whose app is backgrounded. Without it everything else works and undelivered
  pokes are logged instead of pushed.

## 1. Configure

```bash
git clone https://github.com/petrleocompel/jolt-server
cd jolt-server
cp .env.example .env
```

Edit `.env`. The three that matter:

| Variable | Notes |
|---|---|
| `APP_HOST` | Your domain, e.g. `jolt.example.com`. No scheme. |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 48`. Rotating it logs everyone out. |
| `POSTGRES_PASSWORD` | Anything long. Only reachable inside the compose network. |

Leave the `APNS_*` values blank for now.

## 2. Start it

```bash
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.selfhost.yml up -d
```

That brings up Postgres, runs the database migrations to completion, starts the
API, starts the retention cron, and puts Caddy in front to fetch a Let's Encrypt
certificate for `APP_HOST`.

Check it:

```bash
curl https://jolt.example.com/healthz
```

Create the first account — the app's sign-up screen works, or seed an admin:

```bash
docker compose -f deploy/docker-compose.yml exec app pnpm db:seed-admin
```

(needs `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`).

## 3. Point the app at it

In Jolt: **Settings → Server → Server URL**. Enter your base URL *including the
API path*:

```
https://jolt.example.com/api/v1
```

Tap **Test connection**. On success the app switches to your server and signs
you out of whatever it was using before — accounts do not transfer between
servers.

## Already running a reverse proxy?

Skip `docker-compose.selfhost.yml`, which exists only to run Caddy. Start the
base stack, publish the app yourself, and point your proxy at it:

```yaml
# deploy/docker-compose.override.yml
services:
  app:
    ports:
      - "127.0.0.1:7385:3000"
```

```bash
docker compose -f deploy/docker-compose.yml up -d
```

Then proxy `https://jolt.example.com` to `127.0.0.1:7385`. Two requirements:
forward the `Authorization` header, and set `PUBLIC_URL` in `.env` to the
public origin — Better Auth builds callback URLs from it and issues cookies
scoped to it, so a mismatch produces logins that appear to succeed and then
immediately fail.

For Traefik, `deploy/docker-compose.test.yml` is a working label set to copy.

## Push notifications (optional)

Without APNs the server logs what it would have sent. Pokes still arrive
whenever the app is open; they will not wake a backgrounded app.

To enable it you need an Apple Developer account and a **Key** (not a
certificate) with APNs enabled, from Certificates, Identifiers & Profiles →
Keys. Download the `.p8` once — Apple will not let you download it again.

```env
APNS_KEY_ID=ABC123DEFG          # the key's ID
APNS_TEAM_ID=XXXXXXXXXX         # your team ID
APNS_BUNDLE_ID=cz.peelco.jolt   # must match the app you installed
APNS_KEY_P8=-----BEGIN PRIVATE KEY-----\nMIG...\n-----END PRIVATE KEY-----
APNS_ENV=production             # `sandbox` for a debug build from Xcode
```

`APNS_BUNDLE_ID` has to match the bundle identifier of the build on the phone.
If you build the app yourself under your own team, it is your identifier, not
`cz.peelco.jolt`.

Restart: `docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.selfhost.yml up -d`.

To check it worked, sign in on the web and open **Dashboard → Devices**, then
"Send to all my devices". The row turns into "delivered in 1.2 s" once the
phone confirms — if it stays on "waiting for the device", the push left the
server but never arrived, which usually means `APNS_ENV` disagrees with the
build on the phone (a debug build from Xcode is `sandbox`, TestFlight and the
App Store are `production`) or `APNS_BUNDLE_ID` is wrong.

## Upgrading

```bash
git pull
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.selfhost.yml up -d --build
```

Migrations run automatically before the new API starts. Back up first:

```bash
docker compose -f deploy/docker-compose.yml exec -T db pg_dump -U jolt jolt | gzip > jolt-$(date +%F).sql.gz
```

## Restoring

```bash
gunzip -c jolt-2026-08-29.sql.gz | \
  docker compose -f deploy/docker-compose.yml exec -T db psql -U jolt jolt
```

## Troubleshooting

**`Test connection` fails in the app.** Check `curl https://APP_HOST/healthz`
from outside your network. If that works but the app doesn't, the URL is
probably missing the `/api/v1` suffix.

**Certificate never issues.** Caddy needs ports 80 and 443 reachable from the
internet; port 80 is not optional, it is how the ACME challenge is answered.
`docker compose logs caddy`.

**Logins succeed then immediately fail.** `PUBLIC_URL` (or `APP_HOST`) doesn't
match the origin the app is actually reaching. Better Auth scopes its cookies
to that value.

**`migrate` exits non-zero and nothing starts.** That is deliberate — a failed
migration stops the deploy rather than serving against a half-migrated
database. `docker compose logs migrate`.
