# Parity evidence: chatbot widget (WGT)

WaDesk 1.7.0 reference (http://127.0.0.1:8000) vs this branch. API reference: [docs/api/chatbot-widget.md](../../api/chatbot-widget.md).
Rule for this domain (user instruction): the widget is the SAME as the reference, bugs included. Every WaDesk quirk is reproduced on purpose and
recorded as `QUIRK:` in the [inventory entry](../inventory/chatbot-widget.md) (section "Port decisions"). The only departures are the three kinds listed below:
architecture-forced, the Interakt additions the user asked for, and render-time security sanitising.

## Evidence

Twin harness `wadesk-playwright-parity`, spec `apps/web/e2e/chatbot-widget/parity/WD-WGT.twin.mjs`, run at depth `full` against the live reference and this branch:

| Run                                                                    | Scenarios           | same | intended | defect | spec-issue |
| ---------------------------------------------------------------------- | ------------------- | ---- | -------- | ------ | ---------- |
| Whole domain (admin API matrix, screens, embed, chat page, public API) | 71 (minus throttle) | 450  | 1        | 0      | 0          |
| Throttle: 64 message posts in one minute (`zz.throttle`)               | 1                   | 6    | 0        | 0      | 0          |

What the matrix covers: save validation and every boundary (name, mode, position, colours, labels, texts, URLs, country code, number, allow-list: empty, at limit,
over limit, blank entry, normalisation), unknown id, assistant rules, slug and token rules, rotate, duplicate, delete, embed script, chat page and config, WhatsApp
link, message validation, history quirks, AI answers the first message only, allow-list and CORS, unauthenticated access, builder gates step by step, launch,
double submit (two widgets on both), list actions (search, inert status views, copy, rotate, duplicate, delete with unchanged numbers), XSS and SQL-looking input,
the embed on a customer origin, a phone-width page, keyboard, responsive and RTL builder, dark mode.

Run notes that matter: the reference throttles at 60 per minute (60 accepted then 429 when its 64 posts were fired in concurrent batches). Both products share the
loopback address with other dev traffic and the counter is keyed by address only, so the throttle scenario compares the shape (some accepted, never more than 60,
some refused, only 200 or 429) and the exact 60-then-429 is asserted in the API e2e test. Reference widgets are soft-deleted, so a save whose slug a deleted widget
still holds answers 500 there; the spec salts names with the run tag to avoid it (see differences, no 1).

Automated, this branch (final counts):

| Suite                                                                                                                                    | Result                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| API unit `apps/api/test/unit/chatbot-widget` (4 files)                                                                                   | 86 passed                                                                                       |
| API e2e `apps/api/test/e2e/chatbot-widget` (3 files, real Postgres + Redis, local AI vendor stub)                                        | 136 passed                                                                                      |
| API integration `apps/api/test/integration/chatbot-widget` (RLS forced, cross-tenant writes refused, composite FK, token lookup, checks) | 9 passed                                                                                        |
| Web unit `apps/web/src/features/chatbot-widget` (2 files)                                                                                | 42 passed                                                                                       |
| Browser e2e `apps/web/e2e/chatbot-widget/builder-and-list.e2e.mjs`                                                                       | 35 ok, 0 fail (wizard, WhatsApp page, embed on another origin, edit, rotate, duplicate, delete) |
| `pnpm db:verify-schema`, eslint (contracts, api, web feature), tsc (contracts, api, web), `pnpm arch:check`                              | clean (arch: one existing orphan warning in another domain)                                     |

## Features

| Id             | Status  | Same as WaDesk?          | Note                                                                                                                                                                                                                                                     |
| -------------- | ------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WD-WGT-001     | done    | same                     | List, four cards, inert status views, client-side search, row actions. Cursor "Load more" instead of page links (architecture).                                                                                                                          |
| WD-WGT-002     | done    | same, plus Interakt page | Four-step builder for Smart agent and Smart + WhatsApp. The WhatsApp engine opens the Interakt page (WD-WGT-028).                                                                                                                                        |
| WD-WGT-003     | done    | same                     | Engine tiles, agent picker, country picker (intl-tel-input, as WaDesk), digits and `+cc`, pre-typed message.                                                                                                                                             |
| WD-WGT-004/5   | done    | same                     | Styling, opening line, send button, intake gate with the "show once" rule.                                                                                                                                                                               |
| WD-WGT-006     | done    | same                     | Every quirk reproduced (see below).                                                                                                                                                                                                                      |
| WD-WGT-007     | done    | same                     | Snippet reveal after Launch, copy, standalone preview; list copy with clipboard fallback dialog.                                                                                                                                                         |
| WD-WGT-008-018 | done    | same                     | Loader, chat page, config, visitor, repaint, WhatsApp link, message, thread and contact, AI reply (first message only), polling.                                                                                                                         |
| WD-WGT-020     | done    | same                     | Allow-list on config, message and history; a non-empty list blocks the widget's own posts.                                                                                                                                                               |
| WD-WGT-021     | done    | same                     | As WaDesk: API and enforcement, no builder control (its docs promise one; the screen has none).                                                                                                                                                          |
| WD-WGT-022     | done    | same                     | Token shape, one per-address counter for message and history of every widget (60 and 120 a minute), config unthrottled, no CSRF, framable page.                                                                                                          |
| WD-WGT-023-026 | done    | same                     | Rotate (list copy button only), duplicate (keeps author, no truncation), delete (numbers unchanged), nothing can pause a widget.                                                                                                                         |
| WD-WGT-027     | done    | same                     | Permission keys and the `chatbot_widgets` plan flag in the plan catalogue, enforced through the entitlement service; the limit is unenforced and public routes ignore the plan, as WaDesk. Paywall overlay and 422 `PLAN_FEATURE_LOCKED` tested on ours. |
| WD-WGT-028     | partial | Interakt additions       | Sidebar item done. More tile, quick-access list and command palette belong to the shell. The WhatsApp builder page and launcher are the user-requested Interakt additions (below).                                                                       |
| WD-WGT-019     | partial | widget side same         | Thread, contact and polling contract done through the `InboxGateway` shim (SQL writes to the inbox tables). Team Inbox screens, the agent reply path and the mobile list belong to TIB1/MOB.                                                             |
| WD-WGT-029     | done    | architecture             | FK cascades on hard delete; the tenant purge job belongs to WSP.                                                                                                                                                                                         |
| WD-WGT-030     | wontfix | n/a                      | Greenfield: nothing to backfill.                                                                                                                                                                                                                         |

## QUIRKs reproduced on purpose (verified on the live reference first)

1. The AI answers only the first message of a conversation (any outbound row counts as a human takeover).
2. A non-empty allow-list that names only customer sites blocks the widget's own message posts (403 `cors_origin_denied`).
3. Save with an unknown id creates a new widget.
4. A blank `allowedDomains` entry is 422 "must be a string".
5. Colours are free text up to 16 characters; only the launcher fill is checked, in the browser.
6. The opening line is stored in the legacy `messages` table; the transcript is the OLDEST 200 messages; the prompt history includes the current message.
7. The history poll ignores the widget status and creates visitors.
8. One throttle counter per address shared by message and history across widgets; config is unthrottled.
9. Status views are inert and nothing can pause a widget.
10. Delete leaves the stats and footer untouched; rotate updates only the copy button.
11. A duplicate keeps the original author; the name is not truncated.
12. A failed config leaves a blank page; a refused message shows nothing; Enter sends while Send is disabled.
13. A double click on Launch creates two widgets (no guard).
14. The browser storage key is built from the token; the plan limit is unenforced and public routes ignore the plan.

## Intended differences

### Architecture-forced (each with its reason)

1. **uuid ids on the wire**, never the bigint (repo rule).
2. **Hard delete** instead of WaDesk's soft delete (platform schema rule, `docs/wadesk-port/schema/decisions.toml`). Consequence: WaDesk's ghost-slug crash (saving a name whose slug a deleted widget still holds answers 500) cannot occur here. The visitors of a deleted widget go with it (FK cascade).
3. **Cursor pagination** ("Load more") instead of page links.
4. **Tenant isolation**: a widget, visitor or assistant of another organization is a 404 or 422, composite foreign keys; a foreign assistant is 422 `WGT_ASSISTANT_NOT_IN_WORKSPACE`.
5. **Admin API errors are problem+json** and writes carry optimistic locking (`rowVersion`) and audit rows and outbox events (WaDesk wrote none). The public API keeps WaDesk's `{ok,error}` and Laravel-style 422.
6. **Embed addresses use the configured public base** (API host), not the browser origin.
7. **Plan lock** is 422 `PLAN_FEATURE_LOCKED` through the entitlement service.
8. **Concurrent saves of one name** get distinct slugs (an advisory lock); WaDesk's check-then-insert crashes on a true race. A double click still creates two widgets, as WaDesk.
9. **intl-tel-input version** (current release, same widget and behaviour).

### Render-time security sanitising (not a feature change)

10. Colours and image URLs are only ever applied through style properties after a safety check (a CSS-injection flaw of WaDesk's `encodeURIComponent` is not reproduced); script values are JSON-escaped.

### User-requested, Interakt reference (WD-WGT-028)

Chosen by the user: where Interakt specifies the WhatsApp widget builder and launcher it takes priority over WaDesk; everything else stays as WaDesk. Each is `user-requested, Interakt reference`.

11. **The WhatsApp engine's builder is the page "WhatsApp Widget: Install & Customize"**: five collapsible cards (accordion, one open at a time, green border on the open card), a green Save Changes button, an install snippet after saving, and an always-visible live preview. Smart agent and Smart + WhatsApp keep the four-step wizard. A mode switch at the top of the page moves between the two with the same draft.
    1. Style your WhatsApp chat button: button type (pill "Chat With Us" with the WhatsApp mark, or icon-only round button) shown as live samples; twelve colour presets with gradient dots (The Original, Teal Deal, Green Lime, Blue Lagoon, Red Cherry, Orange Sunset, Yellow Sand, Pink Margarita, Navy Suit, Purple Velvet, Silver Spoon, Dark Night; chosen one has a purple outline) and "Pick a custom color" (native colour picker, hex).
    2. Design your messenger: four built-in images or an image address (no file upload: MinIO is unavailable).
    3. Set your welcome message: Greetings (up to 60) and Intro Message (up to 500).
    4. Set your Chat Button position: Desktop or Mobile preview, launcher side Left or Right and side and bottom spacing in px, separately for desktop (10, 10) and mobile (10, 60); whole numbers 0 to 500.
    5. Configure your WhatsApp number: country code and number, Pre-filled Message.
12. **The WhatsApp widget's loader draws the launcher and the messenger panel itself** (no frame): header with the image, business name and "Typically replies within 5 mins", the greeting, a bubble with the intro message and a time, a large "Start Conversation" button that opens `https://wa.me/<code><number>?text=<pre-filled>` in a new tab, and a round chevron button that collapses it (it takes the launcher's place while open; Escape also closes). The placement follows the window: mobile at 768 px and below, via `matchMedia`. AI and Both widgets keep the WaDesk frame loader unchanged.
13. **One config shape** for all of it: `chatbot_widgets.launcher` (jsonb, validated by `widgetLauncherSchema`), carried as `launcher` by the admin API and as a resolved `widget.launcher` block in the public config (the one addition to the public protocol; the harness records it as `intended`). A further Interakt option is a key with a default in the contract, a line in the script and a control in the builder: no migration. The preview is the real embed script running in a frame, so what the builder shows is what a visitor gets. The preview opens with the panel already expanded (500px tall, a 620px frame on desktop, a 372px phone frame on Mobile, a plain neutral backdrop); the round chevron collapses it to the launcher and the launcher re-opens it, in the preview and on a real site. Panel look (user's reference screenshot): launcher-colour header with a round image, the business name in bold white and a bold "Typically replies within 5 mins" line; a warm beige chat area holding one white bubble with a small top-left tail (the greeting in bold, then the intro, the time in 24-hour format at its bottom right); a thin divider, then a full-width pill "Start Conversation" in the launcher colour with a send icon on the left.
14. For a WhatsApp widget the legacy `position` and `buttonColor` columns follow the launcher (desktop side and the colour's first end) so the list shows the same.

Screenshot-versus-ours: the Interakt screenshots were described to this session in words, not shown, so nothing was compared pixel by pixel. Known gaps and choices: the business name in the header is the widget name; the greeting is a bold line above the intro bubble (the brief said "title/greeting line"); the WhatsApp mark and the built-in images are drawn for this product, not copied; "Start Conversation" uses the launcher colour (green for The Original); the reply time text is fixed; the "help link" of the footer is omitted (optional in the brief).

## NOT verified

- **Real AI provider calls.** No provider key is available; the vendor adapter is tested against a local stub (prompt, token cap, fallback, error paths). BYOK/platform key resolution and metering belong to AIADM (keys come from `WGT_AI_*` env).
- **Team Inbox display and agent reply path.** There is no inbox in this app yet; agent replies are simulated by inserting an outbound `inbox_messages` row. The "Web widget" badge and push/translation observers are untested.
- **Paused widget, role gate and plan gate against the reference.** The reference cannot be edited, nothing there can pause a widget, and its role and plan gates need accounts the reference does not have; these are covered on ours (API e2e: 404s of a paused widget, 403 per key, 422 plan lock and the paywall) and by reading the reference source only.
- **Exact 60-then-429 on both products in one run**: shown on the reference alone (60 accepted, then 429) and on ours in the API e2e test; the twin run compares the shape because the loopback address is shared with other dev traffic.
- **The Interakt page against the Interakt screenshots** (see above), and its dark mode and RTL: the page uses the app tokens and a phone-width check showed no horizontal overflow; RTL was not exercised.
- **File uploads** (none: images are addresses; MinIO unavailable) and **cross-origin preflight per widget** (answered by the global CORS middleware).
- The reference still holds soft-deleted widgets and a few visitor/conversation rows from the probes (the widgets and assistants were deleted through the app; soft delete keeps the rows).
