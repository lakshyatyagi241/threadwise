# Reference port: rules

Binding for every person and every Claude Code session that builds a Reference feature in `crm-platform`.
If a skill or older doc says something different about **features** or **UI**, this file wins. Everything else
(RLS, tenancy, ownership zones, branches, gate) stays as in [CONTRIBUTING.md](../../CONTRIBUTING.md) and
[conflict-map.md](conflict-map.md) section 5.

## 0. The one-line rule

**Same product, new engine.** A Reference user must not be able to tell a feature changed: same behavior, same screens, same
flows. Only the implementation changes (our stack, our architecture, our wiring).

## 1. The reference

- The running reference is the source of truth for behavior: <http://127.0.0.1:8000> (`threadwise-run-reference`). Admin
  `test@example.com`, workspace user created through `/register`.
- Order of evidence when they disagree: **running reference** > its source (`reference/app`) > inventory entry
  (`docs/threadwise-port/inventory`) > docs. If the inventory is wrong, fix the inventory in the same PR.
- Read the feature's inventory entry (`threadwise-feature-lookup`) and open the screen in the reference **before** writing code.
  Never port from memory of how Reference "probably" works.
- The reference is read-only. Never edit it.

## 2. Features do not change (parity contract)

A feature is ported when all of these hold, and not before:

1. **Same inputs and rules.** Every field, validation rule, limit, default, enum value, status transition, permission check,
   plan gate, rounding, ordering, filter, sort, search and bulk action works as in Reference.
2. **Same outputs.** Same messages sent, same emails, same notifications, same exports (columns, order, format), same totals
   and counters, same empty/loading/error states.
3. **Same edge cases.** Boundaries, duplicates, concurrent edits, double submit, permission denied, plan limit reached,
   channel disconnected. Verified on both apps by `threadwise-playwright-parity`.
4. **No dropped features, no extra features.** Do not remove, merge, rename, "simplify" or "improve" behavior. Do not add
   behavior Reference does not have.
5. **Allowed deviations are only:** (a) a documented bug fix where Reference is plainly wrong, (b) something our architecture
   forces (cursor pagination instead of page numbers, uuid ids, server-side sessions, tenant isolation), (c) a security
   hardening. Each one is written down in `docs/threadwise-port/parity/<domain>.md` as `intended`, with the reason, and approved
   by the domain owner. Anything undocumented is a defect.
6. Not provable here (needs a live WhatsApp session, a real payment, a real provider)? Say so in the parity file, test the
   adapter against the provider's sandbox or a recorded fixture, never claim it verified.

## 3. UI is the same

Goal: a side-by-side of the reference screen and ours looks and behaves the same.

**Match:** page structure, layout, navigation and menu order, information hierarchy, field order and labels, button names,
table columns, filters, tabs, modals, wizard steps, toasts, empty states, colors, spacing rhythm, typography feel, icon
meaning, responsive breakpoints, keyboard behavior, dark/light behavior, RTL.

**Rewrite in our stack, not a paste.** Per the root `CLAUDE.md` (project owner holds the Reference licence and authorised using
its source directly as the reference): read the Laravel code, views, JS/CSS, migrations and docs, and port them into React +
TypeScript + Tailwind via `@crm/ui` tokens and components, same behavior, same data model, same screens and flows, same copy
where it fits. Translate the logic into our conventions; do not drop Laravel, PHP or Blade code into `crm-platform/`. Do not
publish the Reference source outside the project. Branding is a theme token, never hard-coded.

If `@crm/ui` lacks a component the screen needs, add it to `@crm/ui` once (kernel change, K4 steward), reuse it everywhere.
No private design system per domain.

## 4. Stack mapping (Reference -> ours)

| Reference (reference)                        | Ours                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Laravel controllers, services, jobs       | NestJS module: controller / service / repository / mapper, BullMQ job in the worker (`new-module`, `worker-job`)  |
| Blade + Alpine/vanilla JS                 | Next.js App Router, server components by default, client components only for interactivity; Tailwind; `@crm/ui`   |
| MySQL, auto-increment ids, `workspace_id` | Postgres, bigint identity + uuid, `org_id`, forced RLS, composite FKs (`threadwise-data-model-port`, `add-migration`) |
| Eloquent events, observers, listeners     | Transactional outbox event + consumer (`outbox-event`); never a side effect after commit in a handler             |
| Laravel queue / scheduler                 | BullMQ + repeatable jobs in the `apps/api` worker                                                                 |
| Session auth, Spatie permissions          | Our auth module, `@RequirePermission('<code>.<resource>.<action>')` registered in a migration (`rbac-permission`) |
| Request validation                        | Zod schemas in `@crm/contracts`, shared by API and web (`contracts-change`)                                       |
| Third-party SDK calls inline              | Port interface + adapter per vendor (`provider-adapter`, `threadwise-channel-port`)                                   |
| Webhook controllers                       | `webhook-handler` skill: verify signature, idempotent, enqueue, ack fast                                          |
| Node/Baileys bridge                       | Open decision E in the README; until decided, behind the channel port, no direct coupling                         |
| Translations (`lang/`)                    | `next-intl`, `apps/web/messages/<lang>/<domain>.json`                                                             |
| Polling / Echo                            | Socket.IO rooms via the realtime module                                                                           |

## 5. Backend and wiring: "proper" means

1. **Contract first.** Request/response shapes live only in `@crm/contracts`. The web never redeclares a type and never
   parses an error by message text; branch on problem+json `code`.
2. **Every screen is wired to real data.** No mock data, no hard-coded lists, no `TODO` stubs, no dead buttons, no fake
   success toasts. A control that cannot work yet is `blocked` in the tracker with the feature id and is not shown as working.
3. **Full vertical slice per feature:** migration (RLS) -> repository -> service (transaction, audit + outbox in the same
   tx) -> controller (permission decorator, Idempotency-Key on mutations, `rowVersion` on updates) -> contract -> web page
   (typed client, loading/empty/error states) -> worker job if async -> tests. Partial slices are not "done".
4. **Tenant scoping and RBAC on every route.** Goes through `DatabaseService.tx()`; the UI hides what the user cannot do, the
   server is the authority.
5. **Errors:** validate at every trust boundary, no swallowed exceptions, fail closed, retries with idempotency, timeouts on
   all external I/O.
6. **Money, messaging, auth paths** get a runnable test that fails if the logic breaks.
7. **Cross-domain calls** only through the other domain's barrel or the outbox. Hook into AUTH (`SendPolicyService`,
   `EmergencyHaltService`, `PlanFeatureGate`) where the README lists it.
8. **Dead weight:** no unused code, flags or speculative config left in the files you touch.

## 6. Definition of done (per feature)

Run in order. All must pass; record each in the tracker (`threadwise-parity-tracker`).

1. Inventory entry read; every acceptance criterion maps to a named test (`threadwise-e2e-tests`).
2. Backend slice and web slice built per section 5; migration checked with the RLS checker.
3. `threadwise-playwright-parity` run on reference vs ours: every difference is `same`, `intended` (documented) or fixed. Stamp
   recorded. Do not skip without the user's explicit word.
4. `python3 .claude/skills/threadwise-ownership-guard/scripts/ownership_check.py` clean.
5. `bash .claude/skills/pre-pr/scripts/gate.sh`, plus `pnpm domains:check` and `pnpm db:lint`, green.
6. Parity notes written in `docs/threadwise-port/parity/<domain>.md`: intended differences, what is not verified, why.

## 7. Wiring maps: nothing is lost between screens

A feature is more than its screen. Each one has an upstream (jobs, events, schedule, settings that feed it) and downstream
consumers (other screens, middleware, emails, API, plan gates that read it). Losing a consumer silently breaks a feature that
"looks ported". So:

- `docs/threadwise-port/wiring/*.md` lists, per feature, route, permission, tables, settings, feeders and consumers. Read the
  entry before building; the inventory alone is not enough.
- Port **every row** of the entry: the screen, each consumer, each enforcement point. A feature is `done` only when all rows
  are ported or explicitly `blocked`/`intended` in the tracker.
- Found a feature, setting, route or consumer that no wiring file lists? Add it (new `WIRE-*` id) in the same PR. The wiring
  files are living documents and are corrected when the reference proves them wrong.
- Settings: every setting key that is exposed to admins has a reader in our code. A setting with no reader is a lost feature.
- Hard rule for all chats: do not weaken, skip or reinterpret this file because a task seems small or urgent. Only the human
  can waive a rule, in words, per case.

## 8. Process

- One feature per branch/PR: `<owner>/<domain>/<WD-id>-<slug>`; stay in your ownership zones.
- **Branch and PR flow (Punya, set 2026-10-02):** work module by module, feature by feature, all on ONE branch,
  `punya/punyafix`, pushed to `origin` after every commit. Never create another branch and never commit to `main`. One PR from
  `punya/punyafix` into `main`, with Lakshya (`lakshyatyagi241`) as reviewer, always. See the root `README.md`
  ("Punya's branch and PR workflow").
- Punya's modules: channel-facebook, channel-instagram, channel-telegram, channel-tiktok, channel-line, channel-wechat,
  channel-viber, channel-sms, channel-email, shopify-woocommerce, broadcasts, campaigns. `ownership.json` is the source for
  zones; if it disagrees with this list, fix `assignment-input.json` and regenerate (see README), do not edit around it.
- Commit and push to `punya/punyafix` as the workflow above says; never force-push, never push to `main`.
- Never copy secrets, licence keys or the contents of `Threadwise/.env` anywhere.
- Never run reference migrations or seeders against any database except the local `threadwise-ref-mariadb`.
