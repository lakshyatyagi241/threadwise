---
name: threadwise-parity-tracker
description: >-
  Record and report Reference port progress per feature: mark a feature
  in-progress/backend-done/frontend-done/done/verified/blocked/wontfix, see
  what is done vs remaining for a domain or a person, and validate that every
  inventory feature has exactly one owner and one tracker row. Use this
  whenever someone says "mark TW-XXX done", "update the tracker", "what's left
  in my domain", "parity status", "how far along is the port", "progress
  report", "start feature X", or right after finishing, starting, or getting
  blocked on a Reference feature, and before opening a PR that completes one.
---

# Parity tracker

One tracker file per person: `docs/threadwise-port/tracker/<owner>.md`, one row per
feature of the domains that person owns. **You only ever edit your own file**, so
three people updating status never produce merge conflicts. The script refuses to
edit someone else's rows.

Statuses: `todo` → `in-progress` → `backend-done` → `frontend-done` → `done` →
`verified`; plus `blocked` (say why in the note) and `wontfix` (say why; excluded
from the percentage).

- `done` = code merged, automated tests exist for every acceptance criterion in the entry, `pnpm` gate green.
- `verified` = compared against the running Reference with the `threadwise-verify-parity` skill and the evidence is linked in the PR.

## Commands

```bash
T=.claude/skills/threadwise-parity-tracker/scripts/tracker.py
python3 $T set TW-INBOX-014 in-progress --pr 123 --note "api first"
python3 $T set TW-INBOX-014 done --pr 123
python3 $T summary                       # every domain, done %, in-progress, blocked
python3 $T summary --owner vedant        # or --domain team-inbox-conversations
python3 $T validate                      # CI-safe: exit 1 if ids/owners/rows are inconsistent
python3 $T init --owner <you>            # refresh your rows after the inventory or ownership changed (keeps your statuses)
```

Who you are is taken from `--as NAME`, else `THREADWISE_OWNER`, else your git
`user.email`/`user.name` matched against `ownership.json` (`owners.<name>.aliases`).
Set it once: `export THREADWISE_OWNER=<name>`.

## When to update

- Start of work on a feature: `in-progress`. One feature in progress per person per branch is the norm.
- Merge of the PR that finishes it: `done` with the PR number. Same PR, not a follow-up.
- After parity verification: `verified`.
- Blocked on another domain: `blocked` with the feature id you are waiting for in the note; tell that owner.
- Feature turns out not to exist in Reference 1.7.0 (docs-only) or is deliberately dropped: `wontfix` with the reason, and also correct the inventory entry.

Run `validate` before opening a PR that touches inventory, ownership, or tracker files.
