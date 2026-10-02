# Reference port

Rebuild every feature of **Reference** (a CodeCanyon Laravel + Node WhatsApp CRM, v1.7.0) inside **crm-platform**
(NestJS, Postgres with row-level security, Drizzle, BullMQ, Next.js), with three people working in parallel and as
few merge conflicts as possible. Reference is used as a _behavior reference only_: we read what it does, write it down, and
rebuild it. We never copy its code, views, assets, migrations or text.

This repository holds the whole workspace: the build target, the feature inventory and plans, and the Claude Code skills
that drive the work.

## What is in here

```
threadwise-port/
├── README.md                  you are here
├── CLAUDE.md                  orientation for Claude Code sessions opened at the repo root
├── .claude/skills  ->  crm-platform/.claude/skills      (symlink, so skills load from the root too)
├── crm-platform/              the build target: geta-ai/crm-platform with its full git history, plus the port docs and skills
│   ├── apps/  packages/       API, worker, db, contracts, web (Next.js) and ui (shared components)
│   ├── docs/threadwise-port/      status, inventory, target-map, conflict-map (start with README.md there)
│   └── .claude/skills/        the repo's own skills + 11 threadwise-* skills
├── reference/          EMPTY on purpose: put your own licensed Reference copy here (see its README); git ignores it
└── _work/                     machine manifests of Reference (routes, tables, files) + the resumable inventory workflow script
```

**Not included, deliberately:** the Reference source. It is a commercial product under a CodeCanyon license, so it must not be
published. Each person who needs the live reference app uses their own licensed copy in `reference/`.

## Quick start

Prerequisites: Git, Node 22+, Docker running, `corepack enable pnpm`, and [Claude Code](https://claude.com/claude-code)
(the workflow is built around its skills). PHP 8.2 and MariaDB/MySQL are needed only for the Reference reference app.

1. **Clone**

   ```bash
   git clone https://github.com/lakshyatyagi241/threadwise.git
   cd threadwise-port/crm-platform
   ```

2. **Bring up crm-platform** (idempotent: installs, starts Postgres/Redis/MinIO/Mailpit, builds packages, migrates, seeds, boots the API to check `/health`)

   ```bash
   bash .claude/skills/setup/scripts/setup.sh
   ```

   Then run it (three terminals, all in `crm-platform/`):

   ```bash
   pnpm dev
   ```

   ```bash
   pnpm dev:worker
   ```

   ```bash
   pnpm dev:web
   ```

   API on http://localhost:3000, docs at `/docs`; web app on http://localhost:3001 (sign in with the seeded staff user the setup script prints). The API refuses to boot without `CLERK_SECRET_KEY`; `.env.example` ships a placeholder
   (`sk_test_replace_me`), which is enough to run locally but means Clerk login will not work until you set a real key.

3. **(Optional) Reference reference app**, for side-by-side behavior checks. Put your licensed copy in `reference/`
   (see the README there), then follow `crm-platform/.claude/skills/threadwise-run-reference/SKILL.md` for the one-time setup
   (PHP 8.2, a local database, `.env`) and start it with:

   ```bash
   bash .claude/skills/threadwise-run-reference/scripts/start.sh
   ```

4. **Open Claude Code inside `crm-platform/`** when writing code, so the repo's own `CLAUDE.md` and skills apply.
   Opening it at the repo root also works (skills load through the symlink; on Windows enable symlinks or copy the folder).

## How to proceed

Read [`crm-platform/docs/threadwise-port/README.md`](crm-platform/docs/threadwise-port/README.md) first: it has the current status, the
findings so far, the decisions the team lead still owes, and the ordered runbook. In short:

| Step | What                                                                                                                                                                                                                                                                                                           | Where                                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1    | Decide scope (the inventory so far is thousands of dev-days, so P0 plus a chosen slice of P1), domain codes/owners, and the open kernel decisions D1-D7                                                                                                                                                        | status README, "Decisions needed"                                            |
| 2    | Finish the feature inventory (26 of 62 domains written; the rest is resumable) and sweep the coverage gaps                                                                                                                                                                                                     | `_work/workflows/threadwise-inventory.mjs`, `threadwise-inventory-refresh` skill     |
| 3    | Per-domain port-maps (the three-way split is done: `crm-platform/docs/threadwise-port/assignments.md`, `ownership.json`, `tracker/<owner>.md`; regenerate after changes)                                                                                                                                           | `threadwise-parity-tracker`, `threadwise-ownership-guard`                            |
| 4    | Land the **skeleton PR** (shared registries turned into per-domain files, timestamp migrations, decorator registries), then the rest of the foundation wave (super-admin layer, channel model, worker/outbox/realtime plumbing; the web shell is started, see `crm-platform/docs/threadwise-port/base-changes.md`) | [`conflict-map.md`](crm-platform/docs/threadwise-port/conflict-map.md) section 2 |
| 5    | Port features one at a time in your own zones                                                                                                                                                                                                                                                                  | `threadwise-port-feature`                                                        |

Each feature follows the same loop: read its inventory entry, see Reference do it, build the vertical slice (migration, contracts, module,
permissions, worker, web) with the repo's skills, write a test per acceptance criterion, compare against Reference and record the evidence,
run the gate, mark the tracker. Rules of the road for three people are in `conflict-map.md` section 5: stay in your zones, small branches, rebase not merge,
dependencies in their own PR, prefix everything with your domain code.

## Punya's branch and PR workflow

Applies to Punya's modules (channel-facebook, channel-instagram, channel-telegram, channel-tiktok, channel-line, channel-wechat,
channel-viber, channel-sms, channel-email, shopify-woocommerce, broadcasts, campaigns), and to every Claude Code session working for Punya.

- **One branch only: `punya/punyafix`.** All of Punya's work is committed to it and pushed to it. Do not create any other branch
  (no per-feature, per-module or per-docs branches), and never commit to `main`.
- **Always push to `punya/punyafix`** after committing (`git push origin punya/punyafix`).
- **Pull request:** one open PR from `punya/punyafix` into `main`, with **Lakshya (`lakshyatyagi241`) as reviewer**, always. If the PR is
  already open, a push updates it; if it was merged, sync `punya/punyafix` with the latest `main` (rebase) and open a new PR.
  `gh pr create --base main --head punya/punyafix --reviewer lakshyatyagi241`
- Commit messages are conventional (`feat(bcast): ...`) and end with the `Co-Authored-By` line.

## Skills

Everything is a Claude Code skill in `crm-platform/.claude/skills/`. The repo's own skills (`setup`, `new-module`, `add-migration`,
`contracts-change`, `rbac-permission`, `outbox-event`, `worker-job`, `provider-adapter`, `webhook-handler`, `frontend-api-call`,
`pre-pr`) are unchanged in behavior. The port adds:

| Skill                      | Use it to                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `threadwise-port-feature`      | port one feature end to end (the entry point; it calls the others)                         |
| `threadwise-feature-lookup`    | find and read an inventory entry by id, route, table or keyword                            |
| `threadwise-data-model-port`   | draft a Postgres migration from a Reference MySQL table (tested on all 149 tenant tables)     |
| `threadwise-channel-port`      | port a messaging channel or provider, in the right order and with the open decisions named |
| `threadwise-frontend-port`     | rebuild a Reference screen in the Next.js app                                                 |
| `threadwise-e2e-tests`         | turn acceptance criteria into unit, integration and e2e tests                              |
| `threadwise-verify-parity`     | compare with the running Reference and record evidence                                        |
| `threadwise-parity-tracker`    | per-person progress tracking that cannot conflict                                          |
| `threadwise-ownership-guard`   | check your diff against your zones; shared-kernel protocol                                 |
| `threadwise-inventory-refresh` | regenerate manifests and audit inventory coverage                                          |
| `threadwise-run-reference`     | start, stop and first-time-install the local Reference                                        |

## Relationship to geta-ai/crm-platform

`crm-platform/` was imported with `git subtree`, so its commit history is intact and it is a snapshot of
`geta-ai/crm-platform` (`main` at `85f6513`) plus the port documents and skills. Pull upstream changes with:

```bash
git remote add crm-upstream https://github.com/geta-ai/crm-platform.git
git subtree pull --prefix=crm-platform crm-upstream main
```

Product code that should land in `geta-ai/crm-platform` has to be moved there (a PR from a normal clone of that repo, or
`git subtree push`, which has not been exercised here). Decide as a team whether this repository or that one is the
day-to-day home before feature work starts, so code does not live in two places.

Some of the repo's skill scripts (`setup`, `pre-pr`, `add-migration`)
assumed `crm-platform` was the git root. They now derive the root from their own location and use `git diff --relative`, so
they behave the same here and in the original repository. That change is its own commit and could be sent upstream.

## Known caveats

- **Husky/commitlint hooks are not active** in this layout (the git root is one level up). The gate script and review skills still work; run
  `bash crm-platform/.claude/skills/pre-pr/scripts/gate.sh` before pushing.
- **GitHub CI does not run** for `crm-platform/.github/workflows/` here, because GitHub only reads workflows at the repository root.
- The inventory is unfinished (see the status README). Partial files are listed there and must be completed or rewritten.
- The local test credentials in the skills (`test@example.com` / `password`, database `threadwise` / `threadwise_local_pw`) are throwaway defaults for the
  reference app on your own machine, not real secrets. Never reuse them anywhere else.
- `crm-platform` has a pre-existing Clerk login issue (cross-tenant self-enrolment); see finding 6 in the status README.
