# Agent notes

Read `README.md` and `CONTRIBUTING.md` first: `openapi/jolt-v1.yaml` is the
canonical contract, and `pnpm lint`, `pnpm generate-routes && pnpm typecheck`,
`pnpm openapi:check` and `pnpm test` must pass. The docs site in `docs/` is a
separate Astro project (`npm ci && npm run build` there).

## Remotes and deploys

- GitHub is the public repository; pull requests go there.
- If you are petrleocompel's agent: `origin` in this clone is his private GitLab, whose pipeline runs the checks and deploys the test instance, and `github` is the public repository. Push every `main` commit to both (`git push origin main && git push github main`), and push to `github` only `main` and release tags.
- Everyone else: the iOS app is built on a private pipeline; GitHub Actions cover checks, the Docker image, releases and the docs site.
