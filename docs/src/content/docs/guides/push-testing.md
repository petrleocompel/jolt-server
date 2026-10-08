---
title: Testing push delivery
description: Send a test push to your own devices and see whether the phone really got it.
---

A test push sends the same alert and silent pair as a poke to your own
devices, with a `type: "test"` payload instead of a poke. It needs no friend,
no permission and creates no poke record. The device confirms receipt, so
"delivered in 1.2s" means the phone genuinely got it, not just that Apple
accepted it.

## From the web dashboard

Open **Dashboard → Devices**.

1. Under **What to send**, choose whether to **Also fire it on my Pavlok**. If
   you do, pick the kind, intensity and repetitions. Leave it off for a
   notification-only test that needs no wearable connected.
2. Click **Send to all my devices**, or **Send test** next to one device.
3. A result card appears with one row per device:

   | Row says                                                       | Meaning                                                                 |
   | -------------------------------------------------------------- | ----------------------------------------------------------------------- |
   | delivered in 1.2s (notification tap / silent wake / banner in-app) | The device confirmed, and through which iOS entry point.           |
   | APNs accepted it — waiting for the device…                     | Apple took it; no confirmation yet. The page waits 30 seconds.          |
   | No confirmation. …                                             | Nothing came back in time.                                              |
   | APNs rejected it — unregistered / transient / rejected         | Apple refused it. See below.                                            |

   If the card says the server has no Apple credentials, the push was only
   logged to the server console and no device will confirm it.

A locked phone usually confirms within a second or two. The silent half can
take much longer, because iOS schedules background wakes at its own
convenience. The alert and background halves of the same test show up as
separate confirmations.

The app has the same test under **Settings → Notifications**. Admins can push
to someone else's devices from **/admin/devices** (**Test push**).

## Reading the result

- **Stays on "waiting for the device".** The push left the server but never
  arrived. Usually `APNS_ENV` disagrees with the build on the phone (a debug
  build from Xcode is `sandbox`; TestFlight and the App Store are
  `production`), or `APNS_BUNDLE_ID` does not match the build. APNs keys only
  work for a build signed by the same Apple team; see
  [Push notifications](/jolt-server/self-hosting/push-notifications/).
- **No confirmation.** The app may not be installed, notifications may be off,
  or iOS throttled the push.
- **APNs rejected it.** The reason is one of:
  - `unregistered`: APNs answered `410`, or `400 BadDeviceToken`. The token is
    dead; the server disables it and stops using it.
  - `transient`: network trouble, `429` or a `5xx` from Apple. Worth retrying
    later.
  - `rejected`: a misconfiguration such as a wrong topic (bundle ID), a bad
    auth key or a malformed payload.

## Through the API

All three endpoints need a signed-in session.

```bash
# Send: deviceId omitted means every active device; stimulus omitted means notification only
curl -X POST https://jolt.example.com/api/v1/devices/test-push \
  -H "Authorization: Bearer <session token>" \
  -H "Content-Type: application/json" \
  -d '{"stimulus":{"kind":"vibe","intensity":20,"repetitions":1}}'

# Check the round trip
curl https://jolt.example.com/api/v1/devices/test-push/<testID> \
  -H "Authorization: Bearer <session token>"
```

The body is strict: an unknown field is a `400`. The device confirms with
`POST /api/v1/devices/test-push/{testID}/ack`, giving `path` (`alert`,
`background` or `foreground`) to say which iOS entry point saw it; this is
idempotent per device and path.

Test pushes are rate limited to one every 5 seconds per account
(`429 Too many test pushes — try again in Ns.`).

## One app container

Tests are held **in memory for 10 minutes**, not in the database: a test is
only interesting while you are watching it. That assumes a single `app`
container, which is what the compose files run. Behind two replicas an ack
would land on the instance that did not send the test, and every test would
look undelivered.
