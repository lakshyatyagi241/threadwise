---
name: pre-pr
description: >-
  Run this repo's full local CI gate — format check, lint, typecheck,
  architecture boundary check, unit tests, and (only when relevant files
  changed) migration status and integration tests — before opening a pull
  request or telling the user a change is ready. Use this whenever asked to
  "open a PR", "is this ready", "check this before I push", "run the checks",
  or after finishing any non-trivial change to apps/api or packages/*. Never
  tell the user a change is ready, or open a PR, on the strength of "the code
  looks right" — this repo's own CI runs these exact checks, and skipping
  them locally just moves the failure to a place that's slower to fix.
---

# Pre-PR gate

```bash
bash .claude/skills/pre-pr/scripts/gate.sh
```

Runs the same checks as `.github/workflows/ci.yml`, in the same order, and
stops reporting failures only after showing every one of them (it doesn't
stop at the first failure — you want the whole list, not a whack-a-mole loop
of fix-one-rerun-find-the-next).

## What it decides to run

Format, lint, typecheck, architecture boundaries (`pnpm arch:check`) and unit
tests run **always** — they're fast and don't need Docker.

`pnpm db:migrate` + `pnpm db:status` run **only if** a file under
`packages/db/migrations/` changed — no point re-checking migration state on a
PR that didn't touch the schema.

`pnpm test:integration` runs **only if** something under `packages/db/` or
`apps/api/src/` changed — it needs a Postgres container via testcontainers
and takes real time, so it's skipped for pure docs/skill/frontend changes.
If genuinely unsure whether your change could affect RLS, a repository query,
or a trigger, run it anyway by hand: `pnpm test:integration`. The gate script
guesses conservatively but a guess is still a guess.

## Reading the output

Each check prints `ok` or `x <check> — reproduce with: <command>`. On
failure, run **just that command** in isolation rather than re-running the
whole gate — faster feedback loop, and the reproduce command is exact
(copy-paste, not paraphrased).

## What "ready" actually means here

Don't report a change as done, ready for review, or safe to push based on
having read the diff and it looking correct. This codebase has real,
non-negotiable invariants — RLS on every tenant table, composite FKs,
audit+outbox in the same transaction, module boundaries — that are exactly
the kind of thing that looks fine on inspection and breaks under an actual
Postgres connection or an actual cross-module import. The gate is what turns
"looks right" into "verified." Run it, then report the result.

## The manual bits

If the gate is green, the [PR checklist](../../../.github/PULL_REQUEST_TEMPLATE.md)
has a few items the gate can't check mechanically (composite FKs on new
tables, RLS policy present specifically on _new_ tables — see
`add-migration`'s `check-rls.sh` for that one, idempotency keys on new
money/message-sending routes). Walk through those by hand before opening the
PR.
