# syntax=docker/dockerfile:1

# Staff web app (Next.js). Built from the repo root so the workspace packages resolve:
#   docker build -f apps/web/Dockerfile .
# The public/realtime URLs are read at runtime (API_URL, REALTIME_URL), so one image serves any host.

FROM node:22-alpine AS base
RUN corepack enable pnpm
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
 && pnpm --filter @crm/contracts build \
 && pnpm --filter @crm/web build

FROM build AS runtime
ENV NODE_ENV=production
WORKDIR /app/apps/web
EXPOSE 3001
CMD ["pnpm", "exec", "next", "start", "-p", "3001"]
