---
name: threadwise-feature-lookup
description: >-
  Find and read Reference feature specs from the detailed inventory in
  docs/threadwise-port/inventory. Use this whenever someone names a Reference feature
  id ("TW-INBOX-014"), asks "what does threadwise do for X", "how does threadwise
  handle X", "what's in my assignment", "which feature covers this route/table",
  "who owns feature X", "spec for X", "list features in the billing domain", or
  is about to build/port anything and has not yet read its inventory entry.
  Read the entry before writing any code for a Reference feature; never rely on
  memory of how Reference "probably" works.
---

# Look up a Reference feature

The inventory is the contract for the port: one file per domain under
`docs/threadwise-port/inventory/<domain-id>.md`, every feature is `### WD-<CODE>-<NNN>`
with fixed fields (summary, actors/permissions, screens, endpoints, data, rules,
async, external systems, settings, acceptance criteria, source refs, port notes).
Format: [docs/threadwise-port/inventory-spec.md](../../../docs/threadwise-port/inventory-spec.md).

## Commands

```bash
F=.claude/skills/threadwise-feature-lookup/scripts/find_feature.py
python3 $F TW-INBOX-014                        # full entry + owner + tracker status
python3 $F --domain TIB1                       # feature index of a domain (code or id)
python3 $F --route "POST team-inbox/{id}/assign"   # which feature owns a Reference route
python3 $F --table conversations               # features that read/write a table
python3 $F assign conversation                 # keyword search (all words must match)
python3 $F assign conversation --full --limit 3    # print whole entries for the top hits
```

Output columns: id, priority (P0/P1/P2), effort (S/M/L/XL), Reference status, tracker
status, owner, title. Owner comes from `docs/threadwise-port/ownership.json`, tracker
status from `docs/threadwise-port/tracker/*.md`.

## After you find it

1. Read the whole entry, then the **Data model** and **Cross-domain contracts** sections
   of its domain file (search for the `## Data model` heading), then every feature it
   lists under **Depends on**. Do not start on a feature whose dependencies are not built
   or explicitly stubbed (say which in the PR).
2. The **Source refs** are paths in the removed Laravel app (`reference/app/`), which is no longer in the repo.
   Use the entry and its wiring map instead. Describe and rebuild the behavior, never copy code, views, assets
   or text into this repo.
3. If the entry is wrong or thin, fix the inventory entry in the same PR (you own your
   domain's file), and say so in the PR description. Do not patch around a bad spec in code.
4. To build it, invoke the `threadwise-port-feature` skill.

Ids are permanent: never renumber; new features continue from the highest number.
