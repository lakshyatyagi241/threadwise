# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# One image, two roles. The API and the worker share this build and differ only
# in the command they are started with:
#   API:    node dist/src/main.js
#   Worker: WORKER_MODE=true node dist/src/worker.js
#
# (The Nest SWC builder emits dist/src/**, mirroring sourceRoot. Hence the
# extra path segment — it is not a mistake.)
# ---------------------------------------------------------------------------

FROM node:25-alpine AS base
# git: `pnpm deploy` re-resolves baileys' git-hosted dependency (libsignal-node), and alpine ships without git.
RUN apk add --no-cache git && corepack enable pnpm
WORKDIR /app

# --- dependencies ----------------------------------------------------------
# Manifests are copied before sources so the install layer is cached and a code
# change does not trigger a full reinstall.
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

# --- build -----------------------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm --filter @crm/tax build \
 && pnpm --filter @crm/contracts build \
 && pnpm --filter @crm/db build \
 && pnpm --filter @crm/api build

# Strip dev dependencies from what ships.
RUN pnpm --filter @crm/api --prod deploy /out \
 && cp -r apps/api/dist /out/dist \
 && cp -r packages/db/migrations /out/migrations \
 && cp -r apps/api/assets /out/assets

# --- runtime ---------------------------------------------------------------
FROM node:25-alpine AS runtime
ENV NODE_ENV=production
# The commit this image was built from: the release name in error reports and on the operator System page.
ARG GIT_SHA=
ENV GIT_SHA=$GIT_SHA
WORKDIR /app

# Non-root. A container process that does not need root must not have it.
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /out ./
USER app

EXPOSE 3000

# Liveness only — readiness (dependencies) is the orchestrator's job via /ready,
# because a database blip must pull the pod from the load balancer, not kill it.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/main.js"]
