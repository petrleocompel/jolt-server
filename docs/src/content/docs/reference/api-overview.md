---
title: API overview
description: Base path, authentication, errors and the full endpoint list of the Jolt Server API.
---

The API is defined by an OpenAPI 3 document,
[`openapi/jolt-v1.yaml`](https://github.com/petrleocompel/jolt-server/blob/main/openapi/jolt-v1.yaml).
The [API endpoints](/jolt-server/reference/api/) section of this site is
generated from it, with one page per operation.

Every instance also serves the spec it was built with at `/openapi.yaml`, for
example `https://jolt.example.com/openapi.yaml`. It is bundled into the server
at build time, so it always matches the running version. The response allows
any origin (`Access-Control-Allow-Origin: *`), so Swagger Editor, code
generators and other hosted tools can fetch it directly.

## Base path

All endpoints live under **`/api/v1`**, for example
`https://jolt.example.com/api/v1/me`. This is the URL you enter in the app.

Better Auth keeps its own surface at `/api/auth/*`, which the web UI uses. The
mobile client never touches it: `/api/v1/auth/*` adapts it to the
`{ token, user }` shape the contract specifies.

Outside the API, the server also answers:

| Path            | Purpose                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `/healthz`      | `{"status":"ok","db":"up"}`, or `503` with `{"status":"degraded","db":"down"}` |
| `/openapi.yaml` | The OpenAPI document for this build                                     |
| `/`             | Web UI: sign-in, sign-up, `/dashboard` and, for admins, `/admin`        |

## Authentication

Send a token in the `Authorization` header:

```http
Authorization: Bearer <token>
```

Two kinds of token are accepted:

- **Session tokens**, returned as `token` by `POST /auth/signup` and
  `POST /auth/login`. This is what the app uses. They work on every endpoint
  that needs authentication. `POST /auth/logout` invalidates one.
- **Personal access tokens** (`jolt_pat_…`), which only work on the endpoints
  marked below, and only with the right scope. Anywhere else they get `403`,
  not `401`. See [Personal access tokens](/jolt-server/guides/api-tokens/).

The web UI uses a session cookie instead.

## Endpoints

| Method   | Path                                            | Purpose                                              | Personal access token |
| -------- | ----------------------------------------------- | ---------------------------------------------------- | --------------------- |
| `POST`   | `/auth/signup`                                  | Create an account                                    | n/a (no auth)         |
| `POST`   | `/auth/login`                                   | Log in                                               | n/a (no auth)         |
| `POST`   | `/auth/logout`                                  | Invalidate the current session token                 | No                    |
| `GET`    | `/me`                                           | Your account, invite code and server policies        | Any scope             |
| `POST`   | `/me/stimulus`                                  | Fire a stimulus at your own devices                  | `stimulus:self`       |
| `GET`    | `/me/tokens`                                    | List your personal access tokens                     | No                    |
| `POST`   | `/me/tokens`                                    | Mint a personal access token                         | No                    |
| `DELETE` | `/me/tokens/{tokenId}`                          | Revoke a personal access token                       | No                    |
| `GET`    | `/push/config`                                  | How to register for pushes: APNs, relay or none      | No                    |
| `POST`   | `/devices/push-token`                           | Register this device's APNs token or relay token     | No                    |
| `DELETE` | `/devices/push-token`                           | Forget this device's registration on sign-out        | No                    |
| `GET`    | `/devices`                                      | Your registered devices                              | No                    |
| `POST`   | `/devices/test-push`                            | Send yourself a test push                            | No                    |
| `GET`    | `/devices/test-push/{testID}`                   | State of a test push, including acks so far          | No                    |
| `POST`   | `/devices/test-push/{testID}/ack`               | Confirm a test push arrived on this device           | No                    |
| `GET`    | `/friends`                                      | Friends, with the permissions each side granted      | `friends:read`        |
| `DELETE` | `/friends/{friendId}`                           | Unfriend, both directions                            | No                    |
| `PUT`    | `/friends/{friendId}/permissions/{stimulusKind}`| Set what this friend may send you, for one stimulus  | No                    |
| `GET`    | `/friends/requests`                             | Pending requests, both directions                    | No                    |
| `POST`   | `/friends/requests`                             | Send a friend request by handle or invite code       | No                    |
| `POST`   | `/friends/requests/{requestId}/accept`          | Accept an incoming request                           | No                    |
| `POST`   | `/friends/requests/{requestId}/reject`          | Reject an incoming request, or cancel one you sent   | No                    |
| `GET`    | `/pokes`                                        | Activity: sent and received, newest first            | `pokes:read`          |
| `POST`   | `/pokes`                                        | Send a poke                                          | `pokes:send`          |
| `POST`   | `/pokes/{pokeId}/ack`                           | Recipient's device reports what happened             | No                    |

## Errors

Every error body has the same shape:

```json
{ "message": "They haven't allowed that stimulus." }
```

| Status | When                                                                                         |
| ------ | -------------------------------------------------------------------------------------------- |
| `400`  | Invalid JSON, or a body or query that fails validation. The message names the field.         |
| `401`  | No valid session, or an invalid or expired personal access token.                            |
| `403`  | Authenticated, but not allowed: a missing permission, a token without the scope, a cooldown. |
| `404`  | Not found, for example not friends with that user, or no registered devices.                 |
| `409`  | Conflict, for example an email or handle already taken.                                      |
| `429`  | Rate limited. The message says how long to wait.                                             |

## Conventions

- IDs are UUIDs. User IDs such as `friendId` are accepted in any letter case.
- Timestamps are ISO 8601 strings.
- `POST /pokes` accepts an optional client-chosen `pokeId`. Sending the same one
  again returns the poke already recorded (`200` instead of `201`) instead of
  poking twice, which makes retries after a dropped connection safe.
- Some bodies are strict and reject unknown fields with `400`:
  `POST /me/stimulus`, `POST /me/tokens` and `POST /devices/test-push`.

## Push payloads

The pushes the server sends are part of the contract too. The spec describes
them as the `PokePushPayload` and `TestPushPayload` schemas. A poke payload is
self-contained, so the app can act on a silent push without calling the API:
it carries the poke ID, sender and recipient handles, the stimulus, `sentAt`
and `viaApiToken`.
