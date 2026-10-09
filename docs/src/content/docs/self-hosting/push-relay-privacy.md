---
title: Push relay privacy
description: What the Jolt push relay learns about your server and its users, what it cannot see, and what you can choose to tell it.
---

The [push relay](/jolt-server/self-hosting/push-notifications/#the-push-relay)
exists because only the holder of the Jolt app's Apple key can push to the
official app builds. Your server hands its pushes to the relay, and the relay
hands them to Apple (and, once there is an Android app, to Google). This page
describes what that costs you in privacy. The protocol itself is specified in
the jolt-relay repository, in `spec/protocol-v1.md`.

## What the relay cannot see

- **What a poke says.** Every payload is encrypted on your server with
  AES-256-GCM, under a key the app generated and gave only to your server.
  The relay forwards ciphertext. Who sent the poke, to whom, which stimulus,
  how strong, and when it was sent are all inside it.
- **Your users.** The relay never receives handles, display names, email
  addresses, account IDs or friendships. It does not know how many accounts
  your server has.
- **Your server's address**, unless you tell it (see below). Your server calls
  the relay; the relay never calls your server.

## What the relay sees

- **Your server's public key and ID.** The server signs every request with an
  Ed25519 key it generated itself, and the relay identifies it by an ID
  derived from that key. The key proves the requests come from the same
  server; it does not say whose server it is.
- **Your jolt-server version**, sent when the server registers.
- **Your server's IP address**, as every service you connect to does.
- **Device registrations.** When a phone registers for your server, the relay
  sees its APNs (or FCM) device token, the app's identifier, the platform, and
  your server's ID. It issues the phone a relay token for your server and
  stores only a hash of it. Your server never sees the APNs or FCM token.
- **Message metadata.** For each push: which server sent it, to which
  registration, whether it is a poke or a test, its size and when it was sent.
  This is what the relay needs to deliver it and to enforce the daily limits
  (500 pushes per device, 20,000 per server).

The relay cannot link a registration to a person. It can tell that the same
phone is registered for two servers, since it sees the same device token
twice; it cannot tell who uses that phone.

## What you can choose to tell it

Two settings are opt-in, and nothing is sent unless you set them:

- [`PUSH_RELAY_SERVER_NAME`](/jolt-server/self-hosting/configuration/#push_relay_server_name-push_relay_public_url):
  a name for your server, up to 80 characters.
- [`PUSH_RELAY_PUBLIC_URL`](/jolt-server/self-hosting/configuration/#push_relay_server_name-push_relay_public_url):
  your server's public address.

They only help the relay operator recognise your server, for example to
contact you before blocking a server that sends far more than expected. The
choice is revocable: remove them, and the next time the server registers (on
its first push or app registration after a restart) it sends neither, and the
relay clears what it stored.

## What the relay operator can do

- **Block your server.** A blocked server's pushes are refused, and the admin
  overview says so. Registration is automatic, so blocking is how abuse is
  stopped.
- **Withhold delivery.** Like any intermediary, the relay could drop pushes.
  It cannot alter them unnoticed: a payload that does not decrypt, or that
  names a different server than the one it came from, is dropped by the app,
  which then shows only a generic alert.
- **Not impersonate your server.** A relay token is bound to the server it was
  issued for, and the relay answers a push to another server's token as if the
  registration did not exist. Pushes are only readable with your devices'
  payload keys, which only your server and the apps hold.

## What stays on your server

- Each device's relay token and payload key, in the `device_token` table. The
  payload key is encrypted with a key derived from `BETTER_AUTH_SECRET`, so a
  copy of the database alone does not reveal it.
- The server's relay identity, in the `server_setting` table, unless you set
  [`PUSH_RELAY_PRIVATE_KEY`](/jolt-server/self-hosting/configuration/#push_relay_private_key).
  Whoever has it can register as your server at the relay and send generic
  alerts to your users' phones, though not readable pushes. Keep backups as
  private as the database itself.

If you would rather nothing leave your server, do not set `PUSH_RELAY_URL`:
the server then never contacts the relay. Pokes still reach an app that is
open, and with [your own APNs key](/jolt-server/self-hosting/push-notifications/#your-own-apns-key)
and your own app build they reach it in the background too.
