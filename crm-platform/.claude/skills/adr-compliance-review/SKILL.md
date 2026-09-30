---
name: adr-compliance-review
description: >-
  Review a change in this CRM platform repo against the non-negotiable rules
  in CONTRIBUTING.md and the relevant ADRs — tenant scoping, RLS on new
  tables, AppError usage, audit+outbox in the same transaction, module
  boundaries, uuid-only responses, optimistic locking. Runs a mechanical
  grep-based scan plus a judgment checklist. Use this before opening a PR
  that touches apps/api or packages/db, when reviewing someone else's diff in
  this repo, or when unsure whether a change actually follows the patterns
  this codebase has already settled on rather than just looking plausible.
  Complements — doesn't replace — the general code-review skill: this one
  only knows this repo's specific rules, not general code quality.
---

# ADR compliance review

This repo's conventions exist because each one prevents a specific,
previously-considered failure mode — not because of house style. A change
that "looks right" can still violate one of them, because most of these
failures are invisible on a casual read (RLS enabled-but-not-forced looks
identical to correctly-isolated until you query as the table owner; an
outbox emit outside the transaction looks identical to inside it until a
crash happens between the two statements). That's what this review is for.

## 1. Run the mechanical scan first

```bash
bash .claude/skills/adr-compliance-review/scripts/scan.sh
```

It checks, against the actual repo state (not by trusting comments or intent):

- bare `throw new Error(...)` outside bootstrap-time config code — most of
  these should be `AppError` statics; a few are legitimate (see below)
- `apps/api/src/modules/**` code touching `db.primary`/`db.replica` directly
  instead of `DatabaseService.tx()`/`.txReplica()`
- `@RequirePermission('...')` keys with no matching entry in any migration's
  `permission_defs` insert
- RLS enabled + forced + policy present on every table created by a
  changed/new migration — this one queries the actual running database via
  `add-migration`'s `check-rls.sh`, not the SQL text

**Read every hit — don't just count them.** The `throw new Error` check in
particular has two known false-positive classes worth recognizing on sight
rather than re-investigating each time: a throw inside a `try` block whose own
`catch` converts it to an `AppError` (a legitimate flow-control idiom — see
`cursor.ts`'s `decodeCursor`), and validation that runs once at process
bootstrap before any request context exists (excluded from the scan, but
worth knowing why: there's no problem+json response to build yet at that
point). A hit that isn't either of those is a real finding.

## 2. The checklist a script can't run

These need you to actually read the diff with the rule in mind — walk through
each one against what changed, don't skip any because the scan came back
clean:

| Check                                                                                                                                                                     | Why                                                                                                  | Where it's explained                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Every tenant-data query goes through `DatabaseService.tx()`/`.txReplica()`/`.txAs()` — never a bare connection                                                            | that's the entire tenant-isolation guarantee                                                         | [multi-tenancy.md](../../../docs/architecture/multi-tenancy.md)                             |
| `privileged()` is used only in the four sanctioned places (outbox drain, billing roll-up, partition maintenance, API-key/login org lookup) and never from an HTTP handler | it's the RLS bypass — misuse is a cross-tenant leak                                                  | [multi-tenancy.md](../../../docs/architecture/multi-tenancy.md#the-privileged-escape-hatch) |
| Audit record + outbox emit happen **inside** the same transaction as the write, not after it                                                                              | "row committed, nobody notified" becomes reachable otherwise                                         | [ADR-0005](../../../docs/adr/0005-transactional-outbox.md)                                  |
| New/changed API responses expose `uuid`, never the internal `bigint` id                                                                                                   | leaks row counts, invites enumeration                                                                | [ADR-0016](../../../docs/adr/0016-api-conventions.md)                                       |
| Update endpoints require and check `rowVersion`, return 409 on mismatch                                                                                                   | silent last-write-wins data loss otherwise                                                           | `contacts.repository.ts`'s `updateWithVersion`                                              |
| List endpoints use cursor pagination (`limit + 1` fetch, `(created_at, id)` ordering), never `OFFSET`                                                                     | `OFFSET` on a partitioned table is the exact query that turns 20ms into 2s                           | [ADR-0016](../../../docs/adr/0016-api-conventions.md)                                       |
| A module imports another module only through its `index.ts` barrel                                                                                                        | `pnpm arch:check` enforces this mechanically — run it, don't eyeball it                              | `.dependency-cruiser.cjs`                                                                   |
| New tables have `(org_id, id)` composite PK and composite FKs, not single-column FKs to other tenant tables                                                               | makes a cross-tenant reference a constraint violation instead of a silent bug                        | `add-migration` skill                                                                       |
| Money stays a string end to end, never parsed to a JS `number`                                                                                                            | float rounding on a wallet balance is the one bug nobody forgives                                    | [billing.md](../../../docs/architecture/billing.md)                                         |
| A deliberate, hard-to-reverse decision has an ADR                                                                                                                         | otherwise it gets re-litigated from scratch later by someone who doesn't know it was already settled | `write-adr` skill                                                                           |

## 3. Check ADR drift — invoke `adr-diff-guard`

The last row of the checklist above ("a hard-to-reverse decision has an
ADR") has its own skill. **Invoke `adr-diff-guard` via the Skill tool** — it
verifies the ADR index is consistent and flags an accepted ADR being edited
in place rather than superseded. This is a repo rule
([CLAUDE.md](../../../CLAUDE.md)), not optional polish.

If the review turns up a decision that should have been recorded and wasn't,
**invoke the `write-adr` skill** rather than noting it as a TODO — an
unrecorded decision gets re-litigated from scratch later.

## 4. Then run the real gate

The checklist above is about _whether the change follows the rules_; it
doesn't replace actually running things. **Invoke the `pre-pr` skill**, or
directly:

```bash
bash .claude/skills/pre-pr/scripts/gate.sh
```

## Reporting findings

State what you found plainly — file, line, which rule, why it matters here
specifically (not a generic "this could be a problem"). If the scan and the
checklist both come back clean, say so plainly too; don't manufacture a
finding to seem thorough. A clean report after actually checking each item is
a more useful signal than a vague "looks fine."
