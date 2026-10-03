# Parity evidence: flows list and templates (FLB-001..013)

Reference 1.7.0 vs branch `akshay/flb/flow-builder-editor`. Inventory: [inventory/flow-builder-editor.md](../inventory/flow-builder-editor.md).
Run side by side in Playwright (reference `127.0.0.1:8000`, ours `localhost:3110`) with the same 14 flows (live, paused and draft;
welcome, cart, lead, post-purchase, re-engagement, event, cart-recovery, `Showcase` and no category; chat, call and Instagram;
keyword, tag, manual-enroll and contact-created triggers; one with no nodes) and three admin templates.

## Same (checked)

- Library rail, status rail, KPI tiles, tabs and their counts (counts ignore the filters), search (case-insensitive, `%` and `_`
  literal), page size 12, page clamped to the last page, footer "Showing N of M filtered flows", pager "Showing 1-12 of 16 flows".
- Featured card: category pill, Most used, Live/Draft, stats (steps, messages, `~2.5 h total`, connections), "Updated ...", first four
  nodes with Reference's own labels (`Trigger / keyword`, `Hello there, welcome to our...`, `Wait 30 min`, `Wait 2 hour`), `/ 2 more steps`.
- Card: category icon, Instagram gradient icon, Call and Instagram badges only, uppercase mono state pills, static purpose sentence,
  bullets, `Keyword` for every trigger kind but tag, group and manual, `Edited ...` or `N active - N done - N failed`.
- Actions and toasts: Pause/Resume ("Flow paused" / "Flow resumed"), Rename (191 max, trimmed, "Flow renamed"), Duplicate
  ("<name> (Copy)", draft, opens in the builder, "Flow duplicated."), Export (`<slug>.threadwise-flow.json`, same wrapper keys), Delete
  (confirm text, "Flow deleted"), Create-flow sheet (Messaging / Call), Reset filters.
- Import: wrapper or bare graph, `(imported)` suffix, unknown `flow_type` falls back to chat, blank name becomes "Imported flow",
  3-column grid positions for nodes without x/y, the same error wording for a non-JSON file, a non-object, `flowNodes` not a list,
  a wrong file type, an empty file ("The file field must be a file of type: ...", "... must not be greater than 4096 kilobytes.").
- Template gallery (name, type chip, fallback description, `N steps - category`, order `sort_order` then newest) and "Use template".
- Admin templates list (heading, KPI tiles with captions, table, hidden chip, description cut at 90, eye / pencil / trash buttons, empty
  state) and form (cards, labels, dark JSON box, validation wording, "Template saved." notice, graph source precedence file then paste
  then flow id, unreadable JSON is "nothing supplied": a create asks for the flow, an edit keeps the old one).

## Fixed in this pass

- Header Analytics link (to `/flow-runtime/analytics`), per-card analytics icon (to `/flow-runtime/analytics?flowId=`, hidden for
  Instagram flows), "Enroll contacts" in place of "Open builder" on manual-enroll flows, "Workspace - <name>" eyebrow.
- State and category pills use Reference's global `.pill` look; featured category reads `ucfirst(str_replace('-', ' ', category))`.
- Featured preview labels come from the node data (the API sends `label`); wait units are exact (`sec`, `hour`, `day`, anything else is
  minutes) and the amount is an integer cast, as Reference.
- Import error names the brand ("This is not a valid <brand> flow export."), client file checks use Laravel's words.
- Duplicate keeps `is_active` of the source (Reference `replicate`).
- Admin template detail no longer fails the client parse for a graph stored as given (nodes without ids or positions).
- Admin list and form follow Reference's structure and copy; paste and clone placeholders were showing their message keys.

## QUIRK (reproduced)

- QUIRK: the Condition label in the featured preview reads the legacy `var` / `op` / `value`, so a current-shape condition reads "If value == ".
- QUIRK: a manual-enroll flow's card has no Open-builder button.
- QUIRK: only Instagram and Call flows get a channel badge.
- QUIRK: every trigger kind but tag, group and manual reads "Keyword".
- QUIRK: pausing a draft changes `is_active` but the pill still says Draft.
- QUIRK: admin form: JSON that is neither an export wrapper nor a graph, a flow id that matches nothing, or a file that is not JSON all
  count as "no graph supplied"; the old graph is kept on edit without a warning.
- QUIRK: template flow types are chat, call and instagram only.

## Intended / architecture-forced differences

- architecture-forced: ids are uuids (the admin "clone by flow id" takes a flow uuid); cursor pagination behind numbered pages (a deep link
  to page 2 walks the cursor, so it opens a little slower); filters are applied in SQL (Reference filtered in PHP); the app shell and the
  confirm dialog come from `@crm/ui` (Reference's confirm has a "Confirm" eyebrow and a trash icon, ours is the shared dialog).
- architecture-forced: "Enroll contacts" opens the runtime's enrolment panel (`/flow-runtime/flows/<id>`: contacts or a group, with the
  result) instead of Reference's browser prompt for a group name.
- intended: an unknown `?status=` shows all flows (Reference showed none); a failed template clone (plan limit, hidden template) shows its
  message in the banner (Reference redirected back and never displayed the `template` error); duplicate and clone check the plan flow cap
  (Reference's duplicate skipped it); the delete also removes the flow's subscribers (see the service note).
- intended: the import and the admin upload read the file in the browser and send its JSON (the API takes JSON, not multipart).

## Not verified

- Instagram remote (Instaflow) panel and channel tabs (TW-FLB-079) are not part of this pass.
- The non-admin redirect to the team inbox (workspace roles) was not exercised in the browser.
- Admin templates pagination at 20 per page was run through the API e2e only (25 templates), not in the browser.

## Twin run in Playwright: TW-FLB-001 to 013 (list, row actions, import / export, template gallery, admin templates)

Spec: `apps/web/e2e/flow-builder-editor/parity/TW-FLB-list.twin.mjs` (163 scenarios, run depth `full`, both sides, `--workers 1`).
Run it against a running Reference (`http://127.0.0.1:8000`) and our app:
`PARITY_WEB_URL=http://localhost:3110 PARITY_API_URL=http://localhost:53110 PARITY_CONFIG=<json> parity.sh run <spec> --depth full --workers 1`.
`PARITY_CONFIG` comes from `node apps/web/e2e/flow-builder-editor/parity/prepare-org.mjs <file>` plus, for the admin screens, an
`ours.operator` block `{ email, password, totpSecret }` of a platform operator (super admin). One worker on purpose: counts, the featured
card and the plan cap are workspace-wide. Every flow and template of the run is named `zz-flb-...` and carries the run tag; each scenario
deletes what it made (a second organisation / workspace for the foreign-id cases, the member of another role, the plan cap are put back).

Final state of the last full run: **same 1555, intended 53, defects 0, review 10** (the review items are application-shell differences,
decided below). Result rows (what each family compared, one row per scenario family; `same` rows count the observed keys that were equal):

| # | Criterion / UX item | Reference observed | Ours observed | Result | Note / reason |
|---|---|---|---|---|---|
| 1 | action.delete: 1/1 cases | equivalent | equivalent | same | |
| 2 | action.duplicate: 1/1 cases | equivalent | equivalent | same | |
| 3 | action.export: 1/1 cases | equivalent | equivalent | same | |
| 4 | action.rename.ui | rejected | none | intended | quirk:the browser's rename prompt has no length limit and the server answers 422 for 192 characters: our rename dialog is the shared dialog with a 191-character input: typing and pasting are cut at the limit, so a 192-character name never reaches the server (the API still answers 422, see rename.192) |
| 5 | action.toggle: 1/2 cases | equivalent | equivalent | same | |
| 6 | action.toggle.ids | not-found | rejected | intended | quirk:a path id that is not a number is an unknown row (404): ids are uuids and every path id of the platform is validated by the uuid pipe first: "abc" is a 400 validation problem, a well-formed unknown or foreign uuid is the 404 (CONTRIBUTING 4, ids never leave the system as numbers) |
| 7 | create.sheet-and-links | /flows/analytics | /flow-runtime/analytics | intended | quirk:the analytics screen lives under /flows/analytics: architecture-forced: execution analytics belong to the flow runtime domain, whose screen is /flow-runtime/analytics (a single flow is ?flowId=<uuid>); the list only links to it |
| 8 | delete.api | not-found | rejected | intended | quirk:a path id that is not a number is an unknown row (404): ids are uuids and every path id of the platform is validated by the uuid pipe first: "abc" is a 400 validation problem, a well-formed unknown or foreign uuid is the 404 (CONTRIBUTING 4, ids never leave the system as numbers) |
| 9 | duplicate.api | 257 | 255 | intended | quirk:a copy of a long name has no length cap: flows.flow_name is capped at 255 characters here: a copy of a name that would pass it is cut in front of the "(Copy)" suffix (Reference stores 257 and more because its column has no cap) |
| 10 | export.names | not-found | rejected | intended | quirk:a path id that is not a number is an unknown row (404): ids are uuids and every path id of the platform is validated by the uuid pipe first: "abc" is a 400 validation problem, a well-formed unknown or foreign uuid is the 404 (CONTRIBUTING 4, ids never leave the system as numbers) |
| 11 | import.bad-flow-type: 1/1 cases | equivalent | equivalent | same | |
| 12 | import.bare-graph: 1/1 cases | equivalent | equivalent | same | |
| 13 | import.blank-name: 1/1 cases | equivalent | equivalent | same | |
| 14 | import.empty-file | ok | none | intended | quirk:the upload is a multipart form post answered by a redirect back with the error: documented in docs/threadwise-port/parity/flow-builder-editor-list.md: our screen reads the file in the browser, applies the same type and size rules in the same words, and sends its JSON to the API (a JSON endpoint answers 422, not a redirect); a rejected file may therefore never reach the server |
| 15 | import.empty-nodes: 1/1 cases | equivalent | equivalent | same | |
| 16 | import.json-array | ok | rejected | intended | quirk:the upload is a multipart form post answered by a redirect back with the error: documented in docs/threadwise-port/parity/flow-builder-editor-list.md: our screen reads the file in the browser, applies the same type and size rules in the same words, and sends its JSON to the API (a JSON endpoint answers 422, not a redirect); a rejected file may therefore never reach the server |
| 17 | import.json-scalar | ok | rejected | intended | quirk:the upload is a multipart form post answered by a redirect back with the error: documented in docs/threadwise-port/parity/flow-builder-editor-list.md: our screen reads the file in the browser, applies the same type and size rules in the same words, and sends its JSON to the API (a JSON endpoint answers 422, not a redirect); a rejected file may therefore never reach the server |
| 18 | import.long-name | 261 | 255 | intended | quirk:an imported name has no length cap: flows.flow_name is capped at 255 characters here: the name is cut in front of the " (imported)" suffix (Reference stores 261 and more because its column has no cap) |
| 19 | import.no-flow-keys | ok | rejected | intended | quirk:the upload is a multipart form post answered by a redirect back with the error: documented in docs/threadwise-port/parity/flow-builder-editor-list.md: our screen reads the file in the browser, applies the same type and size rules in the same words, and sends its JSON to the API (a JSON endpoint answers 422, not a redirect); a rejected file may therefore never reach the server |
| 20 | import.no-name-key: 1/1 cases | equivalent | equivalent | same | |
| 21 | import.nodes-not-list | ok | rejected | intended | quirk:the upload is a multipart form post answered by a redirect back with the error: documented in docs/threadwise-port/parity/flow-builder-editor-list.md: our screen reads the file in the browser, applies the same type and size rules in the same words, and sends its JSON to the API (a JSON endpoint answers 422, not a redirect); a rejected file may therefore never reach the server |
| 22 | import.nodes-without-position: 1/1 cases | equivalent | equivalent | same | |
| 23 | import.not-json | ok | rejected | intended | quirk:the upload is a multipart form post answered by a redirect back with the error: documented in docs/threadwise-port/parity/flow-builder-editor-list.md: our screen reads the file in the browser, applies the same type and size rules in the same words, and sends its JSON to the API (a JSON endpoint answers 422, not a redirect); a rejected file may therefore never reach the server |
| 24 | import.plain-text-type: 1/1 cases | equivalent | equivalent | same | |
| 25 | import.png | ok | none | intended | quirk:the upload is a multipart form post answered by a redirect back with the error: documented in docs/threadwise-port/parity/flow-builder-editor-list.md: our screen reads the file in the browser, applies the same type and size rules in the same words, and sends its JSON to the API (a JSON endpoint answers 422, not a redirect); a rejected file may therefore never reach the server |
| 26 | import.roundtrip: 1/1 cases | equivalent | equivalent | same | |
| 27 | import.too-big | ok | none | intended | quirk:the upload is a multipart form post answered by a redirect back with the error: documented in docs/threadwise-port/parity/flow-builder-editor-list.md: our screen reads the file in the browser, applies the same type and size rules in the same words, and sends its JSON to the API (a JSON endpoint answers 422, not a redirect); a rejected file may therefore never reach the server |
| 28 | import.wrapper: 1/1 cases | equivalent | equivalent | same | |
| 29 | import.xss-name: 1/1 cases | equivalent | equivalent | same | |
| 30 | iso.foreign-flows | ok | not-found | intended | tenant-404: a row of another tenant is indistinguishable from a missing row |
| 31 | list.cards-matrix: 1/1 cases | equivalent | equivalent | same | |
| 32 | list.category-rail: 1/1 cases | equivalent | equivalent | same | |
| 33 | list.featured: 1/1 cases | equivalent | equivalent | same | |
| 34 | list.keyboard: 1/1 cases | equivalent | equivalent | same | |
| 35 | list.pagination: 1/1 cases | equivalent | equivalent | same | |
| 36 | list.responsive-390: 1/1 cases | equivalent | equivalent | same | |
| 37 | list.search: 1/1 cases | equivalent | equivalent | same | |
| 38 | list.states: 1/1 cases | equivalent | equivalent | same | |
| 39 | list.status-tabs | 0 | 3 | intended | quirk:an unknown ?status= shows no flow at all: deliberate fix recorded in docs/threadwise-port/parity/flow-builder-editor-list.md: an unknown status falls back to all flows instead of an empty list with no way back |
| 40 | page.admin-anonymous: 1/1 cases | equivalent | equivalent | same | |
| 41 | page.admin-form: 1/3 cases | equivalent | equivalent | same | |
| 42 | page.admin-form.keyboard | 1 | 0.98 | intended | quirk:no skip link on the admin pages: our admin shell adds a "skip to content" link (Reference has none: better, not worse); the only tab stop without a focus ring is the Next.js development overlay button, which exists in `next dev` only |
| 43 | page.admin-form.load | 7 | 23 | review | ui.count.buttons |
| 44 | page.admin-list: 2/4 cases | equivalent | equivalent | same | |
| 45 | page.admin-list.keyboard | 1 | 0.97 | intended | quirk:no skip link on the admin pages: our admin shell adds a "skip to content" link (Reference has none: better, not worse); the only tab stop without a focus ring is the Next.js development overlay button, which exists in `next dev` only |
| 46 | page.admin-list.load | 9 | 21 | review | ui.count.buttons |
| 47 | page.admin-responsive: 1/1 cases | equivalent | equivalent | same | |
| 48 | page.list: 4/7 cases | equivalent | equivalent | same | |
| 49 | page.list.keyboard | 1 | 0.99 | intended | quirk:a longer shell: our app shell lists about 90 interactive controls, Reference 64: the probe presses Tab at most 90 times and our shell has more navigation links than the cap (every control visited in order, no trap, none skipped); the only stop without a focus ring is the Next.js development overlay button of `next dev`; the page itself is the same set of controls as Reference |
| 50 | page.list.load | 25 | 28 | review | ui.count.buttons |
| 51 | page.list.responsive | none | collapsed | review | ui.nav.mobile |
| 52 | perm.agent: 1/1 cases | equivalent | equivalent | same | |
| 53 | plan.limit | ok | refused | intended | quirk:Reference's duplicate skips the plan flow cap: documented deviation (docs/threadwise-port/parity/flow-builder-editor-list.md): duplicate and template clone count against the plan flow cap like create and import do, so a workspace at its cap cannot get past it by duplicating; Reference lets a duplicate through |
| 54 | rename.191: 1/1 cases | equivalent | equivalent | same | |
| 55 | rename.192: 1/1 cases | equivalent | equivalent | same | |
| 56 | rename.255: 1/1 cases | equivalent | equivalent | same | |
| 57 | rename.backslash: 1/1 cases | equivalent | equivalent | same | |
| 58 | rename.emoji-191: 1/1 cases | equivalent | equivalent | same | |
| 59 | rename.emoji-192: 1/1 cases | equivalent | equivalent | same | |
| 60 | rename.empty: 1/1 cases | equivalent | equivalent | same | |
| 61 | rename.html: 1/1 cases | equivalent | equivalent | same | |
| 62 | rename.ids | not-found | rejected | intended | quirk:a path id that is not a number is an unknown row (404): ids are uuids and every path id of the platform is validated by the uuid pipe first: "abc" is a 400 validation problem, a well-formed unknown or foreign uuid is the 404 (CONTRIBUTING 4, ids never leave the system as numbers) |
| 63 | rename.newline: 1/1 cases | equivalent | equivalent | same | |
| 64 | rename.one-char: 1/1 cases | equivalent | equivalent | same | |
| 65 | rename.padded: 1/1 cases | equivalent | equivalent | same | |
| 66 | rename.rtl: 1/1 cases | equivalent | equivalent | same | |
| 67 | rename.script: 1/1 cases | equivalent | equivalent | same | |
| 68 | rename.spaces: 1/1 cases | equivalent | equivalent | same | |
| 69 | rename.sql: 1/1 cases | equivalent | equivalent | same | |
| 70 | rename.tab: 1/1 cases | equivalent | equivalent | same | |
| 71 | rename.template-token: 1/1 cases | equivalent | equivalent | same | |
| 72 | rename.unicode: 1/1 cases | equivalent | equivalent | same | |
| 73 | rename.valid: 1/1 cases | equivalent | equivalent | same | |
| 74 | rename.zero-width: 1/1 cases | equivalent | equivalent | same | |
| 75 | save.category-64: 1/1 cases | equivalent | equivalent | same | |
| 76 | save.category-65: 1/1 cases | equivalent | equivalent | same | |
| 77 | save.category-custom: 1/1 cases | equivalent | equivalent | same | |
| 78 | save.category-emoji-64: 1/1 cases | equivalent | equivalent | same | |
| 79 | save.category-emoji-65: 1/1 cases | equivalent | equivalent | same | |
| 80 | save.category-empty: 1/1 cases | equivalent | equivalent | same | |
| 81 | save.category-html: 1/1 cases | equivalent | equivalent | same | |
| 82 | save.category-padded: 1/1 cases | equivalent | equivalent | same | |
| 83 | save.category-spaces: 1/1 cases | equivalent | equivalent | same | |
| 84 | save.name-255: 1/1 cases | equivalent | equivalent | same | |
| 85 | save.name-256: 1/1 cases | equivalent | equivalent | same | |
| 86 | save.name-empty: 1/1 cases | equivalent | equivalent | same | |
| 87 | save.name-padded: 1/1 cases | equivalent | equivalent | same | |
| 88 | save.name-spaces: 1/1 cases | equivalent | equivalent | same | |
| 89 | save.type-bogus: 1/1 cases | equivalent | equivalent | same | |
| 90 | save.type-telegram: 1/1 cases | equivalent | equivalent | same | |
| 91 | tpl.admin: 4/5 cases | equivalent | equivalent | same | |
| 92 | tpl.admin.ids | not-found | rejected | intended | quirk:a path id that is not a number is an unknown row (404): ids are uuids and every path id of the platform is validated by the uuid pipe first: "abc" is a 400 validation problem, a well-formed unknown or foreign uuid is the 404 (CONTRIBUTING 4, ids never leave the system as numbers) |
| 93 | tpl.clone.api | not-found | rejected | intended | quirk:a path id that is not a number is an unknown row (404): ids are uuids and every path id of the platform is validated by the uuid pipe first: "abc" is a 400 validation problem, a well-formed unknown or foreign uuid is the 404 (CONTRIBUTING 4, ids never leave the system as numbers) |
| 94 | tpl.create: 41/41 cases | equivalent | equivalent | same | |
| 95 | tpl.edit | [] | ["The name field is required."] | intended | quirk:the browser's own required / min / max bubble is the only message (it is not part of the page text): our form is `novalidate` and prints the validation message in the page (the same words Reference's server uses); Reference relies on the native bubble, so nothing is submitted and nothing is stored on either side (flag.created / stored are equal) |
| 96 | tpl.form: 8/18 cases | equivalent | equivalent | same | |
| 97 | tpl.form.all-empty | /admin/flow-templates/create | /admin/flow-templates/new | intended | quirk:the template form lives at /admin/flow-templates/create: platform convention for create screens is /new (every admin screen of this app uses it); the list, edit and delete routes keep Reference paths |
| 98 | tpl.form.file-not-json | /admin/flow-templates/create | /admin/flow-templates/new | intended | quirk:the template form lives at /admin/flow-templates/create: platform convention for create screens is /new (every admin screen of this app uses it); the list, edit and delete routes keep Reference paths |
| 99 | tpl.form.file-png | /admin/flow-templates/create | /admin/flow-templates/new | intended | quirk:the template form lives at /admin/flow-templates/create: platform convention for create screens is /new (every admin screen of this app uses it); the list, edit and delete routes keep Reference paths |
| 100 | tpl.form.name-only | /admin/flow-templates/create | /admin/flow-templates/new | intended | quirk:the template form lives at /admin/flow-templates/create: platform convention for create screens is /new (every admin screen of this app uses it); the list, edit and delete routes keep Reference paths |
| 101 | tpl.form.paste-nodes-string | /admin/flow-templates/create | /admin/flow-templates/new | intended | quirk:the template form lives at /admin/flow-templates/create: platform convention for create screens is /new (every admin screen of this app uses it); the list, edit and delete routes keep Reference paths |
| 102 | tpl.form.paste-not-json | /admin/flow-templates/create | /admin/flow-templates/new | intended | quirk:the template form lives at /admin/flow-templates/create: platform convention for create screens is /new (every admin screen of this app uses it); the list, edit and delete routes keep Reference paths |
| 103 | tpl.form.paste-object | /admin/flow-templates/create | /admin/flow-templates/new | intended | quirk:the template form lives at /admin/flow-templates/create: platform convention for create screens is /new (every admin screen of this app uses it); the list, edit and delete routes keep Reference paths |
| 104 | tpl.form.sort-10000 | /admin/flow-templates/create | /admin/flow-templates/new | intended | quirk:the template form lives at /admin/flow-templates/create: platform convention for create screens is /new (every admin screen of this app uses it); the list, edit and delete routes keep Reference paths |
| 105 | tpl.form.sort-negative | /admin/flow-templates/create | /admin/flow-templates/new | intended | quirk:the template form lives at /admin/flow-templates/create: platform convention for create screens is /new (every admin screen of this app uses it); the list, edit and delete routes keep Reference paths |
| 106 | tpl.form.source-unknown | /admin/flow-templates/create | /admin/flow-templates/new | intended | quirk:the template form lives at /admin/flow-templates/create: platform convention for create screens is /new (every admin screen of this app uses it); the list, edit and delete routes keep Reference paths |
| 107 | tpl.gallery: 1/1 cases | equivalent | equivalent | same | |
| 108 | xss.admin-surfaces: 1/1 cases | equivalent | equivalent | same | |
| 109 | xss.tenant-surfaces: 1/1 cases | equivalent | equivalent | same | |

### What the scenarios cover

List render with 12 kinds of flow (card text line by line, order newest updated first, KPI tiles, tab and rail numbers against the API),
status tabs and rail (URL, counts unchanged, deep link, reload, Back), category rail (fixed and custom categories, combined with a status),
search (case, `%` `_` quote backslash unicode CJK spaces 400 characters SQL script, page reset, survives a reload, XSS), pagination
(12 vs 13 flows, page 2, Back, out-of-range pages), featured card (follows published, active, newest updated), pause / resume (toast, pill,
counts, a draft, double click), rename (UI and API: valid, unchanged, empty, blank, padded, 191 / 192 characters, emoji at 191 / 192, newline,
tab, HTML, script, SQL, template tokens, RTL, zero-width, backslash, unknown / foreign / malformed id), duplicate (live, paused, draft, double
click, long names), export (file name for awkward names, JSON shape, unicode and slashes unescaped), import (18 files: wrapper, bare graph,
text type, unknown type, blank name, no name, XSS name, 250-character name, no positions, not JSON, array, scalar, no flow keys, nodes not a
list, empty nodes, PNG, empty file, 4 MB; plus an export / import round trip), delete (confirm text, cancel, confirm, reload, double click,
twice, unknown / foreign / malformed), create-flow sheet and the header and card links, template gallery (order, hidden ones, card text) and
clone, the category and name a flow is saved with, admin templates (list rows, empty state, failing list, hide / show with the tenants'
gallery, delete with confirm and the clone that stays, edit with prefilled values, graph kept or replaced, bad paste keeps the old graph,
unknown ids; 41 create cases through the API and 18 through the form), permission denial (a workspace agent: screen, builder, and ten
endpoints), the plan flow cap (create, duplicate, import, clone refused; rename and pause allowed; the screen says why), another tenant's
flow (list, counts, featured, detail), XSS on every surface that prints a name, double submit, keyboard, 390 px / 820 px / RTL, empty and
error states (failing refresh, failing action, offline), and the page probes (load noise, a11y, keyboard, 500 on data requests, no session).

### Defects the run found and that are fixed

- Rename (and the flow name on save, the category, the template name, description and category) counted UTF-16 units, so a name of 191
  emoji was refused where Reference takes it (it counts characters). `flbMaxChars` in `packages/contracts/src/flow-builder-editor/flow.ts`.
- The export file name turned punctuation into dashes (`a/b:c` became `a-b-c`); Reference's slug drops it (`abc`), reads `@` as "at" and treats
  `_` as a separator. `flowExportFileName` in `apps/api/src/modules/flow-builder-editor/flow-rules.ts`.
- A copy or an import of a name near the 255 cap lost its `(Copy)` / `(imported)` suffix. `nameWithSuffix` keeps the suffix and cuts the name.
- A double click on Duplicate made two copies (Reference's form post leaves the page after the first). In-flight guard in `flows-screen.tsx`.
- A failed list refresh said nothing for several seconds (the shared two retries); Reference toasts at once. `retry: false` on the list query.
- The list screen nested a second `main` landmark inside the shell's (axe: landmark-main-is-top-level, landmark-no-duplicate-main).
- An agent or viewer opening `/flows` or the builder saw an empty screen / a dead end; Reference sends them to the team inbox. Both now
  redirect to `/inbox` (the warning toast Reference adds has no cross-page channel here and is not shown).
- Spec-side findings fixed on the spec (not defects of the app): toast lifetimes, native prompt of the reference, the reference's own admin
  confirm modal, locators that matched our shell's language selector, concurrent work in the shared workspace.

### New intended / architecture-forced differences found by this run

- A path id that is not a uuid is a 400 validation problem on ours (404 on Reference); well-formed unknown and foreign ids are 404 on both.
- The rename dialog is the shared dialog with a 191-character input, so a 192-character name never reaches the server (Reference's native
  prompt has no limit and the server answers 422). The API refuses 192 on both.
- `flows.flow_name` is capped at 255: a copy or import of a longer name is cut in front of its suffix (Reference stores 257 / 261).
- The analytics links go to `/flow-runtime/analytics` (the runtime domain's screen); Reference `/flows/analytics`.
- The admin template form is `/admin/flow-templates/new` (`/create` on Reference), the platform convention.
- The admin form is `novalidate` and prints the validation message in the page; Reference relies on the browser's required / min / max bubble.
  A wrong file type on that form is explained and keeps what was typed; Reference comes back silent with an empty form.
- Import errors: files are checked in the browser (same words), JSON goes to the API (422, not a redirect); a bare number in a file is
  "not a valid export" on ours and "wrong file type" on Reference (libmagic sniffing); a 4 MB file is "failed to upload" on the local Reference
  (PHP's 2 MB default fires before the 4096 KB rule).
- The plan cap also covers duplicate (and clone) on ours; Reference's duplicate skips it (already recorded above).
- The foreign flow's builder URL is 404 on ours; Reference renders an empty builder for it (no data leaks either way).
- Keyboard probe: our shell has about 90 tab stops (Reference 64) and a skip link; the only stop without a focus ring is the Next.js
  development overlay. LCP is slower on our development servers (cards load after hydration through the cursor API).

### Review items decided

`page.list.load`, `page.admin-list.load`, `page.admin-form.load`: button / form / nav counts differ because of the application shell
(side rail, banner, cookie bar) and because Reference uses a `<form>` per card action; the screenshots show the same list, rails, tiles,
tabs, featured card and gallery. `page.list.responsive`: our shell collapses its navigation on a phone, Reference's top bar does not.
None of them is a missing element of these screens.

### Not compared

- The Instagram remote panel (TW-FLB-079), the builder itself (TW-FLB-014 onwards, a separate twin spec), and plan-feature locking
  of `/flows*` (`autoflow` paywall) were not part of this run.
- The warning toast after an agent's redirect (no shared flash channel on ours).
- Admin template pagination at 20 per page in the browser (API e2e only), and a second operator role (only the super admin was available).
- The rename prompt's double submit (Reference's is the browser's native prompt, which cannot be double-submitted).
- Live Instagram / WhatsApp calls (none are made by these screens).
- During the run another agent was driving the same two workspaces (editor spec); scenarios that read workspace-wide numbers were re-run
  alone until their results were stable.
