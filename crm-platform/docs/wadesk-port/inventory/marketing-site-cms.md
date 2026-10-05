---
domain: marketing-site-cms
code: CMS
title: Marketing Site, Page Editor, Blog, Legal, FAQs, Guidebook and Announcements
wadesk_version: '1.7.0'
sources_read: 96
---

# Marketing Site, Page Editor, Blog, Legal, FAQs, Guidebook and Announcements

## Overview

This domain is everything a visitor sees before signing in, plus the platform-admin tools that manage it and two content surfaces shown inside the app.

**Public marketing site.** Five composable pages (`/`, `/features`, `/pricing`, `/about`, `/contact`), a blog (`/blog`, `/blog/{slug}`), five legal pages (`/legal/*`), `sitemap.xml` and `robots.txt`. Every text, link and colour on the five composable pages is editable at `/admin/frontend`, a WYSIWYG live editor with a draft/publish model backed by one key-value table (`frontend_content`). Sections can be hidden and reordered per page; heroes are pinned. A homepage on/off switch redirects `/` to login without touching the other pages. The public pricing cards are built from the real plans owned by PLAN; the rest of the copy is static marketing text with hardcoded defaults (which include invented statistics and testimonials that must not be ported).

**Public conversion path.** The contact form (`POST /contact`) stores a message (honeypot, optional reCAPTCHA, rate limit 6/min) and emails the support inbox; admins read it at `/admin/contact-messages`.

**Content managed by platform admins.** Blog posts (raw HTML body, featured image, tags, scheduling by future `published_at`, inline category creation), legal pages (title, dates, ordered numbered sections of HTML), pricing FAQs (placement pricing/home/both), announcements (a scheduled marquee shown in the public ticker and the signed-in app bar), and the in-app Guidebook (Markdown articles, votes and view counters). All admin screens sit behind the platform admin role and an IP allowlist; there are no granular permission keys.

**Guidebook.** Authenticated workspace users browse and search the guidebook at `/guidebook` (login required despite marketing copy calling it public), read articles and vote helpful or not helpful.

**Actors.** Super-admin/platform admin (all editors), anonymous visitor (public pages, contact form), workspace user (guidebook, announcement bar), search crawlers (sitemap, robots), mobile app (reads pages, blog, FAQ, banner through MOB endpoints that read these tables).

**Plan tiers.** None of these features are plan-gated. The only plan coupling is the public pricing page, which renders whatever packages PLAN exposes.

**Connections.** SET (site identity, SEO defaults, footer, custom code, storage, privacy URLs), AUTH (reCAPTCHA, login/register links), PLAN (public plan cards, pricing settings, checkout links, FAQ consumers), WSP/STORE (host resolution decides whether `/` is a storefront, a tenant login redirect or the marketing page), NOTIF (audit log), I18N (locale, single-language public site), MOB (content endpoints), ASHELL (admin layout, badges), SUPP (guidebook links to support; contact inbox is separate from tickets).

Port summary: platform-level tables with no tenant RLS, a small `cms` NestJS module (public read endpoints plus admin CRUD), a Next.js public route group for the site, and an admin editor in `apps/web`. See per-feature Port notes and Open questions.

## Feature index

| Id         | Feature                                                              | Status      | Priority | Effort | Depends on                                           |
| ---------- | -------------------------------------------------------------------- | ----------- | -------- | ------ | ---------------------------------------------------- |
| WD-CMS-001 | Public homepage with host routing and kill-switch                    | implemented | P0       | M      | WD-CMS-007, WD-CMS-008, WD-CMS-009, WD-CMS-028       |
| WD-CMS-002 | Public features page                                                 | implemented | P1       | S      | WD-CMS-007, WD-CMS-008, WD-CMS-009, WD-CMS-010       |
| WD-CMS-003 | Public pricing page                                                  | implemented | P0       | M      | WD-CMS-007, WD-CMS-008, WD-CMS-009, WD-CMS-010, PLAN |
| WD-CMS-004 | Public about page                                                    | implemented | P2       | S      | WD-CMS-007, WD-CMS-008, WD-CMS-009                   |
| WD-CMS-005 | Public contact page                                                  | implemented | P1       | S      | WD-CMS-006, WD-CMS-007, WD-CMS-008, WD-CMS-009       |
| WD-CMS-006 | Contact form submission and notification                             | implemented | P0       | S      | WD-CMS-005, WD-CMS-042                               |
| WD-CMS-007 | Public site layout shell (head, nav, ticker, footer, hooks)          | implemented | P0       | L      | WD-CMS-008, WD-CMS-016, WD-CMS-017                   |
| WD-CMS-008 | Editable content store (draft/published key-value with defaults)     | implemented | P0       | L      | none                                                 |
| WD-CMS-009 | Section registry, ordering and visibility                            | implemented | P1       | M      | WD-CMS-008                                           |
| WD-CMS-010 | FAQ blocks (page accordions and homepage slider)                     | implemented | P1       | M      | WD-CMS-008, WD-CMS-037                               |
| WD-CMS-011 | Public blog index                                                    | implemented | P1       | M      | WD-CMS-007, WD-CMS-029                               |
| WD-CMS-012 | Public blog post page                                                | implemented | P1       | M      | WD-CMS-011, WD-CMS-016                               |
| WD-CMS-013 | Public legal pages (Terms, Privacy, Refund, Cookies, Acceptable Use) | implemented | P0       | M      | WD-CMS-007, WD-CMS-033                               |
| WD-CMS-014 | Dynamic sitemap.xml                                                  | implemented | P1       | S      | WD-CMS-011                                           |
| WD-CMS-015 | robots.txt                                                           | implemented | P2       | S      | WD-CMS-014                                           |
| WD-CMS-016 | SEO meta block for all layouts                                       | implemented | P1       | M      | WD-CMS-008                                           |
| WD-CMS-017 | Announcement display (public ticker and in-app bar)                  | implemented | P1       | M      | WD-CMS-039, WD-CMS-040                               |
| WD-CMS-018 | Frontend live editor shell                                           | implemented | P0       | L      | WD-CMS-008, WD-CMS-009                               |
| WD-CMS-019 | Inline text editing and draft save                                   | implemented | P0       | L      | WD-CMS-018, WD-CMS-008                               |
| WD-CMS-020 | Editable link targets (nav, footer, hero CTAs)                       | implemented | P2       | S      | WD-CMS-019                                           |
| WD-CMS-021 | Theme colours and brand presets                                      | implemented | P1       | M      | WD-CMS-018, WD-CMS-007                               |
| WD-CMS-022 | Show and hide sections                                               | implemented | P1       | S      | WD-CMS-009, WD-CMS-018                               |
| WD-CMS-023 | Reorder sections (drag and drop)                                     | partial     | P1       | S      | WD-CMS-009, WD-CMS-018                               |
| WD-CMS-024 | Publish drafts                                                       | implemented | P0       | S      | WD-CMS-008                                           |
| WD-CMS-025 | Discard drafts                                                       | implemented | P1       | S      | WD-CMS-008                                           |
| WD-CMS-026 | Reset to shipped defaults (field, page, theme, site)                 | implemented | P1       | S      | WD-CMS-008                                           |
| WD-CMS-027 | Editor image upload                                                  | implemented | P2       | S      | WD-CMS-018                                           |
| WD-CMS-028 | Homepage kill-switch                                                 | implemented | P1       | S      | WD-CMS-001                                           |
| WD-CMS-029 | Admin blog post list                                                 | implemented | P1       | S      | WD-CMS-030                                           |
| WD-CMS-030 | Create and edit blog post                                            | implemented | P0       | L      | WD-CMS-029                                           |
| WD-CMS-031 | Publish or unpublish a blog post                                     | implemented | P1       | S      | WD-CMS-029                                           |
| WD-CMS-032 | Delete a blog post                                                   | implemented | P2       | S      | WD-CMS-029                                           |
| WD-CMS-033 | Admin legal pages list (self-healing)                                | implemented | P1       | S      | WD-CMS-036                                           |
| WD-CMS-034 | Edit a legal page                                                    | implemented | P0       | M      | WD-CMS-033                                           |
| WD-CMS-035 | Toggle legal page visibility                                         | implemented | P2       | S      | WD-CMS-033                                           |
| WD-CMS-036 | Legal pages seed data                                                | implemented | P1       | M      | none                                                 |
| WD-CMS-037 | Pricing FAQ list and create                                          | implemented | P1       | S      | WD-CMS-010                                           |
| WD-CMS-038 | Update, toggle and delete a pricing FAQ                              | implemented | P2       | S      | WD-CMS-037                                           |
| WD-CMS-039 | Announcements list and stats                                         | implemented | P1       | S      | WD-CMS-040                                           |
| WD-CMS-040 | Create and edit an announcement (schedule and timezone)              | implemented | P1       | M      | WD-CMS-039                                           |
| WD-CMS-041 | Toggle and delete an announcement                                    | implemented | P2       | S      | WD-CMS-039                                           |
| WD-CMS-042 | Contact inbox list, filters and search                               | implemented | P1       | S      | WD-CMS-006                                           |
| WD-CMS-043 | Contact message read state and delete                                | implemented | P2       | S      | WD-CMS-042                                           |
| WD-CMS-044 | Admin guidebook article list                                         | implemented | P1       | S      | WD-CMS-045                                           |
| WD-CMS-045 | Create and edit a guidebook article                                  | implemented | P1       | M      | WD-CMS-044                                           |
| WD-CMS-046 | Toggle publish and delete a guidebook article                        | implemented | P2       | S      | WD-CMS-044                                           |
| WD-CMS-047 | In-app guidebook browse and search                                   | implemented | P1       | M      | WD-CMS-045                                           |
| WD-CMS-048 | In-app guidebook article page                                        | implemented | P1       | S      | WD-CMS-047                                           |
| WD-CMS-049 | Guidebook helpfulness vote                                           | implemented | P2       | S      | WD-CMS-048                                           |
| WD-CMS-050 | Guidebook seed articles                                              | implemented | P2       | M      | none                                                 |
| WD-CMS-051 | Sitemap download (admin)                                             | implemented | P2       | S      | WD-CMS-014                                           |
| WD-CMS-052 | In-app data processing (DPA) information page                        | implemented | P2       | S      | I18N, AR                                             |
| WD-CMS-053 | Guidebook prototype script (dead code)                               | dead-code   | P2       | S      | WD-CMS-047                                           |

## Features

### WD-CMS-001 — Public homepage with host routing and kill-switch

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-CMS-007, WD-CMS-008, WD-CMS-009, WD-CMS-028
- **Summary:** `GET /` renders the marketing landing page (hero with a two-device chat stage, then thirteen reorderable sections). Before rendering it decides whether the host is a storefront custom domain, a white-label tenant domain or the platform domain, and honours the admin "Homepage" on/off switch. Only the homepage is switchable; every other public page keeps working when the site is off.
- **Actors & access:** Anyone (guest or logged in). No auth, no plan gate. Platform scope. Responses carry `Cache-Control: no-store` via the `NoStoreResponse` middleware (stale cached HTML would reference deleted hashed assets after a deploy).
- **UX & screens:** `resources/views/frontend/home.blade.php` inside `components/layouts/frontend.blade.php`. Pinned hero (`components/frontend/hero-home` with slot `two-device-stage`, plus `live-stream` pill inside the stage). Then sections in default order: logo-strip, manifesto, feature-broadcasts, feature-flows, feature-inbox, feature-templates, feature-connectivity, use-cases, testimonials, pricing-strip, faq, faq-slider, cta-final (13). Hero CTAs: primary defaults to the register route (or `/`), secondary defaults to `#`; both URLs are editable (`hero-home.cta1_url`, `hero-home.cta2_url`). Nav CTA switches to "Dashboard" for authenticated visitors. QUIRK: the controller doc-comment says authed users are redirected to `/home`; the code does not do that. A logged-in user opening `/` sees the marketing page.
- **Endpoints:**
  | Endpoint | Name          | Action                  | Middleware      | Request                            | Response                                                                                                          |
  | -------- | ------------- | ----------------------- | --------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
  | GET /    | frontend.home | FrontendController@home | NoStoreResponse | `?fc_edit=1` (editor preview flag) | HTML 200, or 302 to `login` (guest) / `home` (authed) when the switch is off, or storefront/tenant handling below |
- **Data:** reads `system_settings.frontend_enabled` (int, default true), `frontend_content` rows (via WD-CMS-008), active `announcements` (WD-CMS-017), `packages` (via `Package::publicPricingCards()`, PLAN), `pricing_faqs` (home/both placement, WD-CMS-010).
- **Rules & edge cases:**
  1. Order of checks: (a) if the request host resolves to a storefront (verified custom domain, storefront subdomain, or a workspace custom domain with a verified CNAME that has an enabled storefront) the storefront index is rendered instead and the marketing page never shows; this runs BEFORE the kill-switch so shops keep working when the marketing site is off. (b) else if the request is on a white-label tenant domain (`ResolveTenantDomain::isTenant()`), redirect to `/dashboard` when authenticated, else to `login`. (c) else the kill-switch.
  2. Kill-switch: when `frontend_enabled` is false and the request is not an editor preview, redirect to `home` (authed) or `login` (guest). The preview exemption is `?fc_edit=1` plus `Auth::check()` only, NOT an admin check. QUIRK: any logged-in user adding `?fc_edit=1` can see the homepage while it is disabled (they still cannot see drafts, see WD-CMS-008).
  3. `/features`, `/pricing`, `/about`, `/contact`, `/blog`, legal pages and sitemap/robots are NOT affected by the switch.
  4. The 13 sections are captured into strings and echoed in the admin-defined order, skipping hidden ones (WD-CMS-009).
  5. Default copy ships with invented marketing claims (customer logos, "240M messages", testimonials, review scores). Do not port these; ship neutral placeholders (see Port notes).
- **Async & events:** none.
- **External systems:** Tailwind CDN script and Google Fonts are loaded from the browser (see WD-CMS-007).
- **Settings:** `system_settings.frontend_enabled` (int 1/0, default on), toggled from the editor (WD-CMS-028).
- **Acceptance criteria:**
  - Given the frontend switch is on and a guest opens `/`, When the page loads, Then the hero and all visible sections render in the saved order with HTTP 200 and `Cache-Control: no-store`.
  - Given the switch is off and a guest opens `/`, When the request is made, Then the response is a redirect to the login page, and `/pricing` still returns 200.
  - Given the switch is off and an admin opens `/?fc_edit=1` while logged in, When the page loads, Then the homepage renders (editor preview) instead of redirecting.
  - Given the host is a verified storefront custom domain, When `/` is requested with the switch off, Then the storefront index is served, not a redirect.
  - Given a white-label tenant domain, When a guest opens `/`, Then they are redirected to login and never see the platform marketing page.
- **Source refs:** `app/Http/Controllers/FrontendController.php`, `routes/web.php` (public group), `resources/views/frontend/home.blade.php`, `components/frontend/hero-home.blade.php`, `two-device-stage.blade.php`, `live-stream.blade.php`, `app/Http/Middleware/NoStoreResponse.php`, `app/Http/Middleware/ResolveTenantDomain.php`, `StorefrontPublicController::storefrontForHost`, `Documentation/pages/admin-panel/frontend-editor.html`.
- **Port notes:** New: `apps/web` (or a dedicated `apps/site`) Next.js public route group with ISR disabled or short revalidate. Host resolution belongs in edge middleware and reads workspace custom-domain and storefront domain tables (WSP, STORE). The kill-switch is a platform setting (SET). Fetch CMS content server-side per request or with tag-based revalidation triggered by publish (WD-CMS-024).

### WD-CMS-002 — Public features page

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CMS-007, WD-CMS-008, WD-CMS-009, WD-CMS-010
- **Summary:** `GET /features` renders an editorial features page: hero with a chip row, logo strip, a 12-card feature bento, three pillars, a pull quote, a features-specific FAQ and a final CTA.
- **Actors & access:** Anyone; `NoStoreResponse`; not affected by the homepage kill-switch.
- **UX & screens:** `frontend/features.blade.php`, `components/frontend/hero-features` (pinned; richtext headline, jump-to anchors), then sections `logo-strip`, `feature-bento` (largest component, about 60 editable keys), `pillars-three`, `pull-quote`, `faq` (scope `features`, six default Q/A, first open), `cta-final` (headline "All eighteen. One workspace." plus kicker). Order and visibility follow WD-CMS-009. The nav item "Features" is the active one.
- **Endpoints:**
  | Endpoint      | Name              | Action                      | Middleware      | Request | Response |
  | ------------- | ----------------- | --------------------------- | --------------- | ------- | -------- |
  | GET /features | frontend.features | FrontendController@features | NoStoreResponse | none    | HTML     |
- **Data:** `frontend_content` only (keys prefixed `features.` for page-scoped values such as `features.faq.*`; component-level keys such as `feature-bento.*`, `logo-strip.*`, `pillars-three.*`, `pull-quote.*`, `hero-features.*` are shared across pages).
- **Rules & edge cases:**
  1. The features-page FAQ items are passed as props and become editable only because a `scope` is set, which stores them under `features.faq.faqN_q/a` (N is the 1-based index) independent from the homepage FAQ.
  2. The bento copy claims "all eighteen" features; this is static marketing text, not derived from any feature registry.
  3. Sections not in the saved order are appended in default position so newly added sections never disappear.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** editor drafts/publish (WD-CMS-018..026).
- **Acceptance criteria:**
  - Given no edits exist, When `/features` loads, Then all six sections render in the default order beneath the hero.
  - Given the admin hid `faq` on the features page and published, When a visitor loads `/features`, Then the FAQ is absent but still present on `/`.
  - Given a published edit to `features.faq.faq1_q`, When `/features` loads, Then the new question text is shown and the homepage FAQ question is unchanged.
- **Source refs:** `app/Http/Controllers/FrontendController.php`, `resources/views/frontend/features.blade.php`, `components/frontend/{hero-features,logo-strip,feature-bento,pillars-three,pull-quote,faq,cta-final}.blade.php`, `app/Support/fc_helpers.php`.
- **Port notes:** Model page content as a typed block list per page (section slug, order, hidden flag, per-block fields) rather than reproducing per-string keys blindly; keep key-compatibility only if importing WaDesk data.

### WD-CMS-003 — Public pricing page

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-CMS-007, WD-CMS-008, WD-CMS-009, WD-CMS-010, PLAN
- **Summary:** `GET /pricing` shows an editable hero, plan cards built from the real admin-managed packages (falling back to three shipped Starter/Pro/Scale tiers when there are none), an optional monthly/yearly toggle, a pricing FAQ and a final CTA. The authenticated upgrade page lives elsewhere (`/account/plans`, PLAN domain).
- **Actors & access:** Anyone. No plan gate. `NoStoreResponse`.
- **UX & screens:** `frontend/pricing.blade.php` with pinned hero (`pricing.hero.eyebrow/headline(richtext)/intro`), then `pricing-strip` (called with `show-header=false`), `faq` (scope `pricing`, five default Q/A, editable via fc keys), `cta-final`. `components/frontend/pricing-strip.blade.php` details: cards are 3-up on desktop; the `highlighted` plan is dark, raised and shows a badge pill; each card shows plan number, badge, name, tagline, price with period, optional overage pill, three grouped lists (Volume, Features, Support) with check/dash bullets, and a CTA link. A Monthly/Yearly switch (default state shows the yearly price, "save N%" pill) appears only when the admin enabled it AND at least one plan has a yearly price different from its monthly one; a small inline script swaps `data-monthly/data-yearly` prices and appends `?period=yearly` to checkout CTAs (not to `#` or register CTAs).
- **Endpoints:**
  | Endpoint     | Name             | Action                     | Middleware      | Request | Response |
  | ------------ | ---------------- | -------------------------- | --------------- | ------- | -------- |
  | GET /pricing | frontend.pricing | FrontendController@pricing | NoStoreResponse | none    | HTML     |
- **Data:** `packages` via `Package::publicPricingCards()` (status true, ordered by `sort_order`, `id`; each mapped by `toPricingCard` into name/tagline/price/price_yearly/period/overage/badge/highlighted/volume/features/support/cta), `system_settings` `pricing.yearly_toggle_enabled` (default true) and `pricing.yearly_discount_pct` (default 20), `frontend_content` keys `pricing-strip.*` and `pricing.*`. When there are zero packages the shipped tiers are read from `pricing-strip.tierN_*` keys (name, badge, tagline, price, period, overage, cta label, volume/feature/support lines).
- **Rules & edge cases:**
  1. Plan cards mirror the in-app `/account/plans` logic exactly (offer price, display-currency conversion, currency formatting, yearly = discounted monthly-equivalent; lifetime plans never discount; custom-quote plans show "Custom / contact sales" and link to the plan's `cta_url` or `/contact`; free plans link to register; paid plans link to `user.checkout.show`, which bounces anonymous visitors through login).
  2. QUIRK: `publicPricingCards()` queries every active package without a type filter, so add-on packages appear as cards next to plans (the mapper has add-on handling), unlike `/account/plans` which separates plans and add-ons. Confirm before porting.
  3. QUIRK: the FAQ on this page is the `faq` component driven by editor keys with hardcoded defaults; it does NOT read `pricing_faqs`, so rows with placement `pricing` never appear here (they appear on the in-app plans page and checkout).
  4. The hero, strip labels ("Pay for conversations, not seats"), meta chips and the "honest pricing" band are editable text; default copy embeds specific claims (14-day trial, no card, 20% yearly, "12 products").
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `pricing.yearly_toggle_enabled`, `pricing.yearly_discount_pct` (PLAN/checkout settings page).
- **Acceptance criteria:**
  - Given three active packages exist, When `/pricing` loads, Then exactly those three cards render in `sort_order`, using each package's real price and limits.
  - Given no packages exist, When `/pricing` loads, Then the three shipped tiers render from the editable fallback copy.
  - Given yearly toggle enabled and a plan with a distinct yearly price, When the visitor clicks Yearly, Then prices swap and each checkout CTA gains `period=yearly`.
  - Given a custom-quote plan, When the card renders, Then the CTA points to the plan's sales URL (or `/contact`), not to checkout.
- **Source refs:** `app/Http/Controllers/FrontendController.php`, `resources/views/frontend/pricing.blade.php`, `components/frontend/pricing-strip.blade.php`, `components/frontend/faq.blade.php`, `app/Models/Package.php` (`publicPricingCards`, `toPricingCard`), `resources/views/pricing/index.blade.php` (in-app, PLAN).
- **Port notes:** Expose a public, cacheable `GET /public/plans` from the PLAN module and render cards in Next.js; never duplicate pricing logic in CMS. Decide explicitly whether add-ons show. Consider driving this page's FAQ from the FAQ table (WD-CMS-037) to remove the split-brain.

### WD-CMS-004 — Public about page

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CMS-007, WD-CMS-008, WD-CMS-009
- **Summary:** `GET /about` is an editorial company page: hero, origin story, values, timeline, numbers, press mentions, backers, pull quote and a CTA. All text is editable in the live editor; nothing is data-driven.
- **Actors & access:** Anyone; `NoStoreResponse`.
- **UX & screens:** `frontend/about.blade.php`. Pinned `hero` (headline richtext) then removable sections in default order: `origin-story`, `values`, `timeline`, `numbers`, `press`, `backers`, `pull-quote`, `cta-final` (secondary CTA "Contact us" links `/contact`). About the page has roughly 59 editable keys (`about.*`). No team cards by design.
- **Endpoints:**
  | Endpoint   | Name           | Action                   | Middleware      | Request | Response |
  | ---------- | -------------- | ------------------------ | --------------- | ------- | -------- |
  | GET /about | frontend.about | FrontendController@about | NoStoreResponse | none    | HTML     |
- **Data:** `frontend_content` keys prefixed `about.`.
- **Rules & edge cases:**
  1. Sections `numbers`, `press` and `backers` ship with fabricated company facts; treat as demo content.
  2. Registry lists the section slugs; the Blade must use the same slugs or hide/reorder silently does nothing.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none beyond the editor.
- **Acceptance criteria:**
  - Given default content, When `/about` loads, Then the hero and seven sections render in the documented order.
  - Given `about.__hidden` contains `press` and is published, When `/about` loads, Then the press section is not rendered.
  - Given an admin drags `timeline` above `values` and publishes, When `/about` loads, Then timeline precedes values (see WD-CMS-023 for the reorder caveat).
- **Source refs:** `resources/views/frontend/about.blade.php`, `app/Services/Frontend/FrontendRegistry.php`, `app/Support/fc_helpers.php`.
- **Port notes:** Low value; port as a generic "content page" with blocks so it is not a special case. Do not copy the copy-deck.

### WD-CMS-005 — Public contact page

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CMS-006, WD-CMS-007, WD-CMS-008, WD-CMS-009
- **Summary:** `GET /contact` shows three contact channels (email, WhatsApp, sales), the contact form (WD-CMS-006), a "head office" block and a small FAQ. Contact details come from platform Site Settings; headings and helper text are editable.
- **Actors & access:** Anyone; `NoStoreResponse`.
- **UX & screens:** `frontend/contact.blade.php`. Pinned `hero` (richtext headline, intro, three stat pairs). Sections: `channels` (three cards), `form` (the form), `faq` (scope `contact`, five default Q/A), `cta-final`. Email card links `mailto:` with `brand_email('support')`; WhatsApp card links `https://wa.me/{site.whatsapp}` (default number is a placeholder) and displays `site.phone`; Sales card anchors to `#contact-form`. Office block appears only if at least one of company name, address, city/country, general email (fallback support email) or phone is set in Site Settings, and each line is hidden when blank. After a successful submit the page shows a "Message sent" banner (`session contact_status=success`); after validation failure it shows a generic error (or the captcha message) and keeps old input. A leftover Blade comment says the form is a preview; that is stale, the form is wired (WD-CMS-006). JS: `resources/js/charts/frontend-contact.js` only wires reCAPTCHA v3 token fetch through the shared auth helper and is a no-op when captcha is off.
- **Endpoints:**
  | Endpoint     | Name             | Action                     | Middleware      | Request | Response |
  | ------------ | ---------------- | -------------------------- | --------------- | ------- | -------- |
  | GET /contact | frontend.contact | FrontendController@contact | NoStoreResponse | none    | HTML     |
- **Data:** `frontend_content` keys `contact.*` (about 47), `system_settings` `site.company_name`, `site.address`, `site.city_country`, `site.email_general`, `site.email_support`, `site.phone`, `site.whatsapp` (managed by SET at `/admin/site-settings`).
- **Rules & edge cases:**
  1. `brand_email(prefix)` resolution: `site.email_<prefix>` else `site.email_support` else `<prefix>@<site domain or request host without www./app.>`.
  2. Form field labels, radio topic labels and the success/error copy have editable keys except the placeholders (hardcoded sample names) and the four topic option labels (translated `__()` strings only).
  3. The channels section's WhatsApp number falls back to a hardcoded sample, so a fresh install links to a fake number until Site Settings is filled in.
- **Async & events:** none on GET.
- **External systems:** Google reCAPTCHA script when enabled (auth partial `auth/_recaptcha`).
- **Settings:** SET `site.*` keys; reCAPTCHA settings (AUTH/SET).
- **Acceptance criteria:**
  - Given Site Settings has a support email, When `/contact` loads, Then the email card shows and links to that address.
  - Given Site Settings has no address/phone/company/general email, When `/contact` loads, Then the head-office block is not rendered.
  - Given the previous submit succeeded, When the redirected page loads, Then the success banner shows and the form anchor `#contact-form` is scrolled to.
- **Source refs:** `resources/views/frontend/contact.blade.php`, `resources/js/charts/frontend-contact.js`, `app/Support/fc_helpers.php` (`site_info`, `brand_email`), `resources/views/auth/_recaptcha.blade.php` (AUTH).
- **Port notes:** Site identity settings belong to SET; expose a public `GET /public/site-info` returning only non-secret keys. Remove hardcoded fake phone/WhatsApp defaults.

### WD-CMS-006 — Contact form submission and notification

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-CMS-005, WD-CMS-042
- **Summary:** `POST /contact` validates the public form, silently drops bot submissions caught by a honeypot, verifies reCAPTCHA when enabled, stores a `contact_messages` row and emails the support inbox. Redirects back to the form with a success flag.
- **Actors & access:** Anyone (guest). CSRF-protected form post. Rate limited `throttle:6,1` (6 per minute per client). No `NoStoreResponse` on the POST.
- **UX & screens:** Fields on `frontend/contact.blade.php`: name (text, required, maxlength 120), work email (required, maxlength 190), company (optional, 160), topic radios sales/support/partnership/other (optional), message (textarea, required, maxlength 5000), hidden honeypot field `website`, reCAPTCHA widget when enabled. States: success banner; generic error banner (or the captcha error text); inputs repopulated on error.
- **Endpoints:**
  | Endpoint      | Name                    | Action                   | Middleware           | Request                                                                                           | Response                                                                        |
  | ------------- | ----------------------- | ------------------------ | -------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
  | POST /contact | frontend.contact.submit | ContactController@submit | ThrottleRequests:6,1 | name, email, company, topic, message, website (honeypot), g-recaptcha-response or recaptcha_token | 302 back to `/contact#contact-form` with flash `contact_status` = success/error |
- **Data:** writes `contact_messages` (`name`, `email`, `company`, `topic`, `message`, `ip`, `user_agent` truncated to 255, `is_read` default false, timestamps). Reads `system_settings` `app_name`, `site.email_support`; falls back to `mail.from.address`.
- **Rules & edge cases:**
  1. Honeypot: if `website` is filled, respond exactly like success and store nothing (before captcha and validation).
  2. reCAPTCHA (`RecaptchaService::verify`, action `contact`) accepts the v2 token from `g-recaptcha-response` or the v3 token from `recaptcha_token`. Returns true when captcha is disabled. On failure: redirect back with input, `contact_status=error` and a `captcha` error message (fragment `#contact-form`).
  3. Validation: `name` required string max 120; `email` required email max 190; `company` nullable string max 160; `topic` nullable in `sales,support,partnership,other`; `message` required string max 5000.
  4. No dedupe or spam scoring beyond honeypot, captcha and the throttle. The same email can submit unlimited messages across throttle windows.
  5. The notification mail is sent with the raw-text mailer, To = `site.email_support` (fallback default from address), Reply-To = submitter, subject `[<brand>] Contact: <topic or enquiry> from <name>`, body lists name, email, company, topic, message. Mail failure is swallowed and written to the PHP error log; the stored message is unaffected and the visitor still sees success. If no recipient is configured nothing is sent.
  6. No confirmation email is sent to the visitor.
- **Async & events:** mail is sent synchronously inside the request (not queued). No events, no in-app notification, no audit log.
- **External systems:** Google reCAPTCHA `siteverify` (10 s timeout; any error counts as failure); SMTP via platform mail config.
- **Settings:** SET (site email), AUTH/SET (reCAPTCHA enable/keys/version/threshold), `mail.from.address`.
- **Acceptance criteria:**
  - Given valid fields and captcha disabled, When the form is posted, Then a `contact_messages` row exists with the caller IP and truncated user agent, the support inbox receives a mail with Reply-To set to the submitter, and the visitor sees the success banner.
  - Given the honeypot field is non-empty, When the form is posted, Then the visitor sees the success banner and no row is created and no mail is sent.
  - Given reCAPTCHA is enabled and the token is missing or invalid, When the form is posted, Then no row is created and the captcha error is shown with the input preserved.
  - Given seven posts within one minute from one client, When the seventh arrives, Then it is rejected with HTTP 429.
  - Given the mail server is down, When a valid form is posted, Then the row is stored and the visitor still sees success.
- **Source refs:** `app/Http/Controllers/ContactController.php`, `app/Models/ContactMessage.php`, `app/Services/RecaptchaService.php`, `routes/web.php`, `resources/views/frontend/contact.blade.php`.
- **Port notes:** New NestJS module `cms` (public controller, throttled per IP), table `contact_messages` as a platform-level (non-tenant) table WITHOUT `org_id`, so RLS policy is platform-role only. Send the notification through the outbox to the mail worker rather than inline, and add a visitor auto-reply as an optional improvement. Keep honeypot behavior (silent success).

### WD-CMS-007 — Public site layout shell (head, nav, ticker, footer, hooks)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-CMS-008, WD-CMS-016, WD-CMS-017
- **Summary:** One layout wraps every public page. It emits SEO/OG meta, JSON-LD, favicon, the Tailwind palette (built from editable theme tokens), site analytics and custom code hooks, the announcement ticker, the sticky navigation, the footer, a reveal-on-scroll observer, the live-editor bridge (admins only) and the cookie-consent UI.
- **Actors & access:** Anyone; the editor bridge only for an authenticated platform admin previewing with `?fc_edit=1`.
- **UX & screens:** `components/layouts/frontend.blade.php` props: `title`, `page` (data attribute), `navKey`, `showTicker`, `showFooter`, `description`, `metaKeywords`, `ogImage`, `ogType`, `canonical`, `noindex`, `jsonLd`. Nav (`components/frontend/nav`): logo (uploaded brand logo or SVG mark + brand name + version tag), six links (Home, Features, Pricing, Blog, About, Contact) each with editable label and URL (`nav.linkN_label/_url`; blog label/url keys exist but the blog link is hardcoded to the blog route), Sign in / Start free, or Dashboard when authenticated, mobile slide-in menu with hamburger. The locale switcher is deliberately commented out on the public site because marketing copy is not translatable per locale (see WD-CMS-008). Footer (`components/frontend/footer`): brand column (dark logo or SVG + `footer_title`), tagline (`footer.tagline`, falls back to `footer_description`), fake "System status" card with static "99.98% · 90d", Product / Company / Legal columns with editable labels and URLs, social icons only for filled `site.social_*` links (x, linkedin, instagram, youtube, facebook, github), copyright (`footer_copyright` or `(c) year brand`). Legal links default to `legal_url()` which prefers the admin Privacy-settings URLs over `/legal/*`. Custom code: when `custom_code_enabled` is on, `custom_css` is injected in head and `custom_js` before body end (platform admin content, raw). Analytics partial `partials/site-analytics` is consent-gated; cookie UI is `partials/cookie-consent` (SET/AUTH).
- **Endpoints:** none (layout).
- **Data:** `frontend_content` theme tokens, `system_settings` (`footer_*`, `custom_*`, `site.*`, `seo_*`, `app_name`, brand logo/favicon paths, privacy URLs).
- **Rules & edge cases:**
  1. Palette: 24 theme tokens (`theme.wa.*`, `theme.ink.*`, `theme.paper.*`, `theme.accent.*`) are resolved with `fc()`, then injected into the Tailwind CDN config as `colors`. The layout depends on the Tailwind CDN script at runtime (`cdn.tailwindcss.com`) and Google Fonts (Instrument Serif, Inter, JetBrains Mono). Port: build Tailwind at compile time and drive tokens with CSS variables.
  2. `<html lang>` and `dir` come from the active locale (RTL aware).
  3. `noindex` prop yields robots `noindex, nofollow`.
  4. `showTicker` and `showFooter` default true; legal pages use the default chrome; the nav highlights `navKey`.
  5. The version tag in the logo block reads `config('app.version')` (default text `v 4.2`); port should not expose the platform version.
- **Async & events:** none.
- **External systems:** Tailwind CDN, Google Fonts, analytics vendors (via SET partial).
- **Settings:** Footer settings (`footer_title`, `footer_copyright`, `footer_description`, `site.social_*`), Custom code, Privacy URLs, Brand logos (all SET).
- **Acceptance criteria:**
  - Given a published `theme.wa.deep` value, When any public page loads, Then the Tailwind config carries that value for `wa.deep`.
  - Given the visitor is logged in, When the nav renders, Then the primary CTA reads Dashboard and links to `/dashboard`.
  - Given no social URLs are set, When the footer renders, Then no social icon row appears.
  - Given custom code is enabled with CSS and JS, When a public page loads, Then both are emitted, and when disabled neither is emitted.
- **Source refs:** `resources/views/components/layouts/frontend.blade.php`, `components/frontend/{nav,footer,ticker}.blade.php`, `resources/css/frontend.css`, `app/Support/fc_helpers.php` (`legal_url`, `brand_name`), `app/Support/Brand.php`, `partials/{seo-meta,cookie-consent,site-analytics,app-font}.blade.php`, `resources/js/locale-switcher.js`.
- **Port notes:** Next.js root layout for the public group; theme tokens as CSS variables, fetched once. Keep footer/legal links resolution as a small shared util (`legalUrl(kind)`), used by checkout and auth pages too.

### WD-CMS-008 — Editable content store (draft/published key-value with defaults)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** none
- **Summary:** All editable marketing copy, links, colours and layout arrays live in one table keyed by dotted strings. Public pages call a `fc(key, default)` helper: visitors get the published value, or the shipped default when none exists; admins previewing get the draft first. This is the storage engine behind the live editor and every marketing page.
- **Actors & access:** Reads: everyone (published only). Draft reads: authenticated user for whom `isAdmin()` is true AND request has `fc_edit=1`. Writes: only through the admin editor endpoints (WD-CMS-018..027).
- **UX & screens:** none directly; keys surface in the editor inspector as the selected field's key and type.
- **Endpoints:** none (service `FrontendContentStore`, helpers `fc`, `fcp`, `fc_skey`, `fc_page`, `fc_editing`, `fc_section_order`, `fc_section_visible`).
- **Data:** table `frontend_content` (WD-CMS Data model). Key grammar for writes: regex `^[a-z0-9]+([._-][a-z0-9]+)*$` (case-insensitive), max 191. Key families: `<page>.<section>.<field>` (e.g. `home.faq.headline`), component-shared keys (`hero-home.*`, `nav.*`, `footer.*`, `pricing-strip.*`, `ticker.*`, `logo-strip.*`...), `theme.<group>.<token>`, and layout arrays `<page>.__hidden` and `<page>.__order` (type json, arrays of section slugs).
- **Rules & edge cases:**
  1. Read: row missing, or chosen value null/empty string, returns the caller's default. Draft mode returns `draft` else `published`.
  2. Types: `text` (default; may contain HTML entities because some templates print with `{!! !!}`), `json` (decoded; invalid JSON returns default), `image` (URL string). The editor's `richtext` and `color` are stored as `text`.
  3. Page scoping: `fc_page()` maps route names `frontend.home|features|pricing|about|contact` to a page slug; `fcp('faq.headline')` reads `<page>.faq.headline` so one shared component can be edited independently per page. Off those routes (for example legal pages) keys are unscoped.
  4. QUIRK (locale): on any locale other than the default `app.locale`, published TEXT values are ignored and the caller's translated default is returned instead (because the store holds one language). Consequence: theme colours and link-URL overrides (also type text) revert to shipped defaults for non-default-locale visitors; JSON layout arrays (`__hidden`, `__order`) still apply. The public site therefore has no per-locale content; the language switcher is hidden on it.
  5. Cache: the whole table is cached forever in the app cache under `frontend_content:all` and busted on every model save/delete, plus an in-request memo. Query-builder deletes bypass model events, so resets clear the cache explicitly.
  6. `setDraft` upserts by key, stores arrays as JSON, sets `updated_by` = current user id. `publish(prefix?)` copies draft over published where they differ (prefix is a LIKE on `ckey`, `%` and `_` escaped) and returns the count. `discard(prefix?)` deletes draft-only rows (never published) and resets others' draft to their published value, returning the count of changed rows. `reset(key)` deletes the row (both values) immediately.
  7. Unknown or misspelled keys are harmless: templates always pass a default.
- **Async & events:** cache bust on write; no queue.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given no row for a key, When a public page reads it, Then the shipped default is rendered.
  - Given a row with draft "B" and published "A", When a visitor reads it, Then "A" is returned; When an admin reads it with `fc_edit=1`, Then "B" is returned.
  - Given a row with published "A" and a visitor on a non-default locale, When a text key is read, Then the translated default is returned rather than "A".
  - Given a publish of prefix `home.`, When it runs, Then only rows whose `ckey` starts with `home.` change, and a key like `homeX` is untouched.
  - Given a draft with `published` null, When `discard` runs, Then the row is deleted and the default returns.
- **Source refs:** `app/Services/Frontend/FrontendContentStore.php`, `app/Models/FrontendContent.php`, `app/Support/fc_helpers.php`, `database/migrations/2026_05_30_120000_create_frontend_content_table.php`, `app/Providers/AppServiceProvider.php` (singleton binding).
- **Port notes:** Table `cms_content` (platform-level, no `org_id`; RLS not tenant-based). Consider one row per (page, block, locale) with structured JSON instead of dotted string keys; add `locale` to remove the locale quirk. Cache with tag invalidation on publish. Deny draft reads to non-admins at the API layer, not only via query string.

### WD-CMS-009 — Section registry, ordering and visibility

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CMS-008
- **Summary:** Five editable pages each expose an ordered list of named sections. Admins can hide removable sections and reorder them; heroes are pinned. The page Blades render each section from a captured string in the resolved order.
- **Actors & access:** Public rendering: everyone. Changes: platform admin via editor (WD-CMS-022, WD-CMS-023).
- **UX & screens:** No screen of its own; consumed by the editor's Sections panel and by the page Blades.
- **Endpoints:** none.
- **Data:** `frontend_content` keys `<page>.__hidden` (json array of slugs) and `<page>.__order` (json array of removable slugs). Registry (code constants): pages `home` (13 sections), `features` (7), `pricing` (4), `about` (9), `contact` (5) with labels; 33 section slugs; heroes (`hero-home`, `hero-features`, `pricing-hero`, `hero`) have `removable=false`.
- **Rules & edge cases:**
  1. `fc_section_order(page, available)`: takes the saved order, keeps only slugs that exist, then appends any available slug missing from the saved order in default position (new sections can never disappear); no saved order yields the default order.
  2. `fc_section_visible(page, slug)`: non-removable sections are always visible; otherwise hidden only when the slug is in the published `<page>.__hidden` array.
  3. QUIRK: `faq-slider` on the homepage is rendered by the Blade but is not in the registry's home section list, so it cannot be hidden or reordered from the editor (it is appended at the end of the order).
  4. QUIRK: registry lists `pricing-hero` as a pricing section but the pricing Blade's hero is pinned inline; and `hero-features`/`hero-home` etc. are identified by different slugs per page.
  5. Only the `faq` slug is reused on several pages; each page keeps independent visibility/order.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a saved order of [faq, pricing-strip] on home, When the page renders, Then faq precedes pricing-strip and all other sections follow in default order.
  - Given `home.__hidden` = [testimonials] published, When the page renders, Then testimonials is absent, and heroes still render.
  - Given a new section slug is added in code but absent from saved order, When the page renders, Then it still renders at its default position.
- **Source refs:** `app/Services/Frontend/FrontendRegistry.php`, `app/Support/fc_helpers.php`, `resources/views/frontend/{home,features,pricing,about,contact}.blade.php`.
- **Port notes:** Keep the registry as versioned code (block type catalogue) and the per-page arrays as data; validate the arrays against the catalogue on write.

### WD-CMS-010 — FAQ blocks (page accordions and homepage slider)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CMS-008, WD-CMS-037
- **Summary:** Two FAQ presentations exist. The `faq` accordion is editable copy per page (home, features, pricing, contact). The homepage `faq-slider` is a two-row infinite marquee fed from the `pricing_faqs` table using placement `home` or `both`.
- **Actors & access:** Anyone (read). Editing via WD-CMS-019 (accordion text) or WD-CMS-037/038 (slider rows).
- **UX & screens:** `components/frontend/faq.blade.php`: props `kicker`, `headline`, `subtitle`, `items`, `scope`. Left column headline/subtitle; right column a bordered list of `<details>` items (the first item open by default, plus per-item `open`). Default subtitle promises a human reply inside 4 hours and interpolates `brand_email('support')`. Without `scope` (homepage) it uses shared keys `faq.*` (`kicker_text`, `headline`, `subtitle`, `faq1_q..faq5_a`) scoped by page via `fcp`; with `scope` (features, pricing, contact) keys become `<scope>.faq.*` and items supplied by the page are editable too. `components/frontend/faq-slider.blade.php`: centered kicker, headline ("Questions, answered"), subtitle; rows split in halves (ceil), second row reversed direction, each card rendered twice for a seamless loop, hover pauses; if the second half is empty it repeats the first.
- **Endpoints:** none (embedded in pages).
- **Data:** `frontend_content` (accordion and slider titles), `pricing_faqs` where `is_active` and `placement` in (`home`, `both`), ordered by `sort_order` then `id`, selecting `question`,`answer`. When no rows match, eight built-in default Q/As render, so the slider is never empty.
- **Rules & edge cases:**
  1. Accordion answers are printed escaped (`{{ }}`), so HTML in an answer shows as text; headlines are printed raw.
  2. Slider question/answer text is plain text; answers use no markdown.
  3. QUIRK: `faq-slider` DB failure is swallowed (falls back to defaults).
  4. Default accordion copy contains factual claims (SOC 2, "22 gateways", "median 18 minutes") that are not backed by the product.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given two active FAQ rows with placement `home` and one with `pricing`, When the homepage renders, Then the slider shows exactly the two home rows.
  - Given no home/both rows exist, When the homepage renders, Then the eight default cards appear.
  - Given a published edit to `features.faq.faq2_a`, When `/features` renders, Then the second answer shows the new text while `/` is unchanged.
- **Source refs:** `components/frontend/faq.blade.php`, `components/frontend/faq-slider.blade.php`, `app/Models/PricingFaq.php`, `resources/views/frontend/{home,features,pricing,contact}.blade.php`.
- **Port notes:** One FAQ entity with `placements[]` (pricing_page, home_slider, in_app_plans, checkout, mobile) is cleaner; keep the fallback-to-defaults behavior only for fresh installs via seed data, not runtime constants.

### WD-CMS-011 — Public blog index

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CMS-007, WD-CMS-029
- **Summary:** `GET /blog` lists published posts newest first in a 9-per-page grid, with an optional pinned "featured" post, a category filter chip row and simple search via query parameter.
- **Actors & access:** Anyone; `NoStoreResponse`; not affected by the homepage switch.
- **UX & screens:** `frontend/blog/index.blade.php`. Hero ("Ideas that start conversations"); featured card (image or brand gradient, "Featured" pill, category, title, excerpt, date `M j, Y`, reading time, "Read more"); category chips "All" plus every category ordered by name (empty categories included); 3-column grid of cards (image or gradient, category, title, 3-line excerpt, date, reading time); pagination links preserving the query string; empty state "Nothing here yet". There is no search box in the UI even though `?q=` is supported by the controller.
- **Endpoints:**
  | Endpoint  | Name          | Action                       | Middleware      | Request                        | Response |
  | --------- | ------------- | ---------------------------- | --------------- | ------------------------------ | -------- |
  | GET /blog | frontend.blog | FrontendController@blogIndex | NoStoreResponse | `category` (slug), `q`, `page` | HTML     |
- **Data:** `blog_posts` scope published (status `published` AND (`published_at` null OR <= now)), ordered by `published_at` desc, eager-loaded `category`; `blog_categories` ordered by `name`; featured = latest published post with `is_featured` true.
- **Rules & edge cases:**
  1. `category` filter: matches slug; an unknown slug is silently ignored and shows all posts.
  2. `q`: LIKE on `title` OR `excerpt` with `%`, `_`, `\` escaped; no full-text.
  3. The featured post is not excluded from the grid (it appears twice on page 1 if it is also the latest). Several posts can be flagged featured but only the latest one is shown as featured. The admin copy says "pinned to the top", which is only true for the hero card.
  4. Reading time = ceil(words of tag-stripped body / 200), min 1 minute.
  5. Images come from the active media disk (`media_url`), cloud or local.
  6. Page title = "Blog - <brand>"; meta description is a fixed sentence; canonical falls back to the current URL (SEO block).
- **Async & events:** none.
- **External systems:** cloud media storage via SET when enabled.
- **Settings:** storage settings (SET).
- **Acceptance criteria:**
  - Given 20 published posts, When `/blog` loads, Then 9 posts render and a second page link exists; the second page shows the next 9.
  - Given a scheduled post with `published_at` in the future, When `/blog` loads, Then it is not listed until that time passes.
  - Given `?category=news`, When the page loads, Then only posts in that category are listed and the chip is highlighted.
  - Given `?category=unknown`, When the page loads, Then all posts are listed.
  - Given no published posts, When the page loads, Then the empty state is shown.
- **Source refs:** `app/Http/Controllers/FrontendController.php` (`blogIndex`), `app/Models/BlogPost.php`, `app/Models/BlogCategory.php`, `resources/views/frontend/blog/index.blade.php`.
- **Port notes:** Tables `blog_posts`, `blog_categories` (platform-level). Use keyset pagination on (`published_at`, `id`); index `(status, published_at)`. Remove the double display of the featured post.

### WD-CMS-012 — Public blog post page

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CMS-011, WD-CMS-016
- **Summary:** `GET /blog/{slug}` renders one published post with breadcrumb, category badge, author/date/reading time, cover image, raw HTML body, tags, related posts and an Article JSON-LD block. Every view increments a counter.
- **Actors & access:** Anyone; `NoStoreResponse`.
- **UX & screens:** `frontend/blog/show.blade.php` with scoped `.wd-article` typography (h2-h4, lists, quotes, code, images). Header: breadcrumb Home / Blog / title, category pill linking to `/blog?category=`, H1, excerpt, author (`author_name` or brand), date, reading time. Body is `{!! body !!}` (unsanitized HTML written by admins). Tags as `#tag` pills. "Keep reading" grid of up to 3 related posts. Back-to-blog CTA.
- **Endpoints:**
  | Endpoint         | Name               | Action                      | Middleware      | Request           | Response     |
  | ---------------- | ------------------ | --------------------------- | --------------- | ----------------- | ------------ |
  | GET /blog/{slug} | frontend.blog.show | FrontendController@blogShow | NoStoreResponse | slug (any string) | HTML, or 404 |
- **Data:** reads `blog_posts` + `blog_categories`; writes `blog_posts.views` (+1 via a query-builder `whereKey()->update()` that skips model events; the code comment claims timestamps are untouched, but Eloquent's builder update normally also bumps `updated_at`, see rule 2).
- **Rules & edge cases:**
  1. 404 when the slug is missing, the post is a draft, or `published_at` is in the future.
  2. View counter increments on every request, including crawlers, refreshes and the mobile API detail endpoint; no uniqueness or bot filtering. The counter is read-modify-write from the loaded value (`views + 1`), so concurrent hits can lose increments. QUIRK (verify live): because the update goes through an Eloquent builder it most likely also refreshes `updated_at`, which would make every page view move the post's sitemap `lastmod` and JSON-LD `dateModified`.
  3. Related posts: other published posts in the same category (or any post when the post has no category), latest first, limit 3.
  4. SEO: title = `meta_title` or title + " - brand"; description = `meta_description`, else `excerpt`, else first 155 chars of tag-stripped body; OG image = `og_image` else featured image; `og:type` article; canonical = `canonical_url` else post URL; `noindex` true emits robots `noindex, nofollow` and removes the post from the sitemap; JSON-LD `Article` with headline, description, image, datePublished (`published_at`), dateModified (`updated_at`), author Organization (`author_name` or brand), publisher and `mainEntityOfPage`.
  5. Body HTML is trusted (no sanitizer): a compromised admin account can inject script into a public page. Port must sanitize on write or render.
- **Async & events:** none.
- **External systems:** media disk for images.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a published post, When `/blog/<slug>` is requested, Then HTTP 200, the body HTML renders and the `views` column increases by 1.
  - Given a draft or future-dated post, When requested, Then HTTP 404 and `views` is unchanged.
  - Given `noindex` is set, When the page renders, Then the robots meta is `noindex, nofollow` and the sitemap omits it.
  - Given the post has `meta_description` blank and an excerpt, When rendered, Then the meta description equals the excerpt.
  - Given the post has a category with two other published posts, When rendered, Then both are shown under "Keep reading".
- **Source refs:** `app/Http/Controllers/FrontendController.php` (`blogShow`), `app/Models/BlogPost.php` (`seoTitle`, `seoDescription`, `readingTimeMinutes`, `scopePublished`), `resources/views/frontend/blog/show.blade.php`, `components/layouts/frontend.blade.php`.
- **Port notes:** Increment views through a batched counter (Redis or buffered worker) instead of per-request writes. Sanitize HTML (allow-list) at write time. Slugs are unique globally.

### WD-CMS-013 — Public legal pages (Terms, Privacy, Refund, Cookies, Acceptable Use)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-CMS-007, WD-CMS-033
- **Summary:** Five fixed URLs under `/legal/` render admin-editable legal documents from the `legal_pages` table with a numbered table of contents. If a row does not exist the original hard-coded Blade for that slug is rendered as a safety net.
- **Actors & access:** Anyone; `NoStoreResponse`.
- **UX & screens:** `frontend/legal/dynamic.blade.php` wraps `components/frontend/legal-page.blade.php`: hero with "Legal" pill, H1 title, optional subtitle, "Updated - <label>" and "Effective - <label>" pills and a read-time pill (`max(1, int(sections*1.5))` minutes); left sticky table of contents (number + title anchors `#sec-<n>`) with a "Questions?" box showing `brand_email('legal')`; body sections (large number, H2 title, HTML body rendered raw); footer line with document version (= updated label or "current") and the legal email. Static fallbacks: `frontend/legal/{terms,privacy,refund,cookies,acceptable-use}.blade.php`.
- **Endpoints:**
  | Endpoint                  | Name                          | Action                           | Middleware      | Request | Response |
  | ------------------------- | ----------------------------- | -------------------------------- | --------------- | ------- | -------- |
  | GET /legal/terms          | frontend.legal.terms          | FrontendController@terms         | NoStoreResponse | none    | HTML     |
  | GET /legal/privacy        | frontend.legal.privacy        | FrontendController@privacy       | NoStoreResponse | none    | HTML     |
  | GET /legal/refund         | frontend.legal.refund         | FrontendController@refund        | NoStoreResponse | none    | HTML     |
  | GET /legal/cookies        | frontend.legal.cookies        | FrontendController@cookies       | NoStoreResponse | none    | HTML     |
  | GET /legal/acceptable-use | frontend.legal.acceptable-use | FrontendController@acceptableUse | NoStoreResponse | none    | HTML     |
- **Data:** `legal_pages` (`slug` unique, `title`, `subtitle`, `updated_label`, `effective_label`, `sections` JSON array of `{n,title,body}`, `is_published`, `sort`). Section normalization (`orderedSections`): each item gets `n` (trimmed, default zero-padded index), `title`, `body` strings.
- **Rules & edge cases:**
  1. Row exists and `is_published` false: 404.
  2. Row missing: render the static Blade for the slug. Row present with empty `sections`: renders an empty document (no fallback).
  3. Section bodies are raw HTML (no sanitizer); section numbers `n` are used verbatim as anchor ids and TOC labels.
  4. Only these five slugs are routable; nothing else under `/legal/*` (except the in-app DPA page, WD-CMS-052). Legal pages are not in the sitemap.
  5. In-app links elsewhere (checkout, auth, footer) resolve via `legal_url(kind)`: an admin-configured URL for terms/privacy/cookies wins over the built-in page.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `privacy_terms_url`, `privacy_policy_url`, `privacy_cookies_policy_url` (SET Privacy settings) override link targets elsewhere.
- **Acceptance criteria:**
  - Given a published `terms` row, When `/legal/terms` loads, Then the title, dates and every section render with a matching TOC.
  - Given `is_published` is false, When `/legal/privacy` loads, Then HTTP 404.
  - Given no `refund` row exists, When `/legal/refund` loads, Then the static default document renders.
  - Given section numbers "A" and "B", When the page renders, Then the anchors are `#sec-A` and `#sec-B`.
- **Source refs:** `app/Http/Controllers/FrontendController.php` (`legal`), `app/Models/LegalPage.php`, `resources/views/frontend/legal/*.blade.php`, `components/frontend/legal-page.blade.php`, `app/Support/fc_helpers.php` (`legal_url`).
- **Port notes:** Store sections as JSONB. Sanitize HTML on write. Ship neutral template documents written by us, not WaDesk text. Add the five pages to the sitemap.

### WD-CMS-014 — Dynamic sitemap.xml

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CMS-011
- **Summary:** `GET /sitemap.xml` builds an XML sitemap on the fly: six static marketing URLs, one URL per blog category filter, and one per published, indexable blog post.
- **Actors & access:** Anyone. Not wrapped in `NoStoreResponse` (cacheable; no hashed asset references).
- **UX & screens:** none (XML, `Content-Type: application/xml; charset=UTF-8`).
- **Endpoints:**
  | Endpoint         | Name    | Action                  | Middleware | Request | Response   |
  | ---------------- | ------- | ----------------------- | ---------- | ------- | ---------- |
  | GET /sitemap.xml | sitemap | SitemapController@index | none       | none    | XML urlset |
- **Data:** static list (priority/changefreq): `/` 1.0 daily, `/features` 0.8 weekly, `/pricing` 0.8 weekly, `/about` 0.5 monthly, `/contact` 0.5 monthly, `/blog` 0.9 daily; every `blog_categories` row as `/blog?category=<slug>` 0.6 weekly (empty categories included); published posts with `noindex` false ordered by `published_at` desc in chunks of 200: `/blog/<slug>` with `lastmod` = `updated_at` (fallback `published_at`), priority 0.8 if featured else 0.7, changefreq weekly.
- **Rules & edge cases:**
  1. Absolute URLs via `url()` (current host and scheme). Values are XML-escaped.
  2. Legal pages, guidebook and storefronts are not listed. There is no 50,000-URL split or index file.
  3. Future-dated posts are excluded (same `published` scope).
- **Async & events:** none; regenerated every request (no cache).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given two published posts (one noindex), When `/sitemap.xml` is fetched, Then the response has the six static URLs, all categories and only the indexable post with a `lastmod`.
  - Given a new post is published, When the sitemap is fetched immediately, Then it is included without any regeneration step.
- **Source refs:** `app/Http/Controllers/SitemapController.php`, `Documentation/pages/admin-panel/blog.html`.
- **Port notes:** Serve from Next.js `sitemap.ts` reading the CMS API; add legal pages; use per-tenant hostnames only for platform domain.

### WD-CMS-015 — robots.txt

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CMS-014
- **Summary:** `GET /robots.txt` returns a generated robots file allowing everything except `/admin` and `/api`, and pointing at the sitemap.
- **Actors & access:** Anyone; no middleware.
- **UX & screens:** none (text/plain).
- **Endpoints:**
  | Endpoint        | Name   | Action                   | Middleware | Request | Response                                                                                                       |
  | --------------- | ------ | ------------------------ | ---------- | ------- | -------------------------------------------------------------------------------------------------------------- |
  | GET /robots.txt | robots | SitemapController@robots | none       | none    | text lines: `User-agent: *`, `Allow: /`, `Disallow: /admin`, `Disallow: /api`, `Sitemap: <origin>/sitemap.xml` |
- **Data:** none.
- **Rules & edge cases:**
  1. QUIRK: a static `public/robots.txt` also ships (`User-agent: *`, `Disallow:` empty). Web servers normally serve an existing static file before Laravel routing, so the dynamic route is shadowed and the sitemap line never appears unless the static file is deleted. Treat the dynamic version as the intended behavior.
  2. The SEO setting `seo_robots` only affects the per-page meta robots tag, not this file.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the app is reachable at `https://x.example`, When `/robots.txt` is fetched, Then the body ends with `Sitemap: https://x.example/sitemap.xml`.
  - Given a request for `/admin`, When crawlers read the file, Then it is disallowed.
- **Source refs:** `app/Http/Controllers/SitemapController.php`, `public/robots.txt`.
- **Port notes:** Implement as a Next.js route; do not ship a static file that shadows it.

### WD-CMS-016 — SEO meta block for all layouts

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CMS-008
- **Summary:** A shared partial emits description, keywords, author, robots, canonical, Open Graph, Twitter Card and search-engine verification tags on every layout (public, guest/auth, user app and admin). Defaults come from the platform SEO settings; a page can override title, description, keywords, robots, OG fields and canonical.
- **Actors & access:** Output for everyone. The SEO settings form (`/admin/settings/seo`, controller `AdminPagesController@settingSeo/settingSeoUpdate`) is owned by the SET domain; this entry documents the consumer and the field contract.
- **UX & screens:** `partials/seo-meta.blade.php` (empty values are skipped, no empty meta tags). `og:image` also emits fixed 1200x630 width/height tags.
- **Endpoints:** none here (settings form in SET).
- **Data:** `system_settings` keys `seo_meta_title`, `seo_meta_description`, `seo_meta_keywords`, `seo_robots` (default "index, follow"), `seo_canonical`, `seo_author`, `seo_og_title`, `seo_og_description`, `seo_og_image`, `seo_og_type` (default website), `seo_og_url`, `seo_twitter_card` (default summary_large_image), `seo_twitter_site`, `seo_twitter_creator`, `seo_google_verification`, `seo_bing_verification`. Form validation (SET): title/og_title max 160, descriptions max 320, keywords max 500, robots max 120, canonical/og_url/og_image must be URLs (max 300/300/500), og_type in website/article/product/profile, twitter_card in summary/summary_large_image/app/player, twitter handles max 60, verification tokens max 200.
- **Rules & edge cases:**
  1. Resolution order per field: per-page override, saved default, hard default. Title falls back to the brand name; OG title falls back to title; OG description to description; canonical and OG URL fall back to the current request URL (no query normalization).
  2. Twitter handles are prefixed with `@` when missing.
  3. QUIRK: the saved `seo_canonical` (a single global URL) is used as the canonical of every page that does not override it, which points every page at one URL. Set only for single-page sites.
  4. Blog posts override title, description, OG image/type, canonical and robots; other public pages pass only their title.
  5. Blog per-post SEO inputs (meta title/description/keywords, OG image, canonical URL, noindex) exist in the controller and model but were removed from the admin form (see WD-CMS-030).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** the `seo_*` keys above; `app_name`.
- **Acceptance criteria:**
  - Given saved `seo_meta_description`, When any layout renders without override, Then a description meta with that text is emitted.
  - Given an override title, When the layout renders, Then the title override wins in both `<title>` and `og:title`.
  - Given empty `seo_twitter_site`, When rendered, Then no twitter:site tag is emitted; given "acme", Then the tag content is `@acme`.
- **Source refs:** `app/Support/Seo.php`, `resources/views/partials/seo-meta.blade.php`, `app/Http/Controllers/AdminPagesController.php` (`settingSeo`, `settingSeoUpdate`), `resources/views/admin/settings/seo.blade.php`, `resources/js/charts/admin-settings-seo.js` (all SET), `components/layouts/{frontend,guest,user,admin}.blade.php`.
- **Port notes:** In Next.js use `generateMetadata` with a shared `buildMeta(defaults, overrides)`. Drop the global canonical default (derive per page).

### WD-CMS-017 — Announcement display (public ticker and in-app bar)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CMS-039, WD-CMS-040
- **Summary:** Currently active announcements scroll as a marquee in two places: the dark ticker above the public site navigation and the announcement bar at the top of the signed-in app shell. Visitors can dismiss dismissible bars (remembered in the browser).
- **Actors & access:** Public ticker: anyone. In-app bar: any authenticated workspace user (rendered in `components/layouts/user.blade.php` in two places for the two shell variants). Not rendered in the admin layout.
- **UX & screens:** `components/frontend/ticker.blade.php`: black strip, text repeated twice for a seamless loop; first item has a pulsing green dot; separators; link text with optional " · label →"; the `success` tone tints text green; no dismiss control. When no announcements are active, it falls back to five editable default messages (`ticker.message1..5`, sample metrics). `components/announcement-bar.blade.php`: one bar per tone (group by tone), colours by tone (info dark ink, promo dark wood, warning amber with dark text, success green), marquee duration = max(20, total characters / 5) seconds, pause on hover, dismiss "x" shown if any announcement in the group is dismissible; dismissal stored in `localStorage` as `dismissed:ann-<ids joined by ->` so the bar returns when the set of active announcements changes.
- **Endpoints:** none (partials). The mobile API exposes the top active announcement through `GET api/app/banner` (MOB domain).
- **Data:** `announcements` via the `active()` scope: `is_active` true AND (`starts_at` null or <= now) AND (`expires_at` null or >= now), ordered by `sort_order` then `id`.
- **Rules & edge cases:**
  1. Cached for 60 seconds under `announcements.active.v1` (shared by the ticker and the bar) and busted on any admin create/update/toggle/delete, so admin changes show immediately, and schedule boundaries take effect within about a minute.
  2. Announcement text is escaped; `link_url` is written into `href` unvalidated.
  3. Tone drives colour only; `success` additionally recolours ticker text.
  4. If the cache holds an empty collection, the bar renders nothing.
  5. Also audit-logged through the `AuditableObserver` (see WD-CMS-041).
- **Async & events:** none (time-based visibility evaluated on read).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active announcement inside its window, When any public page or app page loads, Then the message scrolls in the matching bar.
  - Given `expires_at` passes, When the cache TTL elapses (or an admin saves), Then the bar disappears.
  - Given a dismissible bar is dismissed, When the user reloads, Then it stays hidden until the set of active announcements changes.
  - Given no announcements are active, When the public site loads, Then the ticker shows the editable default messages and the app shell shows no bar.
- **Source refs:** `resources/views/components/announcement-bar.blade.php`, `resources/views/components/frontend/ticker.blade.php`, `resources/views/components/layouts/user.blade.php`, `app/Models/Announcement.php`, `Documentation/pages/admin-panel/announcements.html`.
- **Port notes:** Serve active announcements from one cached endpoint keyed by audience (public, app). Validate `link_url` scheme (http, https, relative). Consider per-workspace targeting only if product needs it (WaDesk is global).

### WD-CMS-018 — Frontend live editor shell

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-CMS-008, WD-CMS-009
- **Summary:** `/admin/frontend` is a split-screen editor: a live iframe of the real public page in edit mode on the left and a control panel (inspector, sections, brand presets, theme colours, reset) on the right. Nothing is public until Publish.
- **Actors & access:** Platform admin only: middleware `auth`, `admin` (`EnsureUserIsAdmin`: Spatie role "Super Admin" or "Admin", or legacy `users.role` in `admin`/`A`), `ip.allowlist`. No granular permission key is checked (the `platform.*` permission keys are not applied to these routes). No plan gate. Sidebar entry "Frontend editor" under System.
- **UX & screens:** `resources/views/admin/frontend/index.blade.php` (scripts `public/js/frontend-editor.js` shell and `public/js/frontend-editor-bridge.js` in the iframe). Toolbar: page tabs (Home, Features, Pricing, About, Contact; the docs mention only three), device switcher (Desktop 100%, Tablet 834 px, Mobile 414 px max-width), autosave status pill ("Saving...", "All changes saved", "Save failed"), drafts badge (hidden at 0, counts up client-side per save), full-screen toggle (browser Fullscreen API on the editor container), "open live site" link, Homepage on/off toggle (WD-CMS-028), Discard (confirm dialog), Publish. Right panel: how-to hint; Selected field inspector (empty state "Click a text element..."; card with key, type, optional Link target input + "Set", "Reset this field"); Sections list; Brand presets grid (six swatch buttons); Theme colours (color inputs grouped WhatsApp/Ink/Paper/Accent with hex readout, "Reset all colours"); Reset ("Reset this page", "Reset entire site"). Toast at the bottom for confirmations and errors.
- **Endpoints:**
  | Endpoint            | Name                 | Action                         | Middleware                                   | Request                                                                      | Response |
  | ------------------- | -------------------- | ------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------- | -------- |
  | GET /admin/frontend | admin.frontend.index | FrontendEditorController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | `page` (home, features, pricing, about, contact; invalid falls back to home) | HTML     |
- **Data:** reads all theme token values in draft mode (24 tokens with shipped defaults), per page `__hidden` and `__order` drafts, pending count = rows where `draft != published` or (draft not null and published null), and `frontend_enabled`. JSON blob `#fc-editor-data` passes csrf, pages (label, preview URL with `?fc_edit=1`, sections), section metadata, hidden/order state and endpoint URLs to the shell script.
- **Rules & edge cases:**
  1. The preview iframe URL always carries `?fc_edit=1`; the public layout injects the bridge script only when `fc_editing()` is true (authed admin and flag).
  2. The shell and bridge talk via `postMessage` restricted to the same origin: bridge sends `fc:ready`, `fc:select`, `fc:saving`, `fc:saved`, `fc:error`; shell sends `fc:highlightSection`.
  3. Shell requests are form-encoded POSTs with the CSRF header; arrays are sent as JSON strings (relevant to WD-CMS-023).
  4. Switching tabs reloads the iframe with a cache-busting `_t` param; after Discard the whole admin page reloads to resync state; after Publish only the frame reloads.
  5. Draft badge is a client-side counter and can drift from the server count until reload.
  6. All actions are audit-logged (see each action).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an admin opens `/admin/frontend`, When the page loads, Then the Home page loads in the iframe with edit mode and the Sections panel lists the Home sections.
  - Given a non-admin authenticated user, When they open `/admin/frontend`, Then HTTP 403 "Admins only".
  - Given `?page=contact`, When the page loads, Then the Contact tab is active and the iframe shows `/contact?fc_edit=1`.
  - Given unpublished drafts exist, When the page loads, Then the drafts badge shows the pending count.
- **Source refs:** `app/Http/Controllers/Admin/FrontendEditorController.php`, `resources/views/admin/frontend/index.blade.php`, `public/js/frontend-editor.js`, `public/js/frontend-editor-bridge.js`, `routes/admin.php`, `app/Http/Middleware/EnsureUserIsAdmin.php`, `Documentation/pages/admin-panel/frontend-editor.html`.
- **Port notes:** Build as an admin route in `apps/web` with an iframe to the public site preview origin (same-site cookies or signed preview token). Prefer a signed preview token over trusting a query flag. Guard with platform-admin RBAC (permission key `cms.edit`) and IP allowlist (ASHELL).

### WD-CMS-019 — Inline text editing and draft save

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-CMS-018, WD-CMS-008
- **Summary:** Inside the preview, every element marked as editable turns into an inline editor on click. Blur or Enter saves a draft for that key; Escape cancels. Rich-text fields get a bold/italic/clear toolbar.
- **Actors & access:** Platform admin (same gate as WD-CMS-018).
- **UX & screens:** Bridge `public/js/frontend-editor-bridge.js`: dashed outline and key label on hover; click selects (capture-phase, blocks links and form submits so the admin stays on the page); text fields use `contenteditable=plaintext-only`, rich text uses `contenteditable=true` with a floating toolbar (bold, italic, "clear" via `execCommand`). Enter commits single-line fields (Shift+Enter newline; rich text keeps Enter for paragraphs); Escape restores the original; blur commits. Empty result reverts to the original and saves nothing (so the shipped default keeps showing; use Reset to intentionally revert). A green flash confirms; failure restores the original text and shows "Save failed".
- **Endpoints:**
  | Endpoint                   | Name                 | Action                             | Middleware                                   | Request                     | Response           |
  | -------------------------- | -------------------- | ---------------------------------- | -------------------------------------------- | --------------------------- | ------------------ |
  | POST /admin/frontend/draft | admin.frontend.draft | FrontendEditorController@saveDraft | Authenticate, EnsureUserIsAdmin, IPAllowlist | JSON `key`, `value`, `type` | `{ok:true}` or 422 |
- **Data:** upserts `frontend_content` (`ckey`, `type`, `draft`, `updated_by`).
- **Rules & edge cases:**
  1. Validation: `key` required string max 191 matching the key regex; `value` must be present (may be blank); `type` optional in `text, richtext, json, color, image`, default `text`.
  2. `color`: value trimmed; must be `#RGB` or `#RRGGBB` hex, else 422 `{ok:false,error:"Invalid colour"}`; stored as type `text`.
  3. `richtext` is stored as type `text` (HTML string from `innerHTML`); plain fields are stored from `innerText`.
  4. Creating a row by editing the first time leaves `published` null until Publish.
  5. No optimistic locking: last write wins across two admins.
  6. Rich-text HTML is not sanitized; templates print some values raw. Admin-only, but a port should sanitize.
  7. Audit log entry `admin.frontend.draft` with subject `frontend_content`, resource label = key, meta key/type.
- **Async & events:** cache bust via model events.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an editable headline, When the admin edits it and presses Enter, Then a draft row exists for that key and the preview shows the new text, and the public page does not until publish.
  - Given a color type with `#12` value, When posted, Then 422 "Invalid colour" and nothing is saved.
  - Given an empty edit, When the field blurs, Then no request is sent and the original text is restored.
  - Given an invalid key such as `bad key!`, When posted, Then 422 validation error.
- **Source refs:** `app/Http/Controllers/Admin/FrontendEditorController.php` (`saveDraft`), `public/js/frontend-editor-bridge.js`, `app/Services/Frontend/FrontendContentStore.php`.
- **Port notes:** A Next.js implementation can replace contenteditable hacks with a block-form editor plus live preview; keep inline click-to-edit only if the product must retain parity. Use JSON API with per-key PATCH and a version column for conflict detection.

### WD-CMS-020 — Editable link targets (nav, footer, hero CTAs)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CMS-019
- **Summary:** Links marked as editable expose a "Link target" input in the inspector so admins can retarget navigation, footer and hero CTA links without changing the visible label.
- **Actors & access:** Platform admin.
- **UX & screens:** When an editable link's text is selected in the preview the bridge sends its URL key and current `href`; the inspector shows "Link target" prefilled. "Set" posts the URL as a text draft; empty input is rejected client-side ("Enter a URL"). Editable link keys: nav links 1-5 (`nav.linkN_url`), footer columns (`footer.col1_link1..3_url`, `footer.col4_link1..2_url`, `footer.col5_link1..5_url`), hero CTAs (`hero-home.cta1_url`, `hero-home.cta2_url`).
- **Endpoints:** reuses `POST /admin/frontend/draft` (WD-CMS-019) with `type=text`.
- **Data:** `frontend_content` text rows.
- **Rules & edge cases:**
  1. No URL validation server-side: any string is accepted, including `javascript:` URIs (admin trust). Port must validate scheme.
  2. The blog nav link has editable label/URL keys registered in markup but its label and href are hardcoded, so those edits have no effect (dead keys).
  3. Values are text-typed, so they are ignored on non-default locales (WD-CMS-008 QUIRK).
  4. Footer legal defaults point through `legal_url()` (WD-CMS-013).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a selected footer link, When the admin sets a new URL and publishes, Then the public footer link uses the new href with the same label.
  - Given an empty URL, When "Set" is clicked, Then a client error toast "Enter a URL" appears and no request is made.
- **Source refs:** `public/js/frontend-editor.js` (inspector), `public/js/frontend-editor-bridge.js`, `components/frontend/{nav,footer,hero-home}.blade.php`.
- **Port notes:** Restrict to http(s), mailto, tel and site-relative paths.

### WD-CMS-021 — Theme colours and brand presets

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CMS-018, WD-CMS-007
- **Summary:** The public site's palette is 24 named colour tokens. The panel edits each as a draft, and six one-click presets re-skin the brand tokens while leaving text/paper colours alone.
- **Actors & access:** Platform admin.
- **UX & screens:** Colour inputs (native picker) with hex readout, debounced 350 ms per key; on success the iframe reloads and the drafts badge increments. Preset buttons (Emerald, Ocean, Forest, Royal, Sunset, Slate) show four swatches. "Reset all colours" resets scope `theme`.
- **Endpoints:**
  | Endpoint                                                                              | Name                  | Action                               | Middleware                                   | Request      | Response                                                       |
  | ------------------------------------------------------------------------------------- | --------------------- | ------------------------------------ | -------------------------------------------- | ------------ | -------------------------------------------------------------- |
  | POST /admin/frontend/preset                                                           | admin.frontend.preset | FrontendEditorController@applyPreset | Authenticate, EnsureUserIsAdmin, IPAllowlist | `preset` key | `{ok:true,tokens:{key:hex}}` or 422 `{error:"Unknown preset"}` |
  | (single-colour edits use `POST /admin/frontend/draft` with `type=color`, WD-CMS-019.) |
- **Data:** token keys and shipped defaults: WhatsApp group `theme.wa.deep #075E54`, `teal #128C7E`, `green #25D366`, `mint #DCF8C6`, `bubble #E7FFDB`, `chat #ECE5DD`; Ink `theme.ink.950 #070D0C`, `900 #0B1F1C`, `800 #13312D`, `700 #1F4540`, `600 #3A5A55`, `500 #6B807C`, `400 #9AA8A4`, `300 #C3CCC9`; Paper `theme.paper.0 #FBFAF6`, `50 #F5F3EC`, `100 #EFEBE0`, `200 #E5DFD0`, `300 #D4CCB6`; Accent `theme.accent.coral #E87A5D`, `amber #E5A04E`, `sand #D9C9A3`, `plum #5B3D8A`, `sky #3E7AA1`. A preset writes seven keys (`wa.deep/teal/green/mint/bubble`, `accent.coral/amber`) as text drafts (Emerald restores defaults; Ocean, Forest, Royal, Sunset, Slate use their own hex sets and swatches).
- **Rules & edge cases:**
  1. Applying a preset is draft-only and reversible until Publish, but it overwrites individually edited values for those seven keys.
  2. Hex validation only on the single-colour path; presets are trusted code constants.
  3. Only the public marketing site uses these tokens (not the user app or admin theme, which use a separate `theme_css()` mechanism, SET).
  4. Audit `admin.frontend.preset` with preset label.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the Ocean preset is clicked, When the response returns, Then seven draft rows exist with Ocean values and the colour inputs update; the live site is unchanged until publish.
  - Given an unknown preset key, When posted, Then 422 "Unknown preset".
  - Given "Reset all colours" is confirmed, When it runs, Then all `theme.*` rows are deleted and defaults show at once (see WD-CMS-026 caveat).
- **Source refs:** `app/Http/Controllers/Admin/FrontendEditorController.php` (`THEME_TOKENS`, `THEME_PRESETS`, `applyPreset`), `public/js/frontend-editor.js`, `components/layouts/frontend.blade.php`.
- **Port notes:** Store tokens as one JSON theme object with a schema; generate CSS variables server-side. Add contrast check as an improvement, optional.

### WD-CMS-022 — Show and hide sections

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CMS-009, WD-CMS-018
- **Summary:** Each removable section on a page has a Shown/Hidden pill in the panel. Hidden sections disappear from the public page after publish; heroes are labelled "fixed".
- **Actors & access:** Platform admin.
- **UX & screens:** Sections list rows show label, grip (removable rows only), state pill; clicking the row name scrolls and flashes the section in the preview (`fc:highlightSection`). Toggling reloads the frame and increments the drafts badge.
- **Endpoints:**
  | Endpoint                     | Name                   | Action                                 | Middleware                                   | Request                                                           | Response                                    |
  | ---------------------------- | ---------------------- | -------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------- |
  | POST /admin/frontend/section | admin.frontend.section | FrontendEditorController@toggleSection | Authenticate, EnsureUserIsAdmin, IPAllowlist | `page` (required), `slug` (required), `hidden` (required boolean) | `{ok:true,hidden:[slugs]}` or 422 `{error}` |
- **Data:** upserts `<page>.__hidden` draft (json array).
- **Rules & edge cases:**
  1. 422 "Unknown section" when the page is unknown or the slug is not in that page's section list; 422 "This section cannot be hidden" for non-removable sections.
  2. Hiding is idempotent (no duplicates); un-hiding removes the slug.
  3. Draft state is per key: the editor reads hidden set in draft mode, public reads published.
  4. Audit `admin.frontend.section`, label "<page> - <slug>".
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `testimonials` is shown on Home, When the admin hides it and publishes, Then `/` omits it.
  - Given the hero slug, When a hide request is posted, Then 422 and no draft is written.
  - Given a slug from another page, When posted, Then 422 "Unknown section".
- **Source refs:** `app/Http/Controllers/Admin/FrontendEditorController.php` (`toggleSection`), `app/Services/Frontend/FrontendRegistry.php`, `public/js/frontend-editor.js`.
- **Port notes:** Validate against the block catalogue on the server.

### WD-CMS-023 — Reorder sections (drag and drop)

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CMS-009, WD-CMS-018
- **Summary:** Removable sections can be dragged in the panel; the new order is saved as a draft for the page. Advertised in the docs; the client request shape appears incompatible with the server validation, so it likely fails in v1.7.0.
- **Actors & access:** Platform admin.
- **UX & screens:** Native HTML drag and drop on section rows (opacity feedback; drop inserts the dragged row before the target row); toast "Order saved" on success, or "Could not reorder" on failure.
- **Endpoints:**
  | Endpoint                     | Name                   | Action                           | Middleware                                   | Request                                                   | Response                       |
  | ---------------------------- | ---------------------- | -------------------------------- | -------------------------------------------- | --------------------------------------------------------- | ------------------------------ |
  | POST /admin/frontend/reorder | admin.frontend.reorder | FrontendEditorController@reorder | Authenticate, EnsureUserIsAdmin, IPAllowlist | `page` required string; `order` required array of strings | `{ok:true,order:[...]}` or 422 |
- **Data:** upserts `<page>.__order` draft (json array).
- **Rules & edge cases:**
  1. Server keeps only slugs that belong to the page, are removable, and are unique, in submitted order; unknown page returns 422 "Unknown page".
  2. QUIRK (probable bug): the shell script serializes every non-scalar value in its form-encoded body with JSON, so `order` arrives as a JSON string, not an array; Laravel's `array` rule then fails and the request returns 422 with no `error` key, producing the "Could not reorder" toast. Needs live verification with the parity skill before deciding whether to port as intended behavior (yes) and how to test (assert the order is saved).
  3. Heroes are excluded from the saved order and pinned on render; sections missing from the saved order are appended in default position.
  4. Audit `admin.frontend.reorder`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given Home sections, When the admin drags FAQ above pricing-strip, Then `home.__order` draft is [faq, pricing-strip, ...] and after publish `/` renders in that order.
  - Given a submitted order containing a hero slug or a slug from another page, When posted, Then those slugs are dropped from the saved order.
  - Given an unknown page, When posted, Then 422 "Unknown page".
- **Source refs:** `app/Http/Controllers/Admin/FrontendEditorController.php` (`reorder`), `public/js/frontend-editor.js` (`saveOrder`, `post`).
- **Port notes:** Implement as a JSON body; the intent is well defined even if the reference is broken.

### WD-CMS-024 — Publish drafts

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-CMS-008
- **Summary:** Publish copies every pending draft to the live value. The UI always publishes everything; the endpoint also supports a single-page scope.
- **Actors & access:** Platform admin.
- **UX & screens:** "Publish" button (disabled while running); toast "Published - N change(s) live"; drafts badge reset; frame reload.
- **Endpoints:**
  | Endpoint                     | Name                   | Action                           | Middleware                                   | Request                                  | Response                                                |
  | ---------------------------- | ---------------------- | -------------------------------- | -------------------------------------------- | ---------------------------------------- | ------------------------------------------------------- |
  | POST /admin/frontend/publish | admin.frontend.publish | FrontendEditorController@publish | Authenticate, EnsureUserIsAdmin, IPAllowlist | `scope` = `all` (default) or a page slug | `{ok:true,published:N}` or 422 `{error:"Unknown page"}` |
- **Data:** `frontend_content.published := draft` for rows that differ; `updated_by` set.
- **Rules & edge cases:**
  1. Page scope publishes only keys with prefix `<page>.`; theme keys and component-shared keys (for example `nav.*`, `footer.*`, `pricing-strip.*`) are NOT published by a page-scoped publish, only by `all`. The UI only uses `all`.
  2. Publish is atomic per row but not across rows (no transaction); the cache is busted per saved row.
  3. No version history, no rollback and no scheduled publish. Publishing replaces the previous live value permanently (the draft equals the live copy afterwards).
  4. Audit `admin.frontend.publish` with scope and changed count.
- **Async & events:** cache invalidation only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given three pending drafts, When Publish is clicked, Then the response reports 3 and public pages show the new values.
  - Given scope `home` on the API, When called, Then only `home.*` rows publish.
  - Given no pending drafts, When published, Then `published:0` and nothing changes.
- **Source refs:** `app/Http/Controllers/Admin/FrontendEditorController.php`, `app/Services/Frontend/FrontendContentStore.php`.
- **Port notes:** Add revision history (append-only `cms_content_revisions`) and a transaction; emit an `cms.published` outbox event to purge CDN/ISR caches.

### WD-CMS-025 — Discard drafts

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CMS-008
- **Summary:** Throws away unpublished drafts while keeping whatever is live.
- **Actors & access:** Platform admin.
- **UX & screens:** "Discard" button opens a browser confirm ("Discard all unpublished drafts? ..."); toast "Drafts discarded - N reverted"; the whole editor page then reloads to resync sections.
- **Endpoints:**
  | Endpoint                     | Name                   | Action                           | Middleware                                   | Request                      | Response                      |
  | ---------------------------- | ---------------------- | -------------------------------- | -------------------------------------------- | ---------------------------- | ----------------------------- |
  | POST /admin/frontend/discard | admin.frontend.discard | FrontendEditorController@discard | Authenticate, EnsureUserIsAdmin, IPAllowlist | `scope` = `all` or page slug | `{ok:true,reverted:N}` or 422 |
- **Data:** rows with `draft != published`: never-published rows (published null/empty) are deleted; others get `draft := published`.
- **Rules & edge cases:**
  1. Page scope uses the same prefix rule as publish (WD-CMS-024).
  2. Audit `admin.frontend.discard`.
  3. Deleted draft-only rows also revert to the shipped default.
- **Async & events:** cache bust.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a draft on a live key, When discarded, Then the draft equals the live value again.
  - Given a draft on a never-published key, When discarded, Then the row is removed and the default shows.
- **Source refs:** as WD-CMS-024.
- **Port notes:** Same as publish.

### WD-CMS-026 — Reset to shipped defaults (field, page, theme, site)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CMS-008
- **Summary:** Deletes stored content so the shipped default appears again: one field (inspector), one page, all theme colours, or the entire site.
- **Actors & access:** Platform admin.
- **UX & screens:** Inspector "Reset this field" (no confirm); panel buttons "Reset this page", "Reset all colours", "Reset entire site" with a browser confirm ("Reset ... to shipped defaults? This clears edits and drafts.").
- **Endpoints:**
  | Endpoint                   | Name                 | Action                         | Middleware                                   | Request                                                        | Response                                                                |
  | -------------------------- | -------------------- | ------------------------------ | -------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------- |
  | POST /admin/frontend/reset | admin.frontend.reset | FrontendEditorController@reset | Authenticate, EnsureUserIsAdmin, IPAllowlist | `key` (single field) OR `scope` in `all`, `theme`, a page slug | `{ok:true}` / `{ok:true,deleted:N}` or 422 `{error:"Nothing to reset"}` |
- **Data:** deletes rows: exact `ckey`, or LIKE prefix (`theme.` or `<page>.`), or everything.
- **Rules & edge cases:**
  1. QUIRK: reset is immediate and hits the LIVE site, because it deletes both draft and published values; it is not a draft. The confirmation copy only says "clears edits and drafts".
  2. Page scope removes only keys prefixed `<page>.`; shared component keys (`nav.*`, `footer.*`, `hero-home.*`, `pricing-strip.*`, `logo-strip.*`, etc.) survive a page reset and only `all` clears them. It also clears `<page>.__hidden/__order`.
  3. `scope=all` also deletes the theme and every key; it does not touch `frontend_enabled`.
  4. Cache is flushed explicitly because bulk deletes bypass model events. Audit `admin.frontend.reset`.
- **Async & events:** cache flush.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a published headline, When "Reset this field" is used, Then the public page immediately shows the shipped headline.
  - Given scope `theme`, When posted, Then all `theme.*` rows are deleted and the response reports the count.
  - Given scope `bogus`, When posted, Then 422 "Nothing to reset".
- **Source refs:** `app/Http/Controllers/Admin/FrontendEditorController.php` (`reset`), `public/js/frontend-editor.js`.
- **Port notes:** Make reset a draft operation (write tombstones) so it is reversible until publish; that is an intentional improvement over the reference.

### WD-CMS-027 — Editor image upload

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CMS-018
- **Summary:** An endpoint stores an uploaded image under the public web folder and optionally records its URL as an image draft for a key. No page template declares an image-type editable field and the editor UI has no upload control, so the endpoint is currently unreachable from the product.
- **Actors & access:** Platform admin.
- **UX & screens:** none (the route URL is exposed to the shell script config but never used).
- **Endpoints:**
  | Endpoint                    | Name                  | Action                          | Middleware                                   | Request                                                                                                           | Response        |
  | --------------------------- | --------------------- | ------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------- |
  | POST /admin/frontend/upload | admin.frontend.upload | FrontendEditorController@upload | Authenticate, EnsureUserIsAdmin, IPAllowlist | multipart `file` (required image, mimes jpg, jpeg, png, webp, gif, svg; max 4096 KB), `key` (optional, key regex) | `{ok:true,url}` |
- **Data:** file saved to `public/uploads/frontend/<24 random chars>.<ext>`; if `key` given, image-typed draft row with the absolute URL.
- **Rules & edge cases:**
  1. Files go to the local public folder, ignoring the configured cloud media disk (unlike blog images).
  2. SVG is listed in `mimes`, but Laravel's base `image` rule rejects SVG by default, so SVG uploads are probably refused; verify.
  3. Audit `admin.frontend.upload` only when a key is supplied.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a 1 MB PNG and key `hero.image`, When posted, Then a file exists under the uploads folder and an image draft holds its URL.
  - Given a 5 MB file, When posted, Then 422 (max 4096 KB).
- **Source refs:** `app/Http/Controllers/Admin/FrontendEditorController.php` (`upload`), `resources/views/admin/frontend/index.blade.php`.
- **Port notes:** Use the platform object storage adapter (SET) and return media ids; only build if image blocks are introduced.

### WD-CMS-028 — Homepage kill-switch

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CMS-001
- **Summary:** A toggle in the editor toolbar turns the public homepage off (visitors are redirected to login or the app) without affecting any other public page.
- **Actors & access:** Platform admin.
- **UX & screens:** Toggle labelled "Homepage" with tooltip; success toast "Homepage enabled - public site is live" or "Homepage disabled - visitors go to login"; on failure the switch reverts.
- **Endpoints:**
  | Endpoint                             | Name                           | Action                                  | Middleware                                   | Request           | Response            |
  | ------------------------------------ | ------------------------------ | --------------------------------------- | -------------------------------------------- | ----------------- | ------------------- |
  | POST /admin/frontend/toggle-frontend | admin.frontend.toggle-frontend | FrontendEditorController@toggleFrontend | Authenticate, EnsureUserIsAdmin, IPAllowlist | `enabled` boolean | `{ok:true,enabled}` |
- **Data:** `system_settings.frontend_enabled` (int 1/0, type `int`), saved immediately (not a draft).
- **Rules & edge cases:**
  1. Applies only to `GET /` (WD-CMS-001).
  2. Audit `admin.frontend.toggle` with label enabled/disabled.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `frontend_enabled` default on (true) when the key is absent.
- **Acceptance criteria:**
  - Given enabled=0 is posted, When a guest opens `/`, Then they are redirected to login.
  - Given enabled=1 is posted, When a guest opens `/`, Then the marketing homepage renders.
- **Source refs:** `app/Http/Controllers/Admin/FrontendEditorController.php`, `app/Http/Controllers/FrontendController.php`, `public/js/frontend-editor.js`.
- **Port notes:** Platform setting in SET; the CMS reads it. Consider making it apply to the whole site as an option.

### WD-CMS-029 — Admin blog post list

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CMS-030
- **Summary:** `/admin/blog` lists all posts with four KPI tiles, search, a status filter and 15-per-page pagination.
- **Actors & access:** Platform admin (`auth`, `admin`, `ip.allowlist`). No granular permission key. Sidebar entry "Blog" under System.
- **UX & screens:** `resources/views/admin/blog/index.blade.php`. Header search box (GET `q`), "New post" button, KPI tiles (Total posts, Published, Drafts, Total views), toolbar (search, status select All/Published/Draft, Filter, Clear), table columns: thumbnail (or placeholder), title + `/blog/<slug>`, category, status badge (Published/Draft), views, date (`published_at` else `created_at`, `M j, Y`), actions Edit / Publish or Unpublish (POST form) / Delete (confirm "Delete this post? This cannot be undone."). Empty state "No posts yet" with link. Flash messages via `x-admin.flash`. Pagination keeps the query string.
- **Endpoints:**
  | Endpoint        | Name             | Action               | Middleware                                   | Request                                  | Response |
  | --------------- | ---------------- | -------------------- | -------------------------------------------- | ---------------------------------------- | -------- |
  | GET /admin/blog | admin.blog.index | BlogController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | `q`, `status` (draft, published), `page` | HTML     |
- **Data:** `blog_posts` ordered by `created_at` desc (`latest()`), eager-load `category`; search LIKE (escaped) on `title` OR `slug`; status filter exact on `status`; KPIs: count, count published, count draft, sum of `views`.
- **Rules & edge cases:**
  1. "Published" KPI and badge reflect the `status` column only; a post scheduled for the future is counted and badged as Published although the public site does not show it yet.
  2. An invalid `status` value is ignored (no filter).
  3. The sitemap download link mentioned in code comments is not on this page; it lives on the SEO settings screen (WD-CMS-051).
- **Async & events:** none.
- **External systems:** media disk for thumbnails.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 40 posts, When `/admin/blog` loads, Then 15 rows show newest-created first and the KPIs count all 40.
  - Given `q=launch`, When submitted, Then only posts whose title or slug contains "launch" show.
  - Given `status=draft`, When submitted, Then only drafts show.
  - Given a non-admin user, When requesting the page, Then 403.
- **Source refs:** `app/Http/Controllers/Admin/BlogController.php` (`index`), `resources/views/admin/blog/index.blade.php`, `components/admin/sidebar.blade.php`.
- **Port notes:** Admin list endpoint with cursor pagination; separate "live" vs "scheduled" badges as an improvement.

### WD-CMS-030 — Create and edit blog post

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-CMS-029
- **Summary:** One form creates or edits a post: title, slug, excerpt, HTML body, featured image, tags, author name, status, publish date, featured flag and category (existing or created inline). Publishing at a future date schedules the post.
- **Actors & access:** Platform admin.
- **UX & screens:** `admin/blog/create.blade.php` (also used for edit). Main column: Title (required, max 200), Slug (mono, placeholder "auto from title"), Excerpt (textarea 2 rows, max 500), Content (HTML textarea 18 rows, required in the form; plain HTML, "Full article HTML"), Featured image (file input, current image preview, "leave blank to keep"), Tags (comma-separated), Author name (placeholder brand). Sidebar: Status select (Draft/Published), Publish date (`datetime-local`, "Set a future time to schedule"), "Feature this post" switch, submit; Category select ("None" + all categories by name) and "Or create new" text (max 120). Validation errors are listed at the top. There is no rich-text editor, no image upload inside the body and no per-post SEO card (removed from the UI; SEO is centralised, see WD-CMS-016). Docs claim a rich-text body with inline images and a cover image; the code has a raw HTML textarea only.
- **Endpoints:**
  | Endpoint                  | Name              | Action                | Middleware  | Request                | Response                          |
  | ------------------------- | ----------------- | --------------------- | ----------- | ---------------------- | --------------------------------- |
  | GET /admin/blog/create    | admin.blog.create | BlogController@create | admin group | none                   | HTML                              |
  | POST /admin/blog          | admin.blog.store  | BlogController@store  | admin group | form (below) multipart | 302 to index, flash "Post saved." |
  | GET /admin/blog/{id}/edit | admin.blog.edit   | BlogController@edit   | admin group | id                     | HTML (404 if missing)             |
  | PUT /admin/blog/{id}      | admin.blog.update | BlogController@update | admin group | form multipart         | 302 to index, flash "Post saved." |
- **Data:** writes `blog_posts`, and `blog_categories` for inline categories. Validation: `title` required string max 200; `slug` nullable string max 200; `excerpt` nullable max 500; `body` nullable string; `category_id` nullable integer existing in `blog_categories`; `new_category` nullable max 120; `tags` nullable string max 500; `author_name` nullable max 120; `status` required in `draft,published`; `published_at` nullable date; `is_featured` nullable boolean; `featured_image` and `og_image` nullable image max 8192 KB; `meta_title` max 200; `meta_description` max 320; `meta_keywords` max 255; `canonical_url` nullable url max 255; `noindex` nullable boolean.
- **Rules & edge cases:**
  1. Category: if `new_category` is filled, a new category is created (unique slug via `-2`, `-3` suffixes) and assigned, overriding `category_id`. Typing an existing name creates a duplicate category (name is not unique). There is no screen to rename, delete or reorder categories; columns `description` and `sort_order` are unused.
  2. Slug: blank on create generates `slugify(title)`, made unique with `-2`, `-3`... (fallback base "post"); blank on edit keeps the existing slug; a supplied slug is slugified. QUIRK: on edit a supplied slug is not re-checked for uniqueness; a collision hits the DB unique index and surfaces as a server error. Changing a slug breaks old links (no redirects).
  3. `published_at`: an explicit date wins (interpreted in the app timezone, no timezone selector); else status published keeps the existing value or sets now; a draft keeps its existing value or stays null. The public scope requires `status=published` and `published_at` null or <= now, so future dates act as scheduling with no scheduler job.
  4. `is_featured` sent as hidden 0 plus checkbox 1; multiple posts can be featured.
  5. `tags`: split on commas, trimmed, blanks dropped, stored as JSON array (null if empty); no dedupe or lowercasing; UI prefill joins with ", ".
  6. Images are stored on the active media disk under `blog/` (cloud when enabled, local otherwise); replacing an image deletes the old file if it exists; `og_image` can only be set by a crafted request since the field is not in the form (it then also used as social image).
  7. Per-post SEO fields (`meta_title`, `meta_description`, `meta_keywords`, `canonical_url`, `noindex`) are still accepted and honored by the public page and sitemap, but the form no longer exposes them; a port should decide whether to restore them.
  8. `body` is stored unsanitized (see WD-CMS-012). The form marks it required but the server allows null.
  9. No audit log is written for blog changes, and views are read-only (never edited).
- **Async & events:** none (no scheduler; publication is time-evaluated at read).
- **External systems:** object storage when a cloud media provider is enabled (SET).
- **Settings:** storage/cloud media settings (SET).
- **Acceptance criteria:**
  - Given a title only and status draft, When the form is submitted, Then a draft post is created with a generated unique slug and no public visibility.
  - Given a title equal to an existing post's title, When submitted with a blank slug, Then the slug gets a numeric suffix.
  - Given `new_category` "Guides", When submitted, Then a category "Guides" is created and assigned to the post.
  - Given status published and a `published_at` two days ahead, When submitted, Then the post is saved as Published but is absent from `/blog` until that time.
  - Given a 9 MB image, When submitted, Then a validation error for `featured_image` is shown.
  - Given tags "a, b,,c", When submitted, Then the stored tags are ["a","b","c"].
- **Source refs:** `app/Http/Controllers/Admin/BlogController.php` (`persist`, `parseTags`), `app/Models/BlogPost.php`, `app/Models/BlogCategory.php`, `resources/views/admin/blog/create.blade.php`, `database/migrations/2026_06_24_160000_create_blog_tables.php`, `Documentation/pages/admin-panel/blog.html`.
- **Port notes:** Module `cms` with `blog-posts` and `blog-categories` resources; add a real editor (Tiptap or similar) producing sanitized HTML; add category CRUD; enforce slug uniqueness on update; consider slug redirects. Timezone: store UTC and use an explicit tz-aware date picker.

### WD-CMS-031 — Publish or unpublish a blog post

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CMS-029
- **Summary:** A one-click toggle in the list flips a post between draft and published.
- **Actors & access:** Platform admin.
- **UX & screens:** Row action button "Publish" / "Unpublish"; flash "Published." or "Moved to draft.".
- **Endpoints:**
  | Endpoint                     | Name              | Action                | Middleware  | Request | Response            |
  | ---------------------------- | ----------------- | --------------------- | ----------- | ------- | ------------------- |
  | POST /admin/blog/{id}/toggle | admin.blog.toggle | BlogController@toggle | admin group | id      | 302 back with flash |
- **Data:** updates `status`; on draft-to-published sets `published_at` = now only when it was empty.
- **Rules & edge cases:**
  1. Unpublish keeps `published_at`, so re-publishing later restores the original date (a past date), not now.
  2. If a future `published_at` exists, toggling to published leaves the post scheduled.
  3. 404 for unknown id. No audit entry.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a draft with no `published_at`, When toggled, Then status is published, `published_at` is now and the post appears on `/blog`.
  - Given a published post, When toggled, Then status is draft, `published_at` unchanged and `/blog/<slug>` returns 404.
- **Source refs:** `app/Http/Controllers/Admin/BlogController.php` (`toggle`).
- **Port notes:** Emit a cache-purge event for `/blog` and the sitemap.

### WD-CMS-032 — Delete a blog post

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CMS-029
- **Summary:** Permanently deletes a post and its stored images.
- **Actors & access:** Platform admin.
- **UX & screens:** Trash button with browser confirm; flash "Post deleted." and redirect to the list.
- **Endpoints:**
  | Endpoint                | Name               | Action                 | Middleware  | Request | Response    |
  | ----------------------- | ------------------ | ---------------------- | ----------- | ------- | ----------- |
  | DELETE /admin/blog/{id} | admin.blog.destroy | BlogController@destroy | admin group | id      | 302 to list |
- **Data:** deletes `blog_posts` row (hard delete, no soft delete); deletes `featured_image` and `og_image` files from the media disk when they exist. Category rows are kept.
- **Rules & edge cases:**
  1. Irreversible; no audit log; deleting the last post of a category leaves an empty category that still appears in filters and the sitemap.
  2. Public URL then returns 404.
- **Async & events:** none.
- **External systems:** object storage delete when cloud media is enabled.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a post with a featured image, When deleted, Then the row is gone and the image file is removed from storage.
  - Given an unknown id, When requested, Then 404.
- **Source refs:** `app/Http/Controllers/Admin/BlogController.php` (`destroy`).
- **Port notes:** Prefer soft delete plus audit; keep image cleanup in a worker.

### WD-CMS-033 — Admin legal pages list (self-healing)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CMS-036
- **Summary:** `/admin/legal-pages` shows the five legal documents as cards with status and quick actions. Visiting the page creates any missing canonical rows.
- **Actors & access:** Platform admin. Reached from the Settings hub tile ("Legal pages"); not in the sidebar.
- **UX & screens:** `admin/legal-pages/index.blade.php`: card grid (3 columns) with title, `/legal/<slug>`, Live/Hidden pill, "N sections" and "Updated <label>", buttons Edit, View (new tab), Hide/Publish.
- **Endpoints:**
  | Endpoint               | Name                    | Action                     | Middleware  | Request | Response |
  | ---------------------- | ----------------------- | -------------------------- | ----------- | ------- | -------- |
  | GET /admin/legal-pages | admin.legal-pages.index | LegalPagesController@index | admin group | none    | HTML     |
- **Data:** `legal_pages` ordered by `sort` then `id`; `firstOrCreate` for each canonical slug (terms, privacy, refund, cookies, acceptable-use) with default title, `is_published` true and empty `sections`.
- **Rules & edge cases:**
  1. QUIRK: the self-heal creates published rows with no sections, which disables the static fallback in WD-CMS-013 and makes the public page render empty until edited.
  2. Only the five canonical slugs exist; there is no create/delete/rename of pages.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an empty `legal_pages` table, When the admin opens the page, Then five rows are created and five cards appear.
  - Given an unpublished page, When listed, Then the card shows Hidden and a Publish button.
- **Source refs:** `app/Http/Controllers/Admin/LegalPagesController.php` (`index`), `app/Models/LegalPage.php`, `resources/views/admin/legal-pages/index.blade.php`, `resources/views/admin/settings/index.blade.php`.
- **Port notes:** Seed rows in a migration; do not create rows in a GET.

### WD-CMS-034 — Edit a legal page

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-CMS-033
- **Summary:** Edit title, subtitle, "updated" and "effective" date labels, publish flag, and an ordered list of numbered sections (number, heading, HTML body) with add, remove, move and preview.
- **Actors & access:** Platform admin.
- **UX & screens:** `admin/legal-pages/edit.blade.php` and `resources/js/charts/admin-legal-pages-edit.js`. Header card fields: Title (required), Subtitle (2-row textarea), Updated date label, Effective date label (free text like "March 14, 2026"), Published checkbox. Sections: each row has number input (mono), heading input, Move up, Move down, Remove, HTML textarea (6 rows, monospace) with hint on allowed tags and a Preview toggle that renders the HTML in a styled box live; "Add section" button appends a blank row and focuses its heading. Input names are re-indexed sequentially after every mutation. Tip text: empty sections are deleted on save; blank numbers are auto-filled.
- **Endpoints:**
  | Endpoint                           | Name                     | Action                      | Middleware  | Request                                                                      | Response                |
  | ---------------------------------- | ------------------------ | --------------------------- | ----------- | ---------------------------------------------------------------------------- | ----------------------- |
  | GET /admin/legal-pages/{slug}/edit | admin.legal-pages.edit   | LegalPagesController@edit   | admin group | slug                                                                         | HTML (404 unknown slug) |
  | PATCH /admin/legal-pages/{slug}    | admin.legal-pages.update | LegalPagesController@update | admin group | title, subtitle, updated_label, effective_label, is_published, sections[i][n | title                   | body] | 302 back, flash "<title> saved." |
- **Data:** updates `legal_pages`. Validation: `title` required max 160; `subtitle` nullable max 1000; `updated_label`, `effective_label` nullable max 120; `sections` nullable array; `sections.*.n` max 12; `sections.*.title` max 200; `sections.*.body` any string.
- **Rules & edge cases:**
  1. Sections are rebuilt on save: trimmed number/title, body kept verbatim; rows with empty title AND empty tag-stripped body are dropped; blank numbers are auto-numbered by final position as two-digit strings ("01", "02", ...); order is the submitted order.
  2. Blank subtitle/labels are stored as null.
  3. QUIRK: `is_published` is a plain checkbox; unchecking it and saving unpublishes the page (404 publicly).
  4. Bodies are raw HTML rendered without sanitization on the public page.
  5. Audit `legal_page.updated` (layer `platform`, meta slug and section count).
  6. Slug and sort order cannot be edited.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given three filled sections and one empty row, When saved, Then three sections are stored and the empty one is dropped.
  - Given a blank number on section 2, When saved, Then its number becomes "02".
  - Given is_published unchecked, When saved, Then `/legal/<slug>` returns 404 and the audit log has `legal_page.updated`.
  - Given an unknown slug, When editing, Then 404.
- **Source refs:** `app/Http/Controllers/Admin/LegalPagesController.php`, `resources/views/admin/legal-pages/edit.blade.php`, `resources/js/charts/admin-legal-pages-edit.js`.
- **Port notes:** JSONB `sections`; validate ordering server-side; sanitize HTML; keep audit.

### WD-CMS-035 — Toggle legal page visibility

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CMS-033
- **Summary:** Hide or publish a legal page from the list card.
- **Actors & access:** Platform admin.
- **UX & screens:** Card button "Hide" / "Publish"; flash "<title> published." or "<title> hidden.".
- **Endpoints:**
  | Endpoint                              | Name                     | Action                      | Middleware  | Request | Response |
  | ------------------------------------- | ------------------------ | --------------------------- | ----------- | ------- | -------- |
  | POST /admin/legal-pages/{slug}/toggle | admin.legal-pages.toggle | LegalPagesController@toggle | admin group | slug    | 302 back |
- **Data:** flips `is_published`.
- **Rules & edge cases:**
  1. Audit `legal_page.toggled` (meta slug, published).
  2. Hiding a legal page does not remove footer links to it; visitors get a 404.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a published page, When toggled, Then it is hidden and `/legal/<slug>` returns 404.
  - Given an unknown slug, When posted, Then 404.
- **Source refs:** `app/Http/Controllers/Admin/LegalPagesController.php` (`toggle`).
- **Port notes:** Warn when hiding a page that checkout or signup links to.

### WD-CMS-036 — Legal pages seed data

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** none
- **Summary:** On install, the five legal documents are created from the app's original static templates so the admin editor starts pre-filled. Idempotent: never overwrites rows that already have sections.
- **Actors & access:** Installer / `db:seed` (DatabaseSeeder and the web installer run it).
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** seeded rows (`sort` 1-5): terms "Terms of Service" (15 sections), privacy "Privacy Policy" (11), refund "Refund & Payment Policy" (9), cookies "Cookie Policy" (8), acceptable-use "Acceptable Use Policy" (7); all published. The seeder extracts title, subtitle, dates and sections by evaluating PHP expressions found in the static Blade files (the static Blades are also the runtime fallback).
- **Rules & edge cases:**
  1. Existing rows with non-empty `sections` are skipped; a blank self-healed row is filled in.
  2. `brand_name()` is resolved at seed time so text reads with the live brand.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an empty table, When the seeder runs, Then five published rows with the section counts above exist.
  - Given an admin-edited row, When the seeder re-runs, Then it is unchanged.
- **Source refs:** `database/seeders/LegalPagesSeeder.php`, `database/seeders/DatabaseSeeder.php`, `app/Http/Controllers/InstallController.php`, `resources/views/frontend/legal/*.blade.php`.
- **Port notes:** Author new neutral template documents (do not copy WaDesk's legal text) and mark them "template, review with counsel". Seed through a migration or seed script with idempotent upserts by slug.

### WD-CMS-037 — Pricing FAQ list and create

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CMS-010
- **Summary:** `/admin/pricing-faqs` manages FAQ rows shown on the in-app plans page and checkout, the homepage FAQ slider and the mobile FAQ endpoint. Rows have a display placement and sort order.
- **Actors & access:** Platform admin. Linked from Admin Checkout settings (`admin/checkout-settings`). No sidebar entry.
- **UX & screens:** `admin/pricing-faqs/index.blade.php`. "New FAQ" card: Question (required), Answer (textarea, plain text), Sort order (number, blank = auto), Shows on (Pricing page / Homepage slider / Both), Active toggle (default on), "Add FAQ". Existing FAQs render as one form per row (same fields plus Save) and a separate delete form ("Delete FAQ #id" with a confirm that says it disappears from the public pricing page immediately). Footer shows id and last-updated. Empty state "No FAQs yet". Intro copy says "the accordion shown at the bottom of the plans page".
- **Endpoints:**
  | Endpoint                 | Name                     | Action                     | Middleware  | Request                                            | Response                       |
  | ------------------------ | ------------------------ | -------------------------- | ----------- | -------------------------------------------------- | ------------------------------ |
  | GET /admin/pricing-faqs  | admin.pricing-faqs.index | PricingFaqController@index | admin group | none                                               | HTML                           |
  | POST /admin/pricing-faqs | admin.pricing-faqs.store | PricingFaqController@store | admin group | question, answer, sort_order, placement, is_active | 302 back, flash "FAQ created." |
- **Data:** `pricing_faqs` ordered by `sort_order`, `id`. Validation: `question` required max 255; `answer` required max 5000; `sort_order` nullable integer 0-9999; `placement` nullable in `pricing, home, both` (default `pricing`).
- **Rules & edge cases:**
  1. On create a blank `sort_order` becomes max(sort_order)+1 (1 on an empty table; the max of an empty table is null, so null+1 = 1).
  2. `is_active` is true only if the checkbox is present (`!empty(...)`); with the checkbox absent the row is created inactive.
  3. Consumers: in-app `/account/plans` and `/checkout/{id}` show ALL active rows regardless of placement, the homepage slider uses `home` and `both`, and the mobile `GET api/app/faq` lists all active rows. Rows with placement `pricing` never show on the public `/pricing` page (that page uses editor copy, WD-CMS-003/010).
  4. Answers render as plain text (`whitespace-pre-line` on the plans page); the admin placeholder says markdown is not supported.
  5. No audit entry.
  6. CheckoutDefaultsSeeder seeds six FAQs (switch plans, exceeding quota, refund, yearly discount, own gateway, free tier) when the table is empty.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given sort_order left blank, When a FAQ is created, Then its sort_order is max+1.
  - Given placement `home` and active, When the homepage renders, Then it appears in the slider.
  - Given the Active toggle off, When created, Then the row exists but is hidden everywhere.
  - Given an answer over 5000 chars, When submitted, Then a validation error is shown.
- **Source refs:** `app/Http/Controllers/Admin/PricingFaqController.php`, `app/Models/PricingFaq.php`, `resources/views/admin/pricing-faqs/index.blade.php`, `database/migrations/2026_05_21_010000_create_coupons_and_pricing_faqs.php`, `database/migrations/2026_06_24_170000_add_placement_to_pricing_faqs.php`, `database/seeders/CheckoutDefaultsSeeder.php`, `app/Http/Controllers/{PricingController,CheckoutController}.php`.
- **Port notes:** Table `faqs` (platform-level) with `placements` array; seed defaults; expose `GET /public/faqs?placement=`.

### WD-CMS-038 — Update, toggle and delete a pricing FAQ

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CMS-037
- **Summary:** Edit a FAQ in place, flip its active flag, or delete it.
- **Actors & access:** Platform admin.
- **UX & screens:** Inline row form (Save); delete link per row. The toggle endpoint exists but the current screen offers no separate toggle button (the Active switch is saved with the row form).
- **Endpoints:**
  | Endpoint                             | Name                       | Action                       | Middleware  | Request                                            | Response                               |
  | ------------------------------------ | -------------------------- | ---------------------------- | ----------- | -------------------------------------------------- | -------------------------------------- |
  | PATCH /admin/pricing-faqs/{id}       | admin.pricing-faqs.update  | PricingFaqController@update  | admin group | question, answer, sort_order, placement, is_active | 302 back "FAQ updated."                |
  | POST /admin/pricing-faqs/{id}/toggle | admin.pricing-faqs.toggle  | PricingFaqController@toggle  | admin group | id                                                 | 302 back "Activated." / "Deactivated." |
  | DELETE /admin/pricing-faqs/{id}      | admin.pricing-faqs.destroy | PricingFaqController@destroy | admin group | id                                                 | 302 back "FAQ removed."                |
- **Data:** same validation as WD-CMS-037.
- **Rules & edge cases:**
  1. On update a blank `sort_order` is saved as null in the validated payload; since the column is NOT NULL unsigned, a blank value would either write null (rejected by the DB) or, depending on the ConvertEmptyStrings middleware, fail; verify. The UI always prefills the current value, so normal use is safe.
  2. Update sets `is_active` from the checkbox presence, so a row form without the checkbox deactivates the row.
  3. Delete is a hard delete.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active FAQ, When the toggle endpoint is posted, Then it becomes inactive and disappears from consumers.
  - Given a FAQ, When deleted, Then it is removed everywhere immediately.
  - Given unknown id, When patched, Then 404.
- **Source refs:** `app/Http/Controllers/Admin/PricingFaqController.php`.
- **Port notes:** Add reorder by drag; add audit.

### WD-CMS-039 — Announcements list and stats

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CMS-040
- **Summary:** `/admin/announcements` lists marquee announcements with counts and filters by status.
- **Actors & access:** Platform admin. Sidebar Marketing group > Announcements, with a badge showing the count of announcements where `is_active` is true (regardless of window).
- **UX & screens:** `admin/announcements/index.blade.php`. Stat tiles: Total, Live now (active and inside window), Scheduled (`starts_at` in the future), Expired (`expires_at` in the past). Status pills: All, Live now, Disabled, Expired; search box (text or link label). Table: order, message + link, tone chip, window ("forever" or from/to), Active toggle (POST), Edit, Delete (confirm). Pagination 12. Empty state "No announcements yet".
- **Endpoints:**
  | Endpoint                 | Name                      | Action                        | Middleware  | Request                                                | Response |
  | ------------------------ | ------------------------- | ----------------------------- | ----------- | ------------------------------------------------------ | -------- |
  | GET /admin/announcements | admin.announcements.index | AnnouncementsController@index | admin group | `status` (all, active, inactive, expired), `q`, `page` | HTML     |
- **Data:** `announcements`; filters: `active` uses the model scope (active AND within window), `inactive` = `is_active` false, `expired` = `expires_at` not null and < now; search LIKE (not escaped) on `text` or `link_label`; order `sort_order` asc then `id` desc.
- **Rules & edge cases:**
  1. "Expired" filter ignores `is_active`. A disabled and expired row appears under both Disabled and Expired.
  2. The admin sidebar badge counts `is_active` only.
  3. Search does not escape `%` and `_`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given three live, one scheduled and two expired announcements, When the index loads, Then the tiles show Live 3, Scheduled 1, Expired 2.
  - Given status=expired, When filtered, Then only rows with `expires_at` in the past show.
- **Source refs:** `app/Http/Controllers/Admin/AnnouncementsController.php` (`index`), `app/Models/Announcement.php`, `resources/views/admin/announcements/index.blade.php`, `components/admin/sidebar.blade.php`, `app/Http/Controllers/AdminPagesController.php` (`announcements` stub, unrouted).
- **Port notes:** Compute status server-side and return it as an enum (draft, scheduled, live, expired, disabled).

### WD-CMS-040 — Create and edit an announcement (schedule and timezone)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CMS-039
- **Summary:** Create or edit a marquee message with tone, optional link and CTA label, dismissibility, a sort order and an optional schedule window entered in a chosen timezone.
- **Actors & access:** Platform admin.
- **UX & screens:** `admin/announcements/{create,edit,_form}.blade.php`, `resources/js/charts/admin-announcements-form.js` (timezone picker `lib/tz-picker.js`, Tom Select; default zone from app timezone; zone list from `Intl.supportedValuesOf('timeZone')` with a short fallback list). Three cards: Message (Text required max 500, Tone Info/Promo/Warning/Success), Link and visibility (Link URL max 500 "/pricing or https://...", Link label max 64, Active switch default on, Dismissible switch default on), Scheduling (Timezone, Starts at, Expires at as `datetime-local`, Sort order 0-9999 default 0). Edit header shows an Active/Disabled pill and the current window.
- **Endpoints:**
  | Endpoint                           | Name                       | Action                         | Middleware  | Request | Response                             |
  | ---------------------------------- | -------------------------- | ------------------------------ | ----------- | ------- | ------------------------------------ |
  | GET /admin/announcements/create    | admin.announcements.create | AnnouncementsController@create | admin group | none    | HTML                                 |
  | POST /admin/announcements          | admin.announcements.store  | AnnouncementsController@store  | admin group | form    | 302 to index "Announcement created." |
  | GET /admin/announcements/{id}/edit | admin.announcements.edit   | AnnouncementsController@edit   | admin group | id      | HTML                                 |
  | PATCH /admin/announcements/{id}    | admin.announcements.update | AnnouncementsController@update | admin group | form    | 302 back "Announcement updated."     |
- **Data:** validation: `text` required string max 500; `link_url` nullable string max 500 (no URL check); `link_label` nullable max 64; `tone` nullable in `info,promo,warning,success` (default info); `sort_order` nullable integer 0-9999 (default 0); `starts_at` nullable date; `expires_at` nullable date and `after_or_equal:starts_at`; `input_timezone` nullable max 64; `is_active` and `dismissible` cast from checkbox/hidden inputs.
- **Rules & edge cases:**
  1. The raw datetime-local strings are parsed in the chosen timezone (default `app.timezone`, env `APP_TIMEZONE` default UTC). The docs say they are converted to UTC for storage. QUIRK: the code hands the timezone-aware Carbon straight to Eloquent, which formats the wall-clock time without converting to the app timezone, so a non-default zone is likely stored as if it were app time and the edit form re-displays the stored value as-is. Verify live before porting, and in the port store proper UTC instants.
  2. Unparseable dates silently become null (no error).
  3. Cache `announcements.active.v1` is cleared on every write.
  4. Changes are audit-logged automatically by the model observer (`announcement.created`, `announcement.updated`, with a compact changes payload).
  5. Docs call the bar visible "on every signed-in page"; the same rows also feed the public ticker (WD-CMS-017).
  6. Announcement `link_url` is not validated (could be `javascript:`).
- **Async & events:** cache bust; audit via observer.
- **External systems:** none.
- **Settings:** `APP_TIMEZONE`.
- **Acceptance criteria:**
  - Given text only, When created, Then tone info, active, dismissible, sort 0 are stored and the message appears in the bar within the cache window or immediately after the cache bust.
  - Given `expires_at` earlier than `starts_at`, When submitted, Then a validation error appears.
  - Given a start time in the future, When created, Then the row is counted Scheduled and not shown until then.
  - Given text over 500 chars, When submitted, Then a validation error appears.
- **Source refs:** `app/Http/Controllers/Admin/AnnouncementsController.php` (`payload`), `app/Models/Announcement.php`, `resources/views/admin/announcements/*.blade.php`, `resources/js/charts/admin-announcements-form.js`, `resources/js/lib/tz-picker.js`, `database/migrations/2026_05_21_105310_create_announcements_table.php`, `Documentation/pages/admin-panel/announcements.html`.
- **Port notes:** Store `timestamptz`; accept ISO strings with an explicit IANA zone; validate link scheme; Zod schema in `@crm/contracts`.

### WD-CMS-041 — Toggle and delete an announcement

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CMS-039
- **Summary:** Quick enable/disable and hard delete from the list.
- **Actors & access:** Platform admin.
- **UX & screens:** Active switch button per row; Delete with a styled confirm ("Delete announcement").
- **Endpoints:**
  | Endpoint                              | Name                        | Action                          | Middleware  | Request | Response                                                      |
  | ------------------------------------- | --------------------------- | ------------------------------- | ----------- | ------- | ------------------------------------------------------------- |
  | POST /admin/announcements/{id}/toggle | admin.announcements.toggle  | AnnouncementsController@toggle  | admin group | id      | 302 back "Announcement activated." / "Announcement disabled." |
  | DELETE /admin/announcements/{id}      | admin.announcements.destroy | AnnouncementsController@destroy | admin group | id      | 302 back "Announcement deleted."                              |
- **Data:** flips `is_active`; deletes row (hard delete).
- **Rules & edge cases:**
  1. Both bust the cache key `announcements.active.v1`.
  2. Observer writes `announcement.updated` / `announcement.deleted` audit rows.
- **Async & events:** cache bust, audit.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active announcement, When toggled, Then it disappears from the ticker and bar immediately.
  - Given an announcement, When deleted, Then it cannot be edited (404) and an audit row exists.
- **Source refs:** `app/Http/Controllers/Admin/AnnouncementsController.php`, `app/Observers/AuditableObserver.php`, `app/Providers/AppServiceProvider.php`.
- **Port notes:** Audit via the platform audit module (NOTIF).

### WD-CMS-042 — Contact inbox list, filters and search

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CMS-006
- **Summary:** `/admin/contact-messages` lists public contact-form submissions with unread and topic filters and search.
- **Actors & access:** Platform admin. Sidebar Support group > "Contact inbox" with an unread badge; the parent Support group badge adds open support tickets plus unread contact messages.
- **UX & screens:** `admin/contact-messages/index.blade.php`. Header with total and unread counts, "Mark all read" (only when unread > 0), search box (name, email, message), filter pills All / Unread / Sales / Support / Partnership / Other, message cards (sender name with `mailto:` link, topic chip, company, timestamp `M j, Y - H:i`, IP, message text, reply mailto button with prefilled subject "Re: your message", mark read/unread, delete with confirm), pagination 20, empty state "No messages yet".
- **Endpoints:**
  | Endpoint                    | Name                         | Action                          | Middleware  | Request                                                            | Response |
  | --------------------------- | ---------------------------- | ------------------------------- | ----------- | ------------------------------------------------------------------ | -------- |
  | GET /admin/contact-messages | admin.contact-messages.index | ContactMessagesController@index | admin group | `filter` (unread, sales, support, partnership, other), `q`, `page` | HTML     |
- **Data:** `contact_messages` newest first, paginate 20; search LIKE (escaped) across `name`, `email`, `company`, `message`; index `(is_read, created_at)`.
- **Rules & edge cases:**
  1. Unknown filter values are ignored. Search and filter combine.
  2. Reply is a mail client link; there is no in-product reply, threading or assignment (SUPP handles the ticket desk separately).
  3. No export, no retention or purge job; rows accumulate.
  4. The pills link to `?filter=` and drop the current search term.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 25 messages, When the page loads, Then 20 show newest first with total 25.
  - Given `filter=sales` and `q=acme`, When requested, Then only sales-topic messages matching "acme" show.
  - Given zero unread, When the page loads, Then "Mark all read" is not shown.
- **Source refs:** `app/Http/Controllers/Admin/ContactMessagesController.php`, `app/Models/ContactMessage.php`, `resources/views/admin/contact-messages/index.blade.php`, `components/admin/sidebar.blade.php`.
- **Port notes:** Platform-level table; optionally convert a message into a support ticket (SUPP) or a lead (CON) as an improvement.

### WD-CMS-043 — Contact message read state and delete

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CMS-042
- **Summary:** Toggle a message read/unread, mark all read, or delete one message.
- **Actors & access:** Platform admin.
- **UX & screens:** Per-card icon buttons; header "Mark all read".
- **Endpoints:**
  | Endpoint                               | Name                            | Action                                | Middleware  | Request | Response                       |
  | -------------------------------------- | ------------------------------- | ------------------------------------- | ----------- | ------- | ------------------------------ |
  | POST /admin/contact-messages/{id}/read | admin.contact-messages.read     | ContactMessagesController@markRead    | admin group | id      | 302 back (toggles)             |
  | POST /admin/contact-messages/read-all  | admin.contact-messages.read-all | ContactMessagesController@markAllRead | admin group | none    | 302 back "All marked as read." |
  | DELETE /admin/contact-messages/{id}    | admin.contact-messages.destroy  | ContactMessagesController@destroy     | admin group | id      | 302 back "Message deleted."    |
- **Data:** `contact_messages.is_read` update; hard delete.
- **Rules & edge cases:**
  1. The "read" endpoint toggles, it does not set true.
  2. Viewing the list does not mark anything read.
  3. Delete writes audit `admin.contact_message.deleted` (label = sender email); read-state changes are not audited.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an unread message, When toggled, Then it is read and the unread badge decrements.
  - Given five unread messages, When "Mark all read" is posted, Then unread count is 0.
  - Given a message, When deleted, Then it is gone and an audit row records the email.
- **Source refs:** `app/Http/Controllers/Admin/ContactMessagesController.php`.
- **Port notes:** Make mark-read idempotent (PUT with explicit state).

### WD-CMS-044 — Admin guidebook article list

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CMS-045
- **Summary:** `/admin/guidebook` lists help articles with KPI tiles, a category filter and search, and inline publish toggle.
- **Actors & access:** Platform admin. Sidebar Marketing group > Guidebook (badge = published article count).
- **UX & screens:** `admin/guidebook/index.blade.php`. KPI tiles: Total, Published, Drafts, Views (shown with helpful and not-helpful counts). Toolbar: category select (distinct values), search (title, body), Clear. Table (12 per page): sort order, title + `/guidebook/<slug>`, category chip, views, helpful percent (`helpful/(helpful+not)` rounded, or a dash), status pill (Live/Draft, click toggles), Edit, Delete (confirm). Empty state "No articles yet".
- **Endpoints:**
  | Endpoint             | Name                  | Action                    | Middleware  | Request                 | Response |
  | -------------------- | --------------------- | ------------------------- | ----------- | ----------------------- | -------- |
  | GET /admin/guidebook | admin.guidebook.index | GuidebookController@index | admin group | `q`, `category`, `page` | HTML     |
- **Data:** `guidebook_articles` ordered by `category`, `sort_order`, `title`; search LIKE (NOT escaped) on `title`, `slug`, `body`; category exact match; categories = distinct values (order unspecified).
- **Rules & edge cases:**
  1. QUIRK: KPI key is named `views_30d` but is the all-time sum of `views_count`.
  2. Category is free text, so casing variants create separate categories ("Getting started" seeded capitalized).
  3. `AdminPagesController@guidebook` is an unrouted stub (dead).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 32 seeded articles, When the page loads, Then Total 32 and 12 rows show on page 1 ordered by category then sort.
  - Given `category=Billing`, When filtered, Then only Billing articles appear.
- **Source refs:** `app/Http/Controllers/Admin/GuidebookController.php`, `app/Models/GuidebookArticle.php`, `resources/views/admin/guidebook/index.blade.php`.
- **Port notes:** Table `guidebook_articles` (platform-level); normalize category to a lookup table or slug.

### WD-CMS-045 — Create and edit a guidebook article

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CMS-044
- **Summary:** Author help articles in Markdown with title, optional slug, category, excerpt, sort order and a published flag.
- **Actors & access:** Platform admin.
- **UX & screens:** `admin/guidebook/edit.blade.php` (create and edit share it). Content card: Title (required max 200), Excerpt (max 500, "One-line summary shown on /guidebook"), Body (Markdown textarea 18 rows). Publishing card: Slug (pattern `[a-z0-9-]*`, placeholder "auto from title"), Category (required, max 80, datalist of existing categories, default "general"), Sort order (number min 0), Published switch (default on), and read-only stats on edit (views, thumbs up/down counts, first-published date).
- **Endpoints:**
  | Endpoint                       | Name                   | Action                     | Middleware  | Request      | Response                                  |
  | ------------------------------ | ---------------------- | -------------------------- | ----------- | ------------ | ----------------------------------------- |
  | GET /admin/guidebook/create    | admin.guidebook.create | GuidebookController@create | admin group | none         | HTML                                      |
  | POST /admin/guidebook          | admin.guidebook.store  | GuidebookController@store  | admin group | form         | 302 to index "Article "<title>" created." |
  | GET /admin/guidebook/{id}/edit | admin.guidebook.edit   | GuidebookController@edit   | admin group | id (numeric) | HTML                                      |
  | PATCH /admin/guidebook/{id}    | admin.guidebook.update | GuidebookController@update | admin group | form         | 302 to index "Article "<title>" updated." |
- **Data:** validation: `title` required max 200; `slug` nullable max 160 regex `^[a-z0-9-]*$`; `category` required max 80; `excerpt` nullable max 500; `body` nullable max 200000 characters; `is_published` boolean (defaults false when the request lacks it); `sort_order` nullable integer min 0.
- **Rules & edge cases:**
  1. Slug: supplied or title, slugified, uniqueness enforced with numeric suffix `-2`, `-3`... (an empty slug falls back to `article-<6 random chars>`). Editing keeps uniqueness excluding itself. Slugs are lowercase only, matching the user route constraint `[a-z0-9-]+`.
  2. `published_at`: create with published stamps now; update stamps now only on first publish (when null), un-publishing sets it to null (a later re-publish gets a new date).
  3. Body is Markdown; raw HTML in it is stripped at render time (WD-CMS-048).
  4. Counters (`views_count`, `helpful_count`, `not_helpful_count`) are not editable.
  5. Audit `guidebook.created` / `guidebook.updated` (subject `guidebook_article`; created carries title).
  6. `sort_order` blank stores null-or-default: validated null passes to the DB with default 0 (verify).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given title "Reset password" and blank slug, When created, Then slug `reset-password` (or `-2` if taken) is stored.
  - Given a slug with uppercase letters, When submitted, Then a validation error appears.
  - Given a draft article, When published via the form for the first time, Then `published_at` is set once and not changed on later edits.
  - Given category left as default, When created, Then category is "general".
- **Source refs:** `app/Http/Controllers/Admin/GuidebookController.php`, `resources/views/admin/guidebook/edit.blade.php`, `database/migrations/2026_05_23_163209_create_guidebook_articles_table.php`, `Documentation/pages/admin-panel/support-guidebook.html`.
- **Port notes:** Store Markdown, render server-side with a sanitizing renderer; add preview pane; keep unique slug generation.

### WD-CMS-046 — Toggle publish and delete a guidebook article

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CMS-044
- **Summary:** One-click Live/Draft toggle and delete from the admin list.
- **Actors & access:** Platform admin.
- **UX & screens:** Status pill button; Delete link with confirm "Delete '<title>'?".
- **Endpoints:**
  | Endpoint                          | Name                    | Action                            | Middleware  | Request | Response                                     |
  | --------------------------------- | ----------------------- | --------------------------------- | ----------- | ------- | -------------------------------------------- |
  | POST /admin/guidebook/{id}/toggle | admin.guidebook.toggle  | GuidebookController@togglePublish | admin group | id      | 302 back "<title> is now published/a draft." |
  | DELETE /admin/guidebook/{id}      | admin.guidebook.destroy | GuidebookController@destroy       | admin group | id      | 302 back "Article "<title>" removed."        |
- **Data:** flips `is_published`; on publish stamps `published_at` if empty; unlike the form, unpublishing via the toggle keeps `published_at`. Hard delete.
- **Rules & edge cases:**
  1. Delete writes audit `guidebook.deleted`; the toggle writes no audit row.
  2. Deleting loses the vote and view counters.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a draft, When toggled, Then it appears in the in-app guidebook.
  - Given an article, When deleted, Then `/guidebook/<slug>` redirects with "Article not found.".
- **Source refs:** `app/Http/Controllers/Admin/GuidebookController.php`.
- **Port notes:** Soft delete; make toggle idempotent.

### WD-CMS-047 — In-app guidebook browse and search

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CMS-045
- **Summary:** `/guidebook` is the customer-facing help centre inside the signed-in app: category sidebar with counts, a search box and article cards. It is not a public page (login required) despite the docs calling it public.
- **Actors & access:** Any authenticated user (middleware `Authenticate` only; no workspace role check on the route). The nav entry is shown at manager tier and above (`UserNav` tier `manager`), so agents can still open the URL directly.
- **UX & screens:** `user/guidebook/index.blade.php` and `_sidebar.blade.php` in `components/layouts/user`. Sub-header with back link to `/more`, "Guidebook & help articles" title, and "Can't find it? Ask support" (link to `/support`). Two-column layout (280 px sidebar, content). Sidebar lists "All articles" plus one row per category with count; active category highlighted. Search form (GET `q`, preserves category), "Popular" quick-search chips that are hardcoded phrases ("Why was my template rejected?", "Best send time per region", "Verify a webhook signature", "Stuck queued message"), section title (category or "All articles") with article count, 2-column cards (category chip, reading time, title, excerpt, "Read article"). Empty state "No articles match.". `resources/js/charts/user-guidebook-index.js` is a stale prototype (see WD-CMS-053).
- **Endpoints:**
  | Endpoint       | Name           | Action                        | Middleware   | Request                                 | Response |
  | -------------- | -------------- | ----------------------------- | ------------ | --------------------------------------- | -------- |
  | GET /guidebook | user.guidebook | UserPagesController@guidebook | Authenticate | `q`, `category` (exact category string) | HTML     |
- **Data:** `guidebook_articles` scope published; search LIKE (not escaped) on `title`, `excerpt`, `body`; category exact match on the stored category string; order `sort_order`, `title` (no pagination); sidebar counts are all-time per category ignoring filters, ordered by category; total count of published.
- **Rules & edge cases:**
  1. No pagination: all matching articles render.
  2. Reading time = ceil(words / 200), min 1.
  3. The route is workspace-agnostic: the content is global to the platform.
  4. Popular chips are not derived from data.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 32 published articles, When `/guidebook` loads, Then all 32 show and the sidebar totals 32.
  - Given `q=webhook`, When searched, Then only articles whose title, excerpt or body contains it show, and the sidebar counts remain unfiltered.
  - Given a guest, When opening `/guidebook`, Then redirect to login.
  - Given `category=Billing`, When loaded, Then only Billing articles show and the Billing sidebar row is active.
- **Source refs:** `app/Http/Controllers/UserPagesController.php` (`guidebook`), `resources/views/user/guidebook/{index,_sidebar}.blade.php`, `routes/web.php`, `app/Support/UserNav.php`.
- **Port notes:** Next.js authenticated route in `apps/web`; server-side search (Postgres `tsvector`) instead of LIKE; paginate.

### WD-CMS-048 — In-app guidebook article page

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CMS-047
- **Summary:** `/guidebook/{slug}` shows a Markdown article with a category breadcrumb, read time, last-updated label, helpful vote buttons, related articles and support links. Each view increments the counter.
- **Actors & access:** Any authenticated user.
- **UX & screens:** `user/guidebook/show.blade.php` with the same sidebar. Header (category chip, H1), flash message after voting, Markdown body (CommonMark with raw HTML input stripped and unsafe links disallowed; falls back to a preformatted plain-text block if the converter is unavailable or fails), "Was this helpful? Yes/No" forms, "Still stuck? Open a ticket" link, and a Related section (up to 4 cards).
- **Endpoints:**
  | Endpoint              | Name                | Action                            | Middleware   | Request           | Response                                                     |
  | --------------------- | ------------------- | --------------------------------- | ------------ | ----------------- | ------------------------------------------------------------ |
  | GET /guidebook/{slug} | user.guidebook.show | UserPagesController@guidebookShow | Authenticate | slug `[a-z0-9-]+` | HTML, or 302 to `/guidebook` with error "Article not found." |
- **Data:** reads `guidebook_articles` (published only); writes `views_count` +1 (atomic increment, errors ignored). Related: same category, other published, ordered by `sort_order`, limit 5 (view shows 4).
- **Rules & edge cases:**
  1. Unpublished or missing slug redirects (not 404) with an error flash.
  2. The counter increments on every view including repeat views by the same user.
  3. "Updated" shows `updated_at` as a relative time. QUIRK (verify live): Eloquent's `increment` also sets `updated_at`, so every view and vote likely refreshes it and the label reflects the last visit rather than the last edit.
  4. Markdown rendering strips raw HTML, so only Markdown formatting is possible.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a published article, When opened, Then the rendered Markdown shows and `views_count` increases by 1.
  - Given a draft slug, When opened, Then redirect to `/guidebook` with "Article not found.".
  - Given Markdown containing a `<script>` tag, When rendered, Then the tag is not present in the output.
- **Source refs:** `app/Http/Controllers/UserPagesController.php` (`guidebookShow`), `resources/views/user/guidebook/show.blade.php`.
- **Port notes:** Render Markdown with a sanitizing pipeline (remark plus rehype-sanitize) server-side; count views asynchronously.

### WD-CMS-049 — Guidebook helpfulness vote

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CMS-048
- **Summary:** Users rate an article Yes or No; counters feed the admin list.
- **Actors & access:** Any authenticated user.
- **UX & screens:** Two POST buttons; redirect back with a success flash ("Thanks for the feedback!" or "Noted - we will improve this article.").
- **Endpoints:**
  | Endpoint                    | Name                | Action                            | Middleware   | Request                                   | Response                               |
  | --------------------------- | ------------------- | --------------------------------- | ------------ | ----------------------------------------- | -------------------------------------- |
  | POST /guidebook/{slug}/vote | user.guidebook.vote | UserPagesController@guidebookVote | Authenticate | `vote` required in `helpful, not_helpful` | 302 back; 404 unknown/unpublished slug |
- **Data:** increments `helpful_count` or `not_helpful_count`.
- **Rules & edge cases:**
  1. No per-user record: a user can vote unlimited times and cannot change a vote; there is no rate limit beyond the global web limits.
  2. Counters are visible only to admins.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a published article, When a user posts vote=helpful, Then `helpful_count` increases by 1 and a thanks flash shows.
  - Given vote=maybe, When posted, Then a validation error.
- **Source refs:** `app/Http/Controllers/UserPagesController.php` (`guidebookVote`).
- **Port notes:** Store one vote per user per article (unique key) so counters are trustworthy; keep tenant scoping in mind since the article is global but the vote row would carry `org_id`/`user_id`.

### WD-CMS-050 — Guidebook seed articles

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** none
- **Summary:** The install seeds a starter help centre so the guidebook is not empty.
- **Actors & access:** Installer and `db:seed`.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** the seeder header says 29 articles; the reference database holds 32 (Getting started 5, Campaigns 4, Templates 4, Auto-reply 3, Billing 3, Scheduled sends 3, Troubleshooting 3, Webhooks 3, Contacts 2, Flows 2). Each row: Markdown body, category (display name), excerpt, `sort_order` = seeding index, `is_published` true, `published_at` now, slug from the title. `updateOrCreate` keyed by slug, so re-running overwrites admin edits to seeded slugs.
- **Rules & edge cases:**
  1. Content describes WaDesk-specific screens (QR pairing, /chat), not portable text.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a fresh install, When seeding runs, Then the article count and categories above exist and are published.
  - Given the seeder is re-run, When a seeded slug was edited, Then it is overwritten (documented behavior).
- **Source refs:** `database/seeders/GuidebookArticleSeeder.php`, `database/seeders/DatabaseSeeder.php`, `app/Http/Controllers/InstallController.php`.
- **Port notes:** Write new starter articles for our product; seed with `ON CONFLICT DO NOTHING` so admin edits survive.

### WD-CMS-051 — Sitemap download (admin)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CMS-014
- **Summary:** Admins can download the same sitemap XML as a file for manual submission to search consoles.
- **Actors & access:** Platform admin; button lives on the SEO settings screen (SET) next to a link to `/sitemap.xml`.
- **UX & screens:** "Download sitemap.xml" link; help text says it is generated from public pages and published posts.
- **Endpoints:**
  | Endpoint                                 | Name                                | Action                     | Middleware                                   | Request | Response                     |
  | ---------------------------------------- | ----------------------------------- | -------------------------- | -------------------------------------------- | ------- | ---------------------------- |
  | GET /admin/settings/seo/sitemap/download | admin.settings.seo.sitemap.download | SitemapController@download | Authenticate, EnsureUserIsAdmin, IPAllowlist | none    | XML attachment `sitemap.xml` |
- **Data:** same builder as WD-CMS-014.
- **Rules & edge cases:**
  1. The controller comment refers to `/admin/blog/sitemap/download`; the real route is under settings/seo.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an admin, When requesting the URL, Then the response has `Content-Disposition: attachment; filename="sitemap.xml"` and the same body as `/sitemap.xml`.
  - Given a non-admin, When requesting, Then 403.
- **Source refs:** `app/Http/Controllers/SitemapController.php`, `routes/admin.php`, `resources/views/admin/settings/seo.blade.php`.
- **Port notes:** Trivial once WD-CMS-014 exists.

### WD-CMS-052 — In-app data processing (DPA) information page

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** I18N, AR
- **Summary:** `/legal/data-processing` (login required) documents which external translation providers may receive customer message text and lets the workspace owner choose a stricter cross-border routing mode. It matches no other domain cleanly; documented here because of its `legal` URL and view path.
- **Actors & access:** Any authenticated user can view; only the workspace owner can change the setting (checked in the view; the POST is `user.settings.residency`, owned by the translation/workspace settings domains).
- **UX & screens:** `legal/data-processing.blade.php` in the user layout: intro, a provider table (provider, region, data sent, provider DPA) covering translation vendors, a "Restrict cross-border data transfer" section with a mode form (owner only; others see a note), and notes about cache/expiry of translations. Links to `/admin/translation-providers` (admin).
- **Endpoints:**
  | Endpoint                   | Name                       | Action         | Middleware   | Request | Response |
  | -------------------------- | -------------------------- | -------------- | ------------ | ------- | -------- |
  | GET /legal/data-processing | user.legal.data-processing | Closure (view) | Authenticate | none    | HTML     |
- **Data:** reads the workspace's residency mode (via the view); writes happen through `user.settings.residency` (not owned here).
- **Rules & edge cases:**
  1. Copy states legal claims (GDPR Article 28/44) and provider regions as static text.
  2. Not linked from public legal pages.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** workspace residency mode (WSP/I18N).
- **Acceptance criteria:**
  - Given a logged-in owner, When opening the page, Then the residency form is shown and enabled.
  - Given a non-owner, When opening it, Then the form is replaced by a "Only the workspace owner can change this setting" note.
  - Given a guest, When opening it, Then redirect to login.
- **Source refs:** `routes/web.php` (closure), `resources/views/legal/data-processing.blade.php`.
- **Port notes:** Move under the translation/residency feature (I18N); treat as a static info page plus the setting form.

### WD-CMS-053 — Guidebook prototype script (dead code)

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CMS-047
- **Summary:** `resources/js/charts/user-guidebook-index.js` is the original static prototype: it embeds a hardcoded list of ~29 articles and manipulates DOM ids (`#articles`, `#list-view`, `#article-view`, `#cats`, `#search`) that the server-rendered guidebook does not contain. It is registered for page key `user-guidebook-index` but has no effect on the real page.
- **Actors & access:** none.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. On the real page its init would dereference missing elements and throw; the page keeps working because behavior is entirely server-rendered (filtering by GET). Do not port.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the guidebook page, When it loads, Then filtering and search work through full page loads without relying on any client-side article list.
  - Given the port, When reviewed, Then no hardcoded article data exists in front-end bundles.
- **Source refs:** `resources/js/charts/user-guidebook-index.js`, `resources/js/app.js`.
- **Port notes:** Skip.

## Data model

All eight tables are platform-level (not tenant-scoped): they have no `workspace_id` in WaDesk and are administered by platform admins. In the port they must NOT get an `org_id`/tenant RLS policy; give them platform-role-only write policies and public/authenticated read paths through the API. All timestamps are `timestamp NULL` (Laravel `created_at`, `updated_at`).

### frontend_content

Purpose: draft/published key-value store for the marketing site (WD-CMS-008). Volume: a few hundred rows at most; whole table cached.

- `id` bigint PK.
- `ckey` varchar(255) NOT NULL, UNIQUE (`frontend_content_ckey_unique`). Dotted key; write-time regex allows letters, digits and `.`/`_`/`-` separators, max 191 chars.
- `type` varchar(24) NOT NULL default `text`. Values used: `text`, `json`, `image` (`richtext` and `color` are normalised to `text`).
- `draft` longtext NULL, `published` longtext NULL. `json` values hold arrays of section slugs (`<page>.__hidden`, `<page>.__order`).
- `updated_by` bigint unsigned NULL (user id, no FK).
- Readers: every public page, editor shell. Writers: editor endpoints (WD-CMS-019..027).
- Key namespaces seen: `home.*`, `features.*`, `pricing.*`, `about.*`, `contact.*`, `theme.*`, `nav.*`, `footer.*`, `ticker.*`, `hero-home.*`, `hero-features.*`, `logo-strip.*`, `manifesto.*`, `feature-*.*`, `use-cases.*`, `testimonials.*`, `pricing-strip.*`, `faq.*`, `faq-slider.*`, `cta-final.*`, `pull-quote.*`, `pillars-three.*`, `two-device-stage.*`, `live-stream.*`. The seeded reference database has zero rows (defaults come from code).

### blog_posts

Purpose: marketing blog (WD-CMS-011, 012, 029..032, 014).

- `id` PK; `title` varchar(255) NOT NULL; `slug` varchar(255) NOT NULL UNIQUE (`blog_posts_slug_unique`); `excerpt` varchar(500) NULL; `body` longtext NULL (raw HTML); `featured_image` varchar(255) NULL (path on media disk); `category_id` bigint NULL FK to `blog_categories` ON DELETE SET NULL; `tags` JSON (longtext with json_valid check) NULL, array of strings; `author_name` varchar(255) NULL.
- `status` varchar(255) NOT NULL default `draft` (values `draft`, `published`); `published_at` timestamp NULL (scheduling: visible when status published and `published_at` null or <= now); `views` bigint unsigned default 0; `is_featured` tinyint default 0; SEO columns `meta_title` varchar(255), `meta_description` varchar(320), `meta_keywords` varchar(255), `og_image` varchar(255), `canonical_url` varchar(255) all NULL; `noindex` tinyint default 0.
- Indexes: `(status, published_at)`, FK index on `category_id`, unique slug.
- Public scope "published": `status='published' AND (published_at IS NULL OR published_at <= now())`.
- Writers: admin blog controller; `views` written by the public show page and the mobile blog detail endpoint.

### blog_categories

- `id` PK; `name` varchar(255) NOT NULL (not unique); `slug` varchar(255) NOT NULL UNIQUE; `description` varchar(500) NULL (unused); `sort_order` int unsigned default 0 (unused); timestamps.
- Created only inline from the post form; never edited or deleted from any screen. Read by blog index (ordered by `name`), post pages and the sitemap.

### legal_pages

- `id` PK; `slug` varchar(255) UNIQUE (`terms`, `privacy`, `refund`, `cookies`, `acceptable-use`); `title` varchar(255); `subtitle` text NULL; `updated_label` varchar(255) NULL and `effective_label` varchar(255) NULL (free-text labels, not dates); `sections` longtext NULL (JSON array of objects `{n: string, title: string, body: html string}`); `is_published` tinyint default 1; `sort` int unsigned default 0 (seeded 1-5; not editable).
- Readers: public legal routes, mobile `api/app/pages`. Writers: admin editor, seeder, self-heal on index.

### pricing_faqs

- `id` PK; `question` varchar(255); `answer` text; `sort_order` smallint unsigned NOT NULL default 0; `is_active` tinyint default 1; `placement` varchar(16) NOT NULL default `pricing` (`pricing`, `home`, `both`); timestamps. Index `(is_active, sort_order)`.
- Readers: in-app plans page, checkout page, homepage FAQ slider (placement home/both), mobile `api/app/faq`. Seeded with six rows by the checkout defaults seeder (PLAN/CPN seeds it; managed here).

### announcements

- `id` PK; `text` varchar(500) NOT NULL; `link_url` varchar(500) NULL; `link_label` varchar(64) NULL; `tone` varchar(16) NOT NULL default `info` (`info`, `promo`, `warning`, `success`); `is_active` tinyint default 1; `dismissible` tinyint default 1; `sort_order` int unsigned default 0; `starts_at` and `expires_at` timestamp NULL.
- Indexes `(is_active, sort_order)`, `(starts_at, expires_at)`.
- Visibility = active AND window contains now; readers: ticker, in-app bar, mobile banner; cache key `announcements.active.v1` (60 s). Audited automatically by the model observer.

### contact_messages

- `id` PK; `name` varchar(255), `email` varchar(255), `company` varchar(255) NULL, `topic` varchar(40) NULL (`sales`, `support`, `partnership`, `other`), `message` text, `ip` varchar(45) NULL, `user_agent` varchar(255) NULL, `is_read` tinyint default 0; index `(is_read, created_at)`.
- Stores personal data (name, email, IP): the port needs a retention policy and deletion path (WaDesk has none).

### guidebook_articles

- `id` PK; `slug` varchar(160) UNIQUE; `title` varchar(200); `category` varchar(80) NOT NULL default `general` (display string, used as filter value); `excerpt` text NULL; `body` longtext NULL (Markdown); `is_published` tinyint default 1; `sort_order` int unsigned default 0; `views_count`, `helpful_count`, `not_helpful_count` int unsigned default 0; `published_at` timestamp NULL. Index `(category, is_published, sort_order)`.
- Seeded 32 rows in the reference database.

### system_settings keys used (owned by SET; listed for the contract)

`frontend_enabled`; `seo_*` (16 keys, WD-CMS-016); `footer_title`, `footer_copyright`, `footer_description`; `site.company_name`, `site.address`, `site.city_country`, `site.email_general`, `site.email_support`, `site.phone`, `site.whatsapp`, `site.social_x|linkedin|instagram|youtube|facebook|github`, `site.tagline`, `site.domain`; `custom_code_enabled`, `custom_css`, `custom_js`; `privacy_terms_url`, `privacy_policy_url`, `privacy_cookies_policy_url`, `privacy_cookie_banner_*`; `pricing.yearly_toggle_enabled`, `pricing.yearly_discount_pct`, `default_currency`; `app_name`; brand logo and favicon paths.

## Cross-domain contracts

Consumes:

- **SET**: `system_settings` (frontend switch, SEO defaults, footer text, site identity `site.*`, custom CSS/JS, privacy URLs, cookie-banner settings, brand name/logos/favicon), media disk/URL helpers for blog images (`media_disk()`, `media_storage()`, `media_url()`), Custom-code and analytics partials, the SEO and Footer settings forms (`/admin/settings/seo`, `/admin/settings/footer` in `AdminPagesController`, NOT claimed here), the Settings hub tile that links to legal pages, and the checkout-settings page that links to pricing FAQs.
- **AUTH**: reCAPTCHA service, enablement and the `auth/_recaptcha` partial used on the contact form; `login` and `register` route names for CTAs and redirects; `resources/js/auth-recaptcha.js`.
- **PLAN**: `Package::publicPricingCards()`/`toPricingCard()` and pricing settings feed WD-CMS-003; PLAN's `/account/plans` (`PricingController`) and `CheckoutController` read `pricing_faqs` (all active rows); paid-plan CTAs go to `user.checkout.show`.
- **WSP / STORE**: host resolution (`ResolveTenantDomain`, storefront custom domain lookup) decides whether `/` is the marketing page.
- **NOTIF**: `Audit::log()` and `AuditableObserver` (announcements are audited by the observer; legal pages, guidebook, contact deletes and editor actions call `Audit::log` directly).
- **I18N**: locale resolution, `dir` attribute; the public site is deliberately single-language (see WD-CMS-008 QUIRK).
- **ASHELL**: admin layout, sidebar entries and badges, `x-admin.flash`, `IPAllowlist`, admin role gate.
- **CORE**: mail transport for the contact notification, cache store, file storage, `NoStoreResponse` middleware.

Exposes:

- To **MOB**: the mobile content endpoints `GET api/app/pages` (published `legal_pages` with sections and an HTML rendering), `api/app/blog` and `api/app/blog/{key}` (published posts; detail increments `views`), `api/app/faq` (all active FAQs), `api/app/banner` (top active announcement plus brand assets). These routes are claimed by MOB but read CMS tables; keep shapes stable.
- To **PLAN/CPN/checkout**: `legalUrl(kind)` helper and FAQ rows; to **AUTH**: `legal_url()` for signup terms links.
- To **SUPP**: the in-app guidebook links to `/support`; the contact inbox is a separate, unlinked inbox from the support desk tickets.
- To **ASHELL**: sidebar counts (unread contact messages, active announcements, published guidebook articles).
- To **all layouts (guest, user, admin)**: the SEO meta partial via `Seo::meta()`.

## Open questions & quirks

1. **Reorder endpoint likely broken** (WD-CMS-023): form-encoded array serialized as a JSON string fails server-side `array` validation. Verify live; decide port behavior as intended (works).
2. **Reset is live, not draft** (WD-CMS-026): resetting a key/page/theme deletes published values immediately although the panel is otherwise draft-based.
3. **Public FAQ split-brain** (WD-CMS-003, 010, 037): the public `/pricing` FAQ ignores `pricing_faqs`; the admin screen says it manages "the pricing page" but placement `pricing` only shows in-app and at checkout.
4. **Locale quirk** (WD-CMS-008): editor text values are ignored on non-default locales, including colours and link overrides; the language switcher is hidden on the public site for this reason.
5. **Announcement timezone conversion** (WD-CMS-040): docs claim UTC conversion; code likely stores the wall-clock time in the chosen zone. Needs a live check with a non-app timezone.
6. **Blog per-post SEO fields hidden** (WD-CMS-030): controller, model, sitemap and public page still support them; the form removed them. Decide whether to restore.
7. **Blog views may bump `updated_at`** (WD-CMS-012): code comment says timestamps are untouched, but Eloquent builder updates normally set `updated_at`; check sitemap `lastmod`.
8. **Static `public/robots.txt` shadows the dynamic route** (WD-CMS-015).
9. **Legal self-heal publishes empty pages** (WD-CMS-033) and disables the static fallback.
10. **Docs mismatches**: the frontend-editor doc lists only Home/Features/Pricing (code has five pages); the blog doc advertises a rich-text body with inline images and a cover image (code: raw HTML textarea, cover image only); the guidebook doc calls it "public" (code: login required); the announcements doc says the bar appears on "every signed-in page" only (the public ticker also uses it); `AdminPagesController@announcements/@guidebook` are unrouted stubs.
11. **Image type field and upload endpoint have no consumer** (WD-CMS-027): no template declares an image-type field. SVG acceptance is contradictory (`mimes` includes svg while the `image` rule rejects it in Laravel 12).
12. **Dead editable keys**: `nav.blog_label`/`nav.blog_url` are attached to the blog link but never read.
13. **Public pricing may list add-ons** (WD-CMS-003): `publicPricingCards()` has no type filter.
14. **`FrontendController::home` docblock** claims authed visitors are redirected to `/home`; they are not.
15. **Fabricated marketing content** ships as defaults (customer logos, testimonials with names, press, backers, "240M messages", G2/Capterra scores, uptime figure, compliance claims). Do not port; also a legal-risk item.
16. **Unsanitised HTML** is rendered in blog bodies, legal sections and some editor text (`{!! !!}`); trusted-admin assumption only.
17. **Guidebook**: KPI mislabelled `views_30d`; prototype script is dead (WD-CMS-053); votes are unlimited per user; views bump on every hit; categories are free-text strings.
18. **No audit for blog and pricing FAQ changes**, no soft delete anywhere, no revision history for blog or editor content, no retention for contact messages.
19. **Unclaimed neighbours**: `partials/cookie-consent.blade.php` and `resources/js/cookie-consent.js` (Privacy settings, assumed SET/AUTH), `admin/settings/seo|footer|privacy|auth-pages` (assumed SET/AUTH), `pricing/index.blade.php` + `pricing/_features.blade.php` + `components/message-pricing.blade.php` + `PricingController` (in-app plans; PLAN/WALLET), `Api/App/ContentController` routes (MOB), `resources/views/public/*` (owned by APPT, INV, WGT, SALES). The route `GET legal/data-processing` was claimed here as WD-CMS-052 because no other domain matched cleanly; reassign to I18N if preferred.
20. Editor "Publish" reports the number of changed rows but there is no history to see what changed; the drafts badge is client-counted and can drift.
21. `pricing_faqs.sort_order` blank on update and `guidebook_articles.sort_order` blank on create may pass explicit NULL into NOT NULL columns; unverified (UI always supplies values).
22. Contact page WhatsApp link falls back to a hardcoded sample number, and the footer "System status" card shows a fixed uptime figure; both are static.

## Coverage

```json wadesk-coverage
{
  "routes": [
    "GET /",
    "GET features",
    "GET pricing",
    "GET about",
    "GET contact",
    "POST contact",
    "GET blog",
    "GET blog/{slug}",
    "GET legal/terms",
    "GET legal/privacy",
    "GET legal/refund",
    "GET legal/cookies",
    "GET legal/acceptable-use",
    "GET legal/data-processing",
    "GET sitemap.xml",
    "GET robots.txt",
    "GET admin/frontend",
    "POST admin/frontend/draft",
    "POST admin/frontend/preset",
    "POST admin/frontend/section",
    "POST admin/frontend/reorder",
    "POST admin/frontend/publish",
    "POST admin/frontend/discard",
    "POST admin/frontend/reset",
    "POST admin/frontend/upload",
    "POST admin/frontend/toggle-frontend",
    "GET admin/blog",
    "GET admin/blog/create",
    "POST admin/blog",
    "GET admin/blog/{id}/edit",
    "PUT admin/blog/{id}",
    "POST admin/blog/{id}/toggle",
    "DELETE admin/blog/{id}",
    "GET admin/legal-pages",
    "GET admin/legal-pages/{slug}/edit",
    "PATCH admin/legal-pages/{slug}",
    "POST admin/legal-pages/{slug}/toggle",
    "GET admin/pricing-faqs",
    "POST admin/pricing-faqs",
    "PATCH admin/pricing-faqs/{id}",
    "POST admin/pricing-faqs/{id}/toggle",
    "DELETE admin/pricing-faqs/{id}",
    "GET admin/announcements",
    "GET admin/announcements/create",
    "POST admin/announcements",
    "GET admin/announcements/{id}/edit",
    "PATCH admin/announcements/{id}",
    "POST admin/announcements/{id}/toggle",
    "DELETE admin/announcements/{id}",
    "GET admin/contact-messages",
    "POST admin/contact-messages/{id}/read",
    "POST admin/contact-messages/read-all",
    "DELETE admin/contact-messages/{id}",
    "GET admin/guidebook",
    "GET admin/guidebook/create",
    "POST admin/guidebook",
    "GET admin/guidebook/{id}/edit",
    "PATCH admin/guidebook/{id}",
    "POST admin/guidebook/{id}/toggle",
    "DELETE admin/guidebook/{id}",
    "GET guidebook",
    "GET guidebook/{slug}",
    "POST guidebook/{slug}/vote",
    "GET admin/settings/seo/sitemap/download"
  ],
  "controllers": [
    "app/Http/Controllers/FrontendController.php",
    "app/Http/Controllers/ContactController.php",
    "app/Http/Controllers/SitemapController.php",
    "app/Http/Controllers/Admin/FrontendEditorController.php",
    "app/Http/Controllers/Admin/BlogController.php",
    "app/Http/Controllers/Admin/LegalPagesController.php",
    "app/Http/Controllers/Admin/PricingFaqController.php",
    "app/Http/Controllers/Admin/GuidebookController.php",
    "app/Http/Controllers/Admin/ContactMessagesController.php",
    "app/Http/Controllers/Admin/AnnouncementsController.php"
  ],
  "services": [
    "app/Services/Frontend/FrontendContentStore.php",
    "app/Services/Frontend/FrontendRegistry.php",
    "app/Support/Seo.php",
    "app/Support/fc_helpers.php"
  ],
  "models": [
    "Announcement",
    "BlogCategory",
    "BlogPost",
    "ContactMessage",
    "FrontendContent",
    "GuidebookArticle",
    "LegalPage",
    "PricingFaq"
  ],
  "tables": [
    "announcements",
    "blog_categories",
    "blog_posts",
    "contact_messages",
    "frontend_content",
    "guidebook_articles",
    "legal_pages",
    "pricing_faqs"
  ],
  "views": [
    "resources/views/admin/announcements/_form.blade.php",
    "resources/views/admin/announcements/create.blade.php",
    "resources/views/admin/announcements/edit.blade.php",
    "resources/views/admin/announcements/index.blade.php",
    "resources/views/admin/blog/create.blade.php",
    "resources/views/admin/blog/index.blade.php",
    "resources/views/admin/contact-messages/index.blade.php",
    "resources/views/admin/frontend/index.blade.php",
    "resources/views/admin/guidebook/edit.blade.php",
    "resources/views/admin/guidebook/index.blade.php",
    "resources/views/admin/legal-pages/edit.blade.php",
    "resources/views/admin/legal-pages/index.blade.php",
    "resources/views/admin/pricing-faqs/index.blade.php",
    "resources/views/components/announcement-bar.blade.php",
    "resources/views/components/frontend/cta-final.blade.php",
    "resources/views/components/frontend/faq-slider.blade.php",
    "resources/views/components/frontend/faq.blade.php",
    "resources/views/components/frontend/feature-bento.blade.php",
    "resources/views/components/frontend/feature-broadcasts.blade.php",
    "resources/views/components/frontend/feature-connectivity.blade.php",
    "resources/views/components/frontend/feature-flows.blade.php",
    "resources/views/components/frontend/feature-inbox.blade.php",
    "resources/views/components/frontend/feature-templates.blade.php",
    "resources/views/components/frontend/footer.blade.php",
    "resources/views/components/frontend/hero-features.blade.php",
    "resources/views/components/frontend/hero-home.blade.php",
    "resources/views/components/frontend/legal-page.blade.php",
    "resources/views/components/frontend/live-stream.blade.php",
    "resources/views/components/frontend/logo-strip.blade.php",
    "resources/views/components/frontend/manifesto.blade.php",
    "resources/views/components/frontend/nav.blade.php",
    "resources/views/components/frontend/pillars-three.blade.php",
    "resources/views/components/frontend/pricing-strip.blade.php",
    "resources/views/components/frontend/pull-quote.blade.php",
    "resources/views/components/frontend/testimonials.blade.php",
    "resources/views/components/frontend/ticker.blade.php",
    "resources/views/components/frontend/two-device-stage.blade.php",
    "resources/views/components/frontend/use-cases.blade.php",
    "resources/views/components/layouts/frontend.blade.php",
    "resources/views/frontend/about.blade.php",
    "resources/views/frontend/blog/index.blade.php",
    "resources/views/frontend/blog/show.blade.php",
    "resources/views/frontend/contact.blade.php",
    "resources/views/frontend/features.blade.php",
    "resources/views/frontend/home.blade.php",
    "resources/views/frontend/legal/acceptable-use.blade.php",
    "resources/views/frontend/legal/cookies.blade.php",
    "resources/views/frontend/legal/dynamic.blade.php",
    "resources/views/frontend/legal/privacy.blade.php",
    "resources/views/frontend/legal/refund.blade.php",
    "resources/views/frontend/legal/terms.blade.php",
    "resources/views/frontend/pricing.blade.php",
    "resources/views/legal/data-processing.blade.php",
    "resources/views/partials/seo-meta.blade.php",
    "resources/views/user/guidebook/_sidebar.blade.php",
    "resources/views/user/guidebook/index.blade.php",
    "resources/views/user/guidebook/show.blade.php"
  ],
  "commands": [],
  "permissions": [],
  "middleware": ["app/Http/Middleware/NoStoreResponse.php"],
  "node_files": [],
  "js_assets": [
    "resources/css/frontend.css",
    "resources/js/charts/admin-announcements-form.js",
    "resources/js/charts/admin-legal-pages-edit.js",
    "resources/js/charts/frontend-contact.js",
    "resources/js/charts/user-guidebook-index.js"
  ],
  "misc_files": [],
  "config_files": [],
  "doc_pages": [
    "Documentation/pages/admin-panel/frontend-editor.html",
    "Documentation/pages/admin-panel/blog.html",
    "Documentation/pages/admin-panel/announcements.html",
    "Documentation/pages/admin-panel/support-guidebook.html"
  ],
  "feature_map": {
    "WD-CMS-001": ["GET /"],
    "WD-CMS-002": ["GET features"],
    "WD-CMS-003": ["GET pricing"],
    "WD-CMS-004": ["GET about"],
    "WD-CMS-005": ["GET contact"],
    "WD-CMS-006": ["POST contact"],
    "WD-CMS-007": [],
    "WD-CMS-008": [],
    "WD-CMS-009": [],
    "WD-CMS-010": [],
    "WD-CMS-011": ["GET blog"],
    "WD-CMS-012": ["GET blog/{slug}"],
    "WD-CMS-013": [
      "GET legal/terms",
      "GET legal/privacy",
      "GET legal/refund",
      "GET legal/cookies",
      "GET legal/acceptable-use"
    ],
    "WD-CMS-014": ["GET sitemap.xml"],
    "WD-CMS-015": ["GET robots.txt"],
    "WD-CMS-016": [],
    "WD-CMS-017": [],
    "WD-CMS-018": ["GET admin/frontend"],
    "WD-CMS-019": ["POST admin/frontend/draft"],
    "WD-CMS-020": [],
    "WD-CMS-021": ["POST admin/frontend/preset"],
    "WD-CMS-022": ["POST admin/frontend/section"],
    "WD-CMS-023": ["POST admin/frontend/reorder"],
    "WD-CMS-024": ["POST admin/frontend/publish"],
    "WD-CMS-025": ["POST admin/frontend/discard"],
    "WD-CMS-026": ["POST admin/frontend/reset"],
    "WD-CMS-027": ["POST admin/frontend/upload"],
    "WD-CMS-028": ["POST admin/frontend/toggle-frontend"],
    "WD-CMS-029": ["GET admin/blog"],
    "WD-CMS-030": [
      "GET admin/blog/create",
      "POST admin/blog",
      "GET admin/blog/{id}/edit",
      "PUT admin/blog/{id}"
    ],
    "WD-CMS-031": ["POST admin/blog/{id}/toggle"],
    "WD-CMS-032": ["DELETE admin/blog/{id}"],
    "WD-CMS-033": ["GET admin/legal-pages"],
    "WD-CMS-034": ["GET admin/legal-pages/{slug}/edit", "PATCH admin/legal-pages/{slug}"],
    "WD-CMS-035": ["POST admin/legal-pages/{slug}/toggle"],
    "WD-CMS-036": [],
    "WD-CMS-037": ["GET admin/pricing-faqs", "POST admin/pricing-faqs"],
    "WD-CMS-038": [
      "PATCH admin/pricing-faqs/{id}",
      "POST admin/pricing-faqs/{id}/toggle",
      "DELETE admin/pricing-faqs/{id}"
    ],
    "WD-CMS-039": ["GET admin/announcements"],
    "WD-CMS-040": [
      "GET admin/announcements/create",
      "POST admin/announcements",
      "GET admin/announcements/{id}/edit",
      "PATCH admin/announcements/{id}"
    ],
    "WD-CMS-041": ["POST admin/announcements/{id}/toggle", "DELETE admin/announcements/{id}"],
    "WD-CMS-042": ["GET admin/contact-messages"],
    "WD-CMS-043": [
      "POST admin/contact-messages/{id}/read",
      "POST admin/contact-messages/read-all",
      "DELETE admin/contact-messages/{id}"
    ],
    "WD-CMS-044": ["GET admin/guidebook"],
    "WD-CMS-045": [
      "GET admin/guidebook/create",
      "POST admin/guidebook",
      "GET admin/guidebook/{id}/edit",
      "PATCH admin/guidebook/{id}"
    ],
    "WD-CMS-046": ["POST admin/guidebook/{id}/toggle", "DELETE admin/guidebook/{id}"],
    "WD-CMS-047": ["GET guidebook"],
    "WD-CMS-048": ["GET guidebook/{slug}"],
    "WD-CMS-049": ["POST guidebook/{slug}/vote"],
    "WD-CMS-050": [],
    "WD-CMS-051": ["GET admin/settings/seo/sitemap/download"],
    "WD-CMS-052": ["GET legal/data-processing"],
    "WD-CMS-053": []
  }
}
```
