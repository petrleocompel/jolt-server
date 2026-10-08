---
title: Automated pokes policy
description: Decide whether a friend's scripts may poke someone who has not said yes to automation.
---

Users can mint [personal access tokens](/jolt-server/guides/api-tokens/) and,
with the `pokes:send` scope, let their scripts poke friends. A poke sent with a
token still needs the recipient's ordinary permission for that stimulus. On
top of that, each grant has a separate answer for automation: **Allow**,
**Block**, or no answer yet.

What happens when the recipient has not answered is a server-wide policy.

## The policy

| `AUTOMATION_CONSENT_REQUIRED` | Effect                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| unset or empty (default)      | An admin decides at **/admin/settings**. Out of the box: allowed unless the recipient blocks it.                                 |
| `false`                       | Allowed unless the recipient blocks it. Locked: the admin page shows it read-only.                                               |
| `true`                        | Blocked until the recipient allows it, per friend and stimulus. Locked the same way.                                             |

The variable takes `true`/`false`, `1`/`0`, `yes`/`no` or `on`/`off`.
Anything else stops the server from starting rather than guessing which side
you meant.

The order of precedence is: the environment variable if set, otherwise the
admin's choice at `/admin/settings`, otherwise "not required".

## What never changes

- A recipient's explicit **Allow** or **Block** always wins, under either
  policy.
- Changing the policy never rewrites anyone's answer. Switching to "required"
  only affects grants nobody has answered.
- Only pokes sent with a token are affected. A poke from the person in the app
  or on the web is never checked against this policy, and neither is a token
  firing at its owner's own devices.

A refused automated poke gets
`403 They haven't allowed automated pokes of that stimulus.`

## Changing it from the admin page

At **/admin/settings**, the **Require consent for automated pokes** switch
shows where the current value comes from (environment variable, admin, or
default). Turning consent on asks for confirmation first, and the warning says
how many grants are currently allowed only because nobody answered. Those stop
accepting automated pokes immediately, and scripts that rely on them start
getting `403` until each recipient allows automation again.

While `AUTOMATION_CONSENT_REQUIRED` is set, the switch is locked. Change or
unset the variable and restart to manage it from the page:

```bash
docker compose up -d
```

## How users answer

Recipients set their answer per friend and stimulus:

- on the web, with the Default / Allow / Block control under
  **Dashboard → Permissions**;
- through the API, with the `automationAllowed` field of
  `PUT /api/v1/friends/{friendId}/permissions/{stimulusKind}`.

The app reads the current policy from `policies.automationConsentRequired` in
`GET /api/v1/me`. See the [permissions model](/jolt-server/guides/permissions/#automated-pokes)
for the API details.
