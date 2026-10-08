---
title: Upgrading
description: Pull a new Jolt Server image, or pin a specific version.
---

Back up the database first; see [Backup & restore](/jolt-server/self-hosting/backup-restore/).

```bash
docker compose exec -T db pg_dump -U jolt jolt | gzip > jolt-$(date +%F).sql.gz
```

Then pull the new image and recreate the containers:

```bash
docker compose pull && docker compose up -d
```

Migrations run automatically. The `migrate` service applies them to completion
before the new `app` and `cron` containers start, so the API never serves
against an old schema. If a migration fails, `migrate` exits non-zero and the
new API does not start; check `docker compose logs migrate`.

If you use [an existing reverse proxy](/jolt-server/self-hosting/reverse-proxy/#use-an-existing-reverse-proxy)
instead of the built-in Caddy, name the services so Caddy stays stopped:

```bash
docker compose pull && docker compose up -d db migrate app cron
```

## Pinning a version

`compose.yaml` runs `ghcr.io/petrleocompel/jolt-server:${JOLT_VERSION}`, and
`JOLT_VERSION` defaults to `latest`. To stay on a specific release, set it in
`.env` to one of the image tags:

```dotenv
JOLT_VERSION=<tag>
```

To upgrade a pinned install, change the tag, then run
`docker compose pull && docker compose up -d`. The
[releases page](https://github.com/petrleocompel/jolt-server/releases) lists
the versions.

## Building from source

If you run the stack from a checkout of the repository instead of the
published image, see
[Building from source](/jolt-server/development/building-from-source/#upgrading).
