---
title: Push notifications (APNs)
description: Connect Jolt Server to Apple Push Notification service so pokes reach a phone whose app is in the background.
---

Push is optional. Without Apple credentials the server uses its console
sender: it logs what it would have sent, and pokes still arrive whenever the
app is open. They will not wake an app in the background. Permission checks,
cooldowns, poke history and acks all work the same either way. The admin
dashboard shows a notice while APNs is not configured, and in production the
server logs a warning at startup.

## Before you start: you need your own app build

:::caution
APNs credentials only work for an app build signed by the same Apple team.
The Jolt builds in TestFlight are signed by the Jolt developer's team, so a key
from your own Apple Developer account cannot push to them. To get push on your
own server you need a build of the app signed by your team, with your own
bundle identifier, and `APNS_BUNDLE_ID` set to that identifier.
:::

You need:

- an Apple Developer account, the one that owns the app build installed on the
  phone;
- an App ID for that build with the **Push Notifications** capability enabled;
- an APNs **Key** (not a certificate) from Certificates, Identifiers & Profiles
  → Keys. Apple lets you download the `.p8` file only once.

## Option 1: the setup wizard

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

## Option 2: set the values by hand

Add these to `.env`:

```dotenv
APNS_KEY_ID=ABC123DEFG          # the key's ID
APNS_TEAM_ID=XXXXXXXXXX         # your team ID
APNS_BUNDLE_ID=cz.peelco.jolt   # must match the app build on the phone
APNS_KEY_P8=-----BEGIN PRIVATE KEY-----\nMIG...\n-----END PRIVATE KEY-----
APNS_ENV=production             # sandbox for a debug build from Xcode
```

- `APNS_KEY_ID`, `APNS_TEAM_ID` and `APNS_KEY_P8` are all required. If any one
  is missing, the server falls back to the console sender.
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
   "delivered in 1.2s". If it stays on "APNs accepted it — waiting for the
   device…", the push left the server but never arrived. That usually means
   `APNS_ENV` disagrees with the build on the phone, or `APNS_BUNDLE_ID` is
   wrong.

If the test card says the server has no Apple credentials, the `APNS_*` values
did not reach the running `app` container. The server logs show the same
thing: the console sender prints lines starting with `[push] poke …` and
ending in `would send 1 alert + 1 background push each`.

[Testing push delivery](/jolt-server/guides/push-testing/) explains the test
in detail.

## What the server sends

Every poke produces **two separate pushes** to each of the recipient's
devices:

1. an alert push (`apns-push-type: alert`, priority 10), so the recipient
   definitely finds out;
2. a silent push (`apns-push-type: background`, priority 5), which can fire the
   stimulus without interaction. This is best effort; iOS gives no delivery
   guarantee.

They cannot be merged: iOS suppresses the background wake when an alert is
present in the same payload.

The alert names the sender and says how hard and when, for example
`Alice` / `zapped you — 30% x2 at 14:32 UTC`. The time is rendered in
[`PUSH_TIME_ZONE`](/jolt-server/self-hosting/configuration/#push_time_zone)
and always names its zone; the payload also carries the raw `sentAt` so the app
can show local time. A poke sent with a personal access token ends in
`(automation)`.

Device tokens that APNs reports as gone (`410 Unregistered`, or
`400 BadDeviceToken`) are disabled immediately. The hourly `cull-dead-tokens`
job deletes them a week later, because Apple throttles providers that keep
pushing to dead tokens.
