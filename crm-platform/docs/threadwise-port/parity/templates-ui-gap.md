# Message Templates: UI parity gap analysis (Reference reference vs our web app)

Unit: TW-TPL (inventory `docs/threadwise-port/inventory/message-templates.md`). Owner decision: follow the Reference reference UI
pixel-close and simple (same layout, columns, buttons, wording, flow); drop extras our page had that the reference lacks, but never
delete an API capability another screen uses. Reference screens: `user/templates/{index,_cards,create,edit,show}.blade.php`,
`TemplatesController`, `user-templates-{index,create,edit,show}.js`. Evidence order: running reference (screenshots taken at desktop
and 390px) > source.

Legend: **match** (same), **UI** (differs in UI, fixed here), **API** (our API lacked it, added here), **contract** (our contract
lacked it, added here), **blocked** (cannot be ported in this unit, id given).

## Routes and permissions

| Reference route (prefix `templates`, role manager)             | Ours                                                                   | Permission                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| GET `/` index (+ `approved/pending/rejected/mine`, `api/list`) | web `/templates`, `GET /v2/templates` + new `GET /v2/templates/counts` | `tpl.templates.read`                       |
| GET `/create`, POST `/` store                                  | web `/templates/new`, `POST /v2/templates`                             | `tpl.templates.create` (+`sync` to submit) |
| GET `/{id}` show, `api/{id}`                                   | web `/templates/[id]`, `GET /v2/templates/:id`                         | `tpl.templates.read`                       |
| GET `/{id}/edit`, PUT `/{id}`                                  | web `/templates/[id]/edit`, `PUT /v2/templates/:id`                    | `tpl.templates.create` (+`sync` to submit) |
| DELETE `/{id}`                                                 | `DELETE /v2/templates/:id`                                             | `tpl.templates.delete`                     |
| POST `/{id}/refresh`, `/{id}/submit`                           | `POST /v2/templates/:id/refresh`, `/submit`                            | `tpl.templates.sync`                       |
| POST `/import-from-meta`                                       | `POST /v2/templates/sync` (per number)                                 | `tpl.templates.sync`                       |
| POST `/sync-stale` (fired on page load)                        | BullMQ sweep every 10 min (TW-TPL-027, intended)                       | worker                                     |
| POST `/sync-instaflow`, channel tabs IG/FB/TG                  | blocked (TW-TPL-IG, other channel domains)                             | n/a                                        |
| POST `/{id}/approve`, `/{id}/reject`                           | not reachable from any reference screen; blocked: B3                   | n/a                                        |
| GET `api/ai-models`, POST `api/ai-generate`                    | blocked: B1                                                            | n/a                                        |
| POST `api/{id}/preview`                                        | picker preview in inbox/broadcast; their own screens                   | n/a                                        |

## 1. Library (index + _cards)

| Element / behaviour                                                                                                       | Status                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Left rail: tip card, Campaigns link rail (Overview, Template Messages > Library/WhatsApp, Scheduled, Performance, Drafts) | UI: our shell already owns navigation; the tip, status list and Quick start cards are rebuilt, the Campaigns rail is not duplicated (links exist in our sidebar) |
| Status list All / Approved / In review / Rejected with live counts                                                        | API + contract: `GET /templates/counts`; list `statusGroup` filter (reference "effective status" buckets)                                                        |
| Header: breadcrumb, serif "Template library." title, intro + guideline link                                               | UI                                                                                                                                                               |
| "Sync from Meta" button (only with a WABA number), result banner                                                          | match (per number loop) + UI banner                                                                                                                              |
| "New Template Message" opens format modal (Standard / Carousel / Catalog)                                                 | UI: the button goes straight to the Standard form (a one-choice modal would be a dead step); the modal returns with Carousel / Catalog, blocked: B2              |
| Channel step of the modal + channel tabs (IG / FB / TG / LINE / WeChat / Viber), Sync from Instaflow                      | blocked: B4 (other channels own their templates; they are not in `wa_templates` for this domain)                                                                 |
| Category underline tabs (All + categories with count > 0)                                                                 | API: counts; UI                                                                                                                                                  |
| WABA number filter (only when more than one number)                                                                       | match (`connectionId`), UI as pill select                                                                                                                        |
| Sort select Newest / Oldest / Name A-Z / Name Z-A                                                                         | API + contract: `sort` on list (keyset)                                                                                                                          |
| Search box (name / body)                                                                                                  | match (`q`), UI                                                                                                                                                  |
| "Showing X of N filtered templates" + status legend                                                                       | API: `filtered` total in counts; UI                                                                                                                              |
| Card grid 1/2/3/4 columns                                                                                                 | UI                                                                                                                                                               |
| Card: name, category pill, engine chip, status dot, type, category, number                                                | UI (engine chip is always "Meta WABA" here)                                                                                                                      |
| Card: per-message cost chip (pay-per-message workspaces)                                                                  | blocked: B5 (wallet/billing domain TW-WAL owns the rate)                                                                                                         |
| Card: WhatsApp mock bubble (media tile, header, body formatting, footer, time, 3 buttons + "+N more")                     | UI (restyled `MessageBubble`)                                                                                                                                    |
| Card: rejection box "Rejected: reason"                                                                                    | match                                                                                                                                                            |
| Card actions: Edit template, view (eye), delete (trash)                                                                   | UI                                                                                                                                                               |
| Delete confirm dialog, toast "Template deleted"                                                                           | match + UI                                                                                                                                                       |
| Numbered pagination 8 per page                                                                                            | intended: cursor "Load more" (architecture), page size 8                                                                                                         |
| Empty state with reset filters and Create template                                                                        | match                                                                                                                                                            |
| Help cards (3)                                                                                                            | UI (same copy)                                                                                                                                                   |
| Page-load stale sweep + refresh when visible                                                                              | intended: server sweep (TW-TPL-027); list refetches on focus                                                                                                     |
| Pricing banner (`x-message-pricing`)                                                                                      | blocked: B5                                                                                                                                                      |

## 2. Create and Edit

**Owner decision: keep the previous create-template form.** The create and edit screens were NOT ported to the reference layout.
`/templates/new` and `/templates/[id]/edit` use the form as on origin/main (lint panel, button reordering, header kinds, variable
panel, phone preview). Everything below that the reference has and the old form lacks is therefore not ported (numbered 01-06 sections,
sticky pill bar, three-button Call to action / Quick reply / Mix editor, separate Attachment section with location coordinates,
Save changes / Delete bar on edit). It is not blocked; it was declined.

Backend support added for edit stays: the old edit form now reaches Meta's in-place edit for approved and paused templates through the
same PUT with `submit` (its "Submit to Meta" button); the name and language inputs are disabled for a template live on Meta (the API
refuses a rename); Meta's refusal appears in its existing result panel as `metaError`. `headerLocation` is accepted by the API but the old
form has no coordinate inputs (a location header is sent without a pin, as before; the "pin required" lint rule was removed).

## 3. Show

| Element / behaviour                                                                                                                                                                                                   | Status                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Left: icon tile, name, category/type, status pill + quality pill                                                                                                                                                      | UI                                            |
| "Meta sync" card (Status, Quality, Meta category, Template ID, Submitted, Last synced)                                                                                                                                | UI                                            |
| WABA account card (name + number)                                                                                                                                                                                     | UI via number list                            |
| Related links: Back, Edit template, Use in a broadcast (approved only)                                                                                                                                                | UI                                            |
| Header: breadcrumb, serif name, subtitle, Refresh, Edit                                                                                                                                                               | UI                                            |
| Banners: Meta submission failed, Not submitted to Meta (Submit to Meta), Submitted for review (auto refresh + Refresh now), Rejected by Meta (friendly reason + code, Edit & resubmit), Paused by Meta, lint warnings | UI; API + contract: `rejectionReasonCode`     |
| Preview card "How it appears on WhatsApp" with media image/placeholder, formatting, buttons                                                                                                                           | UI                                            |
| Components table (Header, Body, Footer, Buttons with type chip and value)                                                                                                                                             | UI                                            |
| Auto refresh while pending                                                                                                                                                                                            | match (30 s, as the reference)                |
| Resubmit on a chosen WABA when several are connected                                                                                                                                                                  | API: `submit` accepts optional `connectionId` |
| Our extras not in the reference (Meta payload viewer, lint section, status timeline)                                                                                                                                  | removed from the screen, API fields kept      |

## Implemented in this change (summary)

API: `GET /v2/templates/counts`; list `sort` and `statusGroup`; `rejectionReasonCode`, full body/header/footer/buttons on the list item;
`headerLocation` (stored in the existing `header_location` column); Meta in-place edit (`POST /{id}`) for approved and paused templates
with name/language locked; `submit` takes an optional `connectionId`. No migration and no new permission were needed (all columns and
the `tpl.templates.*` keys already exist; RLS unchanged). Audit and outbox events are written by the same paths as before.

## Blocked list (recorded, not silently dropped)

- **B1** Build with AI (`api/ai-models`, `api/ai-generate`): needs the AI provider keys admin and a text-generation port (domain AI-KEYS, not in this unit).
- **B2** Carousel and Catalog template authoring: needs payload builders, linter rules and per-card media upload in the API (columns `carousel_data` exist). Imported carousel rows still display.
- **B3** `approve` / `reject` manual status flips: not reachable from a reference screen and they bypass Meta; kept out of the API on purpose.
- **B4** Instagram / Facebook / Telegram / LINE / WeChat / Viber reusable-DM templates and Sync from Instaflow: owned by the channel domains (TW-IG, TW-FB, TW-TG, TW-LINE, TW-WECH, TW-VIB).
- **B5** Per-message cost chip and pricing banner: needs the billing rate (TW-WAL).
- **B6** The `/` attribute picker popup in the body editor: needs the contacts-attributes picker component; variables are mapped by typing the attribute key in the Variable mapping panel.
- **B7** Page-number pagination: intended deviation (cursor "Load more", 8 per load).
