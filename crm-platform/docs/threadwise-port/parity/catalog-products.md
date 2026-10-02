<!-- One file for the whole catalog-products domain. The Web section is the web agent's; `## Backend` is filled by the backend agent. -->

## Web (screens)

### What was compared, and how

Reference: Reference 1.7.0 running at `127.0.0.1:8000`, admin `test@example.com`, driven with Playwright (Chromium). Ours: `apps/web` against the
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
| TW-CAT-001, 035      | Shell, tabs, pill, paywall             | same (tabs, pill, flash style); paywall sheet now the Reference bottom sheet, plan cards blocked (see differences)                                                       |
| TW-CAT-008           | `/catalog` Setup                       | not comparable (reference 500s); built to the Blade source, walked in fixture mode (none, ready, connected, sync, poll, import, commerce, automation, disconnect)     |
| TW-CAT-014, 015      | `/catalog/send`                        | empty state same; the form is walked in fixture mode (rules of the Blade script reproduced); not compared with a running reference                                    |
| TW-CAT-016           | `/catalog/activity`                    | same (empty state); rows show the number in full as Reference does                                                                                                       |
| TW-CAT-017, 018      | `/catalog/collections`                 | same (empty, new panel, card, picker, edit, delete confirm, no-sender send panel); the new panel now closes after a create                                            |
| TW-CAT-019, 021, 022 | `/store/products`, share modal, delete | same after the fixes below (pager footer, share modal without a close icon, "Product removed.")                                                                       |
| TW-CAT-020           | create and edit                        | same except the image dropzone (blocked on storage) and field-level error text (intended)                                                                             |
| TW-CAT-027           | `/store/reviews`                       | same (tabs with counts, cards, Approve, Reject, Delete, flashes, empty text)                                                                                          |
| TW-CAT-030           | `/admin/settings/catalog`              | built this round (the page was missing); same layout, tiles, fields, walkthrough and side cards; two intended changes (blank version, read-only for non-super-admins) |
| TW-CAT-031           | inbox catalog picker                   | reference modal captured; the staff inbox does not consume the picker endpoint yet (team-inbox domain)                                                                |
| TW-CAT-036           | Store rail                             | not built (STORE domain)                                                                                                                                              |

### Differences, classified

Defects found by the side-by-side and fixed in this round (each has a check in the e2e or a unit test):

| #   | Where                                | Reference                                                                                                                                                                    | Ours before                                                          | Class                                                 |
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

| #   | Area                                  | Reference                                              | Ours                                                                        | Reason                                                   |
| --- | ------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| 11  | Pagination                            | Laravel page links                                  | numbered pager over the cursor API with a total                             | cursor pagination (CONTRIBUTING)                         |
| 12  | Confirmations                         | browser `confirm()`                                 | `ConfirmDialog`, same question                                              | design system                                            |
| 13  | Validation text                       | red list on top: "The name field is required."      | field-level messages from the problem `errors[]`, plus a summary line       | frontend-port rule 5 (field-by-field)                    |
| 14  | Em dashes in copy                     | "Active — live on storefront"                       | "Active: live on storefront"                                                | house copy style                                         |
| 15  | Send tab header and footer fields     | header only on the Collections panel, no footer     | header (list mode) and footer (product modes) with 60-character counters    | requested in the brief; the contract accepts them        |
| 16  | Setup with no sender                  | only "Connect a device first"                       | the manual connect panel is also offered                                    | inventory TW-CAT-008 port note (Reference dead end)         |
| 17  | Sync loop above 1000 products         | loops forever                                       | stops when a chunk pushes nothing; cap 200                                  | documented Reference bug                                    |
| 18  | Row "Sync" label                      | "Queued ✓" whenever the response is ok              | "Not queued" when nothing was pushed                                        | documented Reference bug                                    |
| 19  | Collection edit picker                | silently drops members that are not active          | keeps them                                                                  | documented Reference bug                                    |
| 20  | Product preview currency symbol       | four symbols, other codes shown as code             | the saved price's symbols                                                   | documented Reference bug                                    |
| 21  | Share modal copy buttons              | copy the placeholder when there is no link          | disabled                                                                    | documented Reference bug                                    |
| 22  | Connect token field                   | plain password field                                | password field with show/hide                                               | shared `PasswordInput`                                   |
| 23  | Reviews of a deleted product          | stay, labelled `#id`                                | removed with the product                                                    | hard delete with cascade (migration)                     |
| 24  | Operator settings                     | any admin saves; blank Graph version stored as ""   | read-only unless super admin; blank clears the value so the default applies | OperatorGuard; Reference quirk fixed (inventory TW-CAT-030) |
| 25  | Store rail on products and reviews    | left rail with shop, public link and the Store menu | not drawn; Products and Reviews are customer menu entries                   | STORE domain (TW-CAT-036)                                |
| 26  | Activity "View thread"                | link to the conversation                            | not shown (the activity contract carries no conversation id)                | blocked on a contract field                              |
| 27  | Picker search (Send tab, Collections) | client filter over all products                     | server-side search, capped at 120                                           | scale                                                    |

### Blocked or not verified

- **Image upload** (TW-CAT-020): no upload endpoint for products; the dropzone is left out rather than shown dead. The image field takes URLs.
- **Plan cards in the paywall sheet** (TW-CAT-035): `GET /v2/plans` does not say which plans carry `wa_storefront`; needs a contract field in the plans domain.
- **Menu gating by plan**: the app shell resolves the menu with plan features unknown, so Catalog is listed on every plan and the paywall is the gate
  (`nav.test.ts` proves the declared gates: permission `cat.catalog.read` plus plan flag `wa_storefront`). The permission gate in the shell is wired.
- **Inbox catalog picker consumer** (TW-CAT-031): `GET /v2/catalog/products/picker` exists; the team-inbox web does not call it yet.
- **Never rendered in the reference**: the Setup tab and its states, the Send form, a successful send, the connected Setup, health card, sync bar,
  commerce and automation forms, WABA autodetect, concierge and order acknowledgement. They follow the Blade and controller source and were walked on
  our side with the fixture provider. Live Meta, 360dialog and the Baileys bridge were not exercised from the web.
- Dark mode and 390 px width were checked on ours (no horizontal overflow on any catalog or product route; the reference showed none either);
  Arabic renders `dir=rtl` on the shell (checked in the e2e). Arabic strings were not reviewed by a native speaker.
- The twin spec for `threadwise-playwright-parity` (`parity/TW-CAT.twin.mjs`) was not written: the reference cannot render the Setup tab, so a twin
  run would only compare the three tabs and the product pages that are listed above.

## Backend

<!-- The backend agent adds its section here. -->
