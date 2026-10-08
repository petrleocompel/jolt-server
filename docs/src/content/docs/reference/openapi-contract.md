---
title: Contract-first OpenAPI
description: Why openapi/jolt-v1.yaml is canonical, and how pnpm openapi:check keeps the server in line with it.
---

`openapi/jolt-v1.yaml` is the canonical definition of the API. The server is
written to match it, not the other way round.

The mobile client's in-memory `MockSocialBackend` implements the same
contract, so this server is meant to be a drop-in replacement for it: no client
changes beyond swapping the repository implementation and setting a base URL.

## Two copies, one check

The server does not read the YAML at runtime to validate requests. Its runtime
mirror is `src/api/schemas.ts`, a set of Zod schemas the handlers validate
against. Nothing stops the two from drifting apart, so a script compares them:

```bash
pnpm openapi:check      # exit 1 on drift
pnpm openapi:generate   # print the structural signatures
```

It deliberately does not diff the documents byte for byte. Descriptions,
examples and key order are free to differ. It compares what clients actually
depend on:

- the set of properties on every named component;
- which of those properties are required;
- enum members;
- that every component in the spec has a Zod mirror, and the other way round;
- that every path in the spec has a route file under `src/routes/api/v1/`
  behind it.

On drift it prints each difference, for example
`PokeEvent: properties in spec but not in Zod: …`, and exits non-zero, which
fails CI.

## Changing the API

1. Change `openapi/jolt-v1.yaml` first.
2. Mirror the change in `src/api/schemas.ts`, and add or change the route file
   in `src/routes/api/v1/`.
3. Run `pnpm openapi:check` until it reports
   `✓ openapi/jolt-v1.yaml and src/api/schemas.ts agree`.
4. The end-to-end contract test (`tests/e2e/contract.spec.ts`) walks the whole
   flow against a real server and a real Postgres: sign-up, friend request,
   accept, grant a permission, poke, ack. See [Testing](/jolt-server/development/testing/).

## Where the spec is published

- In the repository:
  [`openapi/jolt-v1.yaml`](https://github.com/petrleocompel/jolt-server/blob/main/openapi/jolt-v1.yaml).
- On every running instance at `/openapi.yaml`. The file is bundled at build
  time, so the served contract is always the one that build was checked
  against.
- On this site, rendered as the [API endpoints](/jolt-server/reference/api/)
  reference.

## Notes on the contract

- The base path is **`/api/v1`**, not the `/v1` the spec originally declared;
  the `servers:` entry was updated to match.
- `pending` was added to `PokeDeliveryStatus` during implementation. The
  original enum had only final values, which left nothing honest to record
  between accepting a poke and hearing back from the device.
- The spec's first `servers` entry is the relative URL `/api/v1`, described as
  "the server this document was fetched from", so tools that load
  `/openapi.yaml` from an instance call that same instance.
