<!-- The backend section of this file is written by the CAT backend agent; the Web section below is the web agent's. -->

## Web (screens)

Evidence: `apps/web/e2e/catalog-products/walk.mjs` (re-runnable Playwright walk on our app, 36 checks, screenshots in
`/tmp/cat-web-shots`), `apps/web/src/features/catalog-products/**/*.test.ts` (unit tests of the pure logic and messages).
The reference renders only `/catalog/send`, `/catalog/collections` and `/catalog/activity` (no device, no catalog, no shop);
`/catalog` and `/store/products` return HTTP 500 there.

### Status

| Id                     | Screen                                                                                                              | Status                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| TW-CAT-001             | Shell: strip, title, connection pill, four tabs, plan paywall                                                       | screen-done                                                                                                                          |
| TW-CAT-008             | `/catalog` Setup: none, ready and connected states, health, sync bar, commerce and automation forms, products table | screen-done (connected state needs a live Meta catalog or `CAT_PROVIDER_MODE=fixture`; not walked)                                   |
| TW-CAT-014             | `/catalog/send`                                                                                                     | screen-done for the "Connect a device first" state; the form is built to the Blade source but not walked (no sender in the test org) |
| TW-CAT-016             | `/catalog/activity`                                                                                                 | screen-done (empty state walked)                                                                                                     |
| TW-CAT-017/018         | `/catalog/collections` create, edit, delete walked; Send panel built, not walked (no sender)                        | screen-done                                                                                                                          |
| TW-CAT-019/021/022/023 | `/store/products` list, search, 25 per page, delete, share modal, send box                                          | screen-done (send to a number needs a sender: not walked)                                                                            |
| TW-CAT-020             | `/store/products/create` and `/:id/edit`                                                                            | partial: image file upload is **blocked** on the storage domain (URL field and gallery URL rows only)                                |
| TW-CAT-027             | `/store/reviews` tabs, counts, approve, reject, delete                                                              | screen-done (empty states walked; no way to create a review without the public shop)                                                 |

### Differences from Reference

| #   | Area                                                         | Reference                                                                            | Here                                                                                                     | Class                                                    |
| --- | ------------------------------------------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | No sender, no catalog                                        | Setup shows only "Connect a device first"; the manual connect form is unreachable | the manual connect panel is also shown                                                                   | defect-fixed (inventory TW-CAT-008 port note)            |
| 2   | Pagination                                                   | Laravel page links                                                                | numbered pager over the cursor API with `includeTotal` ("Showing N of M")                                | intended (cursor pagination)                             |
| 3   | Sync loop                                                    | infinite loop above 1000 unsynced products                                        | loop stops when a chunk pushes nothing; hard cap of 200 chunks                                           | defect-fixed                                             |
| 4   | Row "Sync" label                                             | "Queued ✓" whenever the response is ok                                            | "Queued ✓" only when something was pushed, else "Not queued"                                             | defect-fixed                                             |
| 5   | Page reloads                                                 | `location.reload()` after poll and import                                         | the overview query is refetched                                                                          | intended                                                 |
| 6   | Confirmations                                                | browser `confirm()`                                                               | `ConfirmDialog`                                                                                          | intended (same text)                                     |
| 7   | Product search                                               | server-side on the Send picker absent (client filter over all)                    | picker search is server-side (picker caps at 120)                                                        | intended                                                 |
| 8   | Send tab header and footer fields                            | only the Collections panel offers a header; no footer                             | header (list mode) and footer (product modes) with 60-char counters                                      | intended (requested in the brief; contract accepts them) |
| 9   | Collection edit picker                                       | members that are not active products are silently dropped on save                 | they stay in the picker                                                                                  | defect-fixed                                             |
| 10  | Activity                                                     | no status column, "View thread" link                                              | failed rows get a "Failed" line; **no "View thread" link**: the activity contract has no conversation id | blocked (contract gap)                                   |
| 11  | Store sidebar rail on `/store/products` and `/store/reviews` | left rail with the store menu                                                     | not rendered (belongs to the STORE domain); the app menu has Products and Reviews                        | intended pending STORE                                   |
| 12  | Product preview currency symbol                              | symbols for four currencies, others show the code                                 | the same symbols as the saved price                                                                      | defect-fixed                                             |
| 13  | Share modal copy buttons                                     | copy the placeholder text when no link exists                                     | disabled when there is no link                                                                           | defect-fixed                                             |
| 14  | Connect token field                                          | plain password field                                                              | password field with a show/hide toggle (shared `PasswordInput`)                                          | intended                                                 |

### Not verified / blocked

- Send tab form, Collections "Send as MPM", share-modal send and the connected Setup state were not exercised end to end: they need a
  connected sender (WABA or device) and a catalog; the API runs live Meta mode here (a bad token answers `CAT_META_REJECTED`,
  which the connect form shows under the token field).
- "Connect a device" and the back arrow link to `/channels` and `/integrations`; those screens belong to other domains.
- "Manage →" on the Shops tile links to `/store`.
- Image upload (TW-CAT-020): blocked on storage.
- Collections "Send as MPM" keeps Reference's inline panel on each card rather than opening the Send tab.
