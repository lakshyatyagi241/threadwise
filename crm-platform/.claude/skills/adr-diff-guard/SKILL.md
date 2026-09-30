---
name: adr-diff-guard
description: >-
  Check that this repo's ADR bookkeeping is consistent — every ADR file
  indexed in docs/README.md, every index row backed by a real file, every
  "superseded by" reference valid, and flag any already-accepted ADR being
  edited in place instead of superseded. Enforces the repo rule that any
  code change contradicting an existing ADR, or any change to docs/adr/*.md,
  must be documented in the same change. Use this whenever docs/adr/ files
  changed, whenever write-adr just created a new ADR, before reporting a PR
  ready via pre-pr or adr-compliance-review, or whenever making an
  architectural decision and unsure whether an ADR already covers it. Also
  invoke it proactively any time a change touches something a prior ADR
  clearly governs (auth, tenancy, billing, migrations) even if no docs/adr
  file was touched — that's usually the sign an ADR update was missed.
---

# ADR diff guard

This is the enforcement mechanism for the rule in
[CLAUDE.md](../../../CLAUDE.md): an ADR that code has silently drifted away
from is worse than no ADR at all — it actively misleads whoever reads it
next.

## Run the check

```bash
bash .claude/skills/adr-diff-guard/scripts/adr-guard.sh
```

It checks, against the actual files (not by trusting that the index is
current):

1. **Every real ADR file has a row in `docs/README.md`'s Decision records
   table.** Catches the single most common mistake: `write-adr` creates the
   file, and the "add a row to the index" step gets forgotten.
2. **Every index row points at a file that actually exists** — catches a
   renamed or deleted ADR that left a dangling link.
3. **Every `superseded by ADR-00NN` reference resolves to a real ADR.**
4. **Any ADR that existed before this change and is being modified now,
   while its status isn't `proposed`**, gets flagged — not failed, flagged.
   A wording fix to an already-accepted ADR is fine; silently rewriting its
   Decision or Consequences is not. The script can't tell those apart from
   the text alone, so read the diff on anything it flags here.

Includes untracked new ADR files (the state right after `write-adr` creates
one, before `git add`), not just already-tracked changes.

## What it can't check — do this part yourself

The script only looks at `docs/adr/*.md`. **It cannot tell you that a code
change contradicts an ADR it never touched** — that's the more dangerous
case, because nothing about the diff looks ADR-related on the surface.

Before finishing any change that touches auth, tenancy/RLS, migrations,
billing, the outbox, or module boundaries — the areas this repo already has
ADRs about — ask explicitly: does this behave differently from what the
relevant ADR's Decision says? If yes, that's not a code review nitpick,
it's a missed step: invoke the write-adr skill now, either to edit the ADR
(only if it's still proposed) or to write a new one that supersedes it.

## Where this gets invoked from

pre-pr's gate and adr-compliance-review's scan both invoke this skill as
part of their own checks — you don't need to remember to run it separately
if you're already running either of those. It's also fine to invoke
directly right after write-adr finishes, to confirm the new ADR landed in
the index correctly before moving on.
