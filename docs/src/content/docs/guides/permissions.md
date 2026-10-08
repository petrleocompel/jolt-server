---
title: Permissions model
description: How friends, per-stimulus grants, intensity caps, cooldowns and automation consent decide whether a poke goes through.
---

Jolt has no global "allow pokes" switch. Every pair of friends has a separate
grant for each stimulus in each direction, and the server checks it on every
poke.

## Friends first

You can only poke friends. There is no user search endpoint: a friend request
always targets someone specific, by exact `@handle` or by an invite code they
shared with you out-of-band (`POST /api/v1/friends/requests` takes exactly one
of `handle` or `inviteCode`). Every account has an invite code, shown on the
web under **Dashboard → Invite** and returned by `GET /api/v1/me`.

The public `/invite/{code}` page deliberately does not confirm whether a code
is real before you sign in. Doing so would recreate the discovery endpoint the
product rules out.

Requests nobody answers are rejected automatically after
[`FRIEND_REQUEST_EXPIRY_DAYS`](/jolt-server/self-hosting/configuration/#friend_request_expiry_days)
(30 by default). Removing a friend (`DELETE /api/v1/friends/{friendId}`)
unfriends both directions.

## Grants: per stimulus, per direction

There are three stimuli: `zap`, `vibe` and `beep`. For each one, each friend
has a grant with:

| Field               | Meaning                                                                     |
| ------------------- | --------------------------------------------------------------------------- |
| `isAllowed`         | Whether they may send it to you at all.                                     |
| `maxIntensity`      | The highest intensity they may use, 0–100.                                  |
| `cooldownSeconds`   | Minimum seconds between two of their pokes of this kind. 0 means none.      |
| `automationAllowed` | Whether their scripts may send it: `true`, `false`, or `null` for no answer. |

Grants are always edited from the **granter's** side: you decide what each
friend may send to you, never what you may send to them. Accepting a friend
request creates all six grants (3 stimuli × 2 directions) disabled, with an
intensity cap of 0 and no cooldown. Nothing can be sent until the recipient
turns something on.

`GET /api/v1/friends` returns both sides for every friend:
`permissionsGrantedToMe` (what they allow you to send, which drives the poke
composer) and `permissionsIGranted` (what you allow them, yours to edit).

On the web, grants are edited under **Dashboard → Permissions**. Through the
API:

```bash
curl -X PUT https://jolt.example.com/api/v1/friends/<friendId>/permissions/vibe \
  -H "Authorization: Bearer <session token>" \
  -H "Content-Type: application/json" \
  -d '{"isAllowed":true,"maxIntensity":40,"cooldownSeconds":60}'
```

This endpoint needs a signed-in session; personal access tokens get `403`.

## What the server checks on every poke

The app's composer clamps intensity for convenience only. The server is
authoritative and re-checks everything on every `POST /api/v1/pokes`:

1. You cannot poke yourself (`403`). To fire at your own devices, use
   [`POST /me/stimulus`](/jolt-server/guides/api-tokens/#self-stimulus).
2. If the request carries a `pokeId` already recorded for you, the server
   answers with that poke (`200`) and sends nothing. This makes retries after
   a dropped connection safe.
3. For a personal access token: whether it may reach this friend, and its own
   kind and intensity limits.
4. You must be friends, and the recipient must allow this stimulus. A
   non-friend gets the same `403 They haven't allowed that stimulus.` as a
   missing grant, so it learns nothing about whether the account exists.
5. For a personal access token: whether the recipient allows automation for
   this grant (see below).
6. The intensity must not exceed the recipient's cap:
   `403 Intensity exceeds their cap of 40.`
7. The cooldown must have passed since your last poke of this kind to this
   friend: `403 Too soon — try again in 12s.`
8. For a personal access token: its own minimum interval (`429`).

Stimulus values are limited by the contract: intensity 0–100 and repetitions
1–5.

## Automated pokes

Allowing a friend a stimulus does not by itself allow their *scripts*. Each
grant also has `automationAllowed`: `true`, `false`, or `null` for "no answer
yet". `null` follows the server policy: allowed, unless the operator requires
consent (reported to clients as `policies.automationConsentRequired` in
`GET /me`). An explicit answer always wins and is never rewritten by a policy
change. Only pokes sent with a token are subject to it.

It is set through the same
`PUT /friends/{friendId}/permissions/{stimulusKind}`, with one difference from
the other three keys:

- an **absent** `automationAllowed` leaves the stored answer unchanged, because
  apps built before it send only the three keys as a full overwrite and must
  not wipe it;
- `null` resets it to the server default.

Responses carry both `automationAllowed` (the stored answer) and
`automationAllowedEffective` (what applies right now). The web dashboard has a
Default / Allow / Block control per friend and stimulus. Operators set the
policy as described in [Automated pokes policy](/jolt-server/self-hosting/automated-pokes/).

## Poke lifecycle

A poke is created `pending`. Only the recipient's device moves it to a final
state, with `POST /api/v1/pokes/{pokeId}/ack`:

| Status               | Meaning                                    |
| -------------------- | ------------------------------------------ |
| `fired`              | Reached the device and actuated the wearable. |
| `deviceNotConnected` | The push arrived, but the recipient's Pavlok was not connected. |
| `notAllowed`         | A permission re-check rejected it. Rare, because the composer clamps first. |
| `muted`              | The recipient had "Do not disturb incoming pokes" on. |

Acking is idempotent and the first ack wins, because the same poke may be
acked twice: once from the silent push and once from a notification tap.
Clients should treat a `pending` poke older than a few minutes as undelivered:
iOS gives no delivery guarantee for the silent push, so an ack may never
arrive.

Poke history is kept for
[`POKE_EVENT_RETENTION_DAYS`](/jolt-server/self-hosting/configuration/#poke_event_retention_days)
(90 by default).
