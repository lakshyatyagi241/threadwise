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
COPY packages/tax/package.json      packages/tax/
COPY packages/ui/package.json       packages/ui/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @crm/tax build \
 && pnpm --filter @crm/contracts build
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
WORKDIR /app/apps/web
EXPOSE 3001
CMD ["pnpm", "exec", "next", "start", "-p", "3001"]
