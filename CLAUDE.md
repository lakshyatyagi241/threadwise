# WaDesk port workspace

Goal: rebuild every WaDesk feature in `crm-platform/` (NestJS, Postgres+RLS, Drizzle, BullMQ, Next.js), three people in parallel
(Lakshya, Vedant, Punya). The project owner holds the license for WaDesk and has authorized using its source directly as the
reference: read the Laravel code, views, JS/CSS, migrations and docs, and port them into NestJS and Next.js (same behavior, same
data model, same screens and flows, same copy where it fits). The port is a rewrite in our stack, not a paste: translate the logic into
our conventions (RLS, Drizzle, contracts, module boundaries); do not drop Laravel/PHP/Blade code into `crm-platform/`. Do not publish the
WaDesk source itself outside the project.

Start here: `crm-platform/docs/wadesk-port/README.md` (status, findings, decisions needed, next-session runbook).

| Folder              | What                                                                                   | Rules                                                    |
| ------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `wadesk-reference/` | the licensed Laravel product (`WaDesk/` app, `Documentation/`, `Update/`, `Database/`) | read-only; run it with the `wadesk-run-reference` skill  |
| `crm-platform/`     | the build target (git, origin `geta-ai/crm-platform`)                                  | follow its own `CLAUDE.md`, `CONTRIBUTING.md` and skills |
| `_work/`            | manifests, tools, reports, resumable workflow script; not in git                       | regenerate with the `wadesk-inventory-refresh` skill     |

Skills load from `.claude/skills` (symlink to the repo's). Use `wadesk-port-feature` for any unit of port work; it chains the rest.
Open Claude Code inside `crm-platform/` when writing code so the repo's own CLAUDE.md applies.
Nothing is committed or pushed unless the user asks.
