# Spec: Marketplace (Mini apps and Integrations)

| | |
| --- | --- |
| **Status** | Draft for owner review |
| **Author** | Drafted with Claude Code from the owner's brief and a read-only survey of the repo |
| **Related** | `docs/specs/email-channel-and-social-leads.md` (the lead pipeline this spec feeds), `docs/threadwise-port/inventory/addons-extension-registry.md` (Reference's add-on and extension system), `docs/api/whatsapp-providers.md` (admin-configurable provider precedent), `docs/runbooks/google-calendar-setup.md` (OAuth precedent), `docs/threadwise-port/parity/product-extensions.md` |

---

## 1. Problem statement

Every business wants a slightly different product: one needs leads from IndiaMART and JustDial, another needs Tally accounting export, another wants a custom quoting widget inside the contact screen. Today the only ways to get this are (a) we build it into the core, which makes the core huge and slow to change, or (b) a developer edits the code. Neither scales, and neither lets other developers or agencies contribute.

Reference's answer is a **code add-on system**: a super-admin uploads a ZIP that is unpacked and loaded **inside** the application process (the "Extensions" page), plus billing add-ons. That works for a single-tenant, self-hosted install the owner controls. It is not safe for a multi-tenant SaaS: an uploaded package runs with full access to every tenant's data. It also has no catalogue, no review, no per-workspace install, and no way for a small business owner to browse and add something themselves.

**Who is affected:** workspace admins (cannot extend the product themselves), our own team (every integration request becomes a core feature), and potential partners and agencies (nowhere to publish).

**Cost of not solving:** the core grows with long-tail requests (the owner's example: JustDial, IndiaMART, 99acres, Shiksha), small businesses leave for tools that have an app store, and we cannot build an ecosystem.

## 2. Vision

A **Marketplace** where a workspace admin can browse, install, configure and remove two kinds of things, in two tabs:

1. **Mini apps**: extend the product itself. Built by our team or by third parties. Examples: a custom quote widget on the contact screen, an EMI calculator, a "birthday greeter" automation, a lead-scoring panel, a booking add-on.
2. **Integrations**: connect an outside service. Examples: lead portals (JustDial, IndiaMART, 99acres, MagicBricks, Housing.com, Shiksha, Collegedunia), telephony (Exotel, Knowlarity), accounting (Tally, Zoho Books), payments, Slack, Google, Zapier/Make.

Both are organised by **categories** and both are **installed per workspace**, so one customer's choices never affect another's.

## 3. Goals

1. A workspace admin finds and connects a common integration in **under 3 minutes without a developer**.
2. Adding a new **lead-portal integration costs us days, not weeks** (a declarative recipe plus a small adapter, not a new module per portal).
3. A third-party developer can **build, test and publish a mini app** without touching our codebase and **without being able to read other tenants' data**.
4. Everything installed is **permissioned, auditable, revocable**: the admin sees exactly what an app can access, and uninstalling removes access immediately.
5. The platform operator controls the catalogue (approve, feature, hide, kill-switch, price) from the admin console, in the same spirit as the WhatsApp provider registry.

## 4. Non-goals (v1)

| Not in scope | Why |
| --- | --- |
| Running arbitrary third-party code inside our API process (Reference's ZIP-loader model) for tenants | Unsafe in a multi-tenant SaaS. Third-party mini apps run out of process (see 6.2). The existing ZIP installer stays an operator-only tool for first-party packages. |
| A public revenue-share payments system for paid third-party apps | Needs legal, tax and payout work. v1 supports free apps and first-party paid add-ons through the existing billing add-ons; third-party paid apps are phase 4. |
| Building every portal ourselves up front | We build the framework plus a prioritised first set; demand decides the rest, and partners can add more (see 7). |
| A mobile app store | Web catalogue only. |
| Auto-updating third-party apps without admin visibility | Permission increases always need a new consent. |
| White-label marketplaces for resellers | Later; the catalogue is platform-wide first. |

---

## 5. Users and user stories

Personas: **Workspace admin**, **Agent / end user**, **Developer (our team or a partner)**, **Platform operator**.

### Workspace admin
1. I want to browse the Marketplace by category and search, so I can find what I need without asking support.
2. I want to see, before installing, what an app can read and do, what it costs, who built it and what changed in the last version, so I can trust it.
3. I want to install an integration with a guided setup (sign in, paste a key or copy a webhook URL), and see whether it is healthy afterwards.
4. I want to disconnect or uninstall an app and know its access ends immediately, and what happens to the data it created.
5. I want to ask for an integration that is not listed (and see that others asked for it too).
6. I want to control **who in my team may install or configure apps**.

### Agent
7. I want installed mini apps to show up where they are useful (a panel on the contact, a button in the inbox, a new action in automations) without extra setup.

### Developer
8. I want a clear manifest format, a sandbox workspace, API docs and webhook testing tools, so I can build and test an app myself.
9. I want to submit a version for review, see the decision and the reasons, and ship updates.
10. I want to build a **lead-portal integration as a recipe** (auth, endpoint, field mapping) rather than writing a full service.

### Platform operator
11. I want to review submissions, approve, reject, feature, hide or **kill** an app (and every installation of it) instantly.
12. I want to set which categories exist, which apps are first-party, pricing, and plan gating, and see usage and errors per app.

---

## 6. Product decisions

### 6.1 Two tabs, categories under each

```
Marketplace
 ├─ Mini apps        (extend the product)
 │    Categories: Sales tools · Contacts and data · Inbox and chat · Automation · Reporting · Booking and payments · Industry packs · Utilities
 └─ Integrations     (connect outside services)
      Categories: Lead sources · Ads and social · Telephony · Messaging and email · Payments · Accounting and finance ·
                  E-commerce · Calendar and meetings · Productivity · Marketing · Support · Automation (Zapier/Make/webhooks) · Developer tools
```

Each tab has a category list, search, an "Installed" filter, "Popular" and "New" shelves, and a **Request an integration** box (stored and counted, so demand is visible to the operator). An app page shows description, screenshots, permissions requested, pricing, version and changelog, developer and support link, and a rating (phase 3).

**Where it lives:** a Marketplace entry in the top bar and in Settings > Integrations, route `/marketplace` (tabs `/marketplace/apps` and `/marketplace/integrations`), and a "Manage" page per installed item. The Settings hub tiles that are "Soon" today (`integrations`, `rest-api`, `webhooks`) become entries inside it or link to it. Per the repo's gear pattern, screens that an installed app affects show the gear shortcut for admins.

### 6.2 What a "mini app" is (and how it is allowed to run)

Two kinds, same catalogue, same install flow:

| | **First-party mini app** | **Third-party mini app** |
| --- | --- | --- |
| Built by | Our team | Partners and agencies |
| Runs | In our codebase as a module behind a registry and plan gate (the existing module-gate pattern) | **Out of process**: hosted by the developer; talks to us only through the public API, OAuth and webhooks |
| UI | Native screens | Embedded in a sandboxed iframe at defined **surfaces** |
| Data access | Normal service layer | Only through scopes the admin granted |

**Surfaces** a mini app can extend (declared in its manifest, each opt-in): a panel on the contact and deal pages; a tab in the inbox side pane; a settings page under the app's own entry; a top-level page (iframe); **automation building blocks** (a trigger or an action a flow can use, so apps extend the automation engine instead of replacing it); a button or bulk action on lists; a custom field type; a dashboard widget; incoming and outgoing **webhooks**.

**Why not Reference's in-process ZIP model for tenants:** one bad package could read or corrupt every tenant's rows. The existing extension installer remains for first-party packages and for single-tenant (self-hosted, white-label) installs where the operator is the only tenant owner. Whether to keep it enabled on the multi-tenant SaaS is an open question (see 10).

### 6.3 What an "integration" is: connector types

Most integrations are variations of five mechanisms, so we build **five connector types** and describe each integration as data (a *recipe*), not as code:

| Connector type | How it works | Examples |
| --- | --- | --- |
| **OAuth** | Admin signs in; we store the refresh token sealed | Google, Microsoft, Slack, HubSpot, Zoho |
| **API key (push in)** | Portal pushes leads to our webhook URL with a token | IndiaMART push, JustDial, 99acres (mechanism per portal to be confirmed) |
| **API key (pull)** | We poll the portal's API with the customer's key on a schedule | IndiaMART CRM key, many Indian portals |
| **Email-parse** | Portal sends lead alerts by email; we read the mailbox and parse them with a template | JustDial, 99acres, MagicBricks, Housing.com, Shiksha when no API is offered (depends on the Email channel spec) |
| **Webhook relay** | Zapier / Make / any tool posts to a workspace webhook | Everything else |

A **recipe** declares: name, category, logo, connector type, auth fields (sealed, write-only), endpoints or parser template, field mapping to our lead and contact fields, polling interval, rate limits, error mapping, setup instructions, and test payloads. Adding a portal means writing and testing a recipe plus, where a portal is unusual, a small adapter, which is what makes "build all of them" affordable.

**Integrations are the doors; the lead pipeline is the room.** Every lead-source integration ends in the single lead pipeline defined in `email-channel-and-social-leads.md` (receive, idempotency on `(source, external_id)`, field mapping, dedupe, attribution, deal, assignment, notification, automation hook). That spec's "Social leads channel" becomes the first inhabitants of this catalogue (Meta lead forms, generic webhook, TikTok, LinkedIn).

### 6.4 The lead-portal question: do we build JustDial, IndiaMART, 99acres, Shiksha?

**Yes, as a category, in a staged way.** Reasons: these portals are where Indian small businesses get most leads; a lead arriving late loses the sale; and a bundled tool that captures them is a clear selling point. How:

1. Build the **framework and the five connector types first**; ship a small, high-value first set: **IndiaMART, JustDial, 99acres, MagicBricks, Housing.com, Sulekha, TradeIndia, Shiksha, Collegedunia** (final list set by customer demand; verify each portal's real mechanism before committing: push webhook, pull API, partner API or email alert).
2. For portals with **no usable API**, the email-parse connector makes them work today (the customer forwards alert emails to a connected mailbox; a parser template extracts name, phone, requirement).
3. Group them by customer type through categories and **industry packs**: *Real estate pack* (99acres, MagicBricks, Housing.com, NoBroker + property fields and a site-visit pipeline), *Education pack* (Shiksha, Collegedunia + admissions pipeline), *Trade pack* (IndiaMART, TradeIndia, JustDial).
4. Anything else is handled by the **Request** button, the generic webhook, and partner-built recipes.

Legal and partner terms differ per portal (some require a signed partner agreement or whitelisted IPs): that is a per-connector checklist item, not a blocker for the framework.

### 6.5 Permissions, consent and trust

- **Scopes:** a small, documented set (read contacts, write contacts, read conversations, send messages, read deals, write deals, manage webhooks, read analytics, ...) mapped onto our existing permission keys. An app declares what it needs; the admin sees it in plain words and consents. A new version that asks for more scopes requires **re-consent**.
- **Per-install identity:** every installation has its own credentials and its own audit trail; an app acts as an **app actor** (distinct from users and from API keys) so logs and rate limits are clear.
- **Install permission:** a new permission `market.apps.install` and `market.apps.manage` (workspace) and `platform.market.review` / `platform.market.manage` (operator), granted the repo way.
- **Tenant isolation:** every new table is under forced RLS; third-party apps never receive tenant data except through the API with that tenant's token; webhook payloads are signed; iframes are sandboxed with a strict content security policy and a postMessage bridge for context (no cookies).
- **Secrets:** sealed, write-only, shown as "set, ends in ####", rotated on reinstall; the app cannot read other installs' secrets.
- **Review for third-party apps:** automated checks (manifest valid, scopes justified, endpoints reachable, no mixed content) plus a human review before listing; a **kill switch** disables an app everywhere in one action.
- **Data on uninstall:** the admin chooses to keep or delete data the app created; access is revoked at once; webhooks stop.
- **India data-protection:** a data-processing disclosure on each app page and a deletion path, aligned with the DPDP Act.

### 6.6 Pricing and plans

v1: free apps and integrations, **plan-gated** categories, and **first-party paid add-ons** reusing the existing billing add-on mechanism (a package of type add-on with grants, purchased through checkout, merged into effective plan limits). Third-party paid apps and revenue share come in phase 4 after legal review. A workspace-level cap on installed apps can be a plan limit.

### 6.7 Relationship to what exists

- **`addons-extension-registry` (domain ADD):** already has the module loader, manifest contract (`extension.json`), installer, module registry and gate, billing add-ons and entitlement merge. We **reuse** the manifest ideas, the registry and gate for first-party mini apps, and the billing add-on engine; we **add** the catalogue, per-workspace installation, scopes and the out-of-process model. The upload-ZIP page stays operator-only.
- **`integrations` domain (HubSpot, Slack, Trello, Google, inbound and outbound webhooks):** schema tables exist but no module; those become the first **OAuth** and **webhook** integrations in the catalogue, and `incoming_webhooks` is the webhook-relay backbone.
- **Public API (`/public/v1`):** the surface third-party apps use; it needs OAuth app credentials and scopes beyond today's API-key plus HMAC, and an API-key issuing screen (none exists yet).
- **WhatsApp provider registry:** the model for operator-managed catalogues, sealed credentials and "test connection".
- **Automation (flow runtime, being built on another branch):** apps contribute triggers and actions to it; this spec depends on its node registry having an extension point.

---

## 7. Requirements

### P0 (v1: the marketplace and first integrations)

**M-01 Catalogue.** Tables for apps and versions (platform-owned), with kind (`mini_app` | `integration`), category, status (`draft`, `in_review`, `published`, `hidden`, `killed`), manifest, listing content, first-party flag, plan gate.
- Given a published app, then it appears in its tab and category and in search; a hidden or killed app does not.

**M-02 Marketplace UI.** `/marketplace` with the two tabs, category list, search, Installed filter, Popular/New shelves, app detail page, and the **Request an integration** form (stored, deduplicated, counted).

**M-03 Per-workspace installation.** `workspace_app_installations` (forced RLS) with status, installed version, granted scopes, config, health, installed by.
- Given an admin installs an app, when they confirm the permission list, then an installation exists, credentials are issued, and an audit row and outbox event are written.
- Given uninstall, then access is revoked in the same transaction and the choice about the app's data is recorded.

**M-04 Scopes and consent.** The scope list, the consent screen, re-consent on scope increase, and enforcement in the API layer (an app token can never exceed its granted scopes).

**M-05 Connector framework.** The five connector types (6.3) with recipes stored as data, sealed credentials, a shared worker for pull connectors (queue and schedule per connection), signed inbound endpoints for push, health and last-error per connection, and a **test connection** and **send sample lead** action.

**M-06 Lead-source category end to end.** Every lead-source connector writes through the lead pipeline (L-01..L-10 in the other spec). First set of recipes: **IndiaMART, JustDial, 99acres, MagicBricks, Housing.com, Shiksha** (mechanism verified per portal before build) plus the generic webhook and Meta lead forms.

**M-07 First-party mini apps (2 to 3 examples).** Proves the model: e.g. a quote/proposal panel on the deal, a lead-scoring panel, and a birthday-greeting automation. They use the same registry, install and permission flow as third-party apps.

**M-08 Operator console.** Catalogue management (create and edit listings, approve, hide, kill, feature), category management, requests report, usage and error counts per app, and the per-provider credentials for platform OAuth apps (same console pattern as the existing provider settings).

**M-09 Permissions and plans.** Permission keys in M-03/6.5, plan feature `marketplace` and limit `installed_apps`; locked state with upgrade prompt.

**M-10 Security baseline.** RLS on all tables; sealed secrets; signed webhooks; rate limits per app actor; audit of install, scope change, uninstall and every app-originated write; kill switch effective within one minute.

**M-11 Docs.** Public developer docs: manifest reference, scopes, webhooks, sample app, and a recipe guide for lead portals.

### P1

- **M-12 Third-party mini apps (out-of-process).** Developer accounts, OAuth for apps, iframe surfaces with a postMessage bridge, app-contributed automation triggers and actions, signed outbound webhooks with retries.
- **M-13 Developer portal.** Create app, manifest editor, sandbox workspace with seed data, webhook tester, logs, submission and review status.
- **M-14 Review workflow.** Automated checks plus human review queue, rejection reasons, version history, staged rollout.
- **M-15 More lead portals and industry packs** (Real estate, Education, Trade) and the email-parse templates.
- **M-16 Request voting** and an operator "most requested" list that drives the build order.
- **M-17 Installed-app health dashboard** for admins and alerts when a connection fails (token expired, portal changed format).

### P2 (design for, do not build now)

- Paid third-party apps, revenue share and payouts; ratings and reviews; app analytics for developers; reseller white-label catalogues; app bundles; in-app purchases; self-serve recipe builder UI for non-developers; auto-generated connectors from OpenAPI; mobile surfaces.

---

## 8. Success metrics

| Type | Metric | Target |
| --- | --- | --- |
| Leading | Time from opening a listing to a working connection | Median < 3 minutes (integrations) |
| Leading | Install completion rate (start to healthy) | >= 80% |
| Leading | Share of installed connections still healthy after 7 days | >= 95% |
| Leading | Median engineering time to add a new lead-portal recipe | <= 3 days |
| Leading | Number of integrations in the catalogue | 15 at P0 end, 40 by month 6 |
| Lagging | Workspaces with at least one installed app or integration | 40% of active workspaces |
| Lagging | Share of lead-sourced contacts arriving through a marketplace connector | Tracked; target set after beta |
| Lagging | Support tickets about "how do I connect X" | Down 30% |
| Lagging | Third-party mini apps published | 5 in the first 6 months after P1 |
| Lagging | Security incidents attributable to apps | 0 |

Measurement: install funnel events, per-connection health from the connector framework, nightly reconciliation counts for lead sources, request counts per portal.

---

## 9. Phased delivery plan

| Phase | Scope | Size | Depends on |
| --- | --- | --- | --- |
| **0. Foundations** | Decisions (section 10); inventory and wiring for a new `market` domain; scope model; manifest v1; decide the module boundary with `addons-extension-registry`; permission and plan-key migrations; row in `product-extensions.md` (this is an owner-requested extension; Reference has only the code-extension loader) | M | none |
| **1. Catalogue + connectors + first lead portals** | M-01..M-06, M-08..M-11 | XL | Phase 0; the lead pipeline from the other spec (L1) |
| **2. First-party mini apps** | M-07 and the surfaces they need | L | Phase 1 |
| **3. Third-party mini apps** | M-12..M-14: developer accounts, OAuth for apps, iframe surfaces, automation extension points, review workflow | XL | Phase 2; the flow runtime's node registry; public API OAuth |
| **4. Scale** | M-15..M-17, ratings, paid third-party apps | L | Phase 3; legal for payouts |

Suggested start: Phase 0, then Phase 1 in parallel with the email and lead specs (L1 and the connector framework share code, so build them as one piece of work to avoid two lead doors).

---

## 10. Open questions

**Blocking**

| # | Question | Owner |
| --- | --- | --- |
| 1 | Confirm the **out-of-process model for third-party mini apps** (iframe + API + webhooks) and that arbitrary uploaded code is never run in our API process on the multi-tenant SaaS. | Owner, Security |
| 2 | Should the existing **ZIP extension installer** stay enabled for the multi-tenant SaaS (operator-only), or only for self-hosted/white-label installs? | Owner, Engineering |
| 3 | **Which lead portals first**, and for each: the real integration mechanism (push webhook, pull API, partner API, email alert) and whether a partner agreement is needed. (Recommendation: confirm IndiaMART, JustDial, 99acres, MagicBricks, Housing.com and Shiksha with their documentation before committing dates.) | Product |
| 4 | Ownership: the `integrations` domain is assigned to Lakshya and `addons-extension-registry` to Vedant in `ownership.json`; the marketplace spans both plus CRM. Confirm owners and zones. | Team |
| 5 | Is **Marketplace a separate top-level entry** or only under Settings > Integrations? (Recommendation: top-bar entry plus the Settings tile.) | Product |

**Non-blocking**

| # | Question | Owner |
| --- | --- | --- |
| 6 | Revenue share and payout model for paid third-party apps (phase 4). | Owner, Legal, Finance |
| 7 | Can partners publish without a human review for apps that request only low-risk scopes? | Security |
| 8 | Do installed apps count against a plan limit, a price, or neither in v1? | Product |
| 9 | Should app catalogue content be translatable (en, ar, regional Indian languages)? | Product |
| 10 | Data-residency and DPDP obligations for third-party apps that store customer data on their own servers. | Legal |
| 11 | Branding: "Marketplace", "App Store" or "Apps"? | Product |

---

## 11. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| A third-party app abuses its access or leaks data | Trust and legal damage | Out-of-process model, minimal scopes, per-install tokens, audit, rate limits, human review, kill switch |
| Portal APIs change or are not offered; some require partner agreements | Connectors break or cannot be built | Recipes as data (fast to patch), email-parse fallback, health alerts, per-portal feasibility check before committing |
| Scope creep into a full developer platform | Delays | Phase gates; first-party and recipes first, third-party mini apps in phase 3 |
| Two lead doors built separately (this spec and the social-leads spec) | Duplication | Build the lead pipeline and connector framework as one deliverable (phase 1) |
| Catalogue becomes stale or low quality | Distrust | Health checks, review, deprecation flow, operator hide/kill |
| Billing add-on interplay with plan limits is confusing | Support load | Reuse the existing grants and merge rules; show effective limits on the app page |
| Overlap and ownership confusion with the existing add-ons domain | Rework | Decide the boundary in phase 0 (6.7) |
