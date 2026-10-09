---
title: Troubleshooting
description: Common problems when self-hosting Jolt Server, and how to fix them.
---

Most problems show up in the logs. From the directory with `compose.yaml`:

```bash
docker compose ps
docker compose logs app      # or migrate, caddy, cron, db
```

## Test connection fails in the app

Check `curl https://APP_HOST/healthz` from outside your network. If that works
but the app does not, the URL in the app is probably missing the `/api/v1`
suffix. It should look like `https://jolt.example.com/api/v1`.

## The certificate never issues

Caddy needs ports 80 and 443 reachable from the internet. Port 80 is not
optional: it is how the ACME challenge is answered. Check
`docker compose logs caddy`.

## Logins succeed, then immediately fail

`PUBLIC_URL` (or `APP_HOST`, if `PUBLIC_URL` is unset) does not match the
origin the client is actually reaching. Better Auth scopes its cookies to that
value. This is common behind
[your own reverse proxy](/jolt-server/self-hosting/reverse-proxy/#use-an-existing-reverse-proxy):
set `PUBLIC_URL` to the public origin and run `docker compose up -d`.

## The web login says the password is wrong when it is not

The browser reached the server under a name the server does not trust, such as
a LAN IP, a `www.` alias, or `localhost` instead of the configured host. The
sign-in is refused before the password is ever checked. The login page shows
the server's own message (`Invalid origin`) rather than a credentials error.

Add the name to `TRUSTED_ORIGINS` in `.env`, comma-separated, and restart:

```dotenv
TRUSTED_ORIGINS=http://192.168.1.10:7385,https://www.jolt.example.com
```

```bash
docker compose up -d
```

## Sign-in starts failing after a few tries

Better Auth rate-limits `/sign-in` to 3 attempts per 10 seconds per client IP.
The login page says "Too many attempts. Wait a few seconds and try again."
instead of blaming the password. Wait ten seconds and try again.

## `migrate` exits non-zero and nothing starts

That is deliberate. A failed migration stops the deploy rather than serving
against a half-migrated database. Check `docker compose logs migrate`.

## Compose refuses to start: "set APP_HOST" or "set POSTGRES_PASSWORD"

`compose.yaml` requires `APP_HOST`, `POSTGRES_PASSWORD` and
`BETTER_AUTH_SECRET`. Set them in the `.env` file in the same directory as
`compose.yaml`. `APP_HOST` is required even if you do not run the built-in
Caddy.

## `app` keeps restarting

The server validates its configuration at startup and refuses to start on a
bad value. Common causes, all visible in `docker compose logs app`:

- `BETTER_AUTH_SECRET` shorter than 32 characters;
- `PUSH_TIME_ZONE` that is not an IANA zone (for example `Europe/Prague` is
  valid, a typo such as `Europe/Prag` is not);
- `AUTOMATION_CONSENT_REQUIRED` set to something other than
  `true`/`false`, `1`/`0`, `yes`/`no` or `on`/`off`;
- `APNS_ENV` set to something other than `sandbox` or `production`.

See the [configuration reference](/jolt-server/self-hosting/configuration/).

## Pokes are recorded but never reach a backgrounded phone

Push is not configured, or not reaching the container. The admin dashboard
shows "Push is not configured" and the logs contain `[push]` lines from the
console sender. Set `PUSH_RELAY_URL`, or, for your own app build, all three of
`APNS_KEY_ID`, `APNS_TEAM_ID` and `APNS_KEY_P8`, then `docker compose up -d`.
See [Push notifications](/jolt-server/self-hosting/push-notifications/).

## Pushes through the relay fail

Open the admin overview (`/admin`). Under **Push delivery** it shows whether
the relay has accepted this server and the last error the relay returned:

- **registration failed**, with a network error: the server cannot reach
  `PUSH_RELAY_URL`. Check the URL and the container's outbound network.
- **blocked by the relay**: the relay operator has blocked this server.
- `unregistered` results on the devices page: the app was removed or signed
  out, or registered for a different server. The device stays disabled; when
  the app next starts and posts its old relay token, the server answers `410`
  and the app registers with the relay again under a new token.
- A `rejected` result saying the payload key cannot be read: `BETTER_AUTH_SECRET`
  changed since the device registered. It recovers once the app starts again.

## The test push stays on "waiting for the device"

The push left the server but never arrived. With your own APNs key, usually
`APNS_ENV` disagrees with the build on the phone (a debug build from Xcode is
`sandbox`; TestFlight and the App Store are `production`), or `APNS_BUNDLE_ID`
does not match the build. Remember that APNs keys only work for a build signed
by the same Apple team. Through the relay, check that notifications are
allowed for the app on the phone.
See [Testing push delivery](/jolt-server/guides/push-testing/).
