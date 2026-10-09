# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.output ./.output
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/openapi ./openapi
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
# drizzle.config.ts and tsconfig.json are needed by `pnpm db:migrate`, which
# the compose `migrate` service runs inside this image before the API starts.
COPY --from=build /app/drizzle.config.ts ./
COPY --from=build /app/tsconfig.json ./
COPY package.json ./
# Reported to the push relay when the server registers there. CI passes the
# tag or branch the image was built from; a local build says "dev". Last, so
# a new version does not invalidate the layers above.
ARG JOLT_SERVER_VERSION=dev
ENV JOLT_SERVER_VERSION=$JOLT_SERVER_VERSION
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
