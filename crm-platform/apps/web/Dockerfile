# syntax=docker/dockerfile:1

# Staff web app (Next.js). Built from the repo root so the workspace packages resolve:
#   docker build -f apps/web/Dockerfile .
# The public/realtime URLs are read at runtime (API_URL, REALTIME_URL), so one image serves any host.

FROM node:22-alpine AS base
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

# The runtime is a clean image holding only Next's traced server (`output: 'standalone'` in next.config.ts): the compiled server, the
# production dependencies the trace found, the static assets and `public`. It used to be the whole build stage plus a production install
# (about 3 GB: the repo sources, every workspace, the build cache and the compiler), which every release shipped over SSH. Nothing in
# it needs pnpm, npm or corepack, so none is installed; `apk upgrade` takes the fixed Alpine packages (OpenSSL etc.) that are newer
# than the node base image, as the API Dockerfile does.
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
WORKDIR /app/apps/web
EXPOSE 3001
CMD ["node", "server.js"]
