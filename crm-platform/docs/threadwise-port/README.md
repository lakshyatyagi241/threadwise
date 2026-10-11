# Reference port: status and handoff

Snapshot 2026-09-30, work paused on purpose (usage limit). Everything below is on disk; nothing is committed or pushed.

Goal: rebuild every Reference (CodeCanyon Laravel + Node, v1.7.0) feature inside this monorepo (NestJS, Postgres+RLS, Drizzle,
BullMQ, Next.js) with three people (Lakshya, Vedant, Punya) working in parallel with minimal merge conflicts.
Reference is reference only: never copy its code, assets or text.

**Rules for every port: [PORTING_RULES.md](PORTING_RULES.md)** (features unchanged, same UI rebuilt on our stack, real backend wiring, definition of done).

## Where things are

| What                                                                     | Where                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace                                                                | the repo root: `reference/` (Reference, read-only), `crm-platform/` (this repo), `_work/` (manifests, tools, reports, workflow script; not in git)                      |
| Inventory format                                                         | [inventory-spec.md](inventory-spec.md)                                                                                                                                  |
| Inventory (one file per domain)                                          | [inventory/](inventory/)                                                                                                                                                |
| What the target repo already has (and lacks)                             | [target-map.md](target-map.md)                                                                                                                                          |
| Merge-conflict hotspots, skeleton PR, ownership zones, rules of the road | [conflict-map.md](conflict-map.md)                                                                                                                                      |
| Data model: every Reference table, as migrations and Drizzle             | [schema/README.md](schema/README.md)                                                                                                                                    |
| Skills (`.claude/skills/threadwise-*`)                                   | run-reference, feature-lookup, parity-tracker, ownership-guard, inventory-refresh, data-model-port, port-feature, e2e-tests, verify-parity, frontend-port, channel-port |
| Coverage report (regenerate)                                             | `python3 .claude/skills/threadwise-inventory-refresh/scripts/audit_coverage.py`                                                                                         |
| Resumable inventory workflow                                             | `_work/workflows/threadwise-inventory.mjs`                                                                                                                              |

Written so far: `parity/auth-registration-security.md`, `docs/api/auth-registration-security.md`. Not written yet: the other `port-map/`, `parity/*.md`, `docs/api/` files. Ownership is generated: edit `assignment-input.json`, run `gen_ownership.py`, then `tracker.py init --all`.

## AUTH domain (2026-10-01): built end to end, on branch `lakshya/auth/auth-domain-core`, not committed

All 49 features: 46 built backend + web (tracker `frontend-done`, with notes on the five that wait for other domains), 3 `wontfix`
(042, 048, 049). The auth design (server-side sessions, TOTP MFA, platform operators) still needs the team's approval. API reference: [docs/api/auth-registration-security.md](../api/auth-registration-security.md).
Evidence, intentional differences from Reference and what is not verified: [parity/auth-registration-security.md](parity/auth-registration-security.md).

Run it: `pnpm --filter @crm/api seed:auth` (dev users, password `Passw0rd!`), `pnpm --filter @crm/api operator:create` (platform operator),
then API on 3100, web on 3001, mail on Mailpit 58025. Tests: `pnpm --filter @crm/api test`, `test:integration`, `test:e2e`, `pnpm --filter @crm/web test`.

AUTH built beyond its own screens, so other domains can rely on it: the WhatsApp provider enforces the emergency halt and the send
guardrails at every send (pipelines only pass `screen: { bulk, source }`), the sign-up OTP has real Meta Cloud, Twilio and Node-bridge senders
with template creation, `PlanEntitlementService` and a plans catalogue exist for the PLAN domain to extend, and `WebhookSecretRegistry`
lets the integrations domain take part in the danger-zone rotation. Still open and owned elsewhere: checkout and the rest of PLAN,
the device idle-logout consumer (037), a WebKit/Safari pass and a signed-in Reference pixel review (see the parity doc).

## State at stop

62 domains planned. 26 writers finished (critic passes not run yet), 7 interrupted with partial files, 9 interrupted with no file, 20 not started.

| domain                                            | code   | state                            | features | lines |
| ------------------------------------------------- | ------ | -------------------------------- | -------- | ----- |
| install-update-licensing                          | INST   | writer done, critics pending     | 29       | 1230  |
| auth-registration-security                        | AUTH   | writer done, critics pending     | 49       | 1940  |
| workspaces-teams-tenancy                          | WSP    | writer done, critics pending     | 47       | 1939  |
| roles-permissions                                 | RBAC   | writer done, critics pending     | 37       | 1487  |
| notifications-activity-audit                      | NOTIF  | writer done, critics pending     | 45       | 1679  |
| dashboards-analytics-charts                       | DASH   | writer done, critics pending     | 54       | 1846  |
| admin-console-shell                               | ASHELL | writer done, critics pending     | 47       | 1701  |
| platform-settings-branding-storage                | SET    | writer done, critics pending     | 46       | 2075  |
| marketing-site-cms                                | CMS    | writer done, critics pending     | 53       | 2007  |
| localization-translation                          | I18N   | writer done, critics pending     | 39       | 1411  |
| addons-extension-registry                         | ADD    | writer done, critics pending     | 35       | 1214  |
| plans-subscriptions-trials                        | PLAN   | writer done, critics pending     | 28       | 1225  |
| coupons-credits-referral-currency                 | CPN    | writer done, critics pending     | 38       | 1383  |
| platform-payment-gateways                         | PAYGW  | writer done, critics pending     | 48       | 1999  |
| wallet-message-billing                            | WALLET | writer done, critics pending     | 33       | 1276  |
| bsp-billing-engine                                | BSP    | writer done, critics pending     | 21       | 854   |
| whatsapp-devices-baileys                          | WADEV  | writer done, critics pending     | 46       | 1781  |
| whatsapp-cloud-api-waba                           | WABA   | writer done, critics pending     | 57       | 2085  |
| node-bridge-runtime                               | NODE   | writer interrupted, PARTIAL file | 54       | 2284  |
| chat-conversations                                | CHAT   | writer done, critics pending     | 44       | 1674  |
| team-inbox-conversations                          | TIB1   | writer done, critics pending     | 55       | 2133  |
| team-inbox-routing-sla                            | TIB2   | writer done, critics pending     | 36       | 1244  |
| team-chat                                         | TCHAT  | writer done, critics pending     | 32       | 1163  |
| platform-support-desk                             | SUPP   | writer done, critics pending     | 46       | 1674  |
| broadcasts                                        | BCAST  | writer done, critics pending     | 43       | 1541  |
| campaigns                                         | CAMP   | writer interrupted, no file      |          |       |
| scheduled-queue-warmer                            | SCHED  | writer interrupted, PARTIAL file | 30       | 1048  |
| message-templates                                 | TPL    | writer interrupted, PARTIAL file | 50       | 1808  |
| auto-reply-keywords                               | AR     | writer done, critics pending     | 44       | 1720  |
| flow-builder-editor                               | FLB    | writer interrupted, PARTIAL file | 29       | 1036  |
| flow-runtime-engine                               | FLR    | writer interrupted, PARTIAL file | 20       | 749   |
| chatbot-widget                                    | WGT    | writer done, critics pending     | 30       | 1136  |
| forms-links-groups                                | WFL    | writer interrupted, no file      |          |       |
| calling-voice                                     | CALL   | writer interrupted, PARTIAL file | 21       | 653   |
| ai-agents-training                                | AIAG   | writer interrupted, no file      |          |       |
| ai-keys-usage-admin                               | AIADM  | writer interrupted, PARTIAL file | 10       | 372   |
| ai-copilot-lead-finder                            | AICRM  | writer interrupted, no file      |          |       |
| contacts-attributes-tags                          | CON    | writer interrupted, no file      |          |       |
| deals-pipelines                                   | DEAL   | writer interrupted, no file      |          |       |
| companies-projects-tasks                          | CTP    | written, API + web built         | 13       | 426   |
| sales-docs-proposals                              | SALES  | writer interrupted, no file      |          |       |
| invoicing                                         | INV    | writer interrupted, no file      |          |       |
| appointments-booking                              | APPT   | written, API port built          | 40       | 1021  |
| catalog-products                                  | CAT    | not started                      |          |       |
| storefront-builder                                | STORE  | not started                      |          |       |
| checkout-orders-merchant-payments                 | CHK    | not started                      |          |       |
| shopify-woocommerce                               | ECOM   | not started                      |          |       |
| channel-facebook                                  | FB     | not started                      |          |       |
| channel-instagram                                 | IG     | not started                      |          |       |
| channel-telegram                                  | TG     | not started                      |          |       |
| channel-tiktok                                    | TT     | not started                      |          |       |
| channel-line                                      | LINE   | not started                      |          |       |
| channel-wechat                                    | WECH   | not started                      |          |       |
| channel-viber                                     | VIB    | not started                      |          |       |
| channel-sms                                       | SMS    | not started                      |          |       |
| channel-email                                     | MAIL   | not started                      |          |       |
| meta-ads                                          | MADS   | not started                      |          |       |
| integrations-hubspot-slack-trello-google-webhooks | INTG   | not started                      |          |       |
| developer-rest-api-v1                             | API    | not started                      |          |       |
| mobile-app-api                                    | MOB    | not started                      |          |       |
| chrome-extension-sheets-addon                     | EXT    | not started                      |          |       |
| platform-infrastructure                           | CORE   | not started                      |          |       |

## Findings so far

Numbers are from the 26 finished domains only (42% of domains by count); the remaining 36 include the biggest ones still to come (flows, nine other channels, CRM, commerce, AI, calling).

1. **Scope is very large.** 26 domains hold 1,082 features (41k lines of spec): 353 P0, 458 P1, 271 P2; effort S 527, M 462, L 88, XL 5.
   With the inventory's own effort scale (S=1.5, M=4, L=8, XL=15 dev-days, backend+frontend+tests) that is about 3,300 dev-days for these 26
   (P0 alone about 1,500; P0+P1 about 2,800), excluding dead code and docs-only items. Extrapolated to all 62 domains it is several times that,
   which is many person-years for three people. The effort scale is an assumption, so treat it as an order of magnitude, but the conclusion
   holds: the team must cut scope (P0 plus a chosen slice of P1, skip P2) before dividing work.
2. **Reference is less than its docs.** Of 1,082 features: 904 implemented, 122 partial, 31 dead-code, 25 docs-only (advertised, no working path).
   Examples: recipients-per-broadcast plan cap is advertised but not enforced, BSP markup/alternative credit sources are docs-only, a legacy
   AuthController is dead code. The inventory also records 895 `QUIRK` notes (behavior that looks like a bug but is relied on) that each need a
   deliberate keep-or-fix decision.
3. **Inventory quality.** Zero invented paths across all coverage claims (one config-file typo). Coverage of the 33 files so far: routes 47%,
   controllers 42%, services 54%, tables 43%, views 59%, permissions 100%, node files 100%. Expected to rise as the unfinished domains land;
   a gap sweep is still needed after that. 83 routes are claimed by two domains and need one home each.
4. **The target repo is far from ready** (target-map.md). Only Contacts is a finished slice (87 routes, 31 tables, 49 permission keys, 22 enforced).
   Inbox, broadcast, billing, exams are READMEs. There is no frontend at all, no platform super-admin pool, no plans/limits, no workspace signup,
   no channel model or credential storage, no queue producers or processors, no outbox consumers, no realtime emitters, no S3/mail client.
   A foundation wave has to land before most Reference domains can.
5. **Merge conflicts are predictable and fixable** (conflict-map.md). 36 hotspots; the worst are single hand-edited lists every feature PR touches
   (`app.module.ts`, worker module, queue list, two `export *` barrels, migration numbering, committed `tsbuildinfo` files). A ~2-day skeleton PR pre-creates a shell per
   domain in every layer, switches migrations to `<timestamp>_<code>_<name>.sql`, adds decorator-based outbox/realtime registries, moves docs to per-domain/per-owner
   files and ends with a 3-branch merge drill. After it, each person edits only their own directories.
6. **Existing problem in crm-platform, unrelated to this port:** Clerk staff login takes the org slug from the request body and creates a user in any org for a valid Clerk
   identity (cross-tenant self-enrolment), it skips the deactivated-user check, and it was never agreed (Clerk was rejected earlier). Worth its own ticket.
7. Smaller target findings: new permission keys are not auto-granted to existing Admin roles (locked-role trigger), contact custom-field values are never validated,
   docs drift on seed logins and `/v1` vs `/v2`, and no HTTP-level test harness exists yet (supertest and @nestjs/testing are installed but unused).

## Decisions needed from the team lead

| #   | Decision                                                                                      | Recommendation                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| S   | **Scope cut.** What ships: P0 only, P0 + which P1, what is dropped (dead-code, docs-only, P2) | Decide before assigning; it changes every estimate                                                                                                   |
| D1  | Domain manifest: code, routeBase, owner per domain (goes in `ownership.json`)                 | Generate from this inventory; codes must be lowercase 2-12 chars and `core` is reserved (the CORE inventory domain needs another code, e.g. `infra`) |
| D2  | Migration ordering                                                                            | Timestamp + domain code (conflict-map 2.0)                                                                                                           |
| D3  | How worker jobs push to sockets                                                               | `@socket.io/redis-emitter`, in the kernel PR that adds the room registry                                                                             |
| D4  | How production Admin roles get new permission keys                                            | Kernel decision before the first permission ships to a real tenant                                                                                   |
| D5  | Platform super-admin actor kind                                                               | Decide before any admin-console domain starts (kernel change)                                                                                        |
| D6  | Which Next.js app moves into `apps/web`, Next version, i18n library                           | Needed before the web skeleton                                                                                                                       |
| D7  | GitHub settings: CODEOWNERS enforcement, up-to-date branches, merge queue                     | Turn on                                                                                                                                              |
| E   | Channel strategy: keep the unofficial WhatsApp (Baileys/QR) engine or Cloud API only          | Reference's own docs list ban risk; needs a decision either way                                                                                      |

## Next session, in order

1. **Finish the inventory.** From the repo root, run the workflow script with `Workflow({scriptPath: "<repo root>/_work/workflows/threadwise-inventory.mjs", args: {root: "<absolute path of your clone>", ...}})`.
   `resumeFromRunId` only works in the same session, so use the flags the script now supports instead:
   - `only`: domain ids to process; `skipWrite`: writers already finished (critics only); `critics`: `["A"]` to halve critic cost.
   - Writers for the 16 interrupted and 20 unstarted domains: `args = {"only": ["node-bridge-runtime", "scheduled-queue-warmer", "message-templates", "flow-builder-editor", "flow-runtime-engine", "calling-voice", "ai-keys-usage-admin", "campaigns", "forms-links-groups", "ai-agents-training", "ai-copilot-lead-finder", "contacts-attributes-tags", "deals-pipelines", "companies-projects-tasks", "sales-docs-proposals", "invoicing", "appointments-booking", "catalog-products", "storefront-builder", "checkout-orders-merchant-payments", "shopify-woocommerce", "channel-facebook", "channel-instagram", "channel-telegram", "channel-tiktok", "channel-line", "channel-wechat", "channel-viber", "channel-sms", "channel-email", "meta-ads", "integrations-hubspot-slack-trello-google-webhooks", "developer-rest-api-v1", "mobile-app-api", "chrome-extension-sheets-addon", "platform-infrastructure"], "critics": ["A"]}`. Delete the 7 partial files first (`node-bridge-runtime, scheduled-queue-warmer, message-templates, flow-builder-editor, flow-runtime-engine, calling-voice, ai-keys-usage-admin`).
   - Critics for the 26 finished domains: `args = {"only": ["install-update-licensing", "auth-registration-security", "workspaces-teams-tenancy", "roles-permissions", "notifications-activity-audit", "dashboards-analytics-charts", "admin-console-shell", "platform-settings-branding-storage", "marketing-site-cms", "localization-translation", "addons-extension-registry", "plans-subscriptions-trials", "coupons-credits-referral-currency", "platform-payment-gateways", "wallet-message-billing", "bsp-billing-engine", "whatsapp-devices-baileys", "whatsapp-cloud-api-waba", "chat-conversations", "team-inbox-conversations", "team-inbox-routing-sla", "team-chat", "platform-support-desk", "broadcasts", "auto-reply-keywords", "chatbot-widget"], "skipWrite": ["install-update-licensing", "auth-registration-security", "workspaces-teams-tenancy", "roles-permissions", "notifications-activity-audit", "dashboards-analytics-charts", "admin-console-shell", "platform-settings-branding-storage", "marketing-site-cms", "localization-translation", "addons-extension-registry", "plans-subscriptions-trials", "coupons-credits-referral-currency", "platform-payment-gateways", "wallet-message-billing", "bsp-billing-engine", "whatsapp-devices-baileys", "whatsapp-cloud-api-waba", "chat-conversations", "team-inbox-conversations", "team-inbox-routing-sla", "team-chat", "platform-support-desk", "broadcasts", "auto-reply-keywords", "chatbot-widget"], "critics": ["A"]}`.
   - Run in chunks (about 8 domains at a time) to control usage; writers are the expensive part.
2. `python3 .claude/skills/threadwise-inventory-refresh/scripts/audit_coverage.py`, then a gap sweep for orphans and double-claimed routes.
3. Decisions S, D1 to D7, E above.
4. Port-maps per domain (target home, tables, foundation prerequisites, effort in days), aggregated foundation plan (skeleton PR, web shell, operator pool, channel core, worker/outbox/realtime plumbing, storage, mailer, i18n, test harness).
5. Three-way assignment: keep coupled domains with one person, exclusive directories, balanced load, foundation sequenced first. Write `ownership.json` (schema in conflict-map section 3 and the guard skill) and `assignments.md`; run `tracker.py init --all`, then `validate`.
6. Land the skeleton PR (conflict-map section 2) before anyone starts feature work.
7. Workspace-level extras: update `.claude/skills/README.md` and `docs/skill-router.md` tables, prettier-format the new markdown before committing.
