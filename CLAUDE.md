# Reference port workspace

Goal: rebuild every Reference feature in `crm-platform/` (NestJS, Postgres+RLS, Drizzle, BullMQ, Next.js), three people in parallel
(Lakshya, Vedant, Punya). Reference is behavior reference only: never copy its code, views, assets, migrations or text.

Start here: `crm-platform/docs/threadwise-port/README.md` (status, findings, decisions needed, next-session runbook).

| Folder | What | Rules |
| --- | --- | --- |
| `reference/` | the licensed Laravel product (`Threadwise/` app, `Documentation/`, `Update/`, `Database/`) | read-only; run it with the `threadwise-run-reference` skill |
| `crm-platform/` | the build target (git, origin `geta-ai/crm-platform`) | follow its own `CLAUDE.md`, `CONTRIBUTING.md`, ADRs and skills |
| `_work/` | manifests, tools, reports, resumable workflow script; not in git | regenerate with the `threadwise-inventory-refresh` skill |

Skills load from `.claude/skills` (symlink to the repo's). Use `threadwise-port-feature` for any unit of port work; it chains the rest.
Open Claude Code inside `crm-platform/` when writing code so the repo's own CLAUDE.md applies.
Nothing is committed or pushed unless the user asks.
