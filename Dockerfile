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
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/runtime/package.json packages/runtime/package.json
# apps/api devDepends on the SDK — its contract test lives there because it
# needs Postgres and Redis — so the SDK is inside the build graph and needs its
# own dependencies installed, whether or not the image ships it.
COPY packages/sdk-ts/package.json packages/sdk-ts/package.json

FROM manifests AS build
COPY turbo.json tsconfig.base.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps

# next build reads the environment through a schema that refuses blanks. Every
# route is server-rendered on demand, so nothing here is baked into the output;
# these placeholders exist to make the build independent of the ambient
# environment, and the real values arrive at run time.
ENV API_PUBLIC_URL=https://placeholder.invalid \
    DATABASE_URL=postgres://placeholder:placeholder@placeholder:5432/placeholder \
    AUTH_SECRET=placeholder-placeholder-placeholder-00 \
    AUTH_GITHUB_ID=placeholder \
    AUTH_GITHUB_SECRET=placeholder

# Filtered to the three things this image ships, so that a workspace package
# nothing here depends on cannot break this build by existing. `COPY packages
# packages` above brings in every package in the workspace, while the manifests
# stage lists them one by one: a package added to one and not the other has no
# node_modules, and an unfiltered build fails on its first missing type. Turbo
# still pulls in the build graph, so core, db, runtime — and the SDK, which
# apps/api devDepends on — are built regardless.
RUN pnpm build --filter=@aichess/api --filter=@aichess/worker --filter=@aichess/web

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
COPY --from=build /app/apps/web/.next apps/web/.next
COPY --from=build /app/apps/web/next.config.ts apps/web/next.config.ts

# runMigrations resolves ../drizzle from packages/db/dist, so the SQL and its
# journal have to travel with the build.
COPY --from=build /app/packages/db/drizzle packages/db/drizzle

# COPY preserves the build context's permissions, and a checkout made under a
# restrictive umask arrives unreadable to anyone but its owner. Node reads
# package.json to apply the "exports" map; when it cannot, it does not report a
# permission error but falls back to path resolution and reports
# ERR_MODULE_NOT_FOUND for a file that was never the one it wanted. Make the
# workspace readable so the non-root user below gets the exports map.
RUN chmod -R a+rX /app/package.json /app/packages /app/apps

USER node
CMD ["node", "apps/api/dist/server.js"]
