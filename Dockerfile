# syntax=docker/dockerfile:1
#
# One image, two entry points: the API and the deadline worker run the same
# build with different commands (see docker-compose.prod.yml).
#
# Debian slim rather than Alpine: nothing here needs a native build, and glibc
# removes a class of surprises from prebuilt binaries.

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# Manifests first: this layer is what pnpm needs to resolve the workspace, and
# it only changes when a dependency changes, so installs stay cached across
# ordinary source edits.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/runtime/package.json packages/runtime/package.json

FROM manifests AS build
COPY turbo.json tsconfig.base.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps
RUN pnpm build

# Production dependencies only, installed from the same lockfile, then the
# compiled output copied in. Test tooling never reaches the image.
FROM manifests AS runtime
ENV NODE_ENV=production
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --prod --ignore-scripts

COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/runtime/dist packages/runtime/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/worker/dist apps/worker/dist

# runMigrations resolves ../drizzle from packages/db/dist, so the SQL and its
# journal have to travel with the build.
COPY --from=build /app/packages/db/drizzle packages/db/drizzle

USER node
CMD ["node", "apps/api/dist/server.js"]
