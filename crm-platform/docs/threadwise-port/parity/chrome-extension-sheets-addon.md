# Parity evidence: chrome-extension-sheets-addon (EXT), Google Sheets add-on part

Reference 1.7.0 vs branch `lakshya/ecom/complete-domain`. Inventory: [inventory/chrome-extension-sheets-addon.md](../inventory/chrome-extension-sheets-addon.md). API reference:
[docs/api/chrome-extension-sheets-addon.md](../../api/chrome-extension-sheets-addon.md). The Chrome extension half of EXT is not covered here.

Ownership: EXT is assigned to Shubham in the committed `ownership.json`. The Sheets add-on backend was built at Lakshya's explicit request (the working tree already moves the domain to Lakshya); record this in the PR.

## Evidence so far

The backend, the Apps Script source and the web page are written. The Playwright twin run against the running Reference **has not been done**, and the add-on was **never run inside a real Google Sheet**
(no Apps Script runtime was available), so its menu, dialogs and `UrlFetchApp` calls are checked only by syntax, by unit tests of its pure helpers and by reading against the API doc. The backend items below are automated and ran against
real Postgres and Redis (testcontainers) with the real app.

Add-on and web page (this session):

- `apps/api/test/unit/chrome-extension-sheets-addon/addon-source.spec.ts` (loads `Code.gs` in a Node `vm` with no Google services and calls its pure helpers): the six files exist, `CRM_BASE` is declared once on one line in the form the download rewrites, the manifest has the V8
  runtime and only the three narrow scopes, no `Logger`/`console` and no key in the document properties, no `innerHTML` in the dialogs; key masking and format check; header mapping and row building for contacts and products (blank cells, dates, blank rows,
  `attr:` columns, stock blank vs absent); chunking by 500; per-row results counted and written as status text (a row the server did not mention is a failure); reading answers for 200, 401, 403, 413, 422, 429 with `Retry-After` and non-JSON bodies.
  `node --check` passes on `Code.gs` and on the script of `Dialog.html` and `Settings.html`.
- `apps/web/src/features/chrome-extension-sheets-addon/` `lib/model.test.ts` (12) and `components/sheets-screen.test.tsx` (9): view state order (no permission, loading, error with retry and request id, not installed with the Marketplace link and no Generate key, ready),
  key card with and without a key, masked key only, capabilities, six files in order with unavailable ones, shops and products and their empty states, error kinds by code, formatting. Server-rendered markup only: the generate, rotate and revoke clicks, the
  one-time key banner, the copy button and the file download are **not** exercised by a test or a browser yet.
- `pnpm --filter @crm/web typecheck` (tsc), eslint and prettier on the new files, and the whole web vitest run (580 files, 7216 tests) pass, including the Settings registry and help coverage tests.

- `apps/api/test/unit/chrome-extension-sheets-addon/` (4 files, 31 tests, passing): key format, hashing and masking; bearer parsing; row rules for contacts (email and phone reading, default country code, blank cells, opt-out words, bad rows reported on their own);
  the product row and request schemas (price, stock absent vs blank vs number, active words, 500-row cap, currency, theme); who may do what (consent ceiling and the role floor); the source download (address rewrite, replacement-pattern safety, the six names, no path);
  the error envelope; the environment.
- `apps/api/test/e2e/chrome-extension-sheets-addon/sheets-key.e2e.spec.ts` (14): create, replace and revoke a key; the secret is shown once and only its hash and suffix are stored; audit and outbox without the secret; one active key per member; refusals without
  the app installed or the permission; last-used written at most once a minute; the setup page data; the source download.
- `.../sheets-auth.e2e.spec.ts` (17): every refusal (no key, malformed, unknown, revoked, replaced, wrong scheme, header only); the address lockout; two workspaces never see each other; installed, disabled, killed and uninstalled; consent as a ceiling; a viewer key cannot write;
  role changes take effect at once (write removed, then the app permission); record scope `own`; suspended member and workspace; a deleted member's key; the plan rate ceiling with headers and 429; the 2 MiB cap and 422s.
- `.../sheets-sync.e2e.spec.ts` (22): contacts in (create, E.164, source, owner, audit actor, update by email or phone, blank cells, unchanged repeats, partial failures with index/ref/field, email and phone on two contacts, same person twice, opt-out, create-only and
  update-only roles, record scope, two workspaces), contacts out (cursor paging, shape, search, caps, round trip), shops and products (create from a sheet, second sync in place, kept fields, bad rows, the 422 set, foreign shop id, per-row role, plan product cap, audit).
- Typecheck (`pnpm --filter @crm/api exec tsc -p tsconfig.json --noEmit`), eslint and prettier on every touched file, `pnpm arch:check` and the RLS check (no new table; `user_settings` and `workspace_app_installations` are enabled, forced, with a policy) are in the PR notes.

## Status of each feature

| Feature    | Status              | Notes                                                                                                                                                                                              |
| ---------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TW-EXT-001 | backend-done        | `POST /v2/extension/sheets/key`. Secret shown once, sha256 + suffix stored in `user_settings`, replaces the old key, audit + outbox. Difference 1, 2.                                              |
| TW-EXT-002 | backend-done        | `GET /v2/extension/sheets/key` and the overview.                                                                                                                                                   |
| TW-EXT-003 | backend-done        | `DELETE /v2/extension/sheets/key`, idempotent.                                                                                                                                                     |
| TW-EXT-004 | backend-done        | `SheetsKeyGuard`: runs as the key's owner with live grants. Differences 3, 4.                                                                                                                      |
| TW-EXT-005 | built, not run live | `GET /v2/extension/sheets/files[/:name]`. The six source files are now in `apps/api/assets/google-sheets-addon/`; the page lists them with a Download button each. Not run in a real Google Sheet. |
| TW-EXT-006 | backend-done        | `GET /v2/extension/sheets/overview`. The screen is not built.                                                                                                                                      |
| TW-EXT-007 | backend-done        | Lockout, per-key rate limit with the plan ceiling, 2 MiB cap. New (difference 6).                                                                                                                  |
| TW-EXT-008 | backend-done        | `GET /api/v1/sheets-addon/shops`. Difference 7.                                                                                                                                                    |
| TW-EXT-009 | backend-done        | The shop half of `POST /api/v1/sheets-addon/sync`. Differences 5, 8; quirks kept.                                                                                                                  |
| TW-EXT-010 | backend-done        | The product half of the same call, through the product form's own create and update. Difference 9; quirks kept.                                                                                    |
| TW-EXT-011 | backend-done        | `GET /api/v1/sheets-addon/contacts`. New (not in Reference).                                                                                                                                       |
| TW-EXT-012 | backend-done        | `POST /api/v1/sheets-addon/contacts/sync`. New (not in Reference).                                                                                                                                 |
| TW-EXT-013 | backend-done        | Install per workspace, consent as a ceiling, role as the floor. New; needs the Marketplace listing to be published before a real install (the e2e inserts the install row directly).               |
| TW-EXT-014 | backend-done        | Summary audit row and `ext.sheets.synced` event per write call.                                                                                                                                    |
| TW-EXT-015 | backend-done        | `GET /api/v1/sheets-addon/health`. Difference 7.                                                                                                                                                   |
| TW-EXT-016 | blocked             | Sending a message from a sheet is not in Reference; needs an owner decision (see the inventory).                                                                                                   |

## Webhook trigger (TW-EXT-017, new in this port)

Added at the owner's request, modelled on the Pabbly Connect Google Sheets webhook add-on; Reference has no such mode, and every Reference behaviour above is unchanged (additive only). Built: the contract (`extSheetsWebhookRequestSchema`, capture, `webhookUrl`), the route `POST /api/v1/sheets-addon/webhook[/:key]` with `SheetsWebhookService`, the setup page card, help guide and 21 locales, the Initial Setup dialog and triggers in the add-on, unit tests (add-on helpers run in a Node `vm`, contract and capture, URL masking, web card) and an e2e spec (`sheets-webhook.e2e.spec.ts`). **Not run:** the API compile and the e2e spec (the workspace install fails on a blocked GitHub-hosted dependency in this environment; no Docker for testcontainers), the Apps Script triggers and `createAddonMenu` in a real Google Sheet, and the Playwright twin run.

## Differences from Reference

1. **The key is created through the add-on's Marketplace install and a role permission.** Reference let any signed-in user create one with no install and no permission. Here: the add-on must be installed in the workspace, the role must hold `app.google-sheets.use`, and the plan feature `marketplace` must be on. (intended: the design note `docs/specs/marketplace-extension-listings.md`.)
2. **The key is the same format and storage idea** (`wsn_live_` + 32 hex, sha256 and last 8 characters, one per member, replaced on generate) but the columns are `user_settings.sheets_key_*` (one row per member in our schema, the auth port's translation of Reference's `users` columns) with a unique partial index on the hash. A key made in Reference cannot be moved: only the hash is stored there too, but the databases are separate. (same / intended)
3. **Authentication runs as the member.** Reference's controller found the user and read their current workspace; it checked no role. Here the request carries the member's workspace, id and live permissions, so every write is owned by and audited as them, and a role change ends or narrows the key at once. (intended)
4. **Refusals the add-on did not have:** suspended member or workspace, a role without the app permission, add-on not installed or disabled, scope not consented. The 401 for a wrong key is one sentence for unknown, malformed, revoked and replaced keys. (intended)
5. **One bad product row no longer sinks the sync.** Reference validated every product first and refused the request with a 422 on the first problem; the port reports each bad row (index, ref, code, field) and saves the rest, and answers 200. The shop part is still validated as a whole, with a 422. (intended)
6. **Limits Reference did not have:** 30 wrong keys per address a minute locks the address out, 120 calls a minute per key (never above the plan's API ceiling), a 2 MiB body, 500 items. (intended)
7. **Ids and shapes:** shop ids, `workspace` and every id are uuids; `health.workspace` is an object `{ id, name }`; `health` gains `can`, `limits`, `api_version`. Field names stay snake_case and the `{ ok }` envelope stays. (intended; the add-on client is new code)
8. **A shop sync needs no connected WhatsApp number**, as in Reference; the shop wizard's rule ("connect a number first") deliberately does not apply here. A sync never changes a shop's device, domain or enabled flag. (same)
9. **Products are written through the product form's create and update**, so the plan's product cap, the audit trail, events and the Meta catalog push apply (Reference saved the model directly). Matching is by SKU, then name case-insensitively (Reference: exact SKU, then name as the database compares it). Price is stored times 100 as before. (intended / same)
10. **Failure envelope** is `{ ok: false, error, code, details?, requestId }`; Reference's was `{ ok: false, error }` with Laravel's validation body on a 422. (intended)
11. **Contacts and the key's setup data are new:** Reference's add-on has no contacts, no pull and no overview API (its page was server-rendered). (new)

Quirks kept on purpose: a sync with no `shop_id` makes a new shop each time; an unknown or foreign `shop_id` makes a new shop; an absent `active` re-activates a product; a name match overwrites the stored spelling.

## Still to do

- Run the add-on in a real Google Sheet (paste the six files, check the menu, dialogs, scopes prompt and each action against a running server); then the Playwright twin run and `threadwise-verify-parity` of the setup page against the running Reference.
- Browser-level test of the page's click paths (generate, rotate with confirm, revoke with confirm, the one-time key and copy, file download).
- A Marketplace card "Open" link for this client listing (the Marketplace has no per-listing open target yet); today the page is reached from Settings > Integrations.
- The page and add-on are English only; the Arabic file holds just the Settings tile text, and the other languages come through the localization domain.
- Publish the `google-sheets` Marketplace listing (it is a seeded draft) and run a real install through the Marketplace API.
- Owner decisions: keys after an uninstall (dormant vs cleared), an optional key expiry, and whether TW-EXT-016 is wanted.
