---
name: wadesk-ownership-guard
description: >-
  Keep the three WaDesk-port developers out of each other's code. Checks a
  branch or working tree against docs/wadesk-port/ownership.json and reports
  files inside someone else's zone, shared seams, shared-kernel files, and
  unowned files. Use this whenever someone is about to start work ("can I edit
  X", "who owns this file", "which directories are mine"), before every
  commit/PR of a WaDesk feature ("check my diff", "am I touching someone
  else's files", "ownership check"), when a change needs a shared file
  (app.module, contracts barrel, migrations, nav, kernel) and they need the
  protocol, or when two people report a merge conflict.
---

# Ownership guard

The port is split by **domain**, and every domain owns exclusive directories in
each layer of the monorepo (API module, contracts, db schema/migrations, worker,
web feature, docs). If everyone stays in their own zones there is nothing to
conflict. The zones are in `docs/wadesk-port/ownership.json`; the human-readable
version and the per-person assignment are in
[docs/wadesk-port/assignments.md](../../../docs/wadesk-port/assignments.md), the
hotspot analysis and seam design in
[docs/wadesk-port/conflict-map.md](../../../docs/wadesk-port/conflict-map.md).

## Check your diff

```bash
G=.claude/skills/wadesk-ownership-guard/scripts/ownership_check.py
python3 $G                     # you = WADESK_OWNER or git identity; base = origin/main (or main)
python3 $G --as vedant --base origin/main
python3 $G --strict            # also fail on seams / kernel / unowned files
python3 $G --files apps/api/src/modules/x/y.ts     # ask about specific paths
```

Result classes per changed file (committed vs base, working tree, and untracked):

| Class     | Meaning                                                    | What to do                                                                                      |
| --------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `OK`      | inside a zone you own (plus your tracker/inventory)        | nothing                                                                                         |
| `FOREIGN` | inside another person's zone. **Exit 1.**                  | stop; ask the owner to make the change, or agree a handover and update `ownership.json`         |
| `SEAM`    | registered shared file with an edit policy                 | edit only as the printed policy allows (typically one additive line), keep it in its own commit |
| `KERNEL`  | shared kernel (tenancy, RLS, RBAC core, db client, UI kit) | follow the shared-kernel protocol below                                                         |
| `UNOWNED` | matches nothing                                            | add it to a zone in `ownership.json` in the same PR, or move the file                           |

## Shared-kernel protocol

1. Say in the team channel what you need and why, before coding, and check nobody has it in flight.
2. Land the kernel change as its **own small PR**, additive and backwards compatible. Do not mix it with feature work.
3. The reviewer is named in `ownership.json` (`seams[].reviewer` / kernel owner). Rebase feature branches after it merges.
4. Never fix a kernel bug by copying kernel code into your module.

## If two people need the same thing

Prefer one owner builds it and the other consumes it through the contracts/service interface.
If a feature really spans two domains, the owner of the data owns the feature; the other person
codes against the interface and stubs until it lands (mark `blocked` in the tracker with the id).

## Changing ownership

`ownership.json` and `assignments.md` are generated. Edit `docs/wadesk-port/assignment-input.json` (a cluster's or a domain's `owner`,
`wave`, `days`), then:

```bash
python3 .claude/skills/wadesk-ownership-guard/scripts/gen_ownership.py           # regenerate (add --check to verify)
python3 .claude/skills/wadesk-parity-tracker/scripts/tracker.py init --all      # keeps every existing status
python3 .claude/skills/wadesk-parity-tracker/scripts/tracker.py validate
```

The change needs all three developers' approval in one PR. Never hand-edit the generated files.
