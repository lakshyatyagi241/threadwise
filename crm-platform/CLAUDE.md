# Working in this repo

This file is read automatically by Claude Code whenever this repo is open.
It exists so the rules below apply to every session, not just the one that
wrote them.

## Read first

[CONTRIBUTING.md](CONTRIBUTING.md) — the non-negotiable rules and why each
one exists. [docs/README.md](docs/README.md) — the map of everything else.

## Use the project skills

`.claude/skills/` has a growing library of narrow, single-purpose skills for
this repo — see [`.claude/skills/README.md`](.claude/skills/README.md) for
the full index. They exist because this codebase's conventions (Row-Level
Security forced on every tenant table, audit+outbox in the same transaction,
composite foreign keys, module boundaries) are the kind of thing that looks
correct on a casual read and only fails under an actual Postgres connection
or an actual cross-tenant request. Don't hand-write a migration, a new
module, a permission, or a contract shape from memory when a skill for that
exact task already exists — use it.

Skills in this repo call each other. If a skill's instructions say "invoke
the `X` skill now," actually do it via the Skill tool rather than treating it
as a reading suggestion — that's what keeps a multi-step task (new table →
new module → new permission → verify) from drifting off the rails partway
through.

## Every feature gets a WaDesk parity run (automatic)

After you build or change **any** feature, small or big (an endpoint, a screen, a contract, a migration, a worker
job), invoke the `wadesk-playwright-parity` skill before saying it is done. It runs the same scenarios on the
running WaDesk reference and on our app in Playwright, compares UI, UX and functionality with the full set of edge
cases, reports every difference, spawns fix sub-agents for the defects and records a stamp. A Stop hook in
`.claude/settings.json` blocks the end of the turn until a stamp covers the current state of the feature files, so
do not wait for it. Skip only on the user's explicit word (`stamp.py write --status skipped --user-approved "..."`).

## Before calling anything done

```bash
bash .claude/skills/pre-pr/scripts/gate.sh
```

Not "the code looks right." This repo's CI runs exactly these checks; running
them locally first is strictly faster than finding out in a PR.
