# Working in this repo

This file is read automatically by Claude Code whenever this repo is open.
It exists so the rules below apply to every session, not just the one that
wrote them.

## Read first

[CONTRIBUTING.md](CONTRIBUTING.md) — the non-negotiable rules and why each
one exists. [docs/README.md](docs/README.md) — the map of everything else.

## Reference app: removed

The licensed Laravel app (`reference/`) is gone from this repo and no session runs it. Nothing is ported from it any more.
The features it had are recorded in [docs/threadwise-port/](docs/threadwise-port/) (wiring maps, specs, inventory). Those docs
describe what the product does; they are not a live reference.

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

## Every change gets a security review (mandatory)

Before you say any change is done, ready or opened as a PR, invoke the `security-review-gate` skill. It runs the repo's
`audit:tenancy`, `audit:authz`, `audit:auth` and dependency audit, a secret scan of the diff, then the built-in
`security-review` and `code-review` skills, and you triage and fix every confirmed finding. Model reports are unreviewed,
so read the cited code before acting. It runs before `pre-pr`. A Stop hook in `.claude/settings.json` blocks the end of the turn until a stamp
covers the current state of the code, so do not wait for it. Skip only on the user's explicit word
(`security-review-gate/scripts/stamp.py write --status skipped --user-approved "..."`).

## Every feature gets a help guide (automatic)

The Help center (`/help`, the question mark above Settings, the "?" tips on pages) has one guide per feature, written as markdown in
`apps/web/src/features/<domain>/help/`. A guide is gated like its screen: it only shows on plans and roles that have the feature and
disappears when the feature or module is off. After you build or change **any** screen, Settings tile or plan feature, invoke the
`help-docs-sync` skill before saying it is done, in the same change as the code. A coverage test in `pnpm test` fails when a built
screen or plan feature has neither a guide nor an owned entry in `help-center/pending.json`.

After the owner pulls the team's work (the post-merge hook prints `N features have no help doc` and writes `docs/help-pending.md`, and
a session-start note repeats it), draft the pending guides without being asked and tell the owner what you wrote.
Design: [docs/specs/help-center.md](docs/specs/help-center.md).

## Every text is translated into all 21 locales (mandatory)

Any key you add or change in `apps/web/messages/en/` is translated into the other 20 locales in the same change, and no
user-visible text stays as a literal in a component. After you build or change any screen, tile, error text or notification copy,
invoke the `i18n-translate-sync` skill before saying it is done. The pre-pr gate runs its `check.sh` and fails when a message file
you touched has a missing or still-English key in any locale. English-only is never "done".

## The mobile app (`apps/mobile`)

The iOS/Android app has its own project skills (`mobile-*`, index in `.claude/skills/README.md`), its own rules in `apps/mobile/CLAUDE.md`, and its own gate
(`bash .claude/skills/mobile-pre-pr/scripts/gate.sh`; `pre-pr` calls it when `apps/mobile` changed). Start at `docs/mobile/README.md`; decisions are ADR-0021 to 0027.
How the web feature rules apply to a phone (behaviour is the contract, the UI is a mobile adaptation, scope is the backlog in `docs/mobile/backlog.md`): ADR-0027, still awaiting the
owner's answers. The `mobile-feature-port` skill asks for a Maestro flow for each mobile feature.
Use `mobile-feature-port` for any unit of mobile work; it chains the rest. Expo changes every release: read the versioned Expo docs, do not answer from memory.

## Before calling anything done

```bash
bash .claude/skills/pre-pr/scripts/gate.sh
```

Not "the code looks right." This repo's CI runs exactly these checks; running
them locally first is strictly faster than finding out in a PR.
