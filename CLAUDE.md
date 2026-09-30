# WaDesk port workspace

Goal: rebuild every WaDesk feature in `crm-platform/` (NestJS, Postgres+RLS, Drizzle, BullMQ, Next.js), three people in parallel
(Lakshya, Vedant, Punya). WaDesk is behavior reference only: never copy its code, views, assets, migrations or text.

Start here: `crm-platform/docs/wadesk-port/README.md` (status, findings, decisions needed, next-session runbook).

| Folder | What | Rules |
| --- | --- | --- |
| `wadesk-reference/` | the licensed Laravel product (`WaDesk/` app, `Documentation/`, `Update/`, `Database/`) | read-only; run it with the `wadesk-run-reference` skill |
| `crm-platform/` | the build target (git, origin `geta-ai/crm-platform`) | follow its own `CLAUDE.md`, `CONTRIBUTING.md`, ADRs and skills |
| `_work/` | manifests, tools, reports, resumable workflow script; not in git | regenerate with the `wadesk-inventory-refresh` skill |

Skills load from `.claude/skills` (symlink to the repo's). Use `wadesk-port-feature` for any unit of port work; it chains the rest.
Open Claude Code inside `crm-platform/` when writing code so the repo's own CLAUDE.md applies.
Nothing is committed or pushed unless the user asks.
