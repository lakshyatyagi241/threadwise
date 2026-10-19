# syntax=docker/dockerfile:1

# Staff web app (Next.js). Built from the repo root so the workspace packages resolve:
#   docker build -f apps/web/Dockerfile .
# The public/realtime URLs are read at runtime (API_URL, REALTIME_URL), so one image serves any host.

FROM node:25-alpine AS base
RUN npm install -g --force corepack && corepack enable pnpm
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json          apps/api/
COPY apps/web/package.json          apps/web/
COPY packages/config/package.json   packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json       packages/db/
COPY packages/observability/package.json packages/observability/
COPY packages/tax/package.json      packages/tax/
COPY packages/ui/package.json       packages/ui/
# Only this app and the workspace packages it depends on (the other app's dependencies are not needed to build this image); the store is
# cached between builds so a changed lockfile re-downloads only what changed.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @crm/web...

FROM deps AS build
COPY . .
RUN pnpm --filter @crm/tax build \
 && pnpm --filter @crm/contracts build \
 && pnpm --filter @crm/observability build
# Error reporting (Sentry). The browser bundle can only know what was present at build time, so the DSN (public by design), the
# release and the environment are build arguments. The auth token that uploads source maps is a BuildKit secret, never an argument
# or a layer: `docker build --secret id=sentry_auth_token,env=SENTRY_AUTH_TOKEN`. All are optional; without a token nothing is uploaded.
ARG NEXT_PUBLIC_SENTRY_DSN=
ARG NEXT_PUBLIC_GIT_SHA=
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
ARG SENTRY_ORG=
ARG SENTRY_PROJECT=
# `next build` (type check and bundle) outgrew Node's default heap ("JavaScript heap out of memory"). Set inline, not as ENV: the
# runtime stage is built FROM this one and sets its own limit (compose NODE_OPTIONS).
RUN --mount=type=secret,id=sentry_auth_token,required=false \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" \
    NODE_OPTIONS=--max-old-space-size=6144 \
    pnpm --filter @crm/web build

FROM build AS runtime
ENV NODE_ENV=production
# The build stage holds everything `next build` needed (the compiler, the test runner, their dependencies, a cached copy of pnpm and
# the npm that ships with the base image). `next start` needs none of it, and the image scan flagged about 75 high and critical
# findings in those tools (QA task 39). So the runtime keeps the production dependencies only and starts Next with `node`, not pnpm,
# which lets pnpm, its cache, npm and corepack be removed. CI=true lets pnpm replace the modules directory without asking (there is no
# terminal to answer); --ignore-scripts skips the repository's husky `prepare` hook, which is not installed any more; --filter keeps only
# the web app and what it depends on (the API's git-hosted packages are not in this stage's store, and the web app does not use them).
# Take the fixed Alpine packages (OpenSSL etc.) that are newer than the node base image; see the API Dockerfile.
RUN apk upgrade --no-cache
RUN CI=true pnpm install --prod --frozen-lockfile --offline --ignore-scripts --filter "@crm/web..." \
 && rm -rf /root/.cache /root/.local/share/pnpm/store \
      /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
WORKDIR /app/apps/web
EXPOSE 3001
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3001"]
