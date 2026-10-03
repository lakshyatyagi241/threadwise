<!-- One file for the whole catalog-products domain. The Web section is the web agent's; `## Backend` is filled by the backend agent. -->

## Web (screens)

### What was compared, and how

Reference: WaDesk 1.7.0 running at `127.0.0.1:8000`, admin `test@example.com`, driven with Playwright (Chromium). Ours: `apps/web` against the
CAT API started with `CAT_PROVIDER_MODE=fixture` (an in-memory Meta and Node bridge; nothing leaves the machine).

Why the reference is hard to see, and what was done about it (read-only product, test data tagged `cat-wk-`):

- **`GET /catalog` is HTTP 500 for every workspace, always.** `CatalogController::index` passes `'engine' => $engine` to the view and never
  computes `$engine` (`CatalogController.php:117`, "Undefined variable $engine"). It fails the same way with no device, with a connected device bound
  to the workspace, and with products and a shop present. No legitimate UI action can make it render, so the Setup tab (none, ready and connected
  states, health, sync bar, commerce and automation forms) is compared **against the Blade source only** (`_setup.blade.php`, `_connect-form.blade.php`).
  A scratch copy of the app with the one-line fix was tried and was not allowed to run, so it was dropped.
- **`/store/products`, create, edit and `/store/reviews` are HTTP 500 until the workspace has a storefront**, and the Store wizard
  (`/connect?platform=wa-store`) stops at step 1 "Connect WhatsApp first" without a connected device. A device cannot be paired here (no Node
  bridge). One storefront row named `cat-wk-shop` was therefore inserted with SQL (test data, last resort, removed again at the end); after that
  the product pages rendered. Products (28, created through the real form and its POST), collections (through the real form) and reviews (through the
  public customer endpoint `POST /s/{slug}/review`) were made through the product's own UI paths.
- **`/catalog/send`** only ever shows "Connect a device first": the sender list comes from the platform's allowed engines, and the workspace has none
  that is connected. A connected device row was bound to the workspace for a few minutes to see whether that changed it (it did not) and was put back.
  The Send form, the Collections "Send as MPM" success path, the share-modal send and every Meta call are therefore compared against the Blade and
  controller source and against our fixture, not against a running reference.
- Reachable in the reference and walked: `/catalog/send` (empty state), `/catalog/collections` (empty, create, card, send panel with no sender,
  edit panel, delete confirm), `/catalog/activity` (empty), `/store/products` (28 rows, page 2, search), create (server validation, soft-delete slug
  crash), edit, share modal, delete (confirm and flash), `/store/reviews` (empty, three pending, approve), `/admin/settings/catalog`, and the inbox
  catalog picker modal (opened from a thread's composer toolbar).

Evidence in this repo (re-runnable):

- `apps/web/e2e/catalog-products/catalog-flows.e2e.mjs`: 27 checks against the running stack (own organisation per run, plan flag turned on with SQL,
  one device and reviews inserted with SQL because device pairing and the public shop belong to other domains).
- `apps/web/e2e/catalog-products/admin-settings.e2e.mjs`: 11 checks on the operator page; needs `OPERATOR_TOTP_SECRET`, otherwise it reports "skipped".
- Unit tests: `apps/web/src/features/catalog-products/**/*.test.ts` (15 files, 114 tests), including `messages.test.ts` (English and Arabic keys in step,
  no dead strings) and `nav.test.ts` (the menu gates).
- Screenshots of reference and ours side by side were saved outside the repo (not committed), named `ref-*.png` and `ours-*.png`.

### Status per screen

| Id                   | Screen                                 | Status vs the reference                                                                                                                                               |
| -------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WD-CAT-001, 035      | Shell, tabs, pill, paywall             | same (tabs, pill, flash style); paywall sheet now the WaDesk bottom sheet, plan cards blocked (see differences)                                                       |
| WD-CAT-008           | `/catalog` Setup                       | not comparable (reference 500s); built to the Blade source, walked in fixture mode (none, ready, connected, sync, poll, import, commerce, automation, disconnect)     |
| WD-CAT-014, 015      | `/catalog/send`                        | empty state same; the form is walked in fixture mode (rules of the Blade script reproduced); not compared with a running reference                                    |
| WD-CAT-016           | `/catalog/activity`                    | same (empty state); rows show the number in full as WaDesk does                                                                                                       |
| WD-CAT-017, 018      | `/catalog/collections`                 | same (empty, new panel, card, picker, edit, delete confirm, no-sender send panel); the new panel now closes after a create                                            |
| WD-CAT-019, 021, 022 | `/store/products`, share modal, delete | same after the fixes below (pager footer, share modal without a close icon, "Product removed.")                                                                       |
| WD-CAT-020           | create and edit                        | same except the image dropzone (blocked on storage) and field-level error text (intended)                                                                             |
| WD-CAT-027           | `/store/reviews`                       | same (tabs with counts, cards, Approve, Reject, Delete, flashes, empty text)                                                                                          |
| WD-CAT-030           | `/admin/settings/catalog`              | built this round (the page was missing); same layout, tiles, fields, walkthrough and side cards; two intended changes (blank version, read-only for non-super-admins) |
| WD-CAT-031           | inbox catalog picker                   | reference modal captured; the staff inbox does not consume the picker endpoint yet (team-inbox domain)                                                                |
| WD-CAT-036           | Store rail                             | not built (STORE domain)                                                                                                                                              |

### Differences, classified

Defects found by the side-by-side and fixed in this round (each has a check in the e2e or a unit test):

| #   | Where                                | WaDesk                                                                                                                                                                    | Ours before                                                          | Class                                                 |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | Sender picker                        | note "No connected senders. Connect one →" when empty; first option "— Select a sender —"; one group per engine (Meta, Twilio, Unofficial API); "Connect new device" link | always a select, no placeholder on the Send tab, no groups, no links | defect-fixed                                          |
| 2   | Send with no device                  | "No connected device. Pair one at /devices first."                                                                                                                        | "No connected sender. Connect a device or a WhatsApp number first."  | defect-fixed (copy; the route reads "under Channels") |
| 3   | Product delete flash                 | "Product removed."                                                                                                                                                        | "Product deleted."                                                   | defect-fixed                                          |
| 4   | Products footer                      | "Showing 1 to 25 of 28 results" left, page links right, only with more than one page                                                                                      | centered "Showing 25 of 28" over a separate pager                    | defect-fixed (also on Reviews)                        |
| 5   | New collection panel                 | closes after a create (the page reloads)                                                                                                                                  | stayed open                                                          | defect-fixed                                          |
| 6   | Share modal                          | no corner close icon                                                                                                                                                      | had one                                                              | defect-fixed                                          |
| 7   | Paywall                              | bottom sheet: lock, "Premium feature", "WhatsApp storefront is not on your plan", "Go back · Compare all plans"                                                           | centered card with one button                                        | defect-fixed (cards blocked)                          |
| 8   | "time ago"                           | Carbon: "6 seconds ago", "1 day ago"                                                                                                                                      | `Intl` auto wording ("now", "yesterday")                             | defect-fixed                                          |
| 9   | Page landmarks                       | (n/a)                                                                                                                                                                     | a second `<main>` inside the shell's `<main>`                        | defect-fixed                                          |
| 10  | Operator "WhatsApp Catalog" settings | `/admin/settings/catalog`                                                                                                                                                 | no web screen                                                        | defect-fixed (built)                                  |

Same behaviour that the earlier notes had wrong (the reference was checked):

- Phone numbers in the Activity table and the Send rail are printed in full: `mask_phone` returns its input in this build. (Inventory corrected.)
- The Collections send panel, with no sender, answers HTTP 422 with the readable `no_device` message; the "HTTP 200" quirk applies only after the request was accepted.
- A name that was soft-deleted cannot be recreated in the reference (HTTP 500, `UniqueConstraintViolationException`); ours uses hard delete, so it works (intended).

Intended differences, with reason:

| #   | Area                                  | WaDesk                                              | Ours                                                                        | Reason                                                   |
| --- | ------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| 11  | Pagination                            | Laravel page links                                  | numbered pager over the cursor API with a total                             | cursor pagination (CONTRIBUTING)                         |
| 12  | Confirmations                         | browser `confirm()`                                 | `ConfirmDialog`, same question                                              | design system                                            |
| 13  | Validation text                       | red list on top: "The name field is required."      | field-level messages from the problem `errors[]`, plus a summary line       | frontend-port rule 5 (field-by-field)                    |
| 14  | Em dashes in copy                     | "Active — live on storefront"                       | "Active: live on storefront"                                                | house copy style                                         |
| 15  | Send tab header and footer fields     | header only on the Collections panel, no footer     | header (list mode) and footer (product modes) with 60-character counters    | requested in the brief; the contract accepts them        |
| 16  | Setup with no sender                  | only "Connect a device first"                       | the manual connect panel is also offered                                    | inventory WD-CAT-008 port note (WaDesk dead end)         |
| 17  | Sync loop above 1000 products         | loops forever                                       | stops when a chunk pushes nothing; cap 200                                  | documented WaDesk bug                                    |
| 18  | Row "Sync" label                      | "Queued ✓" whenever the response is ok              | "Not queued" when nothing was pushed                                        | documented WaDesk bug                                    |
| 19  | Collection edit picker                | silently drops members that are not active          | keeps them                                                                  | documented WaDesk bug                                    |
| 20  | Product preview currency symbol       | four symbols, other codes shown as code             | the saved price's symbols                                                   | documented WaDesk bug                                    |
| 21  | Share modal copy buttons              | copy the placeholder when there is no link          | disabled                                                                    | documented WaDesk bug                                    |
| 22  | Connect token field                   | plain password field                                | password field with show/hide                                               | shared `PasswordInput`                                   |
| 23  | Reviews of a deleted product          | stay, labelled `#id`                                | removed with the product                                                    | hard delete with cascade (migration)                     |
| 24  | Operator settings                     | any admin saves; blank Graph version stored as ""   | read-only unless super admin; blank clears the value so the default applies | OperatorGuard; WaDesk quirk fixed (inventory WD-CAT-030) |
| 25  | Store rail on products and reviews    | left rail with shop, public link and the Store menu | not drawn; Products and Reviews are customer menu entries                   | STORE domain (WD-CAT-036)                                |
| 26  | Activity "View thread"                | link to the conversation                            | not shown (the activity contract carries no conversation id)                | blocked on a contract field                              |
| 27  | Picker search (Send tab, Collections) | client filter over all products                     | server-side search, capped at 120                                           | scale                                                    |

### Blocked or not verified

- **Image upload** (WD-CAT-020): no upload endpoint for products; the dropzone is left out rather than shown dead. The image field takes URLs.
- **Plan cards in the paywall sheet** (WD-CAT-035): `GET /v2/plans` does not say which plans carry `wa_storefront`; needs a contract field in the plans domain.
- **Menu gating by plan**: the app shell resolves the menu with plan features unknown, so Catalog is listed on every plan and the paywall is the gate
  (`nav.test.ts` proves the declared gates: permission `cat.catalog.read` plus plan flag `wa_storefront`). The permission gate in the shell is wired.
- **Inbox catalog picker consumer** (WD-CAT-031): `GET /v2/catalog/products/picker` exists; the team-inbox web does not call it yet.
- **Never rendered in the reference**: the Setup tab and its states, the Send form, a successful send, the connected Setup, health card, sync bar,
  commerce and automation forms, WABA autodetect, concierge and order acknowledgement. They follow the Blade and controller source and were walked on
  our side with the fixture provider. Live Meta, 360dialog and the Baileys bridge were not exercised from the web.
- Dark mode and 390 px width were checked on ours (no horizontal overflow on any catalog or product route; the reference showed none either);
  Arabic renders `dir=rtl` on the shell (checked in the e2e). Arabic strings were not reviewed by a native speaker.
- The Setup tab, the Send form and every successful send are not in the twin run (see `## Twin harness`, "Not comparable").

## Twin harness

Skill `wadesk-playwright-parity`, spec `apps/web/e2e/catalog-products/parity/WD-CAT.twin.mjs` (feature id `WD-CAT-019`, covers WD-CAT-014..027 and 035), depth `full`,
reference WaDesk 1.7.0 at `127.0.0.1:8000` against this branch (API in `CAT_PROVIDER_MODE=fixture`, web on `next dev`). Our side logs in to a throw-away
organisation made by `parity/prepare-org.mjs` (no device, no catalog connection, plan flag on). The reference needs a storefront row for its product and
review pages (they answer 500 without one): the spec inserts one tagged `cat-wk-shop` when missing; every product, collection and review of the run carries the
run tag and a `cat-wk-` name, and the teardown deletes them on both sides (SQL on the reference, which soft-deletes and keeps the slug reserved).

Final result of the last complete run (534 scenarios, after the fixes below, with a targeted re-run of the 32 scenarios the last fix touched). The run directory was
lost when the scratch area was cleaned, so a verification run of 193 of those scenarios (all screens, all custom checks, the deletes and the riskiest form cases) was
repeated on the final code: same 1262, intended 131, defect 0, review 23, spec-issue 0. The counts in the table are from the complete run:

| same | intended | defect | blocked-env           | review                      | spec-issue | skipped |
| ---- | -------- | ------ | --------------------- | --------------------------- | ---------- | ------- |
| 4409 | 259      | 0      | 3 (not in the matrix) | 23 (all decided, see below) | 0          | 0       |

What the matrix covers: the six screens (load, three viewports, axe, keyboard, data requests failing with 500, no session, timing); the product create and edit
forms (structure, tab order, valid save with a readback of every stored column, all-empty, each required field, 15 to 25 edge values per field including
empty, spaces, max and max+1, emoji, RTL, HTML, script, SQL, newline, tab, zero-width, combining, NUL, URLs, number forms, Enter key, double submit, slow server,
server error, offline, expired session, cancel with typed data); collection create (name, description, product picker); the share modal send row; the products
search (hit, miss, 12 edge strings, reload, Back, deep link); three deletes (confirm shown, cancel keeps, confirm removes, gone after reload); custom checks for
product edit (prefill, unchanged save, rename keeps the slug, compare 0 clears, tags normalised), price rounding, slug uniqueness, gallery limit, currency list, live
preview, which values are refused or stored (`server-rules-1..5`), collection edit, blank name, remove-all, card, send panel without a sender, picker filter, XSS in
names, descriptions, reviews and the list, the Send and Activity empty states, tabs, share modal contents, close ways, focus, copy, phone rules, the review queue (empty,
unknown status, approve, reject, delete, counts, XSS), unauthenticated writes, unknown ids, RTL, 390 px and 200 percent zoom, dark mode, keyboard to the submit button.

Defects the twin run found, fixed in this branch (the first complete run had 288 defect findings in 86 scenarios; the last run has none):

| #   | Where                                                                                                     | Reference                                                                                                         | Ours before                                                              | Fix                                                                |
| --- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 1   | price and compare-at boxes                                                                                | accept `1e3` and `.5`                                                                                             | refused both                                                             | amounts parse as a number box does; posted as plain decimals       |
| 2   | price and compare-at boxes                                                                                | the box steps by 0.01 and blocks a third decimal                                                                  | accepted `0.123456789`                                                   | a third decimal is refused (`notNumber`)                           |
| 3   | stock, weight, sort order                                                                                 | the integer rule refuses `007`                                                                                    | accepted it as 7                                                         | whole numbers: no leading zeros                                    |
| 4   | every text field (name, SKU, description, body, category, tags, image URLs, collection name, description) | trims whitespace, separators and invisible format characters (zero-width joiner and space, marks, soft hyphen)    | JS `trim` left them; description and body were not trimmed on the server | `trimLikeWaDesk` in `@crm/contracts` (server schemas and the form) |
| 5   | tags                                                                                                      | one tag may be as long as the 1024-character box; `Cotton` and `cotton` are two tags; parts trimmed like PHP trim | refused a tag over 60 characters; de-duplicated ignoring case            | tag length 1024, exact de-duplication, `trimLikePhp` per part      |
| 6   | product and collection forms                                                                              | a refused submit puts focus on the first invalid field                                                            | focus stayed on the button                                               | focus the first invalid field (client and server errors)           |
| 7   | collection name input                                                                                     | `required`                                                                                                        | no `required` attribute                                                  | added (the form keeps its own validation)                          |
| 8   | share modal send row                                                                                      | the button is disabled while the request runs                                                                     | a fast double click sent twice                                           | re-entrancy guard on the send                                      |
| 9   | products and reviews lists when the data requests fail                                                    | an error page                                                                                                     | a spinner through three silent retries                                   | no retry: the error and Retry show at once                         |

Intended differences recorded in the spec (each with its reason there):

| Where                                                                                                                                                                                                             | Difference                                                           | Reason                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NUL character in any text field                                                                                                                                                                                   | reference stores it, ours refuses                                    | PostgreSQL text cannot hold U+0000                                                                                                                            |
| product name of 191 characters twice (`max+1`, `very-long`)                                                                                                                                                       | reference answers 500                                                | slug column is 191 characters, the reference cannot add `-2` (verified); ours truncates the slug first                                                        |
| empty sort order                                                                                                                                                                                                  | reference answers 500                                                | NULL into a NOT NULL column (verified); ours treats blank as 0                                                                                                |
| image URL `ftp://`                                                                                                                                                                                                | reference stores it                                                  | ours accepts http and https only, Meta and WhatsApp fetch images over the web                                                                                 |
| textarea line breaks                                                                                                                                                                                              | reference stores CRLF                                                | native form post versus JSON                                                                                                                                  |
| collection create, empty submit                                                                                                                                                                                   | ours flags name and products at once                                 | the reference browser stops at the first required box                                                                                                         |
| expired session                                                                                                                                                                                                   | ours shows the error and keeps the typed values                      | shared API client redirects only for an idle timeout (auth domain)                                                                                            |
| share modal: Escape                                                                                                                                                                                               | ours closes                                                          | native dialog; the reference ignores Escape                                                                                                                   |
| share modal: Copy with no link, storefront link                                                                                                                                                                   | ours disabled, ours says set up the storefront                       | documented difference 21; STORE domain not ported (WD-CAT-036)                                                                                                |
| Send tab "Connect a device"                                                                                                                                                                                       | ours links to the channels screen                                    | the reference opens an in-page sheet framing its device screen; no such sheet exists yet (owner: channels and devices screens)                                |
| unknown product id in the edit screen                                                                                                                                                                             | page status 200 with a not-found state                               | the screen is rendered in the browser from the API (the API answers 404)                                                                                      |
| keyboard probe on six screens (0.97 focus rings)                                                                                                                                                                  | the Next.js development-tools portal takes focus after the last stop | exists under `next dev` only                                                                                                                                  |
| 24 refusals the harness reads as "saved" (price or compare over 1,000,000, stock, sort or weight `1e3` or `007`, name of spaces, image `javascript:`, data or spaces, collection with no product or a blank name) | none: both refuse and store nothing                                  | the reference answers with a re-rendered page and a plain red list the form detector cannot read; `server-rules-N` compares stored versus refused per value   |
| share modal send row (all `share-send.*`)                                                                                                                                                                         | outcome and flagged-field keys                                       | the reference message is coral (232,122,93), just outside the harness red test; `share.phone-rules` compares sent versus blocked and message shown per number |

Review items (23, structure only), all decided "ignore": ours has one `h1` (the reference none), three landmark navs against two, fewer buttons and forms because
rows use a confirm dialog instead of one POST form per row, no file input (image upload is blocked on storage), `maxlength` on the long description (ours is stricter),
a collapsing mobile menu, and the cursor-pager rule.

Not comparable (blocked-env, not in the matrix, never counted as ours being wrong): the Setup tab (`/catalog` answers 500 in the reference for every workspace, an
undefined `$engine` in its controller), the Send form and every successful send (the reference shows only "Connect a device first" because no sender is connected and
a device cannot be paired here), and the collections "Send as MPM" success path. Permissions are not twin-compared: the reference has one gate (workspace admin) and a
non-admin member was not created in the shared reference; the per-key 403 checks are in the API e2e. The reference rows tagged `cat-wk-` were deleted by the teardown and
by hand and the `cat-wk-shop` storefront row was removed again; two product rows may remain in the reference from manual probes (to be checked by the reference owner).

Run notes: the reference never goes network-quiet (background polling), so the spec opens it on DOM ready; a reference run takes about 35 minutes with 3 workers. Ours
must run with one worker and in chunks of about 180 scenarios: the shell's realtime client retries `POST /realtime/ticket` every second after a 429 (60 a minute per
user), which with parallel pages produces permanent 429s that the recorder counts as the submit request, and the harness login session of ours ended after about 17 minutes
(a fresh `--into` run logs in again). Both are platform behaviours outside this domain. Re-run: `node parity/prepare-org.mjs cfg.json`, then `PARITY_CONFIG=cfg.json
PARITY_WEB_URL=http://localhost:3108 PARITY_API_URL=http://localhost:53108 parity.sh run apps/web/e2e/catalog-products/parity/WD-CAT.twin.mjs --depth full --workers 1`.
Not run: the API e2e suite after the contract change (API unit tests, tsc and the web unit tests pass), a production build of the web app.

## Backend

<!-- The backend agent adds its section here. -->
