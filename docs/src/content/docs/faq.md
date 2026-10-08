---
title: FAQ
description: Common questions about Jolt, Jolt Server and self-hosting.
---

## What is Jolt?

Jolt is an independent iOS client for Pavlok wearables. It lets friends poke
each other's wearables (zap, vibe or beep), within permissions each person
sets for each friend. Jolt Server is its backend: accounts, friends,
permissions, poke history and push delivery.

## Is Jolt affiliated with Pavlok?

No. Jolt is an independent client and is not affiliated with Pavlok.

## Where can I get the app?

The Jolt iOS app is in private testing on TestFlight and is not publicly
available yet.

## Do I have to run my own server?

No. The app takes a server URL in **Settings → Server**, so it can point at
your own instance instead of the default one. Self-hosting is for people who
want their accounts, friend graph and poke history on their own machine.

## Do accounts move between servers?

No. When you switch the app to another server it signs you out, and you sign
up or log in on the new one. Friends have to be on the same server as you.

## Does push work with my own server?

Only with an app build signed by your own Apple team. APNs keys only work for
builds signed by the same team, so a key from your Apple Developer account
cannot push to the TestFlight builds. Without push, everything else works, and
pokes still arrive whenever the app is open. See
[Push notifications](/jolt-server/self-hosting/push-notifications/).

## Can people find me by searching?

No. There is no user search, by design. A friend request needs your exact
`@handle` or your invite code, which you share yourself. The public invite page
does not even confirm whether a code is real before sign-in.

## Can anyone sign up on my server?

Yes. Anyone who can reach the server can create an account in the app or at
`/signup`. Jolt Server has no setting to close registration.

## Can a friend's script shock me?

Only within what you allowed that friend for that stimulus: the allow flag,
intensity cap and cooldown still apply. On top of that, you can allow or block
automation per friend and stimulus, and the server operator decides what
happens if you have not answered. A poke sent by a script is marked
`(automation)` in the notification. See the
[permissions model](/jolt-server/guides/permissions/#automated-pokes).

## How long is poke history kept?

90 days by default. The operator can change it with
[`POKE_EVENT_RETENTION_DAYS`](/jolt-server/self-hosting/configuration/#poke_event_retention_days).
Unanswered friend requests are rejected after 30 days
(`FRIEND_REQUEST_EXPIRY_DAYS`).

## Does my server send data anywhere else?

Your instance holds your data in its own Postgres. It contacts Apple's push
service only if you configure APNs, and reports errors to Sentry only if you
set `SENTRY_DSN`. The Let's Encrypt certificate is requested by the built-in
Caddy.

## Can I run more than one `app` container?

The compose files run one, and some features assume that. Test push results
are kept in the memory of the `app` process, so behind two replicas the
confirmation would land on the wrong instance and every test would look
undelivered. The one-per-second limit on self-stimuli is also kept in memory,
per process. A token's firing interval and the server settings are stored in
the database and hold across instances.

## Which platforms are supported?

The app is iOS only, and the API registers only `ios` devices.

## Where is the API documented?

In the [API overview](/jolt-server/reference/api-overview/) and the generated
[endpoint reference](/jolt-server/reference/api/). Every instance also serves
its own spec at `/openapi.yaml`.

## What is the license?

Jolt Server is open source under the AGPL-3.0-only license. The source is at
[github.com/petrleocompel/jolt-server](https://github.com/petrleocompel/jolt-server).
