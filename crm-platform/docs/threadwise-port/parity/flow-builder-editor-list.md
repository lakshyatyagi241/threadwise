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
