---
title: Personal access tokens & integrations
description: Let your own scripts and automations act for you with scoped, limited personal access tokens.
---

A **personal access token** (`jolt_pat_…`) lets your own code act for you:
jolt you when a build fails, or poke a friend from a home automation.

## Minting a token

Mint one under **Dashboard → API tokens** on the web, or with
`POST /api/v1/me/tokens` and a signed-in session. Paste it into whatever you
are wiring up.

- Only the SHA-256 hash of a token is stored. The secret is shown exactly once,
  at creation; a lost token is replaced, not looked up.
- A token cannot be edited. To change what it may do, mint another and revoke
  the old one.
- A token can expire after 1 to 365 days (`expiresInDays`), or live until
  revoked if you leave that out. It stops working the moment it expires; the
  hourly `prune-expired-api-tokens` job deletes it a week later, so the
  dashboard can still explain why an integration went quiet.
- The dashboard shows the secret once with ready-made curl lines for what the
  token may do, and lists every token with its scopes, friends, limits and when
  it was last used.

Minting through the API needs a session token, not another personal access
token:

```bash
# Sign in for a session token
curl -X POST https://jolt.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"…"}'

# Mint a token that may only fire vibes at your own devices
curl -X POST https://jolt.example.com/api/v1/me/tokens \
  -H "Authorization: Bearer <session token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"CI failures","scopes":["stimulus:self"],"allowedKinds":["vibe"],"expiresInDays":90}'
```

The response includes the secret in `token`. Revoke a token with
`DELETE /api/v1/me/tokens/{tokenId}`, or from the dashboard.

The mint body is strict: an unknown field is a `400`. A misspelt `friendIds`
would otherwise be dropped and mint a token that reaches every friend instead
of the few you named.

## Scopes

Each token says what it may do. `scopes` is required when minting:

| Scope           | Unlocks                                                   |
| --------------- | --------------------------------------------------------- |
| `stimulus:self` | `POST /me/stimulus`: fire at your own devices             |
| `pokes:send`    | `POST /pokes`: poke friends, within what each allows you  |
| `friends:read`  | `GET /friends`                                            |
| `pokes:read`    | `GET /pokes`                                              |
| `*`             | Every scope, including any added later                    |

`GET /me` works with any valid token. A token missing the scope an endpoint
needs gets `403 This token lacks the "pokes:send" scope.`

Everything else is session-only, whatever the scopes: minting, listing and
revoking tokens, devices, friend requests, editing permissions, and acks. A
token there gets a **403, not a 401**, so an integrator is told the token is
fine and the endpoint is not. A token that could mint another would survive
its own revocation. Tokens minted before scopes existed were migrated to
`stimulus:self`, which is all they could ever do.

An invalid or expired token gets `401 Invalid or expired API token.`

## Which friends

By default a token reaches every friend, including ones added later. Send
`friendIds` when minting and it reaches only those (`friendScope:
"selected"`). Each must be a current friend.

Unfriending someone removes them from every token on both sides, and
re-friending does not put them back. So a `selected` token whose list has
emptied reaches **nobody**, never everybody.

Such a token sees only its friends in `GET /friends`, and only pokes with them
in `GET /pokes`. A token's `GET /pokes` includes your own self-stimuli only if
it may fire them (`stimulus:self` or `*`).

```bash
curl -X POST https://jolt.example.com/api/v1/pokes \
  -H "Authorization: Bearer jolt_pat_…" \
  -H "Content-Type: application/json" \
  -d '{"friendId":"<their id from GET /friends>","stimulus":{"kind":"vibe","intensity":20,"repetitions":1}}'
```

## Limits

A token can also be minted with limits on what it fires, at you or at a
friend:

| Field                | Default                         | Range                    |
| -------------------- | ------------------------------- | ------------------------ |
| `allowedKinds`       | every kind                      | `zap`, `vibe`, `beep`    |
| `maxIntensity`       | only the recipient's cap        | 0–100                    |
| `minIntervalSeconds` | 1                               | 1 to 86400 (one day)     |

Limits narrow the recipient's grant and never widen it. The lower intensity
cap wins, and both the token's interval and the friend's cooldown must have
passed.

The interval is claimed with one conditional `UPDATE` on
`api_token.last_fired_at`, as the last check before the poke is recorded. So it
holds across instances and restarts, a burst lands exactly once (`429`, with
how long to wait), and a poke refused for any other reason costs no slot. A
retried `pokeId` is still answered before any of it.

## Automated pokes need the recipient's consent policy

A friend allowing you a stimulus does not automatically allow your scripts.
Each grant has a separate automation answer, and when the friend has not
answered, the server's [automated pokes policy](/jolt-server/self-hosting/automated-pokes/)
decides. A refused automated poke gets
`403 They haven't allowed automated pokes of that stimulus.`

## What the other side sees

A poke sent with a token is recorded as such (`poke_event.source =
'api_token'`). Both ends see `viaApiToken: true` in `PokeEvent`; the sender
also sees `apiTokenName`, the recipient never does. The push carries
`viaApiToken` too, and its alert ends in `(automation)`. Server logs name the
token by id prefix and name, never by the secret.

## Self-stimulus

`POST /api/v1/me/stimulus` fires a stimulus at your own devices. There is no
friend and no permission grant, because the only person in the request is the
one holding the credential:

```bash
curl -X POST https://jolt.example.com/api/v1/me/stimulus \
  -H "Authorization: Bearer jolt_pat_…" \
  -H "Content-Type: application/json" \
  -d '{"stimulus":{"kind":"vibe","intensity":20,"repetitions":1}}'
```

- The body is **strict**: an unknown field is a `400`. It differs from
  `POST /pokes` by one field, and a caller that means to poke a friend but
  posts `{ friendId, stimulus }` here would otherwise have `friendId` stripped
  and be told `201`, for a stimulus fired at itself.
- It is recorded as a poke from you to you, so it appears in your activity
  feed and acks through `POST /pokes/{id}/ack` like any other poke. It is
  delivered as an ordinary poke push, which is what lets existing clients fire
  it with no changes.
- It is rate limited to one per second per account (`429`), on top of the
  token's own `minIntervalSeconds`.
- With no registered device it is a `404` rather than a silent success: an
  integration told `201` for a stimulus nobody could receive has been told the
  opposite of what happened.

## Reading data

```bash
# Who you are; works with any valid token
curl https://jolt.example.com/api/v1/me -H "Authorization: Bearer jolt_pat_…"

# Friends the token reaches (needs friends:read)
curl https://jolt.example.com/api/v1/friends -H "Authorization: Bearer jolt_pat_…"

# Recent pokes, newest first (needs pokes:read); limit is 1–200, default 50
curl "https://jolt.example.com/api/v1/pokes?limit=20" -H "Authorization: Bearer jolt_pat_…"
```

See the [API reference](/jolt-server/reference/api-overview/) for every
endpoint.
