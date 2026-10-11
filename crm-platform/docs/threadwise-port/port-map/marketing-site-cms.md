# Port map: marketing-site-cms (code CMS)

Spec: [`inventory/marketing-site-cms.md`](../inventory/marketing-site-cms.md). Zone: `ownership.json` -> `marketing-site-cms`.
Schema already ported: `packages/db/migrations/20261001100700_cms_threadwise_schema.sql` (eight platform tables, no `org_id`).

## What the domain is, in our stack

Everything a visitor sees before signing in, plus the operator tools that manage it. All eight tables are **platform data**:
anyone may read the published rows (open `SELECT` policy), only a privileged transaction may write. The public site reads
through plain `DatabaseService.primary` selects (no tenant, no privilege); every operator write goes through one door,
`CmsStore` (the only file in the module that calls `.privileged(`, unit-tested like `PlanStore` and `PlatformStore`).

| Concern            | Decision                                                                                                                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content model      | Keep Reference's `frontend_content` key-value store (draft/published per key) so `fc()` semantics port 1:1, but validate every key against a typed **registry** (pages, sections, fields, defaults) shared by API and web through `@crm/contracts`. |
| Locale quirk       | Fixed deliberately: the store is single-language and published text applies to every visitor (no per-locale override that silently reverts colours and links).                                                                                      |
| Reset              | Fixed deliberately: reset writes a draft tombstone (empty string), reversible with Discard, live only after Publish (Reference deleted live rows at once).                                                                                          |
| HTML               | Blog bodies, legal sections, rich-text fields and guidebook text are sanitised on write with the auth module's `HtmlSanitizerService` (allow-list), never trusted at render.                                                                        |
| Audit              | Operator writes record a `security_events` row in the same transaction (`platform.cms.*`), the platform equivalent of audit + outbox. `event_outbox.org_id` is NOT NULL, so platform events cannot use it; no outbox event is emitted.              |
| Permissions        | Reference has none beyond "platform admin + IP allowlist". Here: `OperatorGuard` (allowlist, MFA gate); every operator role reads, `super_admin` writes (`OperatorRoles`). No tenant `RequirePermission` keys.                                      |
| Public rate limit  | `POST /public/cms/contact`: 6 per minute per client address (Redis fixed window), honeypot before anything else, reCAPTCHA through the AUTH captcha service, mail through `MAIL_PORT`, mail failure swallowed.                                      |
| Optimistic locking | Every mutable operator resource takes `rowVersion` (blog, legal, content keys); mismatch is 409 `ROW_VERSION_CONFLICT`.                                                                                                                             |
| Pagination         | Cursor (keyset) for admin and public lists; no OFFSET, no totals.                                                                                                                                                                                   |

## Target modules

| Where                                            | What                                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/marketing-site-cms/`       | `CmsModule`: store, content/legal/blog/contact/pricing/... services, public + operator controllers   |
| `packages/contracts/src/marketing-site-cms/`     | registry, content, legal, blog, contact, pricing, FAQ, announcement, guidebook schemas               |
| `packages/db/migrations/*_cms_*.sql`             | public contact insert policy, blog view counter function and trigger, any later cms column           |
| `apps/web/src/app/(site)/`                       | public marketing route group (layout, pages, `sitemap.xml`, `robots.txt`) (new group, see seam list) |
| `apps/web/src/app/(admin)/(marketing-site-cms)/` | `/admin/frontend`, `/admin/blog`, `/admin/legal-pages`, ...                                          |
| `apps/web/src/features/marketing-site-cms/`      | public renderers, editor, admin screens, `messages/en/marketing-site-cms.json`                       |

## Tables (all existing; none added)

`frontend_content`, `blog_posts`, `blog_categories`, `legal_pages`, `pricing_faqs`, `announcements`, `contact_messages`,
`guidebook_articles`. Migration work in this domain only adds: an `INSERT` policy on `contact_messages` for the public
form (same idea as `security_events.append_any`), `cms_record_blog_view()` (SECURITY DEFINER, bumps the view counter without
touching `updated_at`) and the matching trigger `WHEN` clause.

## Endpoints

Public (`@Public`, `/v2/public/cms/*`): `GET content`, `GET pricing`, `GET legal`, `GET legal/:slug`, `GET blog`,
`GET blog/:slug`, `GET blog/categories`, `GET sitemap`, `POST contact`, `GET faqs`, `GET announcements`.
Workspace (`/v2/cms/guidebook*`, signed-in users): browse, article, vote.
Operator (`/v2/platform/cms/*`, `OperatorGuard`): content (read, draft, layout, publish, discard, reset, homepage
switch), legal (list, one, update, toggle), blog (list, one, create, update, toggle, delete, categories), contact messages,
FAQs, announcements, guidebook admin.

## Web screens

Public: `/` (homepage with kill-switch), `/features`, `/pricing`, `/about`, `/contact`, `/blog`, `/blog/[slug]`,
`/legal/[slug]`, `/sitemap.xml`, `/robots.txt`. Admin: `/admin/frontend` (page tabs, section list with show/hide and
reorder, field inspector, theme colours and presets, live preview of the draft, publish/discard/reset, homepage switch),
`/admin/blog`, `/admin/blog/new`, `/admin/blog/[id]`, `/admin/legal-pages`, `/admin/legal-pages/[slug]`, then FAQs,
announcements, contact messages, guidebook (P1).

## Prerequisites from other domains

| Needs                                                                                  | From      | Status                                                                                                        |
| -------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| Operator identity, guards, security events, captcha, HTML sanitiser, platform settings | AUTH      | built; `CaptchaService` and `RateLimitService` get a minimal barrel export (seam edit)                        |
| Public plan cards                                                                      | PLAN      | built (`PlanFacts`, `buildPlanCard`); CMS reads the active plans itself (no public plans endpoint exists yet) |
| Site identity, SEO defaults, footer settings, custom code, privacy URLs                | SET       | **blocked**: not built. CMS keeps its own small `site.*`/`footer.*` editable keys (shim inside the zone)      |
| Host resolution (storefront, white-label tenant domain)                                | WSP/STORE | **blocked**: `/` serves the marketing page for every host; documented in the parity file                      |
| Operator console shell and nav                                                         | ASHELL    | `OPERATOR_NAV` gets additive entries (seam)                                                                   |
| Media storage for blog images                                                          | SET/STORE | **blocked**: images are URLs (https or site-relative), no upload                                              |

## Build order

1. Contracts: registry, content, legal, blog, contact, pricing.
2. Migration + check against the database, `CmsStore`.
3. Content store (draft/publish/discard/reset/layout/homepage switch) + public content endpoint.
4. Legal pages (seed on migration-free, idempotent first read; edit; toggle) + public legal.
5. Blog (categories, posts, schedule, toggle, delete, public list and detail, view counter).
6. Contact form (public) + pricing read.
7. Web: public layout and pages, editor, blog and legal admin.
8. P1: FAQs, announcements, contact inbox, guidebook, sitemap, robots.

## Risks

- The public site is rendered by Next.js server components that call the API server-side on every request (Reference also
  sends `no-store`); a cache layer is a later optimisation, not part of correctness.
- Reference's default marketing copy contains invented claims (customer logos, statistics, testimonials). The registry ships
  neutral placeholder copy written for this port; nothing from Reference's copy deck is reused.
- Legal template text is original and generic: it must be reviewed by counsel before launch.
- `?fc_edit=1` is not a trust boundary here: the editor previews the draft inside `/admin/frontend` with the operator
  session, and the public pages never read drafts.

## Status

See `parity/marketing-site-cms.md`: every feature except TW-CMS-053 (dead code, not ported on purpose) is built and tested; TW-CMS-027 (editor image upload) now stores on the SET media storage (`POST /v2/platform/cms/content/upload`).

Public site rendering: the marketing pages are drawn in Reference's editorial layout (Tailwind utilities on the `--site-*` palette tokens, `site/wd.css` for Reference's own classes in the `components` layer). One component per Reference section lives in `site/wd-*.tsx`; the registry's field names are what they read (`site/site-render.test.tsx` renders every section and fails when a page reads a key the registry lacks or a registry field is never shown).
