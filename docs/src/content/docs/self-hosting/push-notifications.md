---
title: Push notifications
description: Get pokes to a phone whose app is in the background, through the Jolt push relay or with Apple credentials of your own.
---

Push is optional. Without it the server uses its console sender: it logs what
it would have sent, and pokes still arrive whenever the app is open. They will
not wake an app in the background. Permission checks, cooldowns, poke history
and acks all work the same either way. The admin dashboard shows a notice
while push is not configured, and in production the server logs a warning at
startup.

There are two ways to deliver pushes:

- **The Jolt push relay** (recommended). The official Jolt app builds can only
  receive pushes signed with the Jolt developer's Apple key, which a
  self-hosted server does not have. The relay holds that key and forwards
  your server's pushes to the official apps. You need no Apple or Google
  account, and the relay cannot read what your pushes say.
- **Your own APNs key.** Only for a build of the app you sign yourself, under
  your own Apple team and bundle identifier.

The admin overview (`/admin`) shows which of the two the server uses, under
**Push delivery**.

## The push relay

:::note
There is no public Jolt push relay yet, so there is no default
`PUSH_RELAY_URL`. Until there is, you can point the server at a relay you run
yourself. This page will name the public relay once it exists.
:::

Set the relay's URL in `.env` and recreate the containers:

```dotenv
PUSH_RELAY_URL=https://relay.example/
```

```bash
docker compose up -d
```

That is all. With a relay URL and no `APNS_*` credentials, the server uses the
relay on its own. There is nothing to sign up for:

1. The first time the server needs the relay, it generates an Ed25519 key
   pair, stores it in the database and registers its public key with the
   relay. The relay identifies the server by an ID derived from that key,
   such as `srv_kzdvvj2umnduyauf35o36k6kw4`. The admin overview shows the ID
   and whether the relay has accepted it.
2. When the app connects, it asks the server how to register for pushes
   (`GET /api/v1/push/config`). The server answers `relay`, with the relay's
   address and its own ID.
3. The app registers its device token with the relay, never with your server,
   and receives a relay token for this server. It generates a payload key,
   and hands the server both.
4. For every poke, the server encrypts the payload with that device's payload
   key and sends the ciphertext to the relay, which passes it to Apple (or,
   later, Google). The app decrypts it on the phone.

What the relay can and cannot see is described in
[Push relay privacy](/jolt-server/self-hosting/push-relay-privacy/).

### Relay settings

| Variable | Default | Purpose |
| --- | --- | --- |
| [`PUSH_RELAY_URL`](/jolt-server/self-hosting/configuration/#push_relay_url) | none | The relay's base URL |
| [`PUSH_RELAY_ENABLED`](/jolt-server/self-hosting/configuration/#push_relay_enabled) | unset (automatic) | `true` prefers the relay even with APNs credentials; `false` never contacts it |
| [`PUSH_RELAY_SERVER_NAME`](/jolt-server/self-hosting/configuration/#push_relay_server_name-push_relay_public_url) | none | Opt-in: a name the relay operator sees |
| [`PUSH_RELAY_PUBLIC_URL`](/jolt-server/self-hosting/configuration/#push_relay_server_name-push_relay_public_url) | none | Opt-in: your server's address, for the relay operator |
| [`PUSH_RELAY_PRIVATE_KEY`](/jolt-server/self-hosting/configuration/#push_relay_private_key) | generated | The server's identity at the relay, if you want to manage it yourself |

### Limits

The relay accepts up to 500 pushes a day per registered device and 20,000 a
day per server. A push over the limit is reported as a temporary failure, and
the poke stays `pending`. The admin overview shows the limits the relay
reported when the server registered.

### Keep the identity

The server's relay identity lives in the `server_setting` table, and every app
registration is tied to it. Restoring a backup keeps it. Starting from an
empty database creates a new identity, and every phone has to register again,
which the app does by itself the next time it starts. If you rebuild databases
often, generate a key once and set it in `PUSH_RELAY_PRIVATE_KEY`:

```bash
openssl genpkey -algorithm ed25519
```

Changing `BETTER_AUTH_SECRET` does not change the identity, but it does make
the stored payload keys unreadable, since they are encrypted with a key
derived from it. Relay pushes then fail until each app starts again and
re-registers with a new key.

### When the relay says no

- **Unregistered.** The device's registration is gone: the app was removed,
  the user signed out, or the registration belongs to a different server. The
  device is disabled immediately, like a dead APNs token, and stays disabled:
  if the app posts the same relay token again, the server answers
  `410 relay_token_revoked`, and the app registers with the relay afresh and
  posts the new token. Unlike an APNs token, a revoked relay token is never
  re-enabled.
- **Blocked.** The relay operator has blocked this server. The admin overview
  shows the registration as "blocked by the relay", and every push fails
  until the block is lifted.
- **Unknown server.** If the relay has forgotten the server, the server
  registers again and retries once, without you doing anything.

## Your own APNs key

:::caution
APNs credentials only work for an app build signed by the same Apple team.
The Jolt builds in TestFlight are signed by the Jolt developer's team, so a key
from your own Apple Developer account cannot push to them; use the relay for
those. This section is for a build of the app signed by your team, with your
own bundle identifier, and `APNS_BUNDLE_ID` set to that identifier.
:::

With all three `APNS_*` credentials set, the server tells apps to register
directly (`GET /api/v1/push/config` answers `apns`) and pushes to Apple itself.
If `PUSH_RELAY_URL` is set as well, devices that registered with the relay
earlier keep being delivered through it until the app registers again. Set
`PUSH_RELAY_ENABLED=true` to keep sending new registrations to the relay
instead.

You need:

- an Apple Developer account, the one that owns the app build installed on the
  phone;
- an App ID for that build with the **Push Notifications** capability enabled;
- an APNs **Key** (not a certificate) from Certificates, Identifiers & Profiles
  → Keys. Apple lets you download the `.p8` file only once.

### Option 1: the setup wizard

The repository includes an interactive script that walks you through Apple's
developer portal and writes the values for you:

```bash
git clone https://github.com/petrleocompel/jolt-server
cd jolt-server
./scripts/setup-apns.sh
```

It has five stages:

1. **Team ID**: opens your Apple Developer membership page and asks for the
   10-character Team ID.
2. **App ID**: asks you to confirm the app's identifier has Push Notifications
   enabled, and for the bundle identifier (default `cz.peelco.jolt`).
3. **APNs key**: walks you through creating a key with "Apple Push
   Notifications service (APNs)" ticked, and asks for its Key ID.
4. **Store the key**: reads the downloaded `.p8` file, folds it onto one line
   with literal `\n` escapes, and asks for `APNS_ENV` (default `production`).
5. **Verify**: asks you to restart and send a real poke, then records whether
   it arrived.

The script writes `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_KEY_ID`,
`APNS_KEY_P8` and `APNS_ENV` to the `.env` file in the root of that checkout.
It can be re-run; it offers the values already saved. If your server runs from
a different directory, such as the one from the
[quick start](/jolt-server/getting-started/quick-start/), copy those five lines
into the server's `.env`.

### Option 2: set the values by hand

Add these to `.env`:

```dotenv
APNS_KEY_ID=ABC123DEFG          # the key's ID
APNS_TEAM_ID=XXXXXXXXXX         # your team ID
APNS_BUNDLE_ID=cz.peelco.jolt   # must match the app build on the phone
APNS_KEY_P8=-----BEGIN PRIVATE KEY-----\nMIG...\n-----END PRIVATE KEY-----
APNS_ENV=production             # sandbox for a debug build from Xcode
```

- `APNS_KEY_ID`, `APNS_TEAM_ID` and `APNS_KEY_P8` are all required. If any one
  is missing, the server uses the relay if one is configured, or the console
  sender otherwise.
- `APNS_KEY_P8` is the full content of the `.p8` file on one line, with the
  line breaks written as literal `\n`.
- `APNS_BUNDLE_ID` has to match the bundle identifier of the build on the
  phone. If you build the app under your own team, that is your identifier,
  not `cz.peelco.jolt`.
- `APNS_ENV` has to match the build: a debug build run from Xcode is
  `sandbox`; TestFlight and App Store builds are `production`. They do not
  interoperate. `.env.example` sets `sandbox`, so change it if your build is
  not a debug build.

## Apply and check

Recreate the containers so they pick up the new values:

```bash
docker compose up -d
```

Then check delivery end to end:

1. Sign in on the web and open **Dashboard → Devices**.
2. Click **Send to all my devices**.
3. Watch the result. Once the phone confirms, the row reads
   "delivered in 1.2s". If it never confirms, the push left the server but
   never arrived. With your own key, that usually means `APNS_ENV` disagrees
   with the build on the phone, or `APNS_BUNDLE_ID` is wrong. With the relay,
   check the last relay error on the admin overview.

If the test card says the server has neither Apple credentials nor a push
relay, the `APNS_*` or `PUSH_RELAY_*` values did not reach the running `app`
container. The server logs show the same thing: the console sender prints
lines starting with `[push] poke …` and ending in
`would send 1 alert + 1 background push each`.

[Testing push delivery](/jolt-server/guides/push-testing/) explains the test
in detail.

## What the server sends

Every poke produces **two separate pushes** to each of the recipient's
devices, whichever way they are delivered:

1. an alert push (`apns-push-type: alert`, priority 10), so the recipient
   definitely finds out;
2. a silent push (`apns-push-type: background`, priority 5), which can fire the
   stimulus without interaction. This is best effort; iOS gives no delivery
   guarantee.

They cannot be merged: iOS suppresses the background wake when an alert is
present in the same payload. With the relay, the server sends one message and
the relay sends the pair.

With your own key, the alert names the sender and says how hard and when, for
example `Alice` / `zapped you — 30% x2 at 14:32 UTC`. The time is rendered in
[`PUSH_TIME_ZONE`](/jolt-server/self-hosting/configuration/#push_time_zone)
and always names its zone; the payload also carries the raw `sentAt` so the app
can show local time. A poke sent with a personal access token ends in
`(automation)`. Through the relay, the alert arrives with generic text, and
the app replaces it with the same details once it has decrypted the payload
on the phone.

Device tokens that APNs reports as gone (`410 Unregistered`, or
`400 BadDeviceToken`), and relay registrations the relay reports as
unregistered, are disabled immediately. The hourly `cull-dead-tokens` job
deletes them a week later, because Apple throttles providers that keep
pushing to dead tokens.
