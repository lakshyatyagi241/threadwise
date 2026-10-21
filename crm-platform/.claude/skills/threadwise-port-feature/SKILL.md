---
name: threadwise-port-feature
description: >-
  Port ONE Reference feature into this repo end to end (database, contracts, API,
  worker, permissions, web, tests, docs) and prove it matches. This is the
  entry point for every unit of port work. Use this whenever someone says "port
  TW-XXX", "build feature X from threadwise", "implement the next feature on my
  list", "what should I work on next", "start the <domain> domain", "replicate
  threadwise's X", "add X like threadwise does", or hands you a Reference feature id or
  a Reference screen/behavior to rebuild. It sequences the other skills (lookup,
  ownership, add-migration, new-module, contracts-change, rbac-permission,
  outbox-event, worker-job, provider-adapter, webhook-handler, frontend-port,
  e2e-tests, help-docs-sync, parity-tracker, pre-pr); never
  port a feature by improvising outside this flow.
---

# Port one Reference feature

The Reference app (the licensed Laravel product) is no longer in the repo. Never copy its code, views, assets,
copy-deck, or migrations. The inventory entry and its wiring map are the spec; this repo's rules are the constraints. One feature per branch, one PR, about a day of work. If it is bigger, split the entry in the inventory
first (new ids continue the numbering) and port the pieces.

## 0. Preflight (do all of these, in order)

1. **Pick and read the spec.** Invoke `threadwise-feature-lookup`: `find_feature.py TW-XXX-NNN`. Read the entry, its
   domain's **Data model** and **Cross-domain contracts**, and every feature under **Depends on**. Also read
   `docs/threadwise-port/port-map/<domain>.md` (target home, tables, foundation prerequisites).
   No id yet? `python3 .claude/skills/threadwise-parity-tracker/scripts/tracker.py summary --owner <you>` and take the
   next `todo` in your domain whose dependencies are `done`/`verified`.
2. **Dependencies ready?** Every depended-on feature `done`, or a shim inside your own zone
   (`modules/<domain>/_shims/`) and your row marked `blocked` with the id you wait for. Kernel gap → kernel protocol in
   `threadwise-ownership-guard`, never patch the kernel from a feature PR.
3. **Ownership.** The feature's domain must be yours (`ownership.json`). Not yours → stop and ask the owner.
4. **Branch.** `git fetch && git rebase origin/main`; branch `<owner>/<domain>/<WD-id>-<slug>`.
5. **Tracker.** `tracker.py set TW-XXX-NNN in-progress`.
6. **Check the entry.** If it is wrong or thin, fix it in the inventory file now (you own your domain's file)
   before building on it.

## 1. Plan in one screen

Write down (PR description draft is fine) which of these the feature needs, then skip none silently:

| Layer                   | Invoke                                                            | Notes                                                                                              |
| ----------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Tables / columns        | `add-migration`                    | tenant shape, forced RLS, composite FKs, your `<code>` prefix, Drizzle mirror in the same commit   |
| Request/response shapes | `contracts-change`                                                | identifiers start with your code; errors in `<domain>/errors.ts`; rebuild `@crm/contracts`         |
| API module              | `new-module`                                                      | flat dir `modules/<domain>/`, audit + outbox in the same transaction, cursor pagination            |
| Permissions             | `rbac-permission`                                                 | keys `<code>.<resource>.<action>`, literal in the decorator, own migration, scope actually applied |
| Side effects / events   | `outbox-event`                                                    | `@OutboxSubscriber` once the registry exists; consumers idempotent                                 |
| Background / schedules  | `worker-job`                                                      | worker module in your dir; queue `<code>-<purpose>`; per-job tenant + request context              |
| Vendor / channel        | `threadwise-channel-port` → `provider-adapter`, `webhook-handler` | port + adapter under `infra/providers/<domain>/`                                                   |
| Settings / plan limits  | the domain's settings module                                      | Reference plan-feature keys map to plan gating (kernel item, check `port-map`)                     |
| Web screens             | `threadwise-frontend-port` → `frontend-api-call`                  | route group + feature folder in your zone only                                                     |
| Help guide              | `help-docs-sync`                                                  | one guide per screen or tile you add, gated like the screen; the coverage gate fails without it    |
| Tests                   | `threadwise-e2e-tests`                                            | one test per acceptance criterion                                                                  |
| Docs                    | `docs/api/<domain>.md`                                            | request/response samples per endpoint (replaces the frozen shared api docs)                        |

## 2. Build, in this order (vertical slice, each step compiles and is testable before the next)

1. Migration + Drizzle mirror → `pnpm db:migrate` → `check-rls.sh <tables>` (from `add-migration`).
2. Contracts → `pnpm --filter @crm/contracts build`.
3. Repository/service/controller/mapper per `new-module`; permission + audit + outbox per their skills.
4. Worker/provider pieces if any, each with a test that runs the job/handler against fixtures.
5. Web screens last, against the real API.

Rules while building: a Reference quirk that looks like a bug is recorded (`QUIRK:` in the entry) and either
reproduced deliberately or fixed deliberately with a note; never both silently. No copied code or text. Money is
`numeric` strings; every mutating route takes `rowVersion` where the entity is mutable; hard delete + audit; no
offset pagination. Do not touch files outside your zones; run `ownership_check.py` as you go.

## 3. Prove it

1. `threadwise-e2e-tests`: automated tests covering every Given/When/Then in the entry (add missing criteria to the entry).
2. `help-docs-sync`: **automatic**. Write the Help guide for every screen, Settings tile and plan feature this feature adds (`features/<domain>/help/*.md`), or record why not in `help-center/pending.json`; the coverage test in `pnpm test` fails otherwise.
3. `bash .claude/skills/pre-pr/scripts/gate.sh`, `python3 .claude/skills/threadwise-ownership-guard/scripts/ownership_check.py`,
4. Open the PR via `pre-pr`. Description: TW ids, acceptance-criteria checklist, intentional
   deviations from the spec and why, follow-ups.

## 4. Close

`tracker.py set TW-XXX-NNN done --pr <n>` in the same PR. If a related feature
turned out to be missing from the inventory, add it (next id) rather than building it unrecorded.

## Definition of done

- [ ] every acceptance criterion has an automated test that passes; gate script green
- [ ] RLS verified by script on every new table; no cross-tenant path
- [ ] behavior checked against the entry and its wiring map; differences listed and intentional
- [ ] a Help guide exists for every screen, tile and plan feature added (or a `pending.json` entry with owner and reason)
- [ ] inventory entry, `docs/api/<domain>.md`, tracker row updated in this PR
- [ ] ownership check clean (only your zones, seams edited per policy)
- [ ] no Reference code, assets or text copied
