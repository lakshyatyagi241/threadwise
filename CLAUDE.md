# Threadwise workspace

**Threadwise** is the product we build in `crm-platform/` (NestJS, Postgres+RLS, Drizzle, BullMQ, Next.js). Three people work on it in parallel (Lakshya, Vedant, Punya).

**Reference** was the licensed Laravel app that Threadwise was ported from. Its source (`reference/`) has been removed from this repo. Do not read, run, copy from or bring it back. What it did is recorded in `crm-platform/docs/threadwise-port/` (wiring maps, specs, inventory). Treat those files as the feature record, not as a live reference.

| Folder          | What                                                                    | Rules                                                    |
| --------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| `crm-platform/` | the product (git, origin `geta-ai/crm-platform`)                        | follow its own `CLAUDE.md`, `CONTRIBUTING.md` and skills |

Skills load from `.claude/skills` (symlink to the repo's).
Open Claude Code inside `crm-platform/` when writing code so the repo's own CLAUDE.md applies.
Nothing is committed or pushed unless the user asks.
