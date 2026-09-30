---
name: wadesk-feature-lookup
description: >-
  Find and read WaDesk feature specs from the detailed inventory in
  docs/wadesk-port/inventory. Use this whenever someone names a WaDesk feature
  id ("WD-INBOX-014"), asks "what does wadesk do for X", "how does wadesk
  handle X", "what's in my assignment", "which feature covers this route/table",
  "who owns feature X", "spec for X", "list features in the billing domain", or
  is about to build/port anything and has not yet read its inventory entry.
  Read the entry before writing any code for a WaDesk feature; never rely on
  memory of how WaDesk "probably" works.
---

# Look up a WaDesk feature

The inventory is the contract for the port: one file per domain under
`docs/wadesk-port/inventory/<domain-id>.md`, every feature is `### WD-<CODE>-<NNN>`
with fixed fields (summary, actors/permissions, screens, endpoints, data, rules,
async, external systems, settings, acceptance criteria, source refs, port notes).
Format: [docs/wadesk-port/inventory-spec.md](../../../docs/wadesk-port/inventory-spec.md).

## Commands

```bash
F=.claude/skills/wadesk-feature-lookup/scripts/find_feature.py
python3 $F WD-INBOX-014                        # full entry + owner + tracker status
python3 $F --domain TIB1                       # feature index of a domain (code or id)
python3 $F --route "POST team-inbox/{id}/assign"   # which feature owns a WaDesk route
python3 $F --table conversations               # features that read/write a table
python3 $F assign conversation                 # keyword search (all words must match)
python3 $F assign conversation --full --limit 3    # print whole entries for the top hits
```

Output columns: id, priority (P0/P1/P2), effort (S/M/L/XL), WaDesk status, tracker
status, owner, title. Owner comes from `docs/wadesk-port/ownership.json`, tracker
status from `docs/wadesk-port/tracker/*.md`.

## After you find it

1. Read the whole entry, then the **Data model** and **Cross-domain contracts** sections
   of its domain file (search for the `## Data model` heading), then every feature it
   lists under **Depends on**. Do not start on a feature whose dependencies are not built
   or explicitly stubbed (say which in the PR).
2. The **Source refs** are paths relative to the reference app (`wadesk-reference/WaDesk/`).
   Open them when the entry is ambiguous. WaDesk is read-only reference: describe and
   rebuild the behavior, never copy code, views, assets or text into this repo.
3. If the entry is wrong or thin, fix the inventory entry in the same PR (you own your
   domain's file), and say so in the PR description. Do not patch around a bad spec in code.
4. To build it, invoke the `wadesk-port-feature` skill. To see the reference behavior live,
   invoke `wadesk-run-reference`.

Ids are permanent: never renumber; new features continue from the highest number.
