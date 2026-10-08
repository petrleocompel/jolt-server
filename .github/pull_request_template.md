## What and why

<!-- What does this change, and why? Link the issue if there is one. -->

## Checklist

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm openapi:check` and `pnpm test` pass
- [ ] API changes: `openapi/jolt-v1.yaml` and `src/api/schemas.ts` updated together, e2e contract walk passes
- [ ] Schema changes: migration generated with `pnpm db:generate`
- [ ] User-visible changes: docs in `docs/` updated
