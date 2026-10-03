# Product and engineering backlog

Proposed priorities and sizes are a starting point for the owner to adjust. "Source" says where an item came from. Ids are stable: add new items at the end of their section and never reuse an id.

Priority: **P0** next up, **P1** soon, **P2** later, **Parked** only if demand appears. Size: S (days), M (1-2 weeks), L (3-5 weeks), XL (longer).
Status: `idea`, `spec` (written, not started), `ready`, `in-progress`, `blocked`, `done`.

Specs: [email channel and social leads](specs/email-channel-and-social-leads.md), [marketplace](specs/marketplace-mini-apps-and-integrations.md).

---

## A. Email channel (spec: email-channel-and-social-leads.md)

| Id | Item | Pri | Size | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| BL-001 | Phase 0 foundations for email and leads: inventory + wiring for the `mail` domain, contract changes (`email` kind, `meta.email`, thread key, `lead_ad` deal source, `new_lead` notification), permission and plan-key migrations, `product-extensions.md` rows | P0 | M | spec | Blocking decisions in the spec, section 9 |
| BL-002 | E1: shared mailbox over IMAP/SMTP into the inbox (connect, sync, threading, contact link, reply, health, operator page) | P0 | XL | spec | Needs BL-001 |
| BL-003 | E2: Gmail and Microsoft 365 OAuth connect | P1 | L | spec | **Start Google restricted-scope verification in week 1**; long lead time |
| BL-004 | E3: personal mailboxes, channel-owner visibility rule (SQL + realtime), signatures, saved replies and email templates, default routing, SLA clocks | P1 | L | spec | Routing and SLA engines are not built yet |
| BL-005 | E4: Gmail push / Graph notifications, bounce and out-of-office detection, email on the contact timeline | P2 | M | spec | |
| BL-006 | Decide the attachment storage model (attachments table vs one message per attachment) | P0 | S | idea | Open question 6 in the spec |

## B. Social leads and lead pipeline (spec: email-channel-and-social-leads.md)

| Id | Item | Pri | Size | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| BL-010 | L1: lead pipeline core (idempotent store, mapping, dedupe, structured attribution, deal, assignment, `new_lead` notification, automation hook) + generic webhook door + Social leads settings screen | P0 | L | spec | Build together with the marketplace connector framework (BL-020) |
| BL-011 | L2: Meta lead ads (Page `leadgen` subscription, re-consent for connected Pages, reconciliation sweep, form picker) | P0 | L | spec | Meta app review for lead retrieval; submit early |
| BL-012 | Structured contact attribution (first and latest touch: platform, campaign, ad set, ad, form) | P0 | M | spec | Today only free-text `contacts.source` |
| BL-013 | Auto-assignment for contacts and deals (fixed user, team round-robin) | P1 | M | spec | Inbox assignment is manual-only today |
| BL-014 | L3: TikTok and LinkedIn native connectors, speed-to-lead first message, lead inbox with retry, backfill and "sync now" | P1 | L | spec | Needs TikTok and LinkedIn partner approvals |
| BL-015 | Public lead endpoint friendlier to Zapier/Make (token-only), API-key issuing screen | P1 | M | idea | `/public/v1/leads` needs API key + HMAC and no key-issuing UI exists |
| BL-016 | X (Twitter) profile tab, Google Ads native connector, CAPI offline conversions, per-source cost tracking | Parked | - | idea | |

## C. Marketplace: mini apps and integrations (spec: marketplace-mini-apps-and-integrations.md)

| Id | Item | Pri | Size | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| BL-020 | Phase 0: `market` domain boundary with `addons-extension-registry` and `integrations`, scope model, manifest v1, permission and plan-key migrations | P1 | M | spec | Blocking decisions in the spec, section 10 |
| BL-021 | Phase 1: catalogue, `/marketplace` with two tabs and categories, per-workspace install, scopes and consent, connector framework (OAuth, push, pull, email-parse, webhook relay), operator console, docs | P1 | XL | spec | Shares the lead pipeline (BL-010) |
| BL-022 | First lead-portal recipes: IndiaMART, JustDial, 99acres, MagicBricks, Housing.com, Shiksha (verify each portal's real mechanism and partner terms first) | P1 | L | spec | Then Sulekha, TradeIndia, Collegedunia and industry packs |
| BL-023 | Phase 2: 2 to 3 first-party mini apps on the new model (quote panel, lead-scoring panel, birthday greeting) | P2 | L | spec | |
| BL-024 | Phase 3: third-party mini apps out of process (developer accounts, OAuth for apps, iframe surfaces, automation triggers and actions, developer portal, review workflow) | P2 | XL | spec | Needs the flow runtime's node registry |
| BL-025 | Phase 4: request voting, health dashboard, ratings, paid third-party apps and payouts | Parked | L | idea | Legal and finance first |
| BL-026 | Decide whether the ZIP extension installer stays enabled on the multi-tenant SaaS | P1 | S | idea | Open question 2 in the spec |

## D. Existing features: follow-ups and verification

| Id | Item | Pri | Size | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| BL-030 | Verify WhatsApp sending and webhooks against a real Meta account and a real Interakt account (so far only a local mock) | P0 | S | blocked | Needs accounts and tokens |
| BL-031 | Verify the Google Calendar adapter against real Google (create the OAuth client, publish the app) | P0 | S | blocked | Runbook: `docs/runbooks/google-calendar-setup.md` |
| BL-032 | Look at the provider registry operator screens and the Google Calendar card in a browser | P0 | S | ready | Built and tested, never viewed by a person |
| BL-033 | WhatsApp provider registry follow-ups: template header example upload for custom providers, renew/verify token for non-Meta providers, make `billingMode` do something, expose `Retry-After` from `WabaHttp`, outbox event on token set/renew, read per-entity `can_send_message` issues again, delete the unused `/v2/webhooks/channels/:uuid` door | P2 | M | idea | From the registry and inbox-on-WABA reports |
| BL-034 | Companies follow-ups: company picker on contact and deal forms, tasks card on the company, company properties screen, Generate-brief and AI-copilot company tools (blocked on AI), Playwright twin specs, wrong "no longer exists" message shown when the list fails to load | P1 | M | ready | |
| BL-035 | Appointments follow-ups: Outlook and iCal calendar, back-fill of events after a reconnect, bookings through agents and chatbots (check availability, book, reschedule as tools) | P2 | L | idea | Tools depend on AI agents and Flows |
| BL-036 | Inbox phase 3 and beyond: routing and SLA engines, bulk actions, template sends from the composer, retention sweeps | P1 | XL | idea | See `docs/wadesk-port/plan-inbox-chat.md` |
| BL-037 | Menu: check the new grouped rail and the full-width behaviour in right-to-left, dark mode and the mobile drawer; hide operator nav entries by permission | P1 | S | ready | |
| BL-038 | Extend the per-screen settings gear (`shortcutFrom`) to the remaining Settings tiles as their screens exist (team and roles, localization, chat widget, wallet) | P2 | S | ready | |
| BL-039 | WaDesk parity (Playwright twin) runs not yet done: inbox, Settings, segments, appointments, companies, provider registry, Google Calendar | P1 | L | blocked | Needs the WaDesk reference running |

## E. Features owned by others (tracked, not started by us)

| Id | Item | Pri | Size | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| BL-040 | Flows: builder and runtime | P1 | XL | in-progress | Vishal's branch `vishal/FLR` (runtime) is open; confirm who does the builder |
| BL-041 | AI agents / AI Agent Studio | P1 | XL | idea | No inventory yet; Vedant has AI keys and admin work in progress |
| BL-042 | Calls, scheduled messages, WABA calling card and diagnostics | P1 | L | in-progress | Vishal's branches (`CALL`, `SCHED`, `waba`, `waba-v3`); not on `main` yet |
| BL-043 | Remaining WaDesk domains with no work yet (Meta Ads, forms and links, TikTok, integrations, SMS, LINE, Viber, WeChat, lead finder) | P2 | XL | idea | See `docs/wadesk-port/README.md` and `ownership.json` |

## F. Platform, quality and tooling

| Id | Item | Pri | Size | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| BL-050 | Fix `route-permission-coverage.spec.ts` on Windows (forward-slash path matching) | P1 | S | ready | Fails regardless of changes |
| BL-051 | Fix `platform-payment-gateways/lib/billing.test.ts` currency formatting (`$85.0` vs `$85`) | P2 | S | ready | Fails on `main` too |
| BL-052 | `pnpm arch:check` reports circular-dependency violations (55 at last run); the inbox/WABA/broadcasts/node-bridge cycle was reduced but not removed | P1 | M | ready | Consider moving shared tokens into leaf packages |
| BL-053 | Run the full pre-PR gate (`gate.sh`) on a clean checkout and fix what it finds | P1 | M | ready | Not run in full during this work |
| BL-054 | Update `ownership.json` for domains built here (segments, companies, realtime paths, the new registries) | P2 | S | ready | The ownership check reports new feature folders as unowned |
| BL-055 | GitHub Action that posts PR opened/merged/ready events to the team's Google Chat space, with the webhook as a repository secret; regenerate the webhook that was pasted in chat | P2 | S | idea | Offered, not built |
| BL-056 | `pnpm dev:refresh` follow-ups: make it work when its output is piped on Windows; optional pointer to the local mock Graph server | P2 | S | idea | |
| BL-057 | Seed or sample data for Companies and other new screens in the dev database | P2 | S | idea | |

## G. Lead pipeline and marketplace follow-ups (from the first build)

| Id | Item | Pri | Size | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| BL-060 | Marketplace API: expose a `pattern` for pasted keys in the setup view, the app's setup fields on the installation answer, sample payload names, and whether a connection's secret can be rotated | P1 | S | ready | The UI currently learns these only from errors or a second call |
| BL-061 | Lead sources API returns a full public webhook address (today only `hookPath`; the UI builds it from `API_PUBLIC_URL`, which must be configured) | P1 | S | ready | Also add the limit and used values to the plan-limit error so the UI can say "5 of 5" |
| BL-062 | Operator catalogue: category filter on the list API, a way to list a version's scopes before saving, reserve the listing slugs `new`, `categories`, `requests`, `usage`, and tell "no recipe" from "recipe fails the schema" | P2 | S | ready | |
| BL-063 | Pull, OAuth and email-parse connectors: make them publishable (portal recipes: IndiaMART, JustDial, 99acres, MagicBricks, Housing.com, Shiksha) after verifying each portal's real mechanism and partner terms | P1 | L | spec | Draft listings are seeded and hidden from tenants |
| BL-064 | Meta lead forms, TikTok, LinkedIn and Google Ads doors for the lead pipeline (shown as "Coming soon" in the Social leads Ads tab) | P1 | L | spec | See BL-011 and BL-014 |
| BL-065 | Rules tab for Social leads and the lead-source `Popular` shelf hides when identical to `Featured`; look at the new Marketplace, Social leads and operator screens at 390px, right-to-left and dark mode | P2 | S | ready | Built and tested, only viewed by a person in desktop light mode |
| BL-066 | Uninstall "delete data" has no consumer yet (it deletes nothing; contacts stay either way) | P2 | S | idea | |
| BL-067 | Run the Playwright parity-style check for the new screens; add wiring and parity docs for the web routes | P2 | M | blocked | No WaDesk counterpart; write twin-less e2e instead |
