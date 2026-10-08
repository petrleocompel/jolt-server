---
title: Backup & restore
description: Back up the Postgres database with pg_dump and restore it with psql.
---

Everything Jolt Server knows lives in Postgres: accounts, friendships,
permissions, poke history, registered devices, personal access tokens and
server settings. Back up the database and your `.env`, and you can rebuild the
rest.

The commands below assume the default `POSTGRES_USER` and `POSTGRES_DB`
(`jolt`). Replace them if you changed those values. Run them from the directory
that holds `compose.yaml`.

## Back up

```bash
docker compose exec -T db pg_dump -U jolt jolt | gzip > jolt-$(date +%F).sql.gz
```

Also keep a copy of `.env`. It holds `BETTER_AUTH_SECRET`, without which every
existing session is invalid, and your APNs key if you configured one. Store it
somewhere private: it contains secrets.

## Restore

Restore into a running `db` container:

```bash
gunzip -c jolt-2026-08-29.sql.gz | docker compose exec -T db psql -U jolt jolt
```

To restore onto a new machine, start only the database first, restore, then
start everything else so `migrate` brings the schema up to date for the image
you run:

```bash
docker compose up -d db
gunzip -c jolt-2026-08-29.sql.gz | docker compose exec -T db psql -U jolt jolt
docker compose up -d
```

## Which volumes matter

`compose.yaml` creates three named volumes:

| Volume        | Mounted at                                    | Contents                                   |
| ------------- | --------------------------------------------- | ------------------------------------------ |
| `pgdata`      | `/var/lib/postgresql/data` in `db`            | The database. This is the one that matters. |
| `caddydata`   | `/data` in `caddy`                            | Caddy's certificates and state.             |
| `caddyconfig` | `/config` in `caddy`                          | Caddy's configuration state.                |

Only `pgdata` holds Jolt data, and the `pg_dump` above is the way to back it
up. Removing the volumes (for example with `docker compose down -v`) deletes
the database.

Test push results are never persisted: they live in the `app` process's memory
for ten minutes.
