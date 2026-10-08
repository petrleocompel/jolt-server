---
title: Reverse proxy & TLS
description: Use the built-in Caddy for TLS, or put Jolt Server behind a reverse proxy you already run.
---

The app needs HTTPS: Apple requires it for the iOS app to talk to your server.
`compose.yaml` gives you two ways to get it.

## Built-in Caddy (default)

With no extra configuration, `docker compose up -d` starts a `caddy` service
that:

- listens on ports 80 and 443 of the host;
- gets a Let's Encrypt certificate for `APP_HOST` automatically;
- compresses responses (zstd, gzip) and proxies everything to `app:3000`;
- starts only after `app` reports healthy.

Its configuration is inline in `compose.yaml`, with `APP_HOST` filled in by
Compose:

```yaml
configs:
  caddyfile:
    content: |
      ${APP_HOST:?set APP_HOST to your domain} {
        encode zstd gzip
        reverse_proxy app:3000
      }
```

Certificates and Caddy's state live in the `caddydata` and `caddyconfig`
volumes, so they survive restarts.

Both ports must be reachable from the internet. Port 80 is not optional: it is
how the ACME challenge is answered. If no certificate is issued, check
`docker compose logs caddy`.

## Use an existing reverse proxy

If the machine already runs a reverse proxy, skip Caddy. Publish the app on
the loopback interface with a `compose.override.yaml` next to `compose.yaml`
(Compose merges it automatically):

```yaml
# compose.override.yaml
services:
  app:
    ports:
      - "127.0.0.1:7385:3000"
```

Then start everything except Caddy:

```bash
docker compose up -d db migrate app cron
```

Point your proxy at `http://127.0.0.1:7385`. Two requirements:

1. **Forward the `Authorization` header.** The app and personal access tokens
   authenticate with `Authorization: Bearer …`.
2. **Set `PUBLIC_URL` in `.env`** to the public origin, for example
   `PUBLIC_URL=https://jolt.example.com`. Better Auth builds callback URLs from
   it and scopes its cookies to it, so a mismatch produces logins that appear
   to succeed and then immediately fail.

`APP_HOST` is still required: `compose.yaml` refers to it even when Caddy is
not running. If browsers reach the server under more than one name, list the
others in [`TRUSTED_ORIGINS`](/jolt-server/self-hosting/configuration/#trusted_origins).

:::caution
A plain `docker compose up -d` also starts `caddy`, which then tries to bind
ports 80 and 443. When you upgrade, name the services again:
`docker compose pull && docker compose up -d db migrate app cron`.
:::

### Traefik

If Traefik runs in Docker and discovers containers through labels, you do not
need the published port. Attach `app` to Traefik's network and label it. The
entry point (`https`) and certificate resolver (`letsencrypt`) names below are
examples; use the ones from your Traefik configuration.

```yaml
# compose.override.yaml
services:
  app:
    networks: [default, traefik]
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=traefik"
      - "traefik.http.routers.jolt.rule=Host(`${APP_HOST}`)"
      - "traefik.http.routers.jolt.entrypoints=https"
      - "traefik.http.routers.jolt.tls=true"
      - "traefik.http.routers.jolt.tls.certresolver=letsencrypt"
      - "traefik.http.services.jolt.loadbalancer.server.port=3000"

networks:
  traefik:
    external: true
```

Start it with `docker compose up -d db migrate app cron` and set `PUBLIC_URL`
as above.

### Caddy on the host

If Caddy already runs on the host and serves other sites, add a site block
that proxies to the published port:

```text
jolt.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:7385
}
```

## Plain HTTP on a LAN

For a server only reached on a local network, publish the app on the LAN
interface instead of loopback, for example `"7385:3000"`, and set the origin
browsers use:

```dotenv
PUBLIC_URL=http://192.168.1.10:7385
```

The iOS app still needs HTTPS, so this only suits the web dashboard unless you
build the app yourself with an App Transport Security exception.
