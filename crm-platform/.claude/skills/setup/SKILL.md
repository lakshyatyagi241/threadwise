---
name: setup
description: >-
  End-to-end local dev environment setup for this CRM platform repo —
  installs dependencies, starts Docker infra (Postgres/Redis/MinIO/Mailpit),
  builds shared packages, runs database migrations, seeds demo data, and
  verifies the API actually boots and passes health checks. Use this
  whenever a teammate has just cloned the repo and wants to get it running
  locally, asks "how do I set this up", "get me running", "onboard me",
  mentions first-time setup or environment setup for this project, or hits
  errors trying to run `pnpm dev` on a repo they haven't set up yet. Safe to
  run any number of times — it detects what's already done and skips it, and
  automatically works around port conflicts with other local services.
---

# CRM platform — local setup

Runs `scripts/setup.sh`, a single idempotent script that does the entire
bring-up: prerequisites, `.env`, Docker infra, dependency install, shared
package builds, database roles, migrations, seed data, and a real boot-and
`/health` check of the API.

## How to run it

```bash
bash .claude/skills/setup/scripts/setup.sh
```

Run it from anywhere inside the repo — it finds the repo root itself via
`git rev-parse --show-toplevel`. Just run it; it needs no arguments and asks
no questions. Give the Bash tool call a generous timeout (5 minutes) — a
first run pulls four Docker images and that alone can take a couple of
minutes on a slow connection.

Don't try to reproduce its steps by hand or skip ahead because "it's probably
already set up" — the script's whole job is figuring that out safely. Just
run it and relay the output.

## What it does, in order

1. **Prerequisites** — Node 22+, Docker running, pnpm via corepack. Fails
   fast with a specific fix if any is missing.
2. **`.env`** — copies from `.env.example` if absent. Never overwrites an
   existing one.
3. **Docker infra** — if `crm-postgres` and `crm-redis` are already healthy,
   reuses them untouched. Otherwise checks whether the default ports
   (5432/6379/9000/9001/1025/8025/3000) are free; any that are busy get
   remapped to a free port (50000 offset from default, or the next free port
   after that), with the corresponding `DATABASE_URL` / `REDIS_URL` /
   `S3_ENDPOINT` / `SMTP_PORT` / `APP_URL` values in `.env` updated to match.
   Then starts the containers and waits for them to report healthy.
4. **Dependencies** — `pnpm install`.
5. **Shared packages** — builds `@crm/contracts` and `@crm/db`. The app
   imports their compiled `dist/`, not their source, so this has to happen
   before anything downstream works.
6. **Database roles** — the app connects as a restricted, non-superuser
   Postgres role (`crm_app_user`) rather than the container's superuser,
   because a superuser silently bypasses Row-Level Security. This role is
   normally created automatically on first container start; this step
   self-heals the rare case of an older data volume that predates it.
7. **Migrations** — `pnpm db:migrate`.
8. **Seed data** — skipped if `organizations.slug = 'studyfromuae'` already
   exists, because the seed script isn't safe to run twice (it would insert
   a second batch of demo contacts).
9. **Verify** — builds the API, boots it in the background, polls `/health`
   until it responds (or 20s times out), prints `/ready`, then kills the
   process. This is the step that proves the whole stack actually works
   end-to-end, not just that each piece started.

On success it prints a summary: how to start `pnpm dev` / `pnpm dev:worker`,
the Swagger URL, and the seeded login credentials — using whatever port the
API actually ended up on, remapped or not.

## If it fails

The script's own error message is the fix — it's written to be handed
straight to the user, not decoded. Common ones:

| Message                                        | Fix                                                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Node ... found, this repo needs 22+`          | `nvm install 22 && nvm use 22`                                                                                  |
| `Docker isn't running`                         | Start Docker Desktop, re-run the skill                                                                          |
| `Postgres/Redis didn't become healthy in time` | `docker compose logs` — usually a stale volume from a previous project; ask before touching volumes, see below  |
| `API didn't come up`                           | prints the last 30 log lines right above the message — the real error is in there (commonly a bad `.env` value) |

If a step fails, don't paper over it and tell the user setup succeeded — the
script exits non-zero on real failure and prints exactly what broke. Surface
that, and don't run `docker compose down -v` or delete `.env` to "start
clean" without asking first — that destroys local data and, on this
machine, could just as easily be colliding with an unrelated project's
containers rather than this repo's own.

## After it succeeds

```bash
pnpm dev            # API
pnpm dev:worker     # background jobs, second terminal
```

Full reference if the teammate wants more detail than the summary gives:
[docs/runbooks/local-development.md](../../../docs/runbooks/local-development.md).
