# Working in this repo

This file is read automatically by Claude Code whenever this repo is open.
It exists so the rules below apply to every session, not just the one that
wrote them.

## Read first

[CONTRIBUTING.md](CONTRIBUTING.md) — the non-negotiable rules and why each
one exists. [docs/README.md](docs/README.md) — the map of everything else,
including all 16+ ADRs.

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

## ADRs are enforced, not just written

**Any change to `docs/adr/*.md`, or any code change that behaves differently
from what an existing accepted ADR's Decision section says, must be
documented in the same change** — either the ADR is edited (only valid while
its status is still `proposed`) or it's marked `superseded by ADR-00NN` and a
new one is written via the `write-adr` skill. An ADR that code has silently
drifted away from is worse than no ADR — it actively misleads the next
reader.

This is checked mechanically by the `adr-diff-guard` skill, and both `pre-pr`
and `adr-compliance-review` invoke it. If you're making an architectural
call — a new dependency, a schema pattern applied broadly, an auth/security
tradeoff — write the ADR as part of the same change, not as a follow-up.

## Before calling anything done

```bash
bash .claude/skills/pre-pr/scripts/gate.sh
```

Not "the code looks right." This repo's CI runs exactly these checks; running
them locally first is strictly faster than finding out in a PR.
