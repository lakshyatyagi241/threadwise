---
domain: contacts-attributes-tags
code: CON
title: Contacts, Contact Groups, Contact Tags and Custom Attributes
threadwise_version: '1.7.0'
sources_read: 58
---

# Contacts, Contact Groups, Contact Tags and Custom Attributes

## Overview

This domain is the workspace address book. It owns four things: **contacts** (`contacts`), **contact groups** (`contact_groups`, a named list a contact can be filed under), the **contact side of tags** (`contact_tag` pivot; the master list `tags` is shared with the Team Inbox and documented in TIB1 as TW-TIB1-036/037) and **custom attributes** (`attributes`, workspace-wide "merge variable" definitions with an optional default value). It also owns the public REST API for contacts and groups (`/api/v1/contacts`, `/api/v1/contact-groups`) and the contact-related model hooks (flow triggers, webhooks, notifications, phone hash).

Who uses it:

- **Workspace manager, admin, owner** (role gate `workspace.role:manager`) use the Contacts page `/contacts`: list, search, filter by group or tag, add/edit/delete, bulk actions, CSV import and export, duplicate cleanup, groups, per-contact tags. Agents and viewers are redirected to `/team-inbox` and never see this page.
- **Any logged-in workspace member** (no role gate at all, see QUIRK in TW-CON-042) can open `/attributes` and create/edit/delete custom attributes, and call `/attributes/api/list` for the slash picker used in composers.
- **API clients** use `/api/v1/*` with a workspace API key (Bearer `wsk_...` or `X-Api-Key`).
- **Other domains** read contacts constantly: broadcasts, campaigns, scheduled sends, flows, the inbox, deals/companies, integrations (Shopify, WooCommerce, lead finder, social channels), the Node bridge (attributes feed) and the mobile app API.

Main flow end to end: contacts arrive by manual add, CSV import, API, or automatic capture (every number a user messages once, every inbound sender, every shop/lead import). They are filed into groups and tagged. A send screen expands an audience from groups, tags or explicit ids, drops opted-out contacts, and fills `{{tokens}}` from the contact row, then the contact's custom attributes, then workspace attributes, then system tokens (TW-CON-048). Adding a tag, joining a group, being created or re-subscribing can enroll the contact into a published flow (TW-CON-053). Contact create/update/opt-in fire outbound webhooks (TW-CON-052).

Plan tiers: only one numeric gate applies to this domain, `contacts_limit` (package column, per-workspace override via `plan_overrides`; 0, null or negative = unlimited; platform admins bypass). It is checked on single add (UI only) and CSV import start (UI only); the public API does not check it (TW-CON-026, TW-CON-059). Tag creation has its own `tags_limit` but only in the Team Inbox path, not from Contacts. Seed packages: Starter 500, Growth 5000, Pro 25000, Enterprise 0 (unlimited). API access/rate limit (`api_rate_limit_per_minute`) is documented as plan-dependent in the Plans domain.

Storage model in one paragraph (important for the rebuild): Reference has **no join table for group membership**. A contact's groups live in `contacts.contact_group`, a Laravel-encrypted JSON array of group id strings. `name`, `mobile`, `email` and `contact_group` on contacts, `user_group` and `note` on groups, `attribute_value` and `description` on attributes are application-encrypted (AES via APP_KEY, non-deterministic), so nothing can be searched or counted in SQL; every list, search, filter, count and dedupe loads and decrypts the whole workspace book into PHP memory. `mobile_hash` (SHA-256 of the canonical digits) is the only queryable phone key. `first_name`, `middle_name`, `last_name`, `title`, `address`, `msg`, `language`, `country_code` and `custom_attributes` (JSON) are plaintext.

Connections: WSP/workspaces-teams-tenancy (workspace scoping, roles, starter tags), PLN/plans-subscriptions-trials (`contacts_limit`, `api_rate_limit_per_minute`), TIB1/team-inbox-conversations (tag master list, conversation tags, STOP handling, save-contact, extract-contact), BRD/broadcasts and CMP/campaigns and SCH/scheduled (audience, opt-out, variables), FLW/flow-builder-editor and flow-runtime-engine (audience triggers, attribute feed), INTG/webhooks (contact events), notifications-activity-audit (model-event notifications), roles-permissions (role hierarchy), deals/companies (contacts.company_id, Contact 360).

## Feature index

| Id         | Feature                                                                | Status      | Priority | Effort | Depends on                         |
| ---------- | ---------------------------------------------------------------------- | ----------- | -------- | ------ | ---------------------------------- |
| TW-CON-001 | Contacts list page (scope, access, load, ordering)                     | implemented | P0       | M      | none                               |
| TW-CON-002 | Contacts search (`q`)                                                  | implemented | P0       | S      | TW-CON-001                         |
| TW-CON-003 | Group filter and sidebar group list                                    | implemented | P0       | S      | TW-CON-001, TW-CON-037             |
| TW-CON-004 | Tag filter                                                             | partial     | P1       | S      | TW-CON-001, TW-CON-041             |
| TW-CON-005 | Pagination and page size                                               | implemented | P0       | S      | TW-CON-001                         |
| TW-CON-006 | Stat tiles, sidebar counts, Imported / No-group quick filters          | partial     | P1       | S      | TW-CON-001                         |
| TW-CON-007 | List / grid view toggle                                                | implemented | P2       | S      | TW-CON-001                         |
| TW-CON-008 | Contact row rendering (columns, phone display, attribute chips)        | implemented | P0       | S      | TW-CON-001                         |
| TW-CON-009 | Add contact (modal + `POST /contacts`)                                 | implemented | P0       | M      | TW-CON-012, TW-CON-013, TW-CON-026 |
| TW-CON-010 | Edit contact (modal + `PUT /contacts/{id}`)                            | implemented | P0       | M      | TW-CON-009                         |
| TW-CON-011 | Delete a single contact                                                | implemented | P0       | S      | TW-CON-001                         |
| TW-CON-012 | Display-name composition and title handling                            | implemented | P0       | S      | none                               |
| TW-CON-013 | Phone storage, canonical form and `mobile_hash`                        | implemented | P0       | M      | none                               |
| TW-CON-014 | Contact avatar image upload                                            | partial     | P2       | S      | TW-CON-009                         |
| TW-CON-015 | Status and Source values                                               | partial     | P1       | S      | TW-CON-009                         |
| TW-CON-016 | Per-contact custom attribute values                                    | implemented | P1       | M      | TW-CON-043                         |
| TW-CON-017 | Marketing opt-out flag (`is_unsubscribed`, `unsubscribed_at`)          | partial     | P0       | M      | TW-CON-013                         |
| TW-CON-018 | Contact 360 page (`GET /contacts/{id}`)                                | dead-code   | P2       | M      | TW-CON-001                         |
| TW-CON-019 | Selection model and bulk bar (page vs "all matching")                  | partial     | P0       | M      | TW-CON-001                         |
| TW-CON-020 | Bulk delete                                                            | implemented | P0       | S      | TW-CON-019                         |
| TW-CON-021 | Export selected contacts (CSV)                                         | implemented | P1       | S      | TW-CON-019                         |
| TW-CON-022 | Export all contacts in the current view (CSV)                          | implemented | P1       | S      | TW-CON-021                         |
| TW-CON-023 | Bulk add / remove group                                                | implemented | P0       | M      | TW-CON-019, TW-CON-037             |
| TW-CON-024 | Bulk tag / untag                                                       | implemented | P1       | M      | TW-CON-019, TW-CON-041             |
| TW-CON-025 | Remove duplicates (workspace dedupe)                                   | implemented | P1       | M      | TW-CON-013                         |
| TW-CON-026 | Plan gate `contacts_limit`                                             | partial     | P0       | S      | PLN plan model                     |
| TW-CON-027 | CSV import (upload, process, result summary)                           | implemented | P0       | L      | TW-CON-028..030, TW-CON-026        |
| TW-CON-028 | Import column auto-detection                                           | implemented | P0       | S      | TW-CON-027                         |
| TW-CON-029 | Import "apply to every contact" knobs (status, source, group, tags)    | partial     | P1       | S      | TW-CON-027                         |
| TW-CON-030 | Import duplicate handling (update in place)                            | implemented | P0       | M      | TW-CON-013, TW-CON-027             |
| TW-CON-031 | Import preview endpoint                                                | dead-code   | P2       | S      | TW-CON-028                         |
| TW-CON-032 | Sample CSV download                                                    | implemented | P2       | S      | none                               |
| TW-CON-033 | Groups panel (cards, empty tile, sidebar)                              | implemented | P0       | S      | TW-CON-037                         |
| TW-CON-034 | Create group                                                           | implemented | P0       | S      | TW-CON-037                         |
| TW-CON-035 | Edit group                                                             | implemented | P1       | S      | TW-CON-034                         |
| TW-CON-036 | Delete group (detaches from contacts)                                  | implemented | P0       | S      | TW-CON-037                         |
| TW-CON-037 | Group membership model, counts and orphan ids                          | implemented | P0       | M      | none                               |
| TW-CON-038 | Contact tags: load a contact's tags + workspace tag list               | implemented | P1       | S      | TW-CON-041                         |
| TW-CON-039 | Attach tag to a contact (find-or-create)                               | implemented | P1       | S      | TW-CON-038, TW-CON-053             |
| TW-CON-040 | Detach tag from a contact                                              | implemented | P1       | S      | TW-CON-038                         |
| TW-CON-041 | Tag data model on contacts, chips in list, starter tags                | implemented | P1       | S      | TIB1 tag master list               |
| TW-CON-042 | Attributes list page (`/attributes`)                                   | implemented | P1       | M      | none                               |
| TW-CON-043 | Create attribute                                                       | partial     | P1       | S      | TW-CON-042                         |
| TW-CON-044 | Edit attribute                                                         | partial     | P1       | S      | TW-CON-042                         |
| TW-CON-045 | Delete attribute                                                       | implemented | P1       | S      | TW-CON-042                         |
| TW-CON-046 | Attribute picker feed (`/attributes/api/list`) and slash picker        | implemented | P1       | M      | TW-CON-043                         |
| TW-CON-047 | Built-in (system) attribute catalog and send-screen catalog            | implemented | P1       | M      | TW-CON-046                         |
| TW-CON-048 | Merge-tag resolution at send time                                      | implemented | P0       | L      | TW-CON-016, TW-CON-043             |
| TW-CON-049 | Positional placeholder validator                                       | implemented | P1       | S      | none                               |
| TW-CON-050 | Attribute feeds for Node bridge, mobile app and browser extension      | implemented | P1       | S      | TW-CON-043                         |
| TW-CON-051 | `contact_custom_fields` typed field schema                             | dead-code   | P2       | S      | none                               |
| TW-CON-052 | Contact outbound webhooks (created, updated, opt-in)                   | partial     | P1       | M      | INTG webhooks                      |
| TW-CON-053 | Flow audience triggers fired by contact changes                        | implemented | P1       | M      | flow runtime                       |
| TW-CON-054 | In-app activity notifications on contact/group/attribute model events  | implemented | P2       | S      | notifications domain               |
| TW-CON-055 | Contact auto-capture and other contact creators                        | implemented | P0       | M      | TW-CON-013                         |
| TW-CON-056 | Public API: auth, envelope, rate limit, errors (contacts scope)        | implemented | P1       | M      | API keys                           |
| TW-CON-057 | API: list contacts                                                     | implemented | P1       | S      | TW-CON-056                         |
| TW-CON-058 | API: read one contact                                                  | implemented | P1       | S      | TW-CON-056                         |
| TW-CON-059 | API: create contact                                                    | implemented | P1       | M      | TW-CON-056, TW-CON-012, TW-CON-013 |
| TW-CON-060 | API: update contact                                                    | implemented | P1       | M      | TW-CON-059                         |
| TW-CON-061 | API: delete contact                                                    | implemented | P1       | S      | TW-CON-056                         |
| TW-CON-062 | API: list contact groups                                               | implemented | P1       | S      | TW-CON-056                         |
| TW-CON-063 | API: create contact group                                              | implemented | P1       | S      | TW-CON-056                         |
| TW-CON-064 | API: delete contact group                                              | implemented | P1       | S      | TW-CON-056                         |
| TW-CON-065 | Contacts UI shell: toasts, loading, errors, keyboard, responsive, i18n | implemented | P1       | M      | TW-CON-001                         |

## Features

### TW-CON-001 — Contacts list page (scope, access, load, ordering)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** none
- **Summary:** `/contacts` is a server-rendered page listing the current workspace's contacts, newest first, with filters, stat tiles, sidebar views and modals for add/edit/import/group/delete. It is the only list surface; there is no JSON list endpoint for the web app (the JSON list is the public API, TW-CON-057).
- **Actors & access:** Role gate `workspace.role:manager` (owner, admin, manager). Agents/viewers are redirected to `/team-inbox` with a warning flash; platform admins bypass. No Spatie permission key, no plan feature gate. Workspace is `users.current_workspace_id` of the session.
- **UX & screens:** `resources/views/user/contacts/index.blade.php` (page key `user-contacts-index`). Layout: left rail (260px, sticky on large screens) with a "Tip" card, a "Contact views" card (All contacts, Groups, Imported, No group, each with a count), a "Groups" card (All groups + one button per group with member count) and an "Import format" help card. Main column: eyebrow "Workspace - <workspace name>", H1 "Your contacts", subtitle, header buttons (Remove duplicates, Export all, Bulk upload, New group, Add contact), four stat tiles, a toolbar card (tabs All contacts / Groups, bulk bar, search box, group select, page-size select, list/grid toggle), the table, the pagination bar, the hidden Groups panel, and three static help cards ("What is a contact?", "How should I use groups?", "How do I keep lists clean?"). Modals: contactModal (add), editModal, bulkModal (CSV import), groupModal, deleteModal (bulk delete confirm).
- **Endpoints:**

| Method + URI          | Route name            | Action                        | Middleware                        | Request                                       | Response                                                             |
| --------------------- | --------------------- | ----------------------------- | --------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| GET `/contacts`       | `user.contacts`       | ContactsController@index      | web, auth, workspace.role:manager | query `q`, `group`, `tag`, `per_page`, `page` | HTML (Blade `user.contacts.index`)                                   |
| GET `/contact-groups` | `user.contact-groups` | ContactsController@groupIndex | same                              | same                                          | identical HTML (it just calls `index`); does NOT open the Groups tab |

- **Data:** reads `contacts` (all rows of the workspace, with `tags` eager-loaded), `contact_groups`, `tags`, `attributes` (active only, for the modals' attribute inputs), `contact_tag`. Visibility clause everywhere: `workspace_id = current` OR (`workspace_id IS NULL` AND `user_id = me`) — the second branch exists only for pre-workspace legacy rows. Order: `created_at` DESC (no tie-break). Groups: `created_at` DESC for the modals/panel, `id` DESC for the sidebar list.
- **Rules & edge cases:**
  1. Everything is computed in PHP: the controller loads ALL contacts of the workspace (decrypting name/mobile/email/contact_group), then filters, counts and paginates the collection. The same load happens on every page view. Cost grows linearly with book size (docs and code comments mention books of thousands to 500k rows).
  2. Groups are fetched twice per request and tag counts are derived from the eager-loaded relation.
  3. Active attributes (status true) are passed to the add/edit modals, ordered by `attribute_name`.
  4. Flash `status` becomes a success toast; validation errors become error toasts (page-level, one per message).
  5. The page exposes JS globals: destroy-URL templates, bulk URLs, the group list (id, name, color default `#075E54`) and the active filter `{q, group, tag, total, shown}` used by "select all matching".
- **Async & events:** none. No audit-log call.
- **External systems:** none.
- **Settings:** platform default country (meta tag `default-country-iso`, admin general settings) seeds the phone picker.
- **Acceptance criteria:**
  - Given a manager of workspace A and 30 contacts in A and 5 in B, when they open `/contacts`, then 30 contacts are counted, newest first, 12 on page 1, and none of B's appear.
  - Given an agent, when they request `/contacts`, then they are redirected to `/team-inbox` (never see the page); given an owner, the page renders.
  - Given a legacy contact with `workspace_id` NULL created by the viewer, when the viewer opens the page, then it is listed; a legacy NULL contact owned by someone else is not.
  - Given `GET /contact-groups`, when requested, then the same page renders and no tab switch happens.
- **Source refs:** app/Http/Controllers/ContactsController.php (index, groupIndex, workspaceScopeClause), resources/views/user/contacts/index.blade.php, routes/web.php (L601-633), app/Http/Middleware/EnsureWorkspaceRole.php, app/Http/Controllers/Controller.php (paginateCollection), app/Models/Contact.php (scopeForCurrentWorkspace), app/Support/WorkspacePermissions.php (role hierarchy).
- **Port notes:** There is already `apps/api/src/modules/crm/contacts` (cursor pagination, RLS, outbox, tags, custom-field registry, bulk ops). Reuse it: the target needs SQL pagination and indexed search, not the load-everything approach. Drop the NULL-workspace legacy branch. Gate by the contacts read permission, not by a hard-coded role.

### TW-CON-002 — Contacts search (`q`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-CON-001
- **Summary:** A search box above the table filters the whole book (not just the visible page) by name, first name, last name, mobile or email.
- **Actors & access:** same as TW-CON-001.
- **UX & screens:** input `#contactSearch` (placeholder "Search name, email, phone..."), inside GET form `#contactFilterForm`. The JS debounces typing by 450 ms then submits the form (full page reload with `?q=`). It also carries hidden `per_page`; the group select is in the same form, so searching keeps the group but drops `tag`. The bulk-select "all matching" bar then reflects the filtered total.
- **Endpoints:** `GET /contacts?q=...` (see TW-CON-001).
- **Data:** in-memory scan of decrypted `name`, `first_name`, `last_name`, `mobile`, `email`.
- **Rules & edge cases:**
  1. Trimmed; empty string = no search.
  2. Case-insensitive substring match (`mb_stripos`) on the five fields, OR across fields. No tokenisation, no AND of multiple words (a query "Aarav Sharma" matches only if one single field contains that whole string; "name" holds the full name so it usually works, but "Sharma Aarav" does not).
  3. Phone matching is against the stored raw `mobile` string only: formatting differences ("+91 98123", "9812 3...", "0091...") and the separate `country_code` column are not considered, so imported numbers (country code stored separately) cannot be found by their country code, and a query with punctuation/spaces may miss.
  4. Filter order is group, then tag, then search; all three combine with AND.
  5. The same search logic is duplicated in export-all and bulk-group "all matching" (TW-CON-022, TW-CON-023).
  6. Client-side `data-search` row attribute (name+email+mobile lowercase) exists but is only used by the legacy in-page filter; the real search is server-side.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given contacts "Aarav Sharma" and "Priya Patel", when searching `PATEL`, then only Priya is listed and the tab counter shows 1.
  - Given a contact with email `x@acme.io`, when searching `acme`, then it matches; searching `acme x` does not.
  - Given a search plus `?group=3`, when submitted, then only members of group 3 whose fields match are listed and per-page and page reset to page 1.
  - Given a search with no results, then the empty state ("No contacts match the current filters ...") shows with a Reset filters link to `/contacts` and an Add contact button.
- **Source refs:** ContactsController@index, resources/js/charts/user-contacts-index.js (search debounce), resources/views/user/contacts/index.blade.php.
- **Port notes:** Implement as indexed ILIKE/trigram on normalised name/email/phone digits plus an `e164` exact match. Decide whether to keep the substring-on-raw-phone behaviour; recommended: match on normalised digits so "9812" finds "+91 98123".

### TW-CON-003 — Group filter and sidebar group list

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-CON-001, TW-CON-037
- **Summary:** Filter the list by one group, by "No group", or show all, from a select box or from the sidebar group list.
- **Actors & access:** same as TW-CON-001.
- **UX & screens:** `#groupSelect` (options: All groups, No group, one per group; auto-submits on change) and the sidebar "Groups" card (All groups, then each group with a coloured dot and member count). Clicking a sidebar entry navigates to `/contacts?group=<id>`; "All groups" navigates to `/contacts` (clearing everything). The Groups-tab cards also have a "View contacts" link to `?group=<id>`.
- **Endpoints:** `GET /contacts?group=<id|all|no_group>`.
- **Data:** `contact_group` JSON arrays.
- **Rules & edge cases:**
  1. `group=no_group` keeps contacts whose group list is empty (note: ids of deleted groups count as "has a group", so orphaned contacts are in neither "No group" nor any real group, see TW-CON-037).
  2. `group=<digits>` keeps contacts whose string-cast id list contains that id (strict string compare). Non-digit values and `all` are ignored (show everything).
  3. The filter does not validate that the group belongs to the workspace; an unknown id just yields an empty list.
  4. The sidebar "All groups" count shows `grouped_total` (contacts in at least one still-existing group), not the total contacts.
  5. After an AJAX group create/rename the sidebar button and the select option are upserted without reload; after AJAX delete the sidebar button is removed and the filter resets to all.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 10 contacts and 3 in group G, when opening `?group=G`, then 3 rows are listed and the select shows G.
  - Given `?group=no_group`, when loaded, then only contacts with an empty group list are listed.
  - Given a group that was deleted, when `?group=<its id>` is requested, then the list is empty (no error).
  - Given the select is changed, then the form submits immediately and keeps `q` and `per_page`.
- **Source refs:** ContactsController@index; resources/views/user/contacts/index.blade.php; resources/js/charts/user-contacts-index.js (group filter handlers, `groupUrl`).
- **Port notes:** With a real junction table the filter becomes a join; model "No group" as NOT EXISTS.

### TW-CON-004 — Tag filter

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CON-001, TW-CON-041
- **Summary:** `?tag=<id>` shows only contacts carrying that tag. The only UI entry point is clicking a tag chip in the table's Tags column.
- **Actors & access:** same as TW-CON-001.
- **UX & screens:** each tag chip in a row is a link to `/contacts?tag=<id>` preserving `q` and `group` (when set); tooltip "Filter by <tag>". There is no tag dropdown, no active-filter pill and no clear control. QUIRK: the "All contacts" tab only clears the filter when the URL contains `q=` or `group=`; with `?tag=` alone it merely switches panel. Changing the group select drops `tag` (the form does not carry it); the page-size form keeps it.
- **Endpoints:** `GET /contacts?tag=<id>`.
- **Data:** `contact_tag` via eager-loaded `tags`.
- **Rules & edge cases:** digits only; applied after the group filter and before search; export-all and bulk-group-all honour it; per-page form keeps it.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given contacts A (tag VIP) and B (no tags), when clicking the VIP chip on A, then only A is listed.
  - Given `?tag=<id>&q=ab`, when loaded, then both filters apply.
  - Given `?tag=abc`, when loaded, then the filter is ignored.
- **Source refs:** ContactsController@index; resources/views/user/contacts/index.blade.php (tag cell); resources/js/charts/user-contacts-index.js.
- **Port notes:** Add a proper tag multi-select with AND/OR and a removable pill.

### TW-CON-005 — Pagination and page size

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-CON-001
- **Summary:** In-memory pagination with a whitelisted page size.
- **Actors & access:** same as TW-CON-001.
- **UX & screens:** page-size select (own GET form `#pageSizeForm`, keeps q/group/tag) with options 12, 50, 100, 500, 1000 labelled "N / page". Pagination bar (shared partial `user/partials/pagination`): "Showing a-b of N contacts", Prev, page numbers (all if <= 7 pages, otherwise first, last and current+/-1 with "..." gaps), Next. Page links are plain anchors (full page load), query string preserved (except `page`).
- **Endpoints:** `GET /contacts?per_page=&page=`.
- **Data:** collection slice.
- **Rules & edge cases:**
  1. `per_page` must be in {12, 50, 100, 500, 1000}; anything else silently becomes 12. Default 12.
  2. `page` is clamped to [1, last page]; an out-of-range page shows the last page.
  3. When the filtered total is greater than the page, a hidden "select all N matching this filter" bar can appear (TW-CON-019).
  4. Grid view shows the same page rows.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 100 contacts, when loading with no params, then 12 rows, 9 pages.
  - Given `per_page=7`, when loaded, then page size is 12.
  - Given `page=999`, when loaded, then the last page is shown.
- **Source refs:** ContactsController@index; Controller@paginateCollection; user/partials/pagination.blade.php.
- **Port notes:** Cursor or offset pagination in SQL; keep the whitelist idea (bounded page sizes).

### TW-CON-006 — Stat tiles, sidebar counts, Imported / No-group quick filters

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CON-001
- **Summary:** Four KPI tiles and sidebar badges show workspace-wide totals that ignore the active filter.
- **Actors & access:** same as TW-CON-001.
- **UX & screens:** tiles: Total contacts ("in your workspace"), Groups ("segments configured"), Subscribed ("opted in"), Unsubscribed ("opted out"). Sidebar badges: All contacts, Groups, Imported, No group, All groups (grouped_total) and per-group counts. The "All contacts" tab badge (`data-visible-count`) shows the filtered total.
- **Endpoints:** part of `GET /contacts`.
- **Data:** counts computed in PHP over the loaded book: total, groups, `is_unsubscribed` false vs true, no_group (empty group list, including contacts whose only ids are orphaned), grouped_total (intersection with live group ids), per-group member counts, imported.
- **Rules & edge cases:**
  1. QUIRK: "Imported" is computed only if the `contacts` table has a `source` column. It does not (status/source live inside `custom_attributes`), so the badge is always 0, and each row's `data-source` is always empty, so clicking the "Imported" chip hides every row on the page.
  2. The "Imported" and "No group" chips are client-side filters over the 12 rows currently rendered (toggle on/off by clicking again) while their badges are workspace-wide numbers; the tab counter is overwritten with the visible-row count when active.
  3. Subscribed = `is_unsubscribed` is false; the DB column is NOT NULL default 0 so NULL never occurs.
  4. Tiles do not change with search/group/tag filters.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 10 contacts with 2 unsubscribed, when the page loads, then tiles read Total 10, Subscribed 8, Unsubscribed 2 regardless of `?q=`.
  - Given a group deleted while 3 contacts still carry its id, when the page loads, then grouped_total excludes those 3 and No group excludes them too.
  - Given any workspace, when "Imported" is clicked, then (Reference) all rows hide; the rebuild must define this filter properly (see Differences).
- **Source refs:** ContactsController@index; resources/views/user/contacts/index.blade.php; resources/js/charts/user-contacts-index.js (`filterRows`, `sourceFilter`).
- **Port notes:** Compute counts in SQL; give `source` a real column on contacts (see TW-CON-015).

### TW-CON-007 — List / grid view toggle

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-CON-001
- **Summary:** Switch the contacts table between a dense table and a card grid.
- **Actors & access:** same as TW-CON-001.
- **UX & screens:** component `x-list-grid-toggle target="contacts"`; JS `resources/js/list-grid-toggle.js` clones each row's cells into cards (title cell as card heading, other cells as label/value pairs using the table header text, action buttons on the right, empty cells skipped), 1/2/3 columns by width. The choice is remembered per browser in `localStorage` key `threadwise:list-grid:contacts`. Empty-state rows become a card spanning columns.
- **Endpoints:** none (client only).
- **Data:** none.
- **Rules & edge cases:** the table has a 1100px minimum width in list view and scrolls horizontally on small screens; grid view is the mobile-friendly alternative. Cloned cards lose their `id`s; buttons on a card are proxies that re-dispatch a click on the original table-row button (edit, delete), and clicking a card can proxy to the row's primary action. The grid is rebuilt from the DOM, so rows added or patched by AJAX only appear after the view is re-rendered.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given list view, when the grid button is clicked, then rows render as cards and the choice persists after reload.
  - Given no contacts, when in grid view, then a single empty-state card is shown.
  - Given a narrow viewport, when in list view, then the table scrolls horizontally.
- **Source refs:** resources/js/list-grid-toggle.js, resources/views/components/list-grid-toggle.blade.php, index.blade.php.
- **Port notes:** Build a responsive card layout natively; no DOM cloning.

### TW-CON-008 — Contact row rendering (columns, phone display, attribute chips)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-CON-001
- **Summary:** What each table row shows.
- **Actors & access:** same as TW-CON-001.
- **UX & screens:** columns: checkbox, Name (avatar circle with the first two letters of the name upper-cased on a pastel colour chosen by `id % 6` from six fixed colours; name; language in muted text; up to 4 attribute chips), Groups (outlined chips with colour dot, max width 140px), Tags (filled pastel pills, clickable, "-" when none), Email, Mobile (monospace), Memo, Actions (edit pencil, delete trash). Colgroup widths 42/220/200/210/140/auto/96 px, table min width 1100px.
- **Endpoints:** part of `GET /contacts`.
- **Data:** per row: `name`, `language`, `custom_attributes`, `contact_group`, `tags`, `email`, `country_code`, `mobile`, `msg`.
- **Rules & edge cases:**
  1. Attribute chips come from `custom_attributes`, excluding keys `status` and `source` (case-insensitive), non-scalar values and empty strings; first 4 only; label is the key with underscores replaced by spaces and title-cased; value truncated to 18 chars with a full tooltip. Status and Source are never shown in the table.
  2. Phone display: strip non-digits from `country_code` and `mobile`; prepend the country code only when the number does not already start with it; render "+" plus the (identity) masked value; "-" if empty. `mask_phone()` is a no-op product-wide (masking was disabled), so numbers always show in full.
  3. Group chips resolve ids against the workspace's groups (deleted ids are dropped silently).
  4. The Edit button carries data attributes for the whole contact (name, first/middle/last name, title, mobile, country code, email, language, address, memo, status, source, attributes JSON, group ids JSON); first name falls back to the display name when empty.
  5. Delete uses a confirm dialog "Delete this contact?" and an AJAX DELETE.
  6. The avatar image (`contacts.image`) is never rendered.
  7. After AJAX add, a new row is prepended (no tags/attributes chips, mobile shown as returned); after AJAX edit the row is patched in place (groups, email, mobile, memo, data attributes), not the Tags or attribute chips.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a contact with `country_code` "+91" and mobile "9812345678", when listed, then Mobile shows "+919812345678".
  - Given custom attributes `{status: vip, order_id: A12, city: ''}`, when listed, then only an "Order Id: A12" chip is shown.
  - Given a contact with 6 non-empty attributes, when listed, then 4 chips show.
  - Given a contact in a deleted group only, when listed, then the Groups cell is empty.
- **Source refs:** index.blade.php (L387-555), resources/js/charts/user-contacts-index.js (renderContactRow, updateContactRow), app/Support/security_helpers.php (mask_phone).
- **Port notes:** Show status/source/consent badges; render stored E.164 consistently; avatar if images are kept.

### TW-CON-009 — Add contact (modal + `POST /contacts`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-CON-012, TW-CON-013, TW-CON-026
- **Summary:** Create one contact from the "Add contact" modal; the row appears at the top of the table without reload.
- **Actors & access:** manager+; plan gate `contacts_limit` (TW-CON-026). No per-field permission.
- **UX & screens:** `#contactModal` (max-w-3xl). Fields: Title select (Mr, Mrs, Miss, Ms, Dr; no blank option; Mr preselected), First name (required), Middle name, Last name, Contact image (file, "PNG or JPG / up to 2 MB"), Language (placeholder "English"), Mobile number (required, intl-tel-input with flags, country search, separate dial code; hidden `country_code` input holds "+<dial>"), Email, Memo (maxlength 1024 in the browser), Address, Status select (none, Active, Prospect, Customer, VIP), Source (free text, maxlength 128, placeholder "e.g. Website form"), Contact groups (checkbox chips, or "No groups yet - create one first."), and Attributes (one text input per ACTIVE workspace attribute, labelled "<name> /<key>", placeholder = attribute description, maxlength 1000). Buttons Cancel / Save contact. There is no Unsubscribed toggle and no tags control in the add modal (tags are added via edit). On success: toast "Contact added.", modal closes, form resets, phone picker resets to India (+91) - hard-coded - and the row is prepended.
- **Endpoints:**

| Method + URI     | Route name            | Action                   | Middleware                        | Request fields | Response                                                                                                                                                                                                                                                                                                                      |
| ---------------- | --------------------- | ------------------------ | --------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/contacts` | `user.contacts.store` | ContactsController@store | web, auth, workspace.role:manager | see Rules      | JSON when `Accept: application/json`: `{ok:true, message:"Contact added.", contact:{id,name,first_name,middle_name,last_name,title,mobile,mobile_masked,country_code,email,language,address,msg,group_ids[],groups[{id,name,color}],status,source,custom_attributes{}}}`; otherwise redirect to `/contacts` with flash status |

- **Data:** writes `contacts` (user_id = actor, workspace_id = current, all fields below, `custom_attributes` JSON, `contact_group` encrypted array of strings, `mobile_hash`, `image` path). Reads `contact_groups` for the chip payload.
- **Rules & edge cases:**
  1. Order of checks: plan limit first (before validation), then validation.
  2. Validation: `title` nullable string max 50; `first_name` REQUIRED string max 191; `middle_name`, `last_name`, `name` nullable max 191; `contact_group` nullable array, each integer and `exists:contact_groups,id` (global existence, NOT scoped to the workspace - a foreign group id is accepted); `country_code` nullable max 10; `mobile` REQUIRED string max 32; `email` nullable email max 191; `language` nullable max 80; `address` nullable max 1000; `msg` nullable max 2000; `image` nullable image max 2048 KB; `is_unsubscribed` sometimes boolean; `status` nullable max 64; `source` nullable max 128; `attributes` nullable array of nullable strings max 1000. No uniqueness check on phone/email: duplicates are allowed here.
  3. Name composition (TW-CON-012): `name` input if present, else the non-empty parts of title, first, middle, last joined by single spaces. The modal has no `name` field, so the title always participates.
  4. Phone storage (TW-CON-013): if `country_code` is present and `mobile` does not already start with it (plain string prefix), `mobile` becomes "<country_code> <mobile>" (e.g. "+91 9812345678"); `country_code` is stored as submitted too.
  5. `custom_attributes`: status and source are stored under keys `status` and `source` when non-empty after trim; each posted `attributes[key]` is stored only if the key is an ACTIVE attribute of the workspace and the trimmed value is non-empty. Unknown keys are ignored.
  6. `contact_group` is stored as an array of strings; `is_unsubscribed` from the boolean flag (default false).
  7. A `saving` hook recomputes `mobile_hash` on every save (TW-CON-013).
  8. A `created` hook fires flow triggers `contact_created` and one `group_join` per group id (TW-CON-053). The controller then emits webhook `contact_created` after the response (TW-CON-052). A LogsNotifications hook writes an in-app notification (TW-CON-054).
  9. Image is stored on the configured media disk under `contacts/` (TW-CON-014).
  10. Plan-limit failure: 422 JSON `{ok:false, error:"plan_limit_reached", reason:"limit_reached", key:"contacts_limit", used, limit, message}` (message: "You've reached your plan's limit of N contacts. Upgrade your plan to add more, or delete an existing one to free up space.") or redirect-back with that flash for non-JSON. Validation failure: 422 `{message, errors}`; the UI toasts the first error.
- **Async & events:** model events (flows, notification) are synchronous; webhook is deferred to after the response (terminating callback), guarded by try/catch.
- **External systems:** media disk (local or S3-style per platform storage settings).
- **Settings:** `contacts_limit` of the plan; default country meta.
- **Acceptance criteria:**
  - Given first name "Aarav", mobile "9812345678", country code "+91" and title Mr, when saved, then a contact exists with `name` "Mr Aarav", `mobile` "+91 9812345678", `country_code` "+91" and it appears first in the list.
  - Given the workspace is at its contacts limit, when saving, then nothing is created and an error toast shows the plan-limit message.
  - Given a missing mobile, when saving, then 422 and the first error is toasted, no row added.
  - Given a group id of another workspace, when posting directly, then the contact is created referencing it (QUIRK, validation is global).
  - Given an attribute key not defined in the workspace, when posted in `attributes[...]`, then it is ignored.
- **Source refs:** ContactsController@store, serializeContact, workspaceAttributeKeys; resources/views/user/contacts/index.blade.php (contactModal); resources/js/charts/user-contacts-index.js; app/Services/PlanLimitGuard.php; app/Exceptions/PlanLimitReachedException.php; app/Models/Contact.php.
- **Port notes:** Use the existing `POST /v2/contacts` (identity-first dedup returns the existing contact). Decide the dedup semantics (Reference allows duplicates here). Validate group ids per workspace (RLS gives this for free). Do not default the title.

### TW-CON-010 — Edit contact (modal + `PUT /contacts/{id}`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-CON-009
- **Summary:** Edit all fields of a contact from the row's pencil icon; attached tags are managed in the same modal (TW-CON-038..040).
- **Actors & access:** manager+; contact must be visible to the workspace (else 404).
- **UX & screens:** `#editModal`: same fields as add, plus a Tags block (chips with remove "x", a multi-select picker of all workspace tags where clicking toggles attach/detach immediately, a text input with datalist "Add or pick a tag..." and an "Add tag" button; hint that adding a tag can auto-enroll into a flow). No contact image field. The phone input is prefilled by stripping the country-code digits from the stored number and letting the picker detect the country from an E.164 string; the hidden country code is re-read from the picker. First name is required in the browser (falls back to the display name when `first_name` is empty). Groups are preselected from the row's group ids.
- **Endpoints:**

| Method + URI         | Route name             | Action                    | Middleware                        | Request                                                  | Response                                                                                              |
| -------------------- | ---------------------- | ------------------------- | --------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| PUT `/contacts/{id}` | `user.contacts.update` | ContactsController@update | web, auth, workspace.role:manager | same fields as store but all nullable; `mobile` nullable | JSON `{ok:true, message:"Contact updated.", contact:{...}}` or redirect with flash "Contact updated." |

- **Data:** updates the contact row; may replace `image`.
- **Rules & edge cases:**
  1. 404 when the id is not in the workspace (scope clause incl. legacy NULL-workspace rows owned by the caller).
  2. "Only if provided" semantics via null-coalescing: `title`, `first_name`, `middle_name`, `last_name`, `language`, `address`, `email`, `country_code`, `msg` are overwritten only when the request value is non-null. Consequence: a field can never be cleared to empty/null through this endpoint (an empty string submitted by the form arrives as null after Laravel's empty-string-to-null middleware and is ignored). Only `status`, `source` and attribute values support clearing.
  3. `name` = `name` input or composed parts; if the composed result is empty the old name is kept.
  4. `contact_group` is replaced only if the key is present in the request. QUIRK: the edit form posts checkboxes, so unchecking every group posts nothing and the contact keeps its groups; the last group can only be removed via bulk "Remove from group".
  5. `mobile`: when non-empty it is re-composed with the country code exactly as in store (the edit form submits the national part, so it becomes "<+cc> <national>" with a plus).
  6. `status`/`source`: only touched when the field is present; empty clears the key. Attribute values: only active attribute keys present in `attributes` are changed; empty clears the key; other keys already in `custom_attributes` are preserved.
  7. `is_unsubscribed` is applied only if sent (the UI never sends it). `unsubscribed_at` is not touched.
  8. Dirty tracking: if anything changed, webhook `contact_updated` is emitted; if `is_unsubscribed` changed, `contact_opt_in` is emitted too (`opted_in` = not unsubscribed, `action` = "unsubscribed" or "resubscribed", `source` = "manual").
  9. Model hooks: `mobile_hash` recomputed; if `contact_group` changed, a `group_join` flow trigger fires for each newly added id; if `is_unsubscribed` went true to false the `opt_in` flow trigger fires; notification "Contact updated" is recorded.
  10. A new image replaces the path; the old file is not deleted.
  11. Imported contacts hold the full name in `first_name` AND the surname in `last_name` (TW-CON-030), so saving the modal rebuilds `name` as "<first_name> <last_name>" and duplicates the surname (e.g. "Aarav Sharma Sharma"). QUIRK.
- **Async & events:** same as TW-CON-009 (webhooks deferred; flows/notification synchronous).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a contact in groups {1,2}, when the edit form unchecks group 2 only, then the contact is in {1}.
  - Given a contact in {1}, when the edit form unchecks group 1, then the contact is still in {1} (QUIRK to decide).
  - Given an email change, when saved, then a `contact_updated` webhook is queued for the workspace's active webhooks subscribed to it.
  - Given an id from another workspace, when PUT, then 404.
  - Given the email cleared to blank, when saved, then the old email is kept.
- **Source refs:** ContactsController@update; index.blade.php (editModal); user-contacts-index.js (bindEditButton, loadContactTags); app/Models/Contact.php.
- **Port notes:** Use PATCH semantics with explicit null-to-clear and `rowVersion` (existing `PATCH /v2/contacts/:id`). Group membership as a set operation.

### TW-CON-011 — Delete a single contact

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-CON-001
- **Summary:** Hard-delete one contact from the row's trash icon.
- **Actors & access:** manager+.
- **UX & screens:** trash icon in the row; confirm dialog titled "Delete?" with message "Delete this contact?"; on success the row is removed silently (no toast for destructive AJAX) and counts refresh client-side only.
- **Endpoints:**

| Method + URI            | Route name              | Action                     | Middleware                        | Request | Response                                                                                   |
| ----------------------- | ----------------------- | -------------------------- | --------------------------------- | ------- | ------------------------------------------------------------------------------------------ |
| DELETE `/contacts/{id}` | `user.contacts.destroy` | ContactsController@destroy | web, auth, workspace.role:manager | none    | JSON `{ok:true, message:"Contact deleted.", id}` or redirect with flash "Contact deleted." |

- **Data:** deletes the `contacts` row (no soft delete). Nothing else is cleaned.
- **Rules & edge cases:**
  1. 404 if not in workspace.
  2. `$contact->delete()` fires the model `deleted` event, so a notification "Contact deleted: <name>" is recorded (TW-CON-054).
  3. No cascade: `contact_tag` rows, `conversations.contact_id`, `deals.contact_id`, `broadcast_contacts`, `wp_campaign_contacts`, `flow_subscribers`, `appointments`, etc. keep dangling contact ids; only `wa_form_submissions.contact_id` has an FK (SET NULL). Orphan tag pivots are invisible because tag reads join through the contact.
  4. No webhook is emitted on delete, no flow trigger.
  5. The "tab counter/KPI tiles" are not updated until reload.
- **Async & events:** notification only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a contact in the workspace, when deleted, then GET `/contacts` no longer lists it and the JSON response echoes the id.
  - Given a contact of another workspace, when DELETE, then 404 and the row is untouched.
  - Given a deleted contact, when an inbound message from the same number arrives, then auto-capture creates a new contact (TW-CON-055).
- **Source refs:** ContactsController@destroy; user-contacts-index.js (delete handlers); LogsNotifications trait.
- **Port notes:** Decide soft vs hard delete and define what happens to conversations, deals, tags and campaign recipients (FKs with SET NULL / cascade). The target already has hard delete + audit + outbox per row in bulk delete.

### TW-CON-012 — Display-name composition and title handling

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** none
- **Summary:** How `name`, `first_name`, `middle_name`, `last_name` and `title` relate.
- **Actors & access:** applies to UI, API and import.
- **UX & screens:** only the modal fields (title/first/middle/last); the full-name field exists only in the API.
- **Endpoints:** TW-CON-009/010/059/060.
- **Data:** `contacts.name` (encrypted text), `first_name`, `middle_name`, `last_name`, `title` (plaintext varchar 255).
- **Rules & edge cases:**
  1. Display name = `name` input if non-empty, else join of the non-empty values of title, first_name, middle_name, last_name with single spaces (UI store/update and API store).
  2. QUIRK: the add form always posts a title (select has no blank option; "Mr" default), and has no `name` field, so every UI-created contact is named "Mr <first> <middle> <last>" unless the operator picks another title. The same applies to edit when the select holds a value.
  3. On the edit modal, if the stored title is empty (imported/captured contacts) the select ends up with no selection and posts nothing, so the title is left empty.
  4. Import writes the CSV name column into BOTH `name` and `first_name`, and `last_name` separately (TW-CON-030): "Aarav Sharma" is `name`="Aarav Sharma", `first_name`="Aarav Sharma", `last_name`="Sharma".
  5. Inbound auto-capture stores only `name` (first/last null); the edit modal pre-fills First name from `name` in that case.
  6. API update: when `name` or `first_name` is present, the display name is `name` if truthy, else recomputed from the contact's parts (incl. existing title); an empty result leaves `name` unchanged.
  7. Avatar initials: first two characters of the display name, upper-cased (list); the Contact 360 uses the first character.
  8. The `Contact::initials` accessor (first letter of first + last word) exists but the list does not use it.
  9. Titles are a fixed list in the modal (Mr, Mrs, Miss, Ms, Dr), other values are accepted by the API (max 50).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given API create with `first_name` "Aarav", `last_name` "Sharma", title "Dr", no name, then `name` = "Dr Aarav Sharma".
  - Given API create with `name` "ACME Support" and no first name, then name is "ACME Support" and `first_name` is null.
  - Given a UI add with title Mr and first name "Priya", then name is "Mr Priya".
- **Source refs:** ContactsController@store/update, Api/V1/ContactController@store/update, ContactsController@import, app/Models/Contact.php (getInitialsAttribute).
- **Port notes:** Recommended: no default title; store `first_name`/`last_name` plus a computed `display_name`; split imported full names or keep only `display_name`.

### TW-CON-013 — Phone storage, canonical form and `mobile_hash`

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** none
- **Summary:** How phone numbers are stored, compared and de-duplicated. There is no E.164 normalisation and no libphonenumber on the server; identity is "digits with the country code prefixed".
- **Actors & access:** applies everywhere contacts are written.
- **UX & screens:** phone picker (intl-tel-input) in the add/edit modal, see TW-CON-009/010.
- **Endpoints:** n/a.
- **Data:** `contacts.mobile` (encrypted text, may hold "+91 9812345678", "919812345678" or a local "9812345678"), `contacts.country_code` (plain varchar, "+91" or "91" or null), `contacts.mobile_hash` (varchar 64, indexed, SHA-256 of canonical digits; null when no digits).
- **Rules & edge cases:**
  1. Single add/update (UI) and API: if `country_code` is set and `mobile` does not start with it as a plain string, the stored mobile becomes "<country_code> <mobile>". The prefix test is a literal string-prefix test: "+91" vs a number typed "919812..." does not match, "91" vs "+919812..." does not match, so double prefixes are possible ("91 +919812345678").
  2. CSV import stores `mobile` and `country_code` exactly as in the file, separately (no combining).
  3. Two canonicalisers exist. `Contact::canonicalizePhone(cc, mobile)` (used by the hash, Contact 360, inbound capture, flow phone lookup): keep digits of mobile; if the digits are longer than 2 and start with "00", drop the "00"; if digits of the country code are non-empty and the number does not start with them, prefix them. `ContactsController::canonPhone` (used by CSV import dedupe and "Remove duplicates"): the same without the "00" stripping. So "0097150..." and "97150..." share a `mobile_hash` but are different identities for import/dedupe.
  4. `mobile_hash` is set by the model `saving` hook on every normal save from `country_code` + `mobile`. It is NOT recomputed when events are disabled (import sets it explicitly) and it is overwritten with NULL when a contact is saved after loading only some columns (QUIRK in TW-CON-036: group delete saves contacts loaded with only id and contact_group).
  5. The hash is the only SQL-queryable phone key; `Contact::rememberPhone` and `Contact::nameForPhone` use it (workspace + hash). Numbers with fewer than 6 digits are not captured and not looked up.
  6. There is no unique index on `(workspace_id, mobile_hash)`: duplicates are normal and tolerated; only the dedupe action and CSV import resolve them.
  7. The only DB-enforced identity uniqueness is `(workspace_id, channel, channel_uid)` for social-channel contacts (NULLs do not collide).
  8. Phone display in the list is normalised on the fly (TW-CON-008); the API shows "+" + digits of `mobile` only (TW-CON-057).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given "+91" and "9812345678", when canonicalised, then "919812345678".
  - Given mobile "00971501234567" and no cc, when canonicalised, then "971501234567".
  - Given a contact whose mobile is changed through the edit form, when saved, then `mobile_hash` equals SHA-256 of the new canonical digits.
  - Given `rememberPhone` for "+91 98123 45678" when "919812345678" exists, then the existing contact is returned (no new row).
- **Source refs:** app/Models/Contact.php (canonicalizePhone, hashPhone, rememberPhone, nameForPhone, saving hook), ContactsController@canonPhone/store/update/import, database/migrations/2026_07_01_140000_add_mobile_hash_to_contacts.php, 2026_08_20_020000_add_social_identity_to_contacts.php.
- **Port notes:** Introduce `contact_identities` (existing in the target) with an E.164 value and a unique index per workspace; parse with libphonenumber at the edge; keep raw input for display. Use one canonical function everywhere.

### TW-CON-014 — Contact avatar image upload

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-CON-009
- **Summary:** The add and update endpoints accept an image, but no screen displays it.
- **Actors & access:** manager+.
- **UX & screens:** "Upload profile picture / PNG or JPG / up to 2 MB" tile in the add modal only (the edit modal has none, though the endpoint accepts a new image). The list shows initials, not the image.
- **Endpoints:** `POST /contacts`, `PUT /contacts/{id}` with multipart `image`.
- **Data:** `contacts.image` varchar 255: a path like `contacts/<hash>.png` on the media disk, or a remote URL set by social-channel capture (`Contact::forSocialSender` writes the sender avatar URL).
- **Rules & edge cases:** validation `image|max:2048` (KB; Laravel's `image` rule excludes SVG); stored via the platform media disk helper; replaced on update without deleting the old file; not returned by `serializeContact`, the API or the list.
- **Async & events:** none.
- **External systems:** media disk (local/S3).
- **Settings:** platform storage settings.
- **Acceptance criteria:**
  - Given a 3 MB PNG, when added, then 422 "must not be greater than 2048 kilobytes".
  - Given a valid JPG, when added, then `contacts.image` holds a `contacts/...` path.
  - Given an SVG, when added, then 422 (not an image).
- **Source refs:** ContactsController@store/update; Contact::forSocialSender; index.blade.php.
- **Port notes:** Either drop it or show avatars (list, inbox) and delete replaced files.

### TW-CON-015 — Status and Source values

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CON-009
- **Summary:** An optional lifecycle label (active, prospect, customer, vip) and a free-text source are kept per contact, but inside the `custom_attributes` JSON because the table has no such columns.
- **Actors & access:** manager+.
- **UX & screens:** Status select (none, Active, Prospect, Customer, VIP) and Source text (max 128) in the add and edit modals; "Status" and "Source" selectors in the import modal apply to all imported rows. Not displayed in the table, not filterable, not on the detail page, not exported.
- **Endpoints:** inside store/update/import.
- **Data:** `contacts.custom_attributes` keys `status` and `source` (strings).
- **Rules & edge cases:**
  1. Status validation is free text max 64 (no enum), source max 128; the UI only offers the four values.
  2. On update an empty value deletes the key; on store/import empty means no key.
  3. Only imported contacts when a source/status is chosen get the keys; CSV columns named status/source are not read.
  4. The sidebar "Imported" chip expects a `source = import` marker that nothing writes (TW-CON-006).
  5. Keys `status` and `source` are excluded from the attribute chips; they can collide with a workspace attribute whose key is "status" or "source" (the attribute modal inputs would write to the same JSON key).
  6. The mobile-app and send flows read them only through generic custom-attribute resolution ("{{status}}").
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given status "vip" and source "Website form" on add, then `custom_attributes` = {status:"vip", source:"Website form"}.
  - Given edit with status set to none, then the `status` key is removed.
  - Given import with status "customer", then each created contact has status "customer" but existing contacts updated by the same file do not.
- **Source refs:** ContactsController@store/update/import/serializeContact; index.blade.php.
- **Port notes:** Make `status` a typed column (or the existing lifecycle-stage field) and `source` a first-class column populated on import and API.

### TW-CON-016 — Per-contact custom attribute values

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-CON-043
- **Summary:** Each workspace attribute can hold a per-contact value, stored in `custom_attributes`, which fills `{{key}}` merge tags for that contact in templates, broadcasts, campaigns and flows.
- **Actors & access:** manager+.
- **UX & screens:** "Attributes - fills variables in templates & flows" section in the add and edit modals, one text input per active attribute (label "<attribute_name> /<attribute_key>", placeholder = attribute description, max 1000 chars). Inactive attributes are not offered. Values appear (max 4) as chips in the list row.
- **Endpoints:** `attributes[<key>]` on `POST/PUT /contacts`; the API has a free-form `attributes` object (TW-CON-059).
- **Data:** `contacts.custom_attributes` JSON object, key = attribute key, value = trimmed string (UI path) or any JSON value (API path). Also receives arbitrary keys from integrations (Shopify/Woo/lead imports) and CSV extras are NOT imported.
- **Rules & edge cases:**
  1. UI accepts only keys of currently active workspace attributes and string values up to 1000 chars; blank on store = key omitted, blank on update = key removed; untouched keys survive partial edits.
  2. The API stores whatever object is sent and, on update, REPLACES the entire object (null/empty object sets the column to null).
  3. Resolution precedence at send time: contact column > contact custom attribute (case-insensitive key match after normalisation) > workspace attribute default > system token (TW-CON-048).
  4. Deleting or deactivating an attribute does not touch the values stored on contacts.
  5. Values are plaintext JSON (not encrypted).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active attribute `order_id`, when a contact is added with `attributes[order_id]=A12`, then `custom_attributes.order_id` = "A12".
  - Given the edit form submits an empty `order_id`, then the key is removed and other keys remain.
  - Given a posted key not defined as an attribute, then it is dropped (UI) / kept (API).
  - Given a flow message "{{order_id}}", then it renders A12 for that contact and the attribute default for contacts without a value.
- **Source refs:** ContactsController@store/update/workspaceAttributeKeys; Api/V1/ContactController; app/Services/TemplateOverrideResolver.php; app/Services/AttributeResolver.php.
- **Port notes:** The target has a custom-field registry (`crm/fields`, field-sections); map Reference attributes to typed custom fields and store values keyed by field id/key.

### TW-CON-017 — Marketing opt-out flag (`is_unsubscribed`, `unsubscribed_at`)

- **Status:** partial
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-CON-013
- **Summary:** A contact carries a boolean opt-out flag that every broadcast, campaign and scheduled send respects, plus a timestamp of when they opted out.
- **Actors & access:** set by inbound STOP/START keywords, by campaign recipient unsubscribe handling, by the API, and (programmatically) by the edit endpoint. The Contacts UI has NO control for it.
- **UX & screens:** only the Subscribed / Unsubscribed KPI tiles (TW-CON-006). The user docs claim an "Unsubscribed" toggle in the add form; the modal has none.
- **Endpoints:** `is_unsubscribed` boolean on `POST/PUT /contacts` (UI endpoints, not wired in the form) and on the API (TW-CON-059/060).
- **Data:** `contacts.is_unsubscribed` tinyint NOT NULL default 0; `contacts.unsubscribed_at` timestamp null.
- **Rules & edge cases:**
  1. `Contact::scopeSubscribed` = `is_unsubscribed = 0 OR NULL`; scheduled sends use it, campaigns apply the same condition inline, broadcasts load the opted-out ids and drop them. Audience queries must always use it.
  2. Inbound keyword handling (OptOutService, Team Inbox domain): stop-words set the flag and `unsubscribed_at = now`; start-words clear both; writes only on actual change; also syncs `wp_campaign_contacts` rows and may send a confirmation.
  3. Manual changes via UI edit/API do NOT set or clear `unsubscribed_at` (inconsistent evidence).
  4. Transition true to false triggers the `opt_in` flow trigger (TW-CON-053) and, via the edit endpoint only, webhook `contact_opt_in`.
  5. Contacts created by import/auto-capture start subscribed.
- **Async & events:** model `updated` hook; webhook `contact_opt_in` (TW-CON-052).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a contact replies "STOP", when processed, then `is_unsubscribed` = 1 and `unsubscribed_at` is set, and the next broadcast excludes them.
  - Given an unsubscribed contact replying "START", then the flag clears, `unsubscribed_at` is null and `opt_in` flows fire once.
  - Given the API sets `is_unsubscribed` true, then the flag is set but `unsubscribed_at` stays null (QUIRK).
- **Source refs:** app/Models/Contact.php (scopeSubscribed, updated hook), app/Services/Inbox/OptOutService.php, database/migrations/2026_07_18_120000_add_unsubscribed_at_to_contacts.php, ScheduledController L1615, WaCampaignsController L2018.
- **Port notes:** Model consent explicitly (status, timestamp, source) and always write it through one service; add a UI control.

### TW-CON-018 — Contact 360 page (`GET /contacts/{id}`)

- **Status:** dead-code
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-CON-001
- **Summary:** A profile page with header, deal rollup, an activity timeline (deal activities, deals, inbox messages) and a deals list. In v1.7.0 it cannot render.
- **Actors & access:** manager+; strict workspace match (no legacy NULL fallback); 404 otherwise. The only link to it is from the Companies page (`/contacts/{id}`); the contacts table does not link to it.
- **UX & screens:** `resources/views/user/contacts/show.blade.php`: back link "All contacts", avatar initial, name, phone, email, company link, tag pills, three KPI tiles (Open deals, Won revenue, Timeline events), "Activity timeline" and "Deals" cards with empty copy "No activity yet for this contact." / "No deals yet.". It shows no groups, attributes, status, source or consent.
- **Endpoints:**

| Method + URI                   | Route name           | Action                  | Middleware                        | Request | Response |
| ------------------------------ | -------------------- | ----------------------- | --------------------------------- | ------- | -------- |
| GET `/contacts/{id}` (numeric) | `user.contacts.show` | ContactsController@show | web, auth, workspace.role:manager | none    | HTML     |

- **Data:** reads the contact with tags, up to 50 deals (open first, then id desc), `pipeline_stages` names, up to 40 `deal_activities`, up to 30 `inbox_messages` from up to 20 conversations whose `raw_jid` contains the contact's canonical phone (substring `LIKE`), and the linked `company`. Timeline = merged events sorted by time, top 60. Rollup: open deal count, won value (value_minor/100).
- **Rules & edge cases:**
  1. QUIRK (verified): the view's back link uses `route('contacts')`, but the route is named `user.contacts`; resolving it throws RouteNotFoundException, so the page returns a 500 whenever the contact is found. Confirmed against the reference app (the name `contacts` is not defined).
  2. Sources are guarded with table-exists checks so missing optional tables degrade gracefully.
  3. Message preview bodies are truncated to 160 chars, deal activity bodies to 200.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** feature `access_sales_pipeline` gates the deals domain but not this route.
- **Acceptance criteria:**
  - Given an existing contact in the workspace, when GET `/contacts/{id}`, then (intended) the profile with timeline renders; (Reference actual) HTTP 500.
  - Given an id in another workspace, then 404.
  - Given a contact with 2 deals and 5 messages, then the timeline lists up to 60 events newest first and rollup shows open deals and won value.
- **Source refs:** ContactsController@show; resources/views/user/contacts/show.blade.php; resources/views/user/companies/show.blade.php (link); routes/web.php L608.
- **Port notes:** Rebuild as the contact detail screen (the target already has detail tabs: notes, files, activities, meetings). Show groups, tags, attributes, consent, deals, conversation history.

### TW-CON-019 — Selection model and bulk bar (page vs "all matching")

- **Status:** partial
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-CON-001
- **Summary:** Ticking row checkboxes reveals a bulk bar with Export, Add to group, Remove from group, Tag, Untag and Delete. A header checkbox selects the visible page; a banner offers to extend the selection to every contact matching the current filter, but only "Add/Remove group" honours that.
- **Actors & access:** manager+.
- **UX & screens:** header checkbox `#selectAll` (selects non-hidden rows on the page); bulk bar appears when at least one row is ticked: "<n> selected" (n = total matching when "all matching" is active), then buttons. Banner `#selectAllMatchingBar` is rendered only when the filtered total exceeds the page; it shows when every row on the page is ticked: "All N on this page selected. Select all T matching this filter"; after clicking: "All T contacts matching this filter are selected. Clear selection". Unticking any row cancels the extended selection.
- **Endpoints:** see the individual bulk features.
- **Data:** client state `selectAllMatching`, `contactFilter {q, group, tag, total, shown}`.
- **Rules & edge cases:**
  1. QUIRK: only "Add to group" and "Remove from group" send the filter (`all=1` with q/group/tag). Export, Tag, Untag and Delete always use only the ticked rows on the current page even when the bar says "T selected".
  2. Bulk pickers: group picker (select of all workspace groups; error toast "Create a group first." if none) and tag picker (select of workspace tags with per-tag contact counts, plus a text field to create a new tag when adding; the text wins over the select; untag with no tags shows "No tags to remove yet."; "Pick a tag or type a new name." if neither). Pickers close on outside click.
  3. Successful group/tag/dedupe actions reload the page and show the server message in a toast via sessionStorage `threadwisePendingToast`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a 12-row page of 40 matching contacts, when the header box is ticked, then the banner offers "Select all 40 matching this filter".
  - Given "all matching" is active and "Add to group G" is applied, then all 40 contacts are processed server-side.
  - Given "all matching" is active and Delete is pressed, then only the 12 page rows are deleted (QUIRK).
- **Source refs:** user-contacts-index.js (updateSelection, bulk handlers); index.blade.php; ContactsController@bulkGroup/filteredContactsForBulk.
- **Port notes:** Make all bulk operations accept either explicit ids or a saved filter; run large ones as a job and report progress.

### TW-CON-020 — Bulk delete

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-CON-019
- **Summary:** Delete the ticked contacts after a confirmation modal.
- **Actors & access:** manager+.
- **UX & screens:** modal "Delete selected contacts?" - "This removes the selected contacts from all lists and groups. This action cannot be undone." with buttons "Keep contacts" and "Delete". Rows are removed from the table on success.
- **Endpoints:**

| Method + URI                 | Route name                  | Action                        | Middleware                        | Request                                                       | Response                                                                                          |
| ---------------------------- | --------------------------- | ----------------------------- | --------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| POST `/contacts/bulk-delete` | `user.contacts.bulk-delete` | ContactsController@bulkDelete | web, auth, workspace.role:manager | `ids[]` required array, each integer and `exists:contacts,id` | JSON `{ok:true, message:"Deleted N contact(s).", ids:[all requested ids]}` or redirect with flash |

- **Data:** mass-deletes rows `id IN ids` restricted to the workspace (plus the owner's legacy rows).
- **Rules & edge cases:**
  1. The `exists` rule is global: if ANY id does not exist anywhere (already deleted, stale page), the whole request fails with 422 and nothing is deleted. Ids of other workspaces pass validation but are silently skipped by the scope clause.
  2. The response `ids` echoes the requested ids (not the deleted ones) and the UI removes every requested row.
  3. Query-builder mass delete: no model `deleted` events, so no notifications (unlike single delete) and no cascades.
  4. No limit on the number of ids.
  5. Message pluralisation: "Deleted 1 contact." / "Deleted 3 contacts."
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 3 ticked contacts, when confirmed, then 3 rows are gone and the toast is silent (destructive AJAX) or shows the message after reload.
  - Given one ticked id that was deleted in another tab, when confirmed, then 422 and no contact is deleted.
  - Given ids from another workspace mixed in, then only own contacts are removed and the count reflects the actual deletions.
- **Source refs:** ContactsController@bulkDelete; user-contacts-index.js.
- **Port notes:** Target bulk delete is per-row SAVEPOINT with `{succeeded, failed[]}`; adopt it (idempotent, partial failure reporting).

### TW-CON-021 — Export selected contacts (CSV)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CON-019
- **Summary:** Download the ticked contacts as `contacts-export.csv`.
- **Actors & access:** manager+.
- **UX & screens:** "Export" in the bulk bar fills a hidden POST form with `ids[]` and submits it so the browser downloads the file (no AJAX).
- **Endpoints:**

| Method + URI                 | Route name                  | Action                        | Middleware                        | Request                                                    | Response                                                    |
| ---------------------------- | --------------------------- | ----------------------------- | --------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| POST `/contacts/bulk-export` | `user.contacts.bulk-export` | ContactsController@bulkExport | web, auth, workspace.role:manager | `ids[]` required array of integers (when `all` is not set) | `text/csv; charset=UTF-8`, attachment `contacts-export.csv` |

- **Data:** header row `name, last_name, country_code, mobile, email, group, language, memo`; one row per contact ordered by `created_at` desc. `group` is the comma+space joined names of the contact's still-existing groups; `memo` is `contacts.msg`. Values are decrypted.
- **Rules & edge cases:**
  1. Formula-injection guard: any string cell beginning with `=`, `+`, `-` or `@` gets a leading apostrophe. QUIRK: numbers stored as "+91 9812..." and country codes like "+91" (the format the UI itself writes) get an apostrophe, polluting the export; the import tolerates it (non-digits are stripped) but spreadsheets show the apostrophe.
  2. The export has a "memo" column that the importer does not read, and does not include title, middle name, address, status, source, tags, attributes or consent.
  3. No UTF-8 BOM (some spreadsheets mis-decode non-ASCII). Standard `fputcsv` quoting.
  4. Ids not in the workspace are silently dropped; an empty result yields a header-only file.
- **Async & events:** none (synchronous, in memory).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 2 ticked contacts, when exporting, then a CSV with the 8-column header and 2 rows downloads.
  - Given a contact named "=cmd", then the cell is "'=cmd".
  - Given a contact in groups "VIP" and "New leads", then the group cell is `VIP, New leads`.
- **Source refs:** ContactsController@bulkExport; user-contacts-index.js.
- **Port notes:** Export E.164, include tags/attributes/consent, stream for large sets, apply the formula guard only to text columns.

### TW-CON-022 — Export all contacts in the current view (CSV)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CON-021
- **Summary:** "Export all" downloads every contact matching the active group/tag/search, not just the visible page.
- **Actors & access:** manager+.
- **UX & screens:** header button "Export all" (title "Download every contact in this view as a CSV") submits hidden form `#exportAllForm` with `all=1`, `group`, `tag`, `q` taken from the server-rendered filter state.
- **Endpoints:** same route as TW-CON-021 with `all=1`.
- **Data:** workspace book loaded (with tags), filtered by group, tag and search in the same order and semantics as the list (TW-CON-002..004), ordered by `created_at` desc; same columns and escaping as TW-CON-021. Tags are used for filtering only and are not exported.
- **Rules & edge cases:** the whole book is loaded and decrypted in memory; no row cap; empty book = header-only CSV.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 1,800 contacts and no filter, when "Export all" is clicked, then all 1,800 rows download.
  - Given `?group=G`, then only G's members are exported.
  - Given a search with no results, then a header-only file downloads.
- **Source refs:** ContactsController@bulkExport (exportAll branch); index.blade.php (`exportAllForm`).
- **Port notes:** Stream the CSV in batches; background export for large workspaces.

### TW-CON-023 — Bulk add / remove group

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-CON-019, TW-CON-037
- **Summary:** Add or remove one group across the ticked contacts or across everything matching the active filter.
- **Actors & access:** manager+; the group must belong to the workspace.
- **UX & screens:** bulk bar "Add to group" / "Remove from group" open a popover with a group select and Apply; success reloads the page with the server message.
- **Endpoints:**

| Method + URI                | Route name                 | Action                       | Middleware                        | Request                                                                                                                                                               | Response                                                                                      |
| --------------------------- | -------------------------- | ---------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| POST `/contacts/bulk-group` | `user.contacts.bulk-group` | ContactsController@bulkGroup | web, auth, workspace.role:manager | `ids[]` array (required unless `all`), `group_id` required integer, `action` required in {add, remove}, `all` nullable boolean, plus `q`, `group`, `tag` when `all=1` | JSON `{ok:true, message:"N contact(s) added to \"<group>\"." (or "removed from"), changed:N}` |

- **Data:** rewrites each affected contact's `contact_group` array.
- **Rules & edge cases:**
  1. The group is looked up in the workspace first: missing or foreign group = 404.
  2. `all=1` resolves the contacts with the list filter logic (group/tag/search); otherwise the ids (workspace-scoped; unknown ids ignored).
  3. Add: skip contacts already in the group; remove: skip contacts not in it. `changed` counts only modified contacts.
  4. Each modified contact is saved individually with model events ON: a `mobile_hash` recompute, a "Contact updated" notification per contact (notification spam for large sets), and, for adds, `group_join` flow triggers per contact (each can launch a flow synchronously). Large sets run inside one HTTP request (no queue, no explicit time limit).
  5. Whole-request atomicity is not guaranteed; there is no partial-failure report.
- **Async & events:** `group_join` flow enrolment (HTTP call to the Node flow runtime per match), notifications.
- **External systems:** Node bridge flow launch (via FlowEnrollmentService).
- **Settings:** none.
- **Acceptance criteria:**
  - Given 5 contacts of which 2 are already in group G, when adding G, then `changed` = 3 and the message is `3 contacts added to "G".`
  - Given `all=1` with `q=acme`, then every contact matching "acme" is processed even beyond the page.
  - Given a group id of another workspace, then 404.
  - Given a published `group_join` flow for G, then each newly added contact is enrolled once.
- **Source refs:** ContactsController@bulkGroup/filteredContactsForBulk; app/Models/Contact.php (updated hook); app/Services/Flow/FlowEnrollmentService.php.
- **Port notes:** Junction table makes this an INSERT..SELECT / DELETE; emit one outbox event per contact or one batch event; run async for large sets.

### TW-CON-024 — Bulk tag / untag

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-CON-019, TW-CON-041
- **Summary:** Add or remove one tag across the ticked contacts, creating the tag on the fly when adding.
- **Actors & access:** manager+. No `tag.manage` permission and no `tags_limit` check (QUIRK).
- **UX & screens:** bulk bar "Tag" / "Untag" popover: select of workspace tags `Name (count)`, a text input "...or type a new tag name" (max 80, add mode only), Cancel / Apply. Only the page's ticked ids are sent.
- **Endpoints:**

| Method + URI              | Route name               | Action                     | Middleware                        | Request                                                                                                                               | Response                                     |
| ------------------------- | ------------------------ | -------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| POST `/contacts/bulk-tag` | `user.contacts.bulk-tag` | ContactsController@bulkTag | web, auth, workspace.role:manager | `ids[]` required array of integers (non-empty), `tag_id` nullable integer, `name` nullable max 80, `action` required in {add, remove} | JSON `{ok:true, message:"N contact(s) tagged | untagged \"<tag>\".", changed:N, tag:{id,name,color}}`; 422 `{ok:false, error:"no_workspace" | "tag_required"}` |

- **Data:** `contact_tag` rows (contact_id, tag_id, added_by = actor, timestamps); `tags` row created if needed.
- **Rules & edge cases:**
  1. Tag resolution: `tag_id` within the workspace; otherwise (add only) find-or-create by slug of `name` (slug = URL-style lowercase of the name, random 8 chars if empty): an existing tag with the same slug is reused whatever its name; new tags get colour `#075E54`. Remove never creates. Nothing found = 422 `tag_required`.
  2. Per contact: add only when not already tagged; remove only when tagged; `changed` counts real changes. Contacts outside the workspace are ignored.
  3. The `tag_added` flow trigger fires only for contacts that did not already have the tag, synchronously per contact, failures logged and swallowed.
  4. Name length is validated at 80 but `tags.name` is varchar(64): names of 65-80 chars fail at the database (likely HTTP 500 under strict mode).
  5. No removal trigger, no webhook.
- **Async & events:** flow enrolment per added contact.
- **External systems:** Node flow runtime via FlowEnrollmentService.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 200 selected contacts where 190 already have tag T, when adding T, then `changed` = 10 and 10 enrolments are attempted.
  - Given a typed name "VIP" and an existing tag slug `vip`, when adding, then the existing tag is reused.
  - Given action remove with no tag id, then 422 `tag_required` (no tag is created).
- **Source refs:** ContactsController@bulkTag; app/Models/Tag.php; migration 2026_07_05_000000_create_contact_tag_table.php.
- **Port notes:** Use the existing tags module; unify naming rules (see Differences); make the trigger an outbox event.

### TW-CON-025 — Remove duplicates (workspace dedupe)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-CON-013
- **Summary:** One click deletes every contact that repeats a phone number already held by an older contact, keeping the earliest-created.
- **Actors & access:** manager+.
- **UX & screens:** header button "Remove duplicates" (title "Remove duplicate phone numbers, keeping the earliest of each"); confirm dialog "Remove duplicates? This deletes contacts that repeat the same phone number, keeping the earliest of each. This cannot be undone." (danger tone). On success the page reloads with the server message.
- **Endpoints:**

| Method + URI            | Route name             | Action                    | Middleware                        | Request | Response                             |
| ----------------------- | ---------------------- | ------------------------- | --------------------------------- | ------- | ------------------------------------ |
| POST `/contacts/dedupe` | `user.contacts.dedupe` | ContactsController@dedupe | web, auth, workspace.role:manager | none    | JSON `{ok:true, message, removed:N}` |

- **Data:** reads (id, country_code, mobile) of the workspace's contacts ordered by id; deletes losers.
- **Rules & edge cases:**
  1. Identity key = `ContactsController::canonPhone` (digits, country code prefixed; no "00" stripping). Blank-phone rows are never deduped.
  2. Winner = smallest id (earliest created); every later row with the same key is deleted. No merge: groups, tags, custom attributes, notes and any field values on the losers are lost; conversations/deals pointing at the loser are left dangling.
  3. Message: `Removed N duplicate contact(s), keeping the earliest of each number.` or `No duplicate phone numbers found.` (with `removed` 0).
  4. Mass delete without model events (no notifications).
  5. Not preview-able, not undoable; scope includes legacy owner rows.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given three contacts with ids 4, 9, 12 and the same number, when run, then 9 and 12 are deleted and 4 stays, `removed` = 2.
  - Given "+91 98123 45678" and "919812345678", then they are duplicates; "0091 9812345678" is NOT (QUIRK).
  - Given no duplicates, then `removed` = 0 with the "No duplicate phone numbers found." message.
- **Source refs:** ContactsController@dedupe/canonPhone; user-contacts-index.js (dedupeBtn).
- **Port notes:** Merge, do not delete: union groups/tags/attributes, keep non-empty fields, re-point related records, audit the merge; preview the duplicate sets first.

### TW-CON-026 — Plan gate `contacts_limit`

- **Status:** partial
- **Priority:** P0
- **Effort:** S
- **Depends on:** PLN plan model
- **Summary:** Adding a contact or starting an import is blocked when the workspace already holds as many contacts as its plan allows.
- **Actors & access:** applies to the Contacts UI endpoints `POST /contacts` and `POST /contacts/import`; platform admins bypass.
- **UX & screens:** error toast with the plan-limit message; no inline upsell.
- **Endpoints:** `POST /contacts`, `POST /contacts/import`.
- **Data:** count of `contacts` where `workspace_id` = current (legacy NULL rows not counted); limit from `Workspace::effectiveLimit('contacts_limit')` (workspace `plan_overrides` first, then the package value plus add-ons; platform-admin-owned workspaces unlimited).
- **Rules & edge cases:**
  1. Check is "count >= limit" before the operation; `null`, 0 or negative limit = unlimited.
  2. It runs BEFORE validation, so an invalid request at the limit returns the plan error.
  3. QUIRK: import checks only the starting count; a workspace one under the cap can import any number of rows. QUIRK: the public API create (TW-CON-059) and all auto-capture paths never check the limit.
  4. Failure shape: HTTP 422 JSON `{ok:false, error:"plan_limit_reached", reason:"limit_reached", key:"contacts_limit", used, limit, message}` (or redirect back with an error flash). Message: "You've reached your plan's limit of N contacts. Upgrade your plan to add more, or delete an existing one to free up space."
  5. Usage is shown elsewhere (account plan screen, admin workspace detail) using the same count.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** package `contacts_limit`, workspace `plan_overrides.contacts_limit`.
- **Acceptance criteria:**
  - Given limit 500 and 500 contacts, when adding one, then 422 plan_limit_reached and nothing is created.
  - Given limit 500 and 499 contacts, when importing 2,000 rows, then the import runs and 2,499 contacts result (QUIRK).
  - Given limit 0 or no package, then unlimited.
  - Given a platform admin session, then no limit.
- **Source refs:** app/Services/PlanLimitGuard.php, app/Exceptions/PlanLimitReachedException.php, ContactsController@store/import, app/Models/Package.php, database/seeders/PackageSeeder.php, app/Services/PlanUsage.php.
- **Port notes:** Enforce in the contacts service for every writer (UI, API, import, capture) with remaining-quota awareness for imports; return problem+json with an upgrade hint.

### TW-CON-027 — CSV import (upload, process, result summary)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-CON-028..030, TW-CON-026
- **Summary:** Upload a CSV; every valid row becomes a contact (or updates an existing one); groups named in the file are created on demand.
- **Actors & access:** manager+; plan gate (TW-CON-026).
- **UX & screens:** "Bulk upload" opens `#bulkModal` ("Upload contacts from a file"): file tile "Choose CSV file" with the label "CSV / max 5 MB" (QUIRK: the server allows 50 MB), accept `.csv,.txt`; a "Smart column detection" hint (needs a header row; recognises name, phone/mobile/whatsapp, email, group, country_code, language; unknown columns ignored) with a "Download sample CSV" link; an "Apply to every imported contact" panel (Status select, Source text max 128, Group select of up to 200 newest groups, explanatory line "All imported contacts get added to this group. Per-row CSV groups also apply."). Submit shows a spinner "Working...", then a toast with the summary and a page reload. There is no preview step, no column-mapping UI, no progress bar and no per-row error list.
- **Endpoints:**

| Method + URI            | Route name             | Action                    | Middleware                        | Request                                                                                                                                                                                                                                        | Response                                                                                 |
| ----------------------- | ---------------------- | ------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| POST `/contacts/import` | `user.contacts.import` | ContactsController@import | web, auth, workspace.role:manager | multipart `file` required, mimetypes `text/csv, text/plain, application/csv, application/vnd.ms-excel`, max 51200 KB; `status` nullable max 64; `source` nullable max 128; `group_id` nullable integer; `tag_ids[]` nullable array of integers | JSON `{ok:true, message, imported, skipped, duplicates}` or redirect with flash `status` |

- **Data:** writes `contacts` (user_id = importer, workspace_id, name, first_name, last_name, mobile, mobile_hash, email, country_code, language, contact_group, custom_attributes), `contact_groups` (new names).
- **Rules & edge cases:**
  1. Request-level limits: unlimited execution time (`set_time_limit(0)`) and memory 512M for the request; real limits depend on PHP `upload_max_filesize`/`post_max_size`. File is read with PHP `fgetcsv` defaults (comma delimiter, double-quote enclosure). Semicolon- or tab-delimited files are not detected.
  2. The first row is always the header row (even if it is blank). Header normalisation is in TW-CON-028; a leading UTF-8 BOM is harmless because non-alphanumerics are stripped.
  3. For each following row: `name` = trimmed name column, `mobile` = trimmed mobile column, `email` = trimmed or null, `country_code` = trimmed or null, `language` = trimmed or null, `last_name` = trimmed or null, group cell split on commas.
  4. A row is skipped (counted in `skipped`) when `name` or `mobile` is empty. A blank line counts as skipped. If the header lacks a recognised name or mobile column, EVERY row is skipped and the response is still `ok:true` ("Imported 0 contacts (N invalid rows skipped).").
  5. No validation of email format, phone digits, name length or group-name length; no per-row errors reported; a database error (e.g. value longer than the column) aborts the request mid-way (earlier committed batches stay).
  6. New rows are written with model events DISABLED: no `contact_created`/`group_join` flow triggers, no webhooks, no notifications. `mobile_hash` is set explicitly. Rows are committed in batches of 1,000 created contacts.
  7. New contact fields: `first_name` = the name column (full name), `last_name` from its column, `contact_group` = group ids resolved from the CSV cell plus the chosen global group, `custom_attributes` = {status, source} when chosen, else null. Extra CSV columns, title, middle name, address, memo, consent are not importable. Status/source are applied only to newly created rows.
  8. Group resolution: names are matched case-insensitively against the workspace's groups (cache built once); missing names are created (no colour, no note) the first time they appear.
  9. Result message: `Imported {imported} contacts` plus, in parentheses and comma-separated, `{updated} existing contact(s) updated` and `{skipped} invalid row(s) skipped`, ending with a period. JSON keys: `imported` (new rows), `skipped`, `duplicates` (= updated count; there is no `updated` key). Non-JSON requests get a redirect to `/contacts` with the message flashed.
  10. The UI treats any ok response as success, toasts the message and reloads. A 422 (bad file type, size, plan limit) toasts the first validation error or the plan message.
- **Async & events:** none: synchronous request; no queue, no notification, no audit entry, no webhook.
- **External systems:** none.
- **Settings:** `contacts_limit`; PHP upload limits.
- **Acceptance criteria:**
  - Given the sample CSV (2 rows), when imported with no knobs, then `imported` = 2, `skipped` = 0 and the message is "Imported 2 contacts."
  - Given a file with 1 blank-name row and 1 row without a number, then both are skipped and counted.
  - Given a header row of "Full Name, WhatsApp, Lists" with groups "VIP, New leads", then both groups are created if missing and linked.
  - Given a 6 MB file, then the import succeeds (limit 50 MB) even though the modal text says 5 MB.
  - Given a header with no recognisable mobile column, then 0 imported, N skipped and no error.
- **Source refs:** ContactsController@import; resources/views/user/contacts/index.blade.php (bulkModal); user-contacts-index.js (bulk upload handler).
- **Port notes:** Rebuild as a background job with a preview/mapping step, per-row error report, downloadable rejects, quota-aware limits, idempotent upsert on the canonical phone key, and consent/source capture. The target `crm` module may already have import primitives; check before building.

### TW-CON-028 — Import column auto-detection

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-CON-027
- **Summary:** Header text is normalised and matched against alias lists so differently named files import without mapping.
- **Actors & access:** import and preview.
- **UX & screens:** hint text in the import modal; no mapping editor.
- **Endpoints:** inside `POST /contacts/import` and `POST /contacts/import-preview`.
- **Data:** result is a map field -> column index.
- **Rules & edge cases:**
  1. Normalisation: trim, lowercase, remove every character that is not a-z or 0-9 (so "Phone Number", "phone_number", "PHONE-NUMBER" all become `phonenumber`; non-Latin headers normalise to empty and are skipped).
  2. Aliases (post-normalisation): name = name, fullname, contactname, firstname; last_name = lastname, surname, familyname; mobile = mobile, phone, phonenumber, whatsapp, whatsappnumber, number, tel, telephone, cell, cellphone, msisdn; email = email, emailaddress, mail; country_code = countrycode, cc, dialcode; group = group, groups, contactgroup, list, lists; language = language, lang, locale. (The code also lists underscore variants such as `first_name`; they can never match because underscores are stripped first.)
  3. Columns are scanned left to right; each header is assigned to the first field (in the order name, last_name, mobile, email, country_code, group, language) whose alias list contains it and whose field is still unmapped. First match wins per field, so with both "Name" and "First Name" the leftmost column becomes `name`.
  4. Unmatched columns are ignored; there is no way to override the mapping.
  5. Not importable: title, middle name, address, memo/note, status, source, tags, opt-out, custom attributes.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given headers "Phone Number, Full Name, E-mail", then mobile=0, name=1 and email=2 ("E-mail" normalises to `email`); a header "Mail Address" (normalised `mailaddress`) is NOT recognised.
  - Given headers "Name, First Name", then `name` maps to column 0 and "First Name" is ignored (field already mapped).
  - Given headers "MSISDN, Lists", then mobile and group map.
- **Source refs:** ContactsController@detectColumns and HEADER_ALIASES.
- **Port notes:** Keep alias detection as the default and add a mapping step; extend aliases (title, address, notes, tags, consent).

### TW-CON-029 — Import "apply to every contact" knobs (status, source, group, tags)

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CON-027
- **Summary:** Optional values stamped on every newly imported contact.
- **Actors & access:** manager+.
- **UX & screens:** Status select, Source text, Group select in the import modal. There is no tag selector in the modal (the docs promise one).
- **Endpoints:** fields on `POST /contacts/import`.
- **Data:** status/source -> `custom_attributes`; group -> appended to `contact_group`.
- **Rules & edge cases:**
  1. `group_id` is validated only as an integer; it is not checked against the workspace (a foreign group id is accepted and stored on the new contacts).
  2. The global group is merged with CSV groups (CSV groups first, global group appended if absent).
  3. `tag_ids[]` is validated but never applied (dead parameter); the docs say tags are applied.
  4. Knobs are not applied to existing contacts that are updated by the same file (TW-CON-030).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given status "customer", source "Spring 2026" and group G, when importing 3 new rows, then each has `custom_attributes` {status, source} and G in its groups.
  - Given `tag_ids` posted, then no tag is attached (QUIRK).
  - Given a row already present in the workspace, then it is updated but NOT added to G.
- **Source refs:** ContactsController@import; index.blade.php (bulkModal); Documentation/pages/growth/contacts.html (claims tags).
- **Port notes:** Implement tags and apply group/tag knobs to updated rows as well (additive).

### TW-CON-030 — Import duplicate handling (update in place)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-CON-013, TW-CON-027
- **Summary:** Re-importing a number that already exists updates the existing contact instead of creating a duplicate.
- **Actors & access:** manager+.
- **UX & screens:** message "N existing contact(s) updated" in the summary.
- **Endpoints:** `POST /contacts/import`.
- **Data:** existing-phone map built once from `(id, country_code, mobile)` of the workspace in chunks of 5,000: key = `canonPhone`, value = id (when several existing contacts share a key, the LAST one in id order wins, i.e. the NEWEST duplicate is the one updated).
- **Rules & edge cases:**
  1. A row's key is `canonPhone(country_code col, mobile col)`; blank key rows are not matched and are created.
  2. Match: update only the columns the file provided: `name` and `first_name` both set to the CSV name, `last_name` if non-empty, `email` if provided, `country_code` if provided, `language` if provided; `mobile_hash` backfilled. `mobile`, groups, status, source, attributes are never changed on an update. Updated rows are saved with events off.
  3. Counting: each matched row adds 1 to `updated` and to `duplicates`; within-file repeats are also "matched" (the earlier created row is updated), so repeated numbers inside one file are reported as "existing contacts updated". `imported` counts only newly created rows.
  4. New rows register their key so later rows in the same file collide with them.
  5. The match is workspace-scoped (legacy NULL rows are not considered).
  6. Importing never removes or merges; "Remove duplicates" is the separate cleanup (TW-CON-025), which keeps the oldest, while import updates the newest: the two tools disagree on which duplicate is canonical.
  7. Because the full CSV name is written to `first_name` and `last_name` is set separately, later edits through the modal duplicate the surname (TW-CON-010).
- **Async & events:** none (events disabled).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a contact "A" with number N, when a CSV row N with name "B" and email e is imported, then the contact becomes name "B", first_name "B", email e and `updated` = 1.
  - Given a file with the same number twice, then one contact is created and `updated` = 1.
  - Given two existing duplicates of N (ids 4 and 9), then id 9 is updated.
- **Source refs:** ContactsController@import, canonPhone.
- **Port notes:** Upsert on a unique `(workspace, e164)` key, return `{created, updated, skipped, invalid}` separately.

### TW-CON-031 — Import preview endpoint

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-CON-028
- **Summary:** An endpoint that previews the first five rows and the detected column map exists, but the UI never calls it (the import modal submits straight to import).
- **Actors & access:** manager+.
- **UX & screens:** none in the shipped UI; the documentation advertises a two-step preview-first flow.
- **Endpoints:**

| Method + URI                    | Route name                     | Action                           | Middleware                        | Request                                      | Response                                                                                                                      |
| ------------------------------- | ------------------------------ | -------------------------------- | --------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| POST `/contacts/import-preview` | `user.contacts.import-preview` | ContactsController@importPreview | web, auth, workspace.role:manager | `file` required, same mimetypes, max 5120 KB | JSON `{ok:true, headers:[trimmed header strings], detected:{field:columnIndex}, rows:[up to 5 assoc arrays keyed by header]}` |

- **Data:** reads the file only; writes nothing.
- **Rules & edge cases:** 422 `{ok:false, message:"Could not read file."|"Empty file."}`; rows are built by combining the header list with each row, padding the shorter side with empty strings (extra data columns get empty-string keys that collapse); no plan check; the preview limit is 5 MB while the import limit is 50 MB.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a CSV with header "Phone, Name" and 8 rows, when posted, then `headers` has 2 entries, `detected` {mobile:0, name:1}, and 5 rows.
  - Given an empty file, then 422 "Empty file.".
  - Given a file over 5 MB, then 422 validation error.
- **Source refs:** ContactsController@importPreview; routes/web.php L620-624; Documentation/pages/growth/contacts.html.
- **Port notes:** Build the preview as the first step of the import wizard (TW-CON-027 port notes).

### TW-CON-032 — Sample CSV download

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** none
- **Summary:** Link "Download sample CSV" in the import modal.
- **Actors & access:** manager+.
- **UX & screens:** anchor in the import modal.
- **Endpoints:**

| Method + URI               | Route name                 | Action                       | Middleware                        | Request | Response                                                   |
| -------------------------- | -------------------------- | ---------------------------- | --------------------------------- | ------- | ---------------------------------------------------------- |
| GET `/contacts/sample-csv` | `user.contacts.sample-csv` | ContactsController@sampleCsv | web, auth, workspace.role:manager | none    | `text/csv; charset=UTF-8` attachment `contacts-sample.csv` |

- **Data:** static content: header `name,last_name,country_code,mobile,email,group,language` and two rows ("Aarav Sharma, Sharma, 91, 9812345678, aarav@example.com, group cell "VIP, New leads" (quoted), en" and "Priya Patel, Patel, 91, 9898765432, priya@example.com, Customers, en"). Newline line endings, trailing newline.
- **Rules & edge cases:** the route is declared after the numeric `{id}` routes but `{id}` is constrained to digits, so it does not collide.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a manager, when GET, then a 3-line CSV downloads with that header.
  - Given the sample imported unchanged, then 2 contacts and groups "VIP", "New leads", "Customers" result.
  - Given an agent, then redirected.
- **Source refs:** ContactsController@sampleCsv.
- **Port notes:** Generate from the importer's alias table; localise sample content.

### TW-CON-033 — Groups panel (cards, empty tile, sidebar)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-CON-037
- **Summary:** A "Groups" view on the contacts page lists group cards; the sidebar and the select list the same groups.
- **Actors & access:** manager+.
- **UX & screens:** switch with the sidebar "Groups" tab or the toolbar "Groups" tab (client-side panel toggle, no navigation). Each card: coloured square (group colour or the theme green), name (H3), note, member count with "contacts" label, buttons "View contacts" (link to `?group=<id>`), edit pencil (opens the group modal prefilled) and delete (confirm "Delete this group?", AJAX). A dashed "Create new group" tile ("Bucket contacts by segment, funnel stage, or interest.") opens the modal. No empty message beyond that tile.
- **Endpoints:** part of `GET /contacts`.
- **Data:** groups newest first; counts from `groupCounts` (id -> members_count).
- **Rules & edge cases:** counts are workspace-wide and ignore filters; cards are server-rendered, AJAX create/update patch/append cards, AJAX delete removes the card and sidebar entry; the groups tab badge counts groups.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 3 groups, when opening the Groups view, then 3 cards plus the create tile show with member counts.
  - Given "View contacts" on group G, then the page reloads on the contacts tab filtered to G.
  - Given 0 groups, then only the create tile shows.
- **Source refs:** index.blade.php (groupsPanel); user-contacts-index.js.
- **Port notes:** Groups can become a dedicated screen; keep counts in SQL.

### TW-CON-034 — Create group

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-CON-037
- **Summary:** Create a named segment with an optional note and accent colour; creating an existing name returns the existing group.
- **Actors & access:** manager+.
- **UX & screens:** `#groupModal` titled "Create or edit group": Group name (required), Note (textarea max 1024 in browser), Accent colour (five radio swatches: #7C3AED (default), #22C55E, #E87A5D, #E5A04E, #13478A), buttons Cancel / Save group. On success the modal closes first (to avoid double submits), sidebar button, select option, bulk-group option, group card and the group checkboxes in the add/edit modals are updated without reload.
- **Endpoints:**

| Method + URI           | Route name                  | Action                        | Middleware                        | Request                                                                   | Response                                 |
| ---------------------- | --------------------------- | ----------------------------- | --------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------- |
| POST `/contact-groups` | `user.contact-groups.store` | ContactsController@groupStore | web, auth, workspace.role:manager | `name` required max 191; `note` nullable max 500; `color` nullable max 32 | JSON `{ok:true, message:"Group created." | "Group already exists.", existing:bool, group:{id,name,note,color,members_count:0}}`; non-JSON: back with flash |

- **Data:** `contact_groups` (user_id, workspace_id, user_group [encrypted], note [encrypted], color, status default 1).
- **Rules & edge cases:**
  1. De-dup: trimmed, case-insensitive compare against all groups visible to the workspace (decrypted in PHP). A match returns the EXISTING group with message "Group already exists." and `existing:true` (the new note/colour are ignored); this exists to absorb double submits.
  2. No DB uniqueness; race between two simultaneous creates can still produce duplicates.
  3. Names are trimmed only on comparison; the stored value is the trimmed name for new rows.
  4. Colour is any string up to 32 chars (UI offers 5 hex values; no validation of hex).
  5. `status` is always 1 and never used.
  6. A "Contact group created: <name>" notification is recorded (url `/contacts/groups`, a non-existent page).
  7. The public API create does not de-dup (TW-CON-063); CSV import creates groups without colour or note.
  8. Likely defect (code + data inspection): the name is stored encrypted in `contact_groups.user_group`, a varchar(255) column under strict SQL mode. The four seeded groups already occupy 200-228 characters of ciphertext for short names, so names longer than roughly 30-35 characters probably fail with a "data too long" database error (HTTP 500) even though validation allows 191. Not reproduced live.
- **Async & events:** notification.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given group "VIP", when creating " vip ", then the response has `existing` true and no row is added.
  - Given name "Leads" with colour #22C55E, then a group with that colour is returned with `members_count` 0.
  - Given no name, then 422.
- **Source refs:** ContactsController@groupStore; index.blade.php (groupModal); user-contacts-index.js.
- **Port notes:** Unique `(workspace, lower(name))` constraint; return 409/200 with existing id per target API conventions.

### TW-CON-035 — Edit group

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CON-034
- **Summary:** Rename a group or change its note and colour.
- **Actors & access:** manager+; 404 for groups outside the workspace.
- **UX & screens:** the pencil on a group card opens the same modal prefilled (the colour radio matching the group's colour is checked, else the first swatch); submitted as PUT.
- **Endpoints:**

| Method + URI               | Route name                   | Action                         | Middleware                        | Request                                                                   | Response                                                                             |
| -------------------------- | ---------------------------- | ------------------------------ | --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| PUT `/contact-groups/{id}` | `user.contact-groups.update` | ContactsController@groupUpdate | web, auth, workspace.role:manager | `name` required max 191; `note` nullable max 500; `color` nullable max 32 | JSON `{ok:true, message:"Group updated.", group:{id,name,note,color,members_count}}` |

- **Data:** updates `user_group`, `note`, `color`.
- **Rules & edge cases:** the note is overwritten with the input (null if absent, so a request without `note` clears it); colour kept when absent; NO duplicate-name check (a group can be renamed to an existing name); `members_count` is recomputed by scanning the workspace's contacts; "Contact group updated" notification recorded.
- **Async & events:** notification.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given group G with 7 members, when renamed, then the response `members_count` = 7 and the card and sidebar show the new name.
  - Given a group from another workspace, then 404.
  - Given a rename to an existing group's name, then it succeeds (two groups share a name).
- **Source refs:** ContactsController@groupUpdate.
- **Port notes:** Enforce uniqueness on rename.

### TW-CON-036 — Delete group (detaches from contacts)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-CON-037
- **Summary:** Deleting a group removes its id from every contact in the workspace, then deletes the group. Contacts remain.
- **Actors & access:** manager+; 404 outside the workspace.
- **UX & screens:** trash icon on the card, confirm "Delete this group?"; silent on success; card and sidebar entry disappear; filter resets to all.
- **Endpoints:**

| Method + URI                  | Route name                    | Action                          | Middleware                        | Request | Response                                                                                            |
| ----------------------------- | ----------------------------- | ------------------------------- | --------------------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| DELETE `/contact-groups/{id}` | `user.contact-groups.destroy` | ContactsController@groupDestroy | web, auth, workspace.role:manager | none    | JSON `{ok:true, message:"Group deleted.", id}` or back with flash `Contact group "<name>" deleted.` |

- **Data:** loads all workspace contacts with only `id` and `contact_group`, rewrites any list containing the id, saves, then deletes the group row.
- **Rules & edge cases:**
  1. QUIRK (code analysis, same in the API delete): contacts are loaded with a partial column list and then `save()`d, which fires the `saving` hook that recomputes `mobile_hash` from the (unloaded, therefore null) `country_code` and `mobile`, overwriting `mobile_hash` with NULL for every contact that was in the group. This breaks hash-based dedupe/lookup until the contact is saved again. (Not exercised live; verify before relying.)
  2. Each saved contact also fires the `updated` hook and a "Contact updated" notification; the group delete adds a "Contact group deleted" notification.
  3. Not transactional: a failure mid-way leaves some contacts detached from a group that still exists.
  4. Flows with a `group_join` trigger bound to the deleted group id keep a dangling trigger value; campaigns/broadcasts that stored the group id keep it.
  5. Contacts that lost their only group show as "No group".
- **Async & events:** notifications.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 3 contacts in G and G deleted, then none of them lists G, their other groups remain, and G is gone from the sidebar.
  - Given G from another workspace, then 404.
  - Given the API delete, then the same detach happens.
- **Source refs:** ContactsController@groupDestroy; Api/V1/ContactGroupController@destroy; app/Models/Contact.php (saving hook).
- **Port notes:** FK cascade on the junction table; keep flow/campaign references consistent (block deletion or null them).

### TW-CON-037 — Group membership model, counts and orphan ids

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** none
- **Summary:** Group membership is denormalised JSON on the contact, so counts, filters and audience expansion are all PHP scans.
- **Actors & access:** internal.
- **UX & screens:** counts in the sidebar, tiles, group cards and API.
- **Endpoints:** n/a.
- **Data:** `contacts.contact_group` longtext holding a Laravel-encrypted JSON array of string ids (e.g. ["3","7"]); `contact_groups` rows. No pivot table, no FK.
- **Rules & edge cases:**
  1. Members count = number of workspace contacts whose decoded list contains the id (string compare). Computed per request for the sidebar, in `groupUpdate`, in the API list (one pass over contacts) and by `ContactGroup::contacts_count`.
  2. Orphan ids (deleted group still on a contact) are tolerated: they are filtered out when rendering chips, API refs, export names; they still make `empty(contact_group)` false so such contacts are not "No group".
  3. Broadcast/campaign/scheduled audience expansion decrypts every workspace contact (chunked by 2,000 in campaigns) to find group members.
  4. New group ids written by CSV import and bulk group are strings; the create validation casts to strings.
  5. Each save that changes the list fires `group_join` for newly added ids (TW-CON-053).
  6. No limit on the number of groups per contact or per workspace.
- **Async & events:** `group_join` flow triggers.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a contact in groups [3,7] and group 7 deleted, then chips show only group 3 and the contact is still not counted as "No group".
  - Given 1,000 contacts with half in G, then G's count is 500 on every surface.
  - Given a broadcast to group G, then recipients are exactly the contacts whose list contains G (minus opted-out).
- **Source refs:** app/Models/ContactGroup.php, app/Models/Contact.php, ContactsController@index, BroadcastsController, WaCampaignsController (audience), ScheduledController.
- **Port notes:** Use a junction table `contact_group_members(contact_id, group_id)` with indexes and FK cascade; counts via SQL.

### TW-CON-038 — Contact tags: load a contact's tags + workspace tag list

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CON-041
- **Summary:** Feeds the Tags block of the edit modal.
- **Actors & access:** manager+; 404 for a contact outside the workspace.
- **UX & screens:** opened when the edit modal opens; renders attached chips (colour dot, name, x), the chip picker (every workspace tag as a toggle, tick on attached), the datalist for typed names. Empty copy: "No tags yet." and "No tags in this workspace yet - type a name below to create the first one."
- **Endpoints:**

| Method + URI              | Route name           | Action                         | Middleware                        | Request | Response                                                                                                      |
| ------------------------- | -------------------- | ------------------------------ | --------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| GET `/contacts/{id}/tags` | `user.contacts.tags` | ContactsController@contactTags | web, auth, workspace.role:manager | none    | `{ok:true, tags:[{id,name,color}], all:[{id,name,color}]}`; `all` ordered by name, from the session workspace |

- **Data:** `contact_tag` joined to `tags`; `tags` of the workspace.
- **Rules & edge cases:** tags of other workspaces never appear (the join is through the pivot, so orphan pivot rows are hidden); no pagination of `all`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a contact tagged VIP in a workspace with 6 tags, then `tags` has 1 and `all` has 6.
  - Given a contact of another workspace, then 404.
  - Given no tags, then both arrays are empty.
- **Source refs:** ContactsController@contactTags; user-contacts-index.js (loadContactTags, renderContactTags).
- **Port notes:** Use the existing tags module read endpoint.

### TW-CON-039 — Attach tag to a contact (find-or-create)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CON-038, TW-CON-053
- **Summary:** Add a tag to one contact by id or by name (creating the tag if needed) and fire the `tag_added` flow trigger once.
- **Actors & access:** manager+. QUIRK: it does not require `tag.manage` and ignores `tags_limit`, unlike the Team Inbox tag endpoint.
- **UX & screens:** chip toggle in the picker (by id), or typed name + "Add tag" / Enter (the JS reuses an existing tag id when the typed name matches case-insensitively, else sends the name).
- **Endpoints:**

| Method + URI               | Route name                  | Action                       | Middleware                        | Request                                                | Response                                                                                             |
| -------------------------- | --------------------------- | ---------------------------- | --------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| POST `/contacts/{id}/tags` | `user.contacts.tags.attach` | ContactsController@attachTag | web, auth, workspace.role:manager | JSON `tag_id` nullable integer, `name` nullable max 80 | `{ok:true, tag:{id,name,color}}`; 422 `{ok:false, error:"no_workspace"}` or `{error:"tag_required"}` |

- **Data:** `contact_tag(contact_id, tag_id, added_by, timestamps)` unique (contact, tag); `tags` find-or-create by (workspace_id, slug).
- **Rules & edge cases:**
  1. `tag_id` must belong to the workspace, else it falls through to the name; with neither = 422 `tag_required`.
  2. Name path: slug from the name (or random 8 chars if the slug is empty, e.g. names with no transliterable characters, which means repeated attaches create a new tag each time); an existing tag with that slug is reused regardless of its stored name; new colour `#075E54`.
  3. Idempotent: attaching an already attached tag is a no-op; the flow trigger fires only when newly attached.
  4. Flow errors are logged and ignored.
  5. Name max 80 vs column 64.
- **Async & events:** `tag_added` flow enrolment (HTTP to the Node runtime); no webhook; no notification (pivot has no model).
- **External systems:** Node flow runtime.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a contact without tag T, when attaching by id, then the pivot row exists and a published `tag_added` flow for T enrols the contact once.
  - Given the same call again, then no second enrolment.
  - Given name "Hot Lead" when no such tag exists, then a tag `hot-lead` with colour #075E54 is created and attached.
  - Given an unknown tag id and no name, then 422 tag_required.
- **Source refs:** ContactsController@attachTag; app/Services/Flow/FlowEnrollmentService.php; app/Models/Tag.php.
- **Port notes:** Single tag service shared with the inbox; same rules for creation everywhere.

### TW-CON-040 — Detach tag from a contact

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CON-038
- **Summary:** Remove a tag from a contact.
- **Actors & access:** manager+.
- **UX & screens:** "x" on the chip or toggling an attached chip in the picker.
- **Endpoints:**

| Method + URI                         | Route name                  | Action                       | Middleware                        | Request | Response    |
| ------------------------------------ | --------------------------- | ---------------------------- | --------------------------------- | ------- | ----------- |
| DELETE `/contacts/{id}/tags/{tagId}` | `user.contacts.tags.detach` | ContactsController@detachTag | web, auth, workspace.role:manager | none    | `{ok:true}` |

- **Data:** deletes the pivot row.
- **Rules & edge cases:** 404 if the contact is not in the workspace; the tag id is not checked (detaching an unattached or unknown tag still returns ok); no flow trigger, no webhook.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a tagged contact, when detached, then GET `/contacts/{id}/tags` no longer lists the tag.
  - Given an unattached tag id, then ok:true.
  - Given a foreign contact, then 404.
- **Source refs:** ContactsController@detachTag.
- **Port notes:** Emit a `contact.tag_removed` event for automations if needed.

### TW-CON-041 — Tag data model on contacts, chips in list, starter tags

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TIB1 tag master list
- **Summary:** Tags are a workspace-wide label list (`tags`) shared with inbox conversations; this domain owns the contact pivot, the list chips and the "Tags" filter source.
- **Actors & access:** see the individual features. Tag master-list CRUD (`/team-inbox/api/tags`) and conversation labels are documented in TW-TIB1-036/037.
- **UX & screens:** filled colour pills in the Tags column (clickable to filter), bulk tag picker counts (`Name (count)`), edit-modal chips.
- **Endpoints:** see TW-CON-038..040, TW-CON-024.
- **Data:** `tags(workspace_id, name varchar(64), slug varchar(64), color varchar(16) default #075E54, description varchar(255))` unique (workspace_id, slug); `contact_tag(id, contact_id, tag_id, added_by, timestamps)` unique (contact_id, tag_id), indexes on each, NO foreign keys. Six starter tags are created for every new workspace by the Workspace model: New Lead (#2E7D32), Interested (#F9A825), Customer (#075E54), VIP (#6A1B9A), Follow Up (#1565C0), Not Interested (#9E9E9E).
- **Rules & edge cases:**
  1. Uniqueness is by slug per workspace, not by name: "VIP" and "vip" are the same tag; names that slug to nothing get random slugs.
  2. No UI in Contacts to rename, recolour or delete tags; deleting a tag (inbox) leaves `contact_tag` and `conversation_tag` rows orphaned (invisible but not purged).
  3. Tag counts in the bulk picker come from the eager-loaded pivot over the whole book.
  4. Tags are also an audience for campaigns (union of `contact_tag` and conversation tags) (TW-CON-053 / cross-domain).
  5. Tag `description` is unused here.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `tags_limit` (inbox path only).
- **Acceptance criteria:**
  - Given a new workspace, then the six starter tags exist.
  - Given contact-tag pivot rows pointing at a deleted tag, then the contact page shows no tag and does not error.
  - Given tags "Lead" and "lead", then attaching either resolves to one tag.
- **Source refs:** app/Models/Tag.php, app/Models/Workspace.php (STARTER_TAGS), migrations create_workspace_inbox_tables / create_contact_tag_table, TeamInboxController@tagsIndex/tagsStore/tagsDestroy.
- **Port notes:** The target already has `tags` and `contact_tags`; adopt starter-tag seeding in tenant provisioning.

### TW-CON-042 — Attributes list page (`/attributes`)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** none
- **Summary:** The workspace's custom attribute definitions (merge variables) with status filter, search, pagination and stat tiles.
- **Actors & access:** QUIRK: route group has only `auth` - no `workspace.role` gate: viewers and agents can read, create, edit and delete attributes (the nav item is under the More menu). No plan gate. Scope = current workspace id.
- **UX & screens:** `resources/views/user/attributes/index.blade.php` + `_rows`. Left rail: status filter buttons All / Active / Inactive with counts, a "How attributes work" card, a "Quick reference" card (slash picker keys), a "Where to use" card (Templates, Broadcasts, Campaigns, Flow builder). Main: eyebrow "More / Attributes", H1 "Template attributes", three tiles (Total, Active "show in slash picker", Inactive "hidden from picker"), results header "Showing N of M filtered", search box ("Search by name, key, description..."), list/grid toggle, table (Name, Key, Default, Description, Status badge Active/Off, Actions edit/delete) with "/" shown for empty default/description, pagination, three tip cards and a "Default values save you" banner. Empty state: "No attributes match the current filters. Create attributes to store reusable customer fields." with Reset filters and Create attribute buttons.
- **Endpoints:**

| Method + URI      | Route name        | Action                     | Middleware | Request                                                             | Response                                                                                                                |
| ----------------- | ----------------- | -------------------------- | ---------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| GET `/attributes` | `user.attributes` | AttributesController@index | web, auth  | `q`, `status` (all/active/inactive, default all), `page`, `partial` | HTML, or with `partial=1` JSON `{ok, rows:<html>, counts:{all,active,inactive}, pagination:<html>, shown, total, page}` |

- **Data:** reads `attributes` of the workspace ordered by `id` desc; filtering is in PHP (description is encrypted). Fixed page size 12 (shared in-memory paginator, page clamped).
- **Rules & edge cases:**
  1. Search: case-insensitive substring over "name key description" concatenated (one string).
  2. Unknown `status` values behave like all. Counts always cover the whole workspace.
  3. The UI refreshes via fetch with `partial=1` (debounce 220 ms on search), updates `history.pushState` to `/attributes?status=&q=&page=`, and handles back/forward.
  4. If the user has no current workspace the scope becomes `workspace_id IS NULL` (legacy rows of every user).
  5. "Inactive" can effectively never occur from the UI (TW-CON-043/044).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 30 attributes, when opening `/attributes`, then 12 rows, "Showing 12 of 30", pager of 3 pages.
  - Given `?q=order&status=active`, then only matching active rows show and tile counts stay workspace-wide.
  - Given an agent, then the page renders (QUIRK).
- **Source refs:** AttributesController@index; resources/views/user/attributes/index.blade.php, _rows.blade.php; routes/web.php L1851.
- **Port notes:** Require a settings-level permission (e.g. custom-field manage) instead of open access; SQL filtering.

### TW-CON-043 — Create attribute

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CON-042
- **Summary:** Define a new variable with a unique key, optional default value and description.
- **Actors & access:** any authenticated workspace member (see TW-CON-042).
- **UX & screens:** "New attribute" modal: Display name (required, max 120), Key (required, max 64, HTML pattern `[a-z0-9_-]+`, hint "a-z, 0-9, dash, underscore. Unique."), Default value (max 255, "(optional fallback)"), Description (max 500), checkbox "Active / show in the slash-popover when composing" (checked). Plain form POST: success redirects to `/attributes` with flash "Attribute saved."; validation errors reopen the modal and show error toasts.
- **Endpoints:**

| Method + URI       | Route name              | Action                     | Middleware | Request                                                                                                                                                                                                                                                  | Response            |
| ------------------ | ----------------------- | -------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| POST `/attributes` | `user.attributes.store` | AttributesController@store | web, auth  | `attribute_name` required string max 120; `attribute_key` required string max 64, `alpha_dash`, unique in `attributes.attribute_key` within the workspace; `attribute_value` nullable max 255; `description` nullable max 500; `status` nullable boolean | redirect with flash |

- **Data:** `attributes(user_id, workspace_id, attribute_name, attribute_key, attribute_value [encrypted text], description [encrypted text], type, status)`; `type` is always "custom".
- **Rules & edge cases:**
  1. `alpha_dash` accepts letters (including non-ASCII), digits, dash and underscore; uppercase is allowed server-side although the browser pattern says lowercase. DB unique `(workspace_id, attribute_key)` uses a case-insensitive collation, so "Order_ID" and "order_id" collide.
  2. QUIRK: `status` defaults to TRUE when absent. The checkbox is a plain checkbox (no hidden "0"), so unticking it submits nothing and the attribute is still created ACTIVE.
  3. No reserved-key check: keys equal to built-in tokens (name, email, phone, today...) or to `status`/`source` are allowed; at send time contact columns win over attributes of the same key.
  4. The key cannot be changed later.
  5. A "Attribute created" notification is recorded (category system, no link).
  6. No limit on the number of attributes.
- **Async & events:** notification.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given name "Order ID", key "order_id", when saved, then the attribute exists, is active and the list shows it.
  - Given an existing key, when saving the same key, then the modal reopens with the validation error "has already been taken".
  - Given the Active box unticked, then the attribute is created active (QUIRK).
  - Given key "order id" (space), then rejected by `alpha_dash`.
- **Source refs:** AttributesController@store; attributes index modal; migration 2026_05_06_000001/000002; app/Models/Attribute.php.
- **Port notes:** Restrict keys to `^[a-z][a-z0-9_]{0,63}$`, lowercase-unique; fix the inactive toggle; add types (text, number, date, select, bool, url, email) to replace the unused `contact_custom_fields` concept.

### TW-CON-044 — Edit attribute

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CON-042
- **Summary:** Change display name, default value, description and active flag; the key is read-only.
- **Actors & access:** any authenticated workspace member.
- **UX & screens:** edit modal opened from the row pencil (payload in a data attribute): disabled Key field with "Read-only." and a note that the key cannot change because it is in use in templates; other fields as in create; "Save changes"; success = redirect back with flash "Attribute updated.".
- **Endpoints:**

| Method + URI           | Route name               | Action                      | Middleware | Request                                                                                                                          | Response        |
| ---------------------- | ------------------------ | --------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| PUT `/attributes/{id}` | `user.attributes.update` | AttributesController@update | web, auth  | `attribute_name` required max 120; `attribute_value` nullable max 255; `description` nullable max 500; `status` nullable boolean | back with flash |

- **Data:** updates the four fields; 404 when the id is not in the workspace.
- **Rules & edge cases:** QUIRK: unchecking "Active" sends no `status`, which is treated as TRUE, so an attribute can never be deactivated through the UI; blank default/description are stored as null; renaming does not affect templates (they reference the key).
- **Async & events:** notification "Attribute updated".
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an attribute, when its default is changed to "N/A", then merge-tag fallbacks use "N/A" for contacts with no value.
  - Given the Active box unticked, then status stays active (QUIRK).
  - Given an id from another workspace, then 404.
- **Source refs:** AttributesController@update; attributes index modal.
- **Port notes:** Send explicit booleans; version-check updates.

### TW-CON-045 — Delete attribute

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CON-042
- **Summary:** Hard-delete an attribute definition.
- **Actors & access:** any authenticated workspace member.
- **UX & screens:** trash icon, confirm dialog "Delete attribute? Delete "<name>"?", toast "Attribute deleted", table refreshes (counts update).
- **Endpoints:**

| Method + URI              | Route name                | Action                       | Middleware | Request | Response                                |
| ------------------------- | ------------------------- | ---------------------------- | ---------- | ------- | --------------------------------------- |
| DELETE `/attributes/{id}` | `user.attributes.destroy` | AttributesController@destroy | web, auth  | none    | `{ok:true}` (404 when not in workspace) |

- **Data:** deletes the row; values already stored in contacts' `custom_attributes` stay; saved templates, flows and campaigns that reference the key are not checked or rewritten (their merge tags then resolve to blank at send time).
- **Rules & edge cases:** no "in use" protection; "Attribute deleted" notification via the model event.
- **Async & events:** notification.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an attribute, when deleted, then it disappears from the list and the picker.
  - Given contacts holding a value for the key, then those values remain in `custom_attributes`.
  - Given a foreign id, then 404.
- **Source refs:** AttributesController@destroy; attributes index script.
- **Port notes:** Block or warn when referenced by templates/flows.

### TW-CON-046 — Attribute picker feed (`/attributes/api/list`) and slash picker

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-CON-043
- **Summary:** Composers open a popover on typing "/" listing built-in and custom attributes; the feed endpoint powers it.
- **Actors & access:** any authenticated member; throttled 120 requests/minute.
- **UX & screens:** `resources/js/attribute-picker.js`: any textarea/input with `data-attr-input` opts in. Typing "/" opens a 300px popover "Insert attribute" with a live "/query" display; rows show a badge S (system) or C (custom), name, and "key / description"; filter by key, name or description; mouse hover or arrow selection, Enter, Tab or click inserts, Esc closes, ArrowUp/ArrowDown cycle (wrapping); empty state "No attributes match. Create one." (link to `/attributes`). The popover opens only when the slash starts a token (start of text or preceded by whitespace); it closes when the query contains whitespace or exceeds 24 characters, on outside click, page scroll, resize or input blur. On viewports narrower than 640px it is pinned to the bottom of the screen at full width; otherwise it floats at the caret (measured with a mirror element) and flips above when there is no room below. The inserted token is the NAMED form `{{key}}` (the user docs say positional `{{1}}`; the code inserts the key and relies on server-side normalisation, plus a hidden `data-attr-map` JSON of slot->key). The feed is cached per page load in JS (fetch failure = empty list).
- **Endpoints:**

| Method + URI               | Route name                 | Action                       | Middleware                | Request | Response                                                                            |
| -------------------------- | -------------------------- | ---------------------------- | ------------------------- | ------- | ----------------------------------------------------------------------------------- |
| GET `/attributes/api/list` | `user.attributes.api.list` | AttributesController@apiList | web, auth, throttle:120,1 | none    | `{ok:true, system:[{key,name,description}], custom:[{name,key,description,value}]}` |

- **Data:** `custom` = ACTIVE attributes of the workspace (decrypted default value in `value`); `system` = the fixed list.
- **Rules & edge cases:** system list: first_name, name, last_name, phone_number, email, country_code, address, language, business_name, today; only active custom attributes appear; no ordering guarantee beyond DB order; inactive attributes are hidden here but still resolved at send time (TW-CON-048).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 2 active and 1 inactive attributes, when calling the feed, then `custom` has 2 and `system` has 10 entries.
  - Given typing "/ord", then only matches for "ord" show; Enter inserts `{{order_id}}`.
  - Given 130 calls within a minute, then 429.
- **Source refs:** AttributesController@apiList/systemAttributes; resources/js/attribute-picker.js.
- **Port notes:** Serve the typed field registry; decide named vs positional tokens end-to-end (TW-CON-049).

### TW-CON-047 — Built-in (system) attribute catalog and send-screen catalog

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-CON-046
- **Summary:** The list of tokens every workspace has without defining anything, plus the richer catalog the send screens show.
- **Actors & access:** internal service.
- **UX & screens:** token chips with sample values on send screens (broadcasts, campaigns), grouped Contact / Custom field / Workspace / System.
- **Endpoints:** none directly (service `SendAttributes::catalog`).
- **Data:** Contact group: name, first_name, last_name, middle_name, title, phone (full), mobile (no country code), country_code, email, address, language, contact_group. Custom field group: keys discovered from the 200 most recent contacts' `custom_attributes` (key regex letters/underscore start, `\w.-`), cached 5 minutes. Workspace group: attribute rows (label = display name, sample = default). System group: today, business_name, company_name. Samples come from the newest contact (cached 5 minutes), truncated to 60 chars; duplicates across groups are dropped keeping the earlier group.
- **Rules & edge cases:** the catalog's promise is that every offered key resolves at send time; the system tokens resolve through the same resolver (TW-CON-048); `contact_group` resolves to the comma-joined group ids (not names).
- **Async & events:** cache only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a workspace with attribute `order_id`, then it appears under "Workspace" with its default as the sample.
  - Given contacts carrying `city` in custom attributes, then "City" appears under "Custom field".
  - Given a key defined both as a contact field and an attribute, then only the contact entry is listed.
- **Source refs:** app/Services/SendAttributes.php; AttributesController@systemAttributes.
- **Port notes:** One registry feeding picker, preview and resolver.

### TW-CON-048 — Merge-tag resolution at send time

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-CON-016, TW-CON-043
- **Summary:** How `{{token}}` placeholders become text for each recipient in broadcasts, campaigns and overrides. This is the contract other domains rely on.
- **Actors & access:** internal.
- **UX & screens:** send screens (other domains).
- **Endpoints:** none.
- **Data:** contact row (name, first_name, last_name, middle_name, title, phone/mobile, country_code, email, address, language, contact_group), `custom_attributes`, workspace `attributes`.
- **Rules & edge cases:**
  1. Token pattern: `{{ anything but braces }}` with optional inner spaces, so "{{Phone Number}}" is recognised.
  2. Key normalisation: trim, lowercase, spaces/dashes/dots to underscore, strip non `a-z0-9_`, trim underscores, then aliases: phone_number/phone_no/whatsapp_number/number/contact_number -> phone; mobile_number/mobile_no -> mobile; full_name/customer_name/contact_name -> name; first -> first_name; last/surname -> last_name; mail/email_address/e_mail -> email; sender_name/sender/business/brand/brand_name/whatsapp_name/store_name/shop_name -> business_name.
  3. Lookup order for each candidate (raw key, then normalised): (1) contact row field, (2) contact custom attribute (key compare after normalisation, empty values skipped), (3) workspace attribute (non-empty default; `status` is NOT checked, so inactive attributes still resolve), (4) system tokens: today (server date), business_name (connected WABA number's display label or verified name, else workspace name), company_name (same, else platform brand).
  4. Unresolvable token = empty string (never the literal braces); arrays are flattened to comma-joined scalars; the template payload builder back-fills blanks with the template's example text.
  5. `AttributeResolver` (older path for composer/voice/media replies): positional `{{N}}` via a variable map or named `{{key}}`; contact fields and `custom_attributes` win over workspace defaults only when non-empty; unmapped or unknown tokens stay LITERAL (the opposite of the override resolver).
  6. Template slot mapping accepts nested `{header:[{num,key}], body:[...]}` or flat `{"1":"key"}` maps; positional placeholders must be contiguous from 1 (TW-CON-049).
  7. Phone tokens: `phone` = country code digits + local digits unless already prefixed; `mobile` = local digits only.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given token "{{Customer Name}}", then it resolves to the contact's full name via alias.
  - Given contact custom attribute `city`=Pune and workspace default `city`=N/A, then "{{city}}" = "Pune"; for a contact without a city = "N/A".
  - Given an unknown token "{{foo}}", then the override resolver returns "" while `AttributeResolver` leaves "{{foo}}".
  - Given `{{business_name}}` with a connected WABA verified name, then that name.
- **Source refs:** app/Services/TemplateOverrideResolver.php, app/Services/AttributeResolver.php, app/Services/SendAttributes.php.
- **Port notes:** Implement one resolver with this precedence and alias table; decide whether inactive attributes resolve; keep "empty not literal" for outbound sends.

### TW-CON-049 — Positional placeholder validator

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** none
- **Summary:** A static helper rejects message bodies whose positional placeholders have gaps or do not start at 1.
- **Actors & access:** called by templates, broadcast and campaign save paths (other domains).
- **UX & screens:** error text "Variable placeholders must be 1-based and contiguous (use {{1}}, {{2}}, {{3}}... no gaps)."
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:** finds `{{ N }}` numeric tokens (optional inner whitespace), de-duplicates and sorts; valid only if equal to 1..count; bodies without numeric tokens or empty/null bodies are valid; named tokens are ignored.
- **Async & events:** none.
- **External systems:** Meta template rules motivate it.
- **Settings:** none.
- **Acceptance criteria:**
  - Given "Hi {{1}}, code {{3}}", then invalid.
  - Given "{{2}} {{1}}", then valid.
  - Given "Hi {{name}}", then valid.
- **Source refs:** AttributesController@validatePlaceholders.
- **Port notes:** Move into the templates domain; keep the same message.

### TW-CON-050 — Attribute feeds for Node bridge, mobile app and browser extension

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CON-043
- **Summary:** Other runtimes read attributes through their own endpoints.
- **Actors & access:** Node bridge (X-Node-Token), mobile app (Sanctum + workspace header), browser extension (extension token).
- **UX & screens:** none.
- **Endpoints:**

| Method + URI                                  | Route name                            | Action                                | Middleware                                                                                   | Response                                                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/api/workspace-attributes/{workspaceId}` | `api.workspace-attributes`            | closure in routes/api.php             | api; header `X-Node-Token` must equal the node token (401 `{ok:false,error:"unauthorized"}`) | `{ok:true, attributes:{key:defaultValue,...}}` (ALL attributes incl. inactive)                                                                                                                 |
| GET `/api/app/attributes`                     | `app.` (ContentController@attributes) | Api\App\ContentController@attributes  | api, sanctum, app.workspace                                                                  | `{success, data[], attributes[], total, counts{fixed,custom}}` with 10 fixed contact fields, `contact_custom_fields` rows and keys discovered in the first 5,000 contacts' `custom_attributes` |
| GET `/api/attributes`                         | `ext.attributes`                      | Api\ExtensionApiController@attributes | api, extension token                                                                         | `{custom_attributes:[{attribute_key, attribute_name}]}` for the workspace OR any attribute of the same user                                                                                    |

- **Data:** `attributes`, `contact_custom_fields`, `contacts.custom_attributes`.
- **Rules & edge cases:** the Node feed is workspace-id based with no ownership check beyond the shared secret; contact attributes take precedence over these defaults on key collision (merged Node side); inactive attributes are included; the mobile feed ignores the `attributes` table entirely and uses `contact_custom_fields` (an empty table with no writer) plus discovered keys.
- **Async & events:** Node caches per workspace.
- **External systems:** Node bridge.
- **Settings:** node token (platform).
- **Acceptance criteria:**
  - Given a wrong Node token, then 401.
  - Given attributes order_id=A and promo=SAVE, then the Node feed returns both keys.
  - Given contacts with custom key `city`, then the mobile feed lists "City" under custom.
- **Source refs:** routes/api.php L383-405; Api/App/ContentController@attributes; Api/ExtensionApiController@attributes.
- **Port notes:** One typed field registry exposed to all clients; flow runtime reads it directly.

### TW-CON-051 — `contact_custom_fields` typed field schema

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** none
- **Summary:** A table and model for typed per-workspace contact fields exist but nothing creates rows.
- **Actors & access:** none (no controller, route or UI writes it).
- **UX & screens:** none.
- **Endpoints:** none; read only by the mobile attributes feed (TW-CON-050).
- **Data:** `contact_custom_fields(workspace_id, key varchar(64), label varchar(128), type varchar(16) default text, options json, required tinyint default 0, show_in_panel tinyint default 1, sort int default 0, timestamps)` unique (workspace_id, key); model constant types: text, number, date, select, bool, url, email. Table empty in the reference DB.
- **Rules & edge cases:** the web "Attributes" feature is the `attributes` table, which has no types.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the shipped app, then no screen creates a typed field.
  - Given the table, then the mobile feed lists its labels as custom attributes.
  - Given duplicates of (workspace, key), then the DB rejects them.
- **Source refs:** app/Models/ContactCustomField.php; database/migrations/2026_05_06_120003_create_workspace_inbox_tables.php; Api/App/ContentController@attributes.
- **Port notes:** Adopt these types for the target custom-field registry instead of porting the table.

### TW-CON-052 — Contact outbound webhooks (created, updated, opt-in)

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** INTG webhooks
- **Summary:** Active workspace webhooks subscribed to contact events receive a JSON payload when a contact is created or updated through certain paths.
- **Actors & access:** configured in the Webhooks area (other domain); event names `contact_created`, `contact_updated`, `contact_opt_in`.
- **UX & screens:** event checkboxes in webhook create/edit.
- **Endpoints:** outbound POSTs.
- **Data:** envelope `{id (uuid), event, eventType, created (ISO 8601), timestamp, data}`. `contact_created` / `contact_updated` data: workspace_id, user_id, contact_id, name, phone_number (digits only of `mobile`, null if none), email, timestamp. `contact_opt_in` data: workspace_id, user_id, contact_id, phone_number, opted_in (bool), action ("unsubscribed" or "resubscribed"), source ("manual" here), timestamp.
- **Rules & edge cases:**
  1. Fired only from the UI `store` (created), UI `update` (updated when anything changed; opt-in when `is_unsubscribed` changed), API `store` (created), and the campaign opt-out handler (opt-in with another source). NOT fired by: API update/delete, UI delete or bulk operations, CSV import, auto-capture, social/shop importers.
  2. `phone_number` is digits of the stored `mobile` only (country code included only if it is inside `mobile`).
  3. Dispatch is deferred until after the response, failures are swallowed and logged; webhooks are matched by workspace (or legacy user), status true and event list containing the name or "*".
  4. Payloads carry no contact id of the group/tag changes.
- **Async & events:** terminating callback, then HTTP delivery handled by the webhook service (retry/logging in the webhooks domain).
- **External systems:** customer endpoints.
- **Settings:** webhook rows (events, URL, secret).
- **Acceptance criteria:**
  - Given a webhook subscribed to `contact_created`, when a contact is added in the UI, then one POST with the payload above is made.
  - Given a CSV import of 500 contacts, then zero contact webhooks fire.
  - Given an UI edit with no actual change, then no `contact_updated`.
- **Source refs:** ContactsController@store/update, Api/V1/ContactController@store, app/Services/WebhookService.php, Requests/Api/V1/Webhook/StoreWebhookRequest.php.
- **Port notes:** Emit domain events through the outbox for every write path and let the webhook subscriber filter; keep the payload keys.

### TW-CON-053 — Flow audience triggers fired by contact changes

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** flow runtime
- **Summary:** Creating a contact, joining a group, adding a tag or re-subscribing can auto-enrol the contact into an active, published flow whose trigger matches.
- **Actors & access:** automatic.
- **UX & screens:** flow builder trigger options (other domain); contacts UI hints ("Adding a tag can auto-enroll this contact into a flow").
- **Endpoints:** none.
- **Data:** `flows` (trigger_kind, trigger_value, is_active, is_published, workspace_id), `flow_subscribers` unique (flow, contact).
- **Rules & edge cases:**
  1. `contact_created` (value 0): model `created` hook (UI add, API create, anything that creates with events on). `group_join` (value = group id): `created` hook per group id on create, and `updated` hook for each id newly added. `tag_added` (value = tag id): fired explicitly by attach/bulk-tag (and by conversation tagging in the inbox), once per new attachment. `opt_in` (value 0): `updated` hook when `is_unsubscribed` goes true to false.
  2. NOT fired by CSV import (events disabled by design), the webhook phone sync, or the importers that disable events.
  3. Flow selection (`flowsForContact`): the contact's `user_id` owner must exist; flows of every workspace the owner belongs to (plus owner's current workspace) with matching kind/value, active and published. Contacts with NULL `user_id` (auto-captured by system paths) never trigger.
  4. Enrolment is idempotent (unique pair); failed subscribers are retried; it refuses a contact whose workspace differs from the flow's; when Meta Business Agent coexistence suppresses auto replies the subscriber is recorded but the flow is not launched. Launch = HTTP POST to the Node flow runtime with the resolved sender (Baileys device or WABA/Twilio config).
  5. All errors are logged and swallowed; the triggering request is never failed.
- **Async & events:** synchronous HTTP to the Node runtime per matching flow.
- **External systems:** Node bridge flow runtime.
- **Settings:** flow trigger configuration.
- **Acceptance criteria:**
  - Given a published flow with trigger `group_join` = G, when a contact is added to G in the edit modal, then the contact is enrolled once.
  - Given the same contact saved again with G still present, then no new enrolment.
  - Given a CSV import adding contacts to G, then no enrolment.
  - Given a contact with NULL `user_id`, then no trigger fires.
- **Source refs:** app/Models/Contact.php (booted), app/Services/Flow/FlowEnrollmentService.php, ContactsController@attachTag/bulkTag.
- **Port notes:** Publish `contact.created`, `contact.group_added`, `contact.tag_added`, `contact.opted_in` events via the outbox and let the flow module subscribe; consider an opt-in switch for imports.

### TW-CON-054 — In-app activity notifications on contact/group/attribute model events

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** notifications domain
- **Summary:** Contact, ContactGroup and Attribute models use the notifications trait, so Eloquent create/update/delete writes a bell notification.
- **Actors & access:** the contact's owner `user_id` (or the acting user); stamped with the record's workspace; muted by the workspace's notification preferences for category `contact`.
- **UX & screens:** notification bell (other domain): title "Contact created: <name>", body "Contact created "<name>" by <actor>.", icon contact, link `/contacts`; groups link to `/contacts/groups` (a page that does not exist).
- **Endpoints:** none.
- **Data:** `notifications` rows (title, message, category contact/system, severity info or warning on delete, source type/id, verb).
- **Rules & edge cases:** fires for every individual save/delete through the model: single add/edit/delete, API create/update/delete, each contact touched by bulk add/remove group (one "Contact updated" per contact), group delete detaches; does NOT fire for mass query-builder deletes (bulk delete, dedupe) or for imports (events disabled). The notification text contains the decrypted contact name (PII duplicated in plaintext in `notifications`).
- **Async & events:** synchronous insert; optional email/Slack fan-out deferred per workspace preferences.
- **External systems:** email/Slack when enabled.
- **Settings:** workspace notification preferences.
- **Acceptance criteria:**
  - Given a contact added in the UI, then one "Contact created" notification for the owner.
  - Given bulk "Add to group" on 50 contacts, then 50 "Contact updated" notifications.
  - Given bulk delete of 50 contacts, then none.
- **Source refs:** app/Models/Concerns/LogsNotifications.php, app/Helpers/NotificationHelper.php.
- **Port notes:** Prefer audit log entries; do not store contact PII in notification text; aggregate bulk operations.

### TW-CON-055 — Contact auto-capture and other contact creators

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-CON-013
- **Summary:** Many flows create contacts implicitly so numbers are never lost; they all go through shared model helpers.
- **Actors & access:** system.
- **UX & screens:** none directly; contacts appear in the list.
- **Endpoints:** none.
- **Data:** `rememberPhone(workspace, user, rawPhone, name, countryCode)`: needs at least 6 digits, hashes the canonical number, returns the existing contact with that hash in the workspace or creates one with `mobile` as typed, `country_code` if given, `name` if given (events on, so flows/notification fire; `user_id` may be null). `forSocialSender(workspace, channel, uid, name, image, sourceLabel)`: find-or-create by (workspace, channel, channel_uid) for TikTok, Telegram, Facebook, Instagram, Viber, LINE, WeChat, email; new contacts get name (or "<Channel> user"), memo "Source: <Channel> DM" or the label, avatar URL; never throws.
- **Rules & edge cases:**
  1. Callers: manual numbers typed in broadcasts/campaigns/scheduled/quick-send/chat, inbound WhatsApp (Baileys, WABA, Twilio, SMS) senders, the public API template send, incoming webhooks, AI CRM tools, team-inbox save/extract contact, lead finder (updateOrCreate), Shopify and WooCommerce importers, WhatsApp-contact sync (events disabled), mobile app contact endpoints, form submissions and flow nodes.
  2. Capture deduplicates by `mobile_hash`; the manual UI and API do not.
  3. Capture bypasses `contacts_limit` and does not set status/source.
  4. Contacts captured with no name show the number as the display name in the UI.
- **Async & events:** model events (flows, notification) except where a caller disables them.
- **External systems:** channel webhooks.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an inbound message from a new number, then a contact exists after processing and the next message reuses it.
  - Given a number with fewer than 6 digits, then no contact is created.
  - Given a repeat Telegram DM from the same sender id, then the same contact row is reused.
- **Source refs:** app/Models/Contact.php (rememberPhone, forSocialSender, nameForPhone); callers listed by grep (BroadcastsController, ChatController, WaWebhookController, WaInboundController, TeamInboxController, *WebhookController, importers).
- **Port notes:** Provide one `ContactsService.upsertFromIdentity` (the target already has identity-first dedup) used by all channel adapters.

### TW-CON-056 — Public API: auth, envelope, rate limit, errors (contacts scope)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** API keys
- **Summary:** `/api/v1/*` is a workspace-key-authenticated JSON API; this feature covers the rules shared by the contact and group endpoints.
- **Actors & access:** API client. Auth: `Authorization: Bearer wsk_...` or `X-Api-Key`. No `Accept: application/json` requirement documented, but see error notes. Keys are minted in the Developers console (one active key per workspace).
- **UX & screens:** `/developers` console and `/developers/docs` (other domain).
- **Endpoints:** all `/api/v1/contacts*` and `/api/v1/contact-groups*` (middleware `api`, `auth.apikey`, `auth.apikey.throttle`).
- **Data:** `api_keys(key_hash sha256, prefix, scopes, last_used_at, expires_at, revoked_at)`.
- **Rules & edge cases:**
  1. Auth: missing key = 401 `{error:{code:"missing_api_key", message}}`; unknown/revoked/expired key or deleted owner = 401 `invalid_api_key`. The request runs "as" the key's owner user with the key's workspace as current; `last_used_at` is touched each call.
  2. Scopes: the model has a scope check but nothing calls it, so every key has full access to every endpoint.
  3. Rate limit per key per minute: the plan's `api_rate_limit_per_minute` (with add-ons), else the platform setting `security.api_rate_limit_per_minute` (default 600); 0 or -1 = unlimited. Exceeding it returns 429 `{error:{code:"rate_limited", message:"Rate limit of N requests/minute for your plan exceeded. Retry in Ns."}}` with `Retry-After` and `X-RateLimit-Limit/Remaining`; successful responses carry `X-RateLimit-Limit` and `X-RateLimit-Remaining`.
  4. Success envelope: `{data: ..., meta?: {...}}` (meta only when non-empty); create returns HTTP 201.
  5. Business errors: `{error:{code, message, details?}}` (here `not_found` 404 "Contact not found." / "Contact group not found.").
  6. Validation errors are Laravel's default `{message, errors:{field:[...]}}` with HTTP 422 (a different shape from the business envelope). Without `Accept: application/json`, a failed FormRequest redirects instead of returning 422 (no API-specific exception handler was found); the docs' examples always send the header.
  7. Non-numeric `{id}` does not match a route (framework 404).
  8. Docs state API access is a paid feature; no plan middleware guards `/api/v1`, so gating (if any) is at key-minting time (not verified here).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `security.api_rate_limit_per_minute`, package `api_rate_limit_per_minute`.
- **Acceptance criteria:**
  - Given no Authorization header, then 401 `missing_api_key`.
  - Given a revoked key, then 401 `invalid_api_key`.
  - Given a key on a plan with limit 60/min, when the 61st request in a minute arrives, then 429 with `Retry-After`.
  - Given an invalid body with `Accept: application/json`, then 422 with `errors`.
- **Source refs:** app/Http/Middleware/AuthenticateApiKey.php, ApiPlanRateLimit.php, app/Http/Controllers/Api/V1/V1Controller.php, app/Models/ApiKey.php, routes/api_v1.php, routes/api/v1/contacts.php, bootstrap/app.php.
- **Port notes:** The target has `/public/v1` with API key + HMAC and rate limit counters; unify errors on problem+json and enforce key scopes.

### TW-CON-057 — API: list contacts

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CON-056
- **Summary:** Paginated list of workspace contacts with an optional text search.
- **Actors & access:** API key.
- **UX & screens:** none.
- **Endpoints:**

| Method + URI           | Route name              | Action                         | Middleware                             | Request                                                                         | Response                                                       |
| ---------------------- | ----------------------- | ------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| GET `/api/v1/contacts` | `api.v1.contacts.index` | Api\V1\ContactController@index | api, auth.apikey, auth.apikey.throttle | `per_page` (default 25, clamped 1-100), `page` (default 1, minimum 1), `search` | `{data:[contact...], meta:{page, per_page, total, last_page}}` |

- **Data:** contact object (ContactResource): `id`, `name`, `phone` (see rule 4), `email`, `tags` (array of `{id,name}` of the contact's GROUPS, not tags), `attributes` (object, `{}` when empty), `created_at` (ISO 8601). No first/last name, country code, language, address, note, consent flag, updated_at or real tags.
- **Rules & edge cases:**
  1. Order: `created_at` desc (ties arbitrary). No sort parameter, no other filters (no group, tag, unsubscribed, date).
  2. `search`: trimmed, case-insensitive substring over name, mobile and email only (not first/last name). All contacts are loaded and filtered in PHP.
  3. `per_page`: absent = 25; a present non-numeric value becomes 0 and is clamped to 1 (not 25); `page` past the end returns an empty `data`; `last_page` is at least 1.
  4. `phone` = "+" followed by the digits of the stored `mobile` (null if empty). Contacts created by CSV import keep the country code in a separate column, so their API `phone` lacks the country code. A leading plus in the stored value does not add a second one.
  5. Visibility = workspace rows plus the key owner's legacy NULL-workspace rows.
  6. `tags` resolves group ids with one query per contact, scoped to the contact's workspace.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** rate limit.
- **Acceptance criteria:**
  - Given 30 contacts, when GET with `per_page=10&page=2`, then 10 items, `meta` {page:2, per_page:10, total:30, last_page:3}.
  - Given `search=ACME`, then contacts whose name, number or email contains "acme" in any case.
  - Given `per_page=500`, then clamped to 100.
  - Given `per_page=abc`, then 1 item per page.
- **Source refs:** Api/V1/ContactController@index; Http/Resources/Api/V1/ContactResource.php.
- **Port notes:** Provide cursor pagination and filters (group, tag, consent, updated_since); keep `id`, `name`, `phone`, `email`, `created_at`; rename `tags` to `groups` and add real tags.

### TW-CON-058 — API: read one contact

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CON-056
- **Summary:** Fetch a contact by id.
- **Actors & access:** API key.
- **UX & screens:** none.
- **Endpoints:**

| Method + URI                | Route name             | Action                        | Middleware                             | Request | Response                                                                           |
| --------------------------- | ---------------------- | ----------------------------- | -------------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| GET `/api/v1/contacts/{id}` | `api.v1.contacts.show` | Api\V1\ContactController@show | api, auth.apikey, throttle; id numeric | none    | `{data:{contact}}`; 404 `{error:{code:"not_found", message:"Contact not found."}}` |

- **Data:** as TW-CON-057.
- **Rules & edge cases:** contacts of other workspaces return 404 (not 403).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an existing id, then 200 and the contact object.
  - Given an id of another workspace, then 404 not_found.
  - Given `/contacts/abc`, then framework 404.
- **Source refs:** Api/V1/ContactController@show.
- **Port notes:** Add expansion options (groups, tags, attributes).

### TW-CON-059 — API: create contact

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-CON-056, TW-CON-012, TW-CON-013
- **Summary:** Create a contact in the key's workspace.
- **Actors & access:** API key. No plan limit check (QUIRK).
- **UX & screens:** none.
- **Endpoints:**

| Method + URI            | Route name              | Action                         | Middleware                 | Request              | Response               |
| ----------------------- | ----------------------- | ------------------------------ | -------------------------- | -------------------- | ---------------------- |
| POST `/api/v1/contacts` | `api.v1.contacts.store` | Api\V1\ContactController@store | api, auth.apikey, throttle | JSON body, see rules | 201 `{data:{contact}}` |

- **Data:** writes a contact (same columns as the UI path; `msg` receives `note`; `custom_attributes` receives `attributes`).
- **Rules & edge cases:**
  1. Validation: `name` required when `first_name` is absent (nullable string max 191); `first_name`, `middle_name`, `last_name` nullable max 191; `title` nullable max 50; `phone` REQUIRED string max 32; `country_code` nullable max 10; `email` nullable email max 191; `language` nullable max 80; `address` nullable max 1000; `note` nullable max 2000; `group_ids` nullable array of integers that must exist in `contact_groups` FOR THIS WORKSPACE; `attributes` nullable array (any keys/values, not checked against attribute definitions); `is_unsubscribed` nullable boolean (default false). No `status`/`source`.
  2. Name: `name` if given, else the joined title/first/middle/last (TW-CON-012).
  3. Mobile: trimmed `phone`; if `country_code` is set and the phone does not start with it (string prefix) the stored mobile is "<country_code> <phone>"; the example "+91" with phone "+919812345678" is left as is, but "91" with "+91981..." produces a doubled prefix. `country_code` stored as sent. Not normalised to E.164, no duplicate check (duplicates allowed).
  4. `group_ids` stored as strings; unknown/foreign ids = 422 on `group_ids.N`.
  5. Side effects: model hooks run (`mobile_hash`, flow triggers `contact_created` and `group_join`, notification), then webhook `contact_created` is emitted (deferred). The `user_id` is the key owner.
  6. `attributes` empty = null column.
- **Async & events:** same as TW-CON-009.
- **External systems:** none.
- **Settings:** rate limit.
- **Acceptance criteria:**
  - Given `{"name":"ACME","phone":"15551234567"}`, then 201 with `phone` "+15551234567" and `name` "ACME".
  - Given no `phone`, then 422 `errors.phone`.
  - Given `group_ids:[999]` for a non-existent group, then 422.
  - Given the workspace at its contacts limit, then the contact is still created (QUIRK).
- **Source refs:** Api/V1/ContactController@store/composeMobile; Requests/Api/V1/Contact/StoreContactRequest.php.
- **Port notes:** Enforce the plan limit, validate/normalise E.164, offer dedup semantics (return 409 or existing), accept `tags`.

### TW-CON-060 — API: update contact

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-CON-059
- **Summary:** Partial update; only keys present in the body change.
- **Actors & access:** API key.
- **UX & screens:** none.
- **Endpoints:**

| Method + URI                | Route name               | Action                          | Middleware                 | Request                                           | Response                            |
| --------------------------- | ------------------------ | ------------------------------- | -------------------------- | ------------------------------------------------- | ----------------------------------- |
| PUT `/api/v1/contacts/{id}` | `api.v1.contacts.update` | Api\V1\ContactController@update | api, auth.apikey, throttle | JSON; all fields nullable (same shapes as create) | `{data:{contact}}`; 404 `not_found` |

- **Data:** updates the row.
- **Rules & edge cases:**
  1. Presence-based: for title, first_name, middle_name, last_name, language, address, email, country_code a key that is present (even null) overwrites; absent keys are untouched. Unlike the UI, the API can clear a field by sending null.
  2. `name`/`first_name` present: display name = `name` if truthy, else recomputed from the stored parts; empty result keeps the old name.
  3. `phone` present: `mobile` is recomposed with `country_code` (request or stored); an empty/null `phone` sets `mobile` to NULL (the contact loses its number; hash becomes null).
  4. `note` -> `msg`; `group_ids` present REPLACES the group list (group ids validated per workspace; `group_join` triggers fire for added ids); `attributes` present REPLACES the whole custom-attribute object (empty = null); `is_unsubscribed` present sets the flag (no `unsubscribed_at`, no `contact_opt_in` webhook).
  5. NO `contact_updated` webhook is emitted from the API.
  6. HTTP verb is PUT but semantics are PATCH; there is no PATCH route.
- **Async & events:** model hooks (flows, notification).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `{"email":null}`, then the email is cleared.
  - Given `{"group_ids":[]}`, then all groups removed.
  - Given `{"phone":null}`, then the contact has no mobile (QUIRK).
  - Given a foreign id, then 404.
- **Source refs:** Api/V1/ContactController@update; Requests/Api/V1/Contact/UpdateContactRequest.php.
- **Port notes:** Use PATCH with optimistic versioning; merge custom fields instead of replacing; emit update events.

### TW-CON-061 — API: delete contact

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CON-056
- **Summary:** Hard-delete a contact.
- **Actors & access:** API key.
- **UX & screens:** none.
- **Endpoints:**

| Method + URI                   | Route name                | Action                           | Middleware                 | Request | Response                                         |
| ------------------------------ | ------------------------- | -------------------------------- | -------------------------- | ------- | ------------------------------------------------ |
| DELETE `/api/v1/contacts/{id}` | `api.v1.contacts.destroy` | Api\V1\ContactController@destroy | api, auth.apikey, throttle | none    | 200 `{data:{id, deleted:true}}`; 404 `not_found` |

- **Data:** deletes the row (model delete, so the notification fires); no cascade (see TW-CON-011); no webhook.
- **Rules & edge cases:** not idempotent (second call = 404).
- **Async & events:** notification.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an existing id, then 200 `{deleted:true}` and a following GET is 404.
  - Given a repeated DELETE, then 404.
  - Given a foreign id, then 404.
- **Source refs:** Api/V1/ContactController@destroy.
- **Port notes:** Decide soft delete; make DELETE idempotent (204).

### TW-CON-062 — API: list contact groups

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CON-056
- **Summary:** All groups with member counts, not paginated.
- **Actors & access:** API key.
- **UX & screens:** none.
- **Endpoints:**

| Method + URI                 | Route name                    | Action                              | Middleware                 | Request | Response                                                                |
| ---------------------------- | ----------------------------- | ----------------------------------- | -------------------------- | ------- | ----------------------------------------------------------------------- |
| GET `/api/v1/contact-groups` | `api.v1.contact-groups.index` | Api\V1\ContactGroupController@index | api, auth.apikey, throttle | none    | `{data:[{id,name,note,color,contacts_count,created_at}], meta:{count}}` |

- **Data:** groups newest id first; `contacts_count` computed in one PHP pass over the workspace's contacts; `note` decrypted; `created_at` ISO 8601.
- **Rules & edge cases:** no pagination or filters; `meta` is `{count: N}` and is present (non-empty) even for 0 groups.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 2 groups with 3 and 0 members, then `contacts_count` 3 and 0 and `meta.count` 2.
  - Given no groups, then `data:[]`, `meta:{count:0}`.
  - Given orphan ids on contacts, then they are not counted.
- **Source refs:** Api/V1/ContactGroupController@index; Resources/ContactGroupResource.php.
- **Port notes:** Add cursor pagination and SQL counts.

### TW-CON-063 — API: create contact group

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CON-056
- **Summary:** Create a group.
- **Actors & access:** API key.
- **UX & screens:** none.
- **Endpoints:**

| Method + URI                  | Route name                    | Action                              | Middleware                 | Request                                                                   | Response                                                      |
| ----------------------------- | ----------------------------- | ----------------------------------- | -------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| POST `/api/v1/contact-groups` | `api.v1.contact-groups.store` | Api\V1\ContactGroupController@store | api, auth.apikey, throttle | `name` required max 191, `note` nullable max 500, `color` nullable max 32 | 201 `{data:{id,name,note,color,contacts_count:0,created_at}}` |

- **Data:** one `contact_groups` row (user_id = key owner).
- **Rules & edge cases:** NO case-insensitive de-dup (unlike the UI, duplicates are created); no update endpoint exists for groups; a "Contact group created" notification is recorded.
- **Async & events:** notification.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `{"name":"VIP","color":"#2563eb"}`, then 201 with those values and `contacts_count` 0.
  - Given the same name twice, then two groups exist.
  - Given no name, then 422.
- **Source refs:** Api/V1/ContactGroupController@store; Requests/Api/V1/Group/StoreContactGroupRequest.php.
- **Port notes:** Unique per workspace; add PATCH.

### TW-CON-064 — API: delete contact group

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CON-056
- **Summary:** Delete a group and detach it from all contacts.
- **Actors & access:** API key.
- **UX & screens:** none.
- **Endpoints:**

| Method + URI                         | Route name                      | Action                                | Middleware                 | Request | Response                                                                                          |
| ------------------------------------ | ------------------------------- | ------------------------------------- | -------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| DELETE `/api/v1/contact-groups/{id}` | `api.v1.contact-groups.destroy` | Api\V1\ContactGroupController@destroy | api, auth.apikey, throttle | none    | `{data:{id, deleted:true}}`; 404 `{error:{code:"not_found", message:"Contact group not found."}}` |

- **Data:** same detach loop as TW-CON-036 (including the `mobile_hash` null-out quirk).
- **Rules & edge cases:** workspace scoped; not idempotent.
- **Async & events:** notifications per touched contact and for the group.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a group with 3 members, when deleted, then GET contact shows no reference and the group is gone.
  - Given a foreign group id, then 404.
  - Given a repeated DELETE, then 404.
- **Source refs:** Api/V1/ContactGroupController@destroy.
- **Port notes:** Cascade through the junction table.

### TW-CON-065 — Contacts UI shell: toasts, loading, errors, keyboard, responsive, i18n

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-CON-001
- **Summary:** Cross-cutting behaviour of the contacts and attributes screens.
- **Actors & access:** all users of these screens.
- **UX & screens:**
  - Loading: submit buttons are disabled and show a spinner with "Working..." during AJAX (add, edit, group save, import, bulk delete); the page itself is server-rendered (no skeletons).
  - Success feedback: toasts via `window.toast(message, 'success')`; destructive AJAX (delete contact/group/bulk delete) is silent; bulk group/tag/dedupe/import persist the toast across a page reload with sessionStorage key `threadwisePendingToast`.
  - Errors: network failure toast "Network error. Please try again."; 422 toasts the first validation message; other failures toast the JSON `message` or "Request failed (status)."; the attributes page uses `WaToaster` ("Refresh failed: ...", "Delete failed: ...", "Could not load attribute").
  - Confirm dialogs: themed `confirmDialog` (danger tone for deletes) with browser `confirm()` fallback on the attributes page.
  - Keyboard: Escape closes any open modal on both pages (and the attribute create/edit modals); Enter in the tag input attaches the tag; Esc/Enter/arrows in the slash picker; no list shortcuts. Clicking the modal backdrop closes it.
  - Modals: add/edit max-w-3xl, import/group max-w-xl, delete confirm max-w-md; body scroll locked while open; max height 90vh with scrolling body.
  - Responsive: 2-column layout (260px rail + content) from the lg breakpoint, rail stacks on small screens; KPI tiles 2 columns on small, 4 on large; toolbar wraps; search is full width on mobile and 288px from sm; table has a 1100px minimum width with horizontal scroll, and a card/grid view is available; name fields are a 2-column grid on mobile and 4 on sm+.
  - Phone input: intl-tel-input with preferred countries (platform default, India, US, UK, UAE, Singapore), separate dial code, dropdown attached to body; after a successful add the picker resets to India (+91) regardless of platform default.
  - i18n: strings use the `__()` helper with English text as the key and JSON files `lang/*.json` for ar, bn, de, en, es, fr, he, hi, id, it, ja, ko, nl, pl, pt, ru, th, tr, ur, vi, zh-CN. Several strings are hard-coded English and never translated: "Tip", "Import format", "Bulk upload", "New group", "Add contact", "Mr/Ms/Dr", "— none —" in the import modal, the import hint paragraph, "Delete this contact?", "Delete this group?" and most JS toasts ("Create a group first.", "No tags to remove yet.", "Pick a tag or type a new name.").
  - Help copy: static "Tip", "Import format" and three help cards; mismatched copy: the import modal says "CSV / max 5 MB" (server 50 MB); the memo textarea limits to 1024 characters while the server allows 2000.
- **Endpoints:** none.
- **Data:** none (browser `localStorage` list/grid preference, sessionStorage toast).
- **Rules & edge cases:** the add-contact AJAX handler prepends the row but does not update the KPI tiles or sidebar counts; the sidebar counts become stale until reload.
- **Async & events:** none.
- **External systems:** intl-tel-input library.
- **Settings:** platform default country, locale (`SetLocale` middleware).
- **Acceptance criteria:**
  - Given a failing save with a validation error, then a red toast with the first message and the button re-enabled.
  - Given Escape pressed with a modal open, then it closes.
  - Given a 375px viewport, then the table scrolls horizontally and grid view is available.
  - Given an Arabic locale, then translated keys render (RTL handling is a layout concern, not tested here).
- **Source refs:** resources/js/charts/user-contacts-index.js; resources/views/user/contacts/index.blade.php; user/attributes/index.blade.php; lang/*.json; resources/js/list-grid-toggle.js; resources/js/app.js (confirmDialog).
- **Port notes:** Use the web shell's toast/dialog kit; real i18n of all strings; update counters optimistically.

## Data model

All tables use MySQL utf8mb4_unicode_ci in the reference app. Encrypted columns store Laravel's base64 JSON envelope (IV, MAC, ciphertext), so they cannot be indexed, sorted or searched.

### `contacts` (read/written by TW-CON-001..027, 055, 057..061)

| Column                             | Type                    | Null / default | Notes                                                                                                                     |
| ---------------------------------- | ----------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| id                                 | bigint unsigned PK auto | no             |                                                                                                                           |
| user_id                            | bigint unsigned         | yes            | creator/owner; NULL for system-captured; indexed; no FK                                                                   |
| workspace_id                       | bigint unsigned         | yes            | indexed; FK to workspaces ON DELETE SET NULL (so a deleted workspace turns its contacts into legacy "owner-visible" rows) |
| company_id                         | bigint unsigned         | yes            | indexed; set by the Companies domain; no FK                                                                               |
| title                              | varchar(255)            | yes            | plaintext                                                                                                                 |
| first_name, middle_name, last_name | varchar(255)            | yes            | plaintext                                                                                                                 |
| name                               | text                    | yes            | ENCRYPTED display name                                                                                                    |
| language                           | varchar(255)            | yes            | plaintext                                                                                                                 |
| address                            | text                    | yes            | plaintext                                                                                                                 |
| contact_group                      | longtext                | yes            | ENCRYPTED JSON array of string group ids                                                                                  |
| email                              | text                    | yes            | ENCRYPTED                                                                                                                 |
| country_code                       | varchar(255)            | yes            | plaintext, "+91" or "91"                                                                                                  |
| mobile                             | text                    | yes            | ENCRYPTED, shape varies (see TW-CON-013)                                                                                  |
| mobile_hash                        | varchar(64)             | yes            | indexed; SHA-256 of canonical digits; NULL when no digits                                                                 |
| channel                            | varchar(32)             | yes            | social channel key (tiktok, telegram, facebook, instagram, viber, line, wechat, email)                                    |
| channel_uid                        | varchar(191)            | yes            | sender id; UNIQUE (workspace_id, channel, channel_uid) named contacts_ws_channel_uid_unique                               |
| msg                                | text                    | yes            | the "Memo"                                                                                                                |
| subject                            | text                    | yes            | unused by this domain (legacy)                                                                                            |
| image                              | varchar(255)            | yes            | media-disk path or remote URL                                                                                             |
| is_unsubscribed                    | tinyint(1)              | no, default 0  |                                                                                                                           |
| unsubscribed_at                    | timestamp               | yes            |                                                                                                                           |
| custom_attributes                  | json                    | yes            | plaintext object: `status`, `source`, attribute values, integration keys                                                  |
| created_at, updated_at             | timestamp               | yes            | list ordering uses created_at                                                                                             |

No `source` or `status` column exists (the code probes for `source` and finds none). Row volume: tens to hundreds of thousands per workspace (import sized for ~500k rows); every list request loads all of them.

### `contact_groups` (TW-CON-033..037, 062..064)

| Column                 | Type               | Null / default | Notes                                                                                                                                               |
| ---------------------- | ------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                     | bigint unsigned PK | no             |                                                                                                                                                     |
| user_id                | bigint unsigned    | yes            | indexed                                                                                                                                             |
| workspace_id           | bigint unsigned    | yes            | indexed; FK workspaces ON DELETE SET NULL                                                                                                           |
| user_group             | varchar(255)       | yes            | ENCRYPTED group name; ciphertext is ~200 chars for a short name (seed rows: 200-228), so longer names probably overflow the column (see TW-CON-034) |
| note                   | longtext           | yes            | ENCRYPTED                                                                                                                                           |
| status                 | tinyint(1)         | no, default 1  | unused                                                                                                                                              |
| color                  | varchar(32)        | yes            | free string; UI swatches #7C3AED, #22C55E, #E87A5D, #E5A04E, #13478A                                                                                |
| created_at, updated_at | timestamp          | yes            |                                                                                                                                                     |

No unique constraint on name.

### `contact_tag` (TW-CON-024, 038..041)

`id` bigint PK, `contact_id` bigint NOT NULL (indexed), `tag_id` bigint NOT NULL (indexed), `added_by` bigint null, `created_at`, `updated_at`; UNIQUE (contact_id, tag_id). No foreign keys (orphans possible after contact or tag deletion).

### `tags` (shared with TIB1; TW-CON-024, 039, 041)

`id`, `workspace_id` bigint NOT NULL (indexed), `name` varchar(64) NOT NULL, `slug` varchar(64) NOT NULL, `color` varchar(16) NOT NULL default `#075E54`, `description` varchar(255) null, timestamps; UNIQUE (workspace_id, slug). No FK to workspaces. `conversation_tag` is the inbox pivot (TIB1).

### `attributes` (TW-CON-042..050)

| Column                 | Type            | Null / default     | Notes                                         |
| ---------------------- | --------------- | ------------------ | --------------------------------------------- |
| id                     | bigint PK       | no                 |                                               |
| user_id                | bigint unsigned | no                 | creator; indexed                              |
| workspace_id           | bigint unsigned | yes                | indexed; UNIQUE (workspace_id, attribute_key) |
| attribute_name         | varchar(255)    | no                 | display name                                  |
| attribute_key          | varchar(255)    | no                 | the token key; app limits to 64 chars         |
| attribute_value        | text            | yes                | ENCRYPTED default value (app limit 255)       |
| description            | text            | yes                | ENCRYPTED (app limit 500)                     |
| type                   | varchar(16)     | no, default custom | always "custom"; "system" unused              |
| status                 | tinyint(1)      | no, default 1      | active flag; UI cannot clear it               |
| created_at, updated_at | timestamp       | yes                |                                               |

### `contact_custom_fields` (TW-CON-051, dead)

`id`, `workspace_id` bigint NOT NULL (indexed), `key` varchar(64), `label` varchar(128), `type` varchar(16) default text (model types: text, number, date, select, bool, url, email), `options` json null, `required` tinyint default 0, `show_in_panel` tinyint default 1, `sort` int unsigned default 0, timestamps; UNIQUE (workspace_id, key). Empty; read only by the mobile attributes feed.

### Columns in other tables that reference contacts (owned elsewhere)

`conversations.contact_id` and `conversations.contact_group_id`, `deals.contact_id`, `appointments.contact_id`, `broadcast_contacts.contact_id`, `wp_campaign_contacts.contact_id`, `scheduled_message_contacts.contact_id`, `flow_subscribers.contact_id`, `flow_retry_logs.contact_id`, `inbox_messages.contact_id`, `messages.contact_id`, `leads.contact_id`, `payments.contact_id`, `projects.contact_id`, `sales_docs.contact_id`, `wa_calls.contact_id`, `wa_form_submissions.contact_id` (the only one with a foreign key, SET NULL), `wa_link_clicks.contact_id`. None is cascaded on contact delete.

## Cross-domain contracts

Consumes:

- **workspaces-teams-tenancy (WSP):** `current_workspace_id` for scoping, the role hierarchy owner > admin > manager > agent > viewer (`workspace.role:manager` gate), the `Workspace` model hook that seeds six starter tags on creation, workspace deletion/wipe (`workspaces:wipe-expired` lists contacts, contact_groups and attributes among the wiped tables), `plan_overrides`.
- **plans-subscriptions-trials (PLN):** `contacts_limit` via `PlanLimitGuard::check` and `Workspace::effectiveLimit`; `api_rate_limit_per_minute` for the public API; `PlanUsage` counts contacts per workspace for usage displays.
- **team-inbox-conversations (TIB1):** the `tags` master list and its CRUD (`/team-inbox/api/tags`, `tag.manage`, `tags_limit`), conversation labels (`conversation_tag`), STOP/START keyword handling (OptOutService writes `is_unsubscribed`/`unsubscribed_at`), `saveContact` and `extractMessageContact` creation paths, `Contact::nameForPhone` for display names.
- **notifications-activity-audit:** `LogsNotifications` and `NotificationHelper` (per-model-event bell rows and email/Slack fan-out).
- **webhooks (INTG):** `WebhookService::emit` for `contact_created`, `contact_updated`, `contact_opt_in`.
- **flow runtime / flow builder (FLW):** `FlowEnrollmentService` for triggers `contact_created`, `group_join`, `tag_added`, `opt_in`; flow subscribers reference `contact_id`.
- **API keys / developers console:** `ApiKey`, `/developers`.

Exposes (other domains rely on):

- **broadcasts / campaigns / scheduled (BRD, CMP, SCH):** audience expansion from `contact_group` ids, explicit contact ids and tag ids (`contact_tag`, union with conversation tags); `Contact::scopeSubscribed` (opt-out filter; scheduled sends use it, campaigns apply the same condition, broadcasts drop opted-out ids); manual-number auto-capture through `Contact::rememberPhone`; the recipient row used for variables (name, first_name, last_name, middle_name, title, phone, mobile, country_code, email, address, language, contact_group, custom_attributes); `TemplateOverrideResolver::lookup`, `AttributeResolver::resolve`, `SendAttributes::catalog` and the placeholder validator; opt-out sync from campaign recipients back to `contacts.is_unsubscribed`.
- **chat / team inbox:** `Contact::forSocialSender` and `rememberPhone` called by every channel ingest; `Contact::canonicalizePhone`, `hashPhone`, `nameForPhone` for resolving a contact from a phone; conversations hold `contact_id`.
- **flows (FLW):** `attributes` feed to the Node runtime (`/api/workspace-attributes/{workspaceId}`), contact fields seeded as flow variables, `FlowEnrollmentService::onTagAdded|onGroupJoin|onContactCreated|onOptIn|onConversationTagged`.
- **deals/companies/CRM:** `contacts.company_id`, `Contact::deals()`, the Contact 360 page (dead), contact search for deals (`/deals/contacts/search`).
- **integrations (Shopify, WooCommerce, lead finder, incoming webhooks, TikTok leads, Google Sheets add-on, browser extension, mobile app):** create or look up contacts through the same model helpers; mobile app has its own contact endpoints (`/api/app/contacts`, `/api/app/contact-groups`, `/api/app/get-contacts`) not analysed here.
- **settings data export:** `/settings/export/contacts` streams `id, name, mobile, email, status, created_at` for contacts owned by workspace members (user-based scope, `status` read as a column that does not exist so always empty). Owned by the settings domain.
- **public API:** `/api/v1/contacts` and `/api/v1/contact-groups` contract (TW-CON-056..064).

Target mapping reminders (see docs/threadwise-port/target-map.md): contacts, tags, custom fields, bulk operations, outbox events and the public API already have homes under `apps/api/src/modules/crm/*` and `public-api`; the denormalised group membership and encrypted-search model must not be ported.

## Open questions & quirks

- **Contact 360 page 500s** (TW-CON-018) because the view calls a route name that does not exist; nothing in the contacts table links to it, only Companies does. Verified with a route-name lookup in the reference app; the page itself was not rendered because the seeded contacts have no workspace.
- **Documentation vs code:** docs describe a two-step preview-first import (the preview endpoint exists but no UI calls it), tags in "apply to all rows" (accepted but ignored), a 5 MB import limit (50 MB real; modal says 5), an "Unsubscribed" toggle in the add form (absent), "filtering happens live as you type" (debounced server round trip), "Imported" view (always empty) and the slash picker inserting positional `{{N}}` (it inserts named `{{key}}`; normalisation to positional happens on save in the templates/broadcast/campaign controllers, which are other domains).
- **Unverified items:** the `mobile_hash` null-out on group delete (TW-CON-036) and the 500 on names of 65-80 characters (TW-CON-024/039) are from code reading; the redirect-instead-of-422 on API validation errors without `Accept: application/json` is inferred (no API exception handler found); whether API key minting is plan-gated was not checked in this domain.
- **Areas not read:** the mobile-app contact endpoints (`routes/app.php` L128-140, Api\App\ContactGroupController, 672 lines), the Settings export code beyond the contacts stream, and the team-inbox `saveContact` / `extractMessageContact` handlers (documented in TIB1) were only listed, not analysed. `routes/api.php` Node-token routes other than the attributes feed were not read.
- The `contacts.subject` column and `Contact::initials` accessor are unused by this domain.
- `contact_groups.status` is unused; `attributes.type` is always `custom`.
- A user with no current workspace sees all NULL-workspace attributes (`forWorkspace(null)` matches `IS NULL`).
- Notifications for groups link to `/contacts/groups`, which does not exist.
- `mask_phone()` is intentionally a no-op; masking UI paths still call it.

### Differences to decide

| #   | Reference behaviour                                                                                                                                                                                                                                      | Why it looks wrong                                                  | Recommendation                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | UI add sends a default title "Mr" and composes the name from it ("Mr Aarav")                                                                                                                                                                          | Pollutes every display name and every merge-tag `{{name}}`          | No default title; keep title optional; compute `display_name` from first/last only (title shown separately if set)                                                                                                    |
| 2   | Import writes the full CSV name into `first_name` and also fills `last_name`; later edits rebuild `name` as first+last                                                                                                                                | Surname duplicated after any edit                                   | Split the name on import (first token / rest) or store only `display_name`; never rebuild from overlapping parts                                                                                                      |
| 3   | Two phone canonicalisers (one strips "00"); no unique key; dedupe/import use the weaker one                                                                                                                                                           | Same person can be duplicate or distinct depending on the code path | One libphonenumber E.164 normaliser; unique `(workspace, e164)` identity (use `contact_identities`); keep raw input for display                                                                                       |
| 4   | Phone stored inconsistently ("+91 98..." vs separate country code vs bare digits); API `phone` omits country code for imported contacts                                                                                                               | Unreliable display, search and API output                           | Store E.164 + national + country; API always returns E.164                                                                                                                                                            |
| 5   | Import updates the NEWEST duplicate; "Remove duplicates" keeps the OLDEST and deletes the rest without merging                                                                                                                                        | Inconsistent winner; data (groups, tags, attributes, history) lost  | Single upsert on the unique identity; merge duplicates (union groups/tags/attributes, re-point history) with a preview and audit                                                                                      |
| 6   | Group membership as encrypted JSON on the contact; all lists/counts/filters/audiences are full-book PHP scans; orphan ids; group delete can null `mobile_hash`                                                                                        | Does not scale, inconsistent counts, data-loss bug                  | Junction table with FKs/cascade; SQL counts; never resave contacts for membership changes                                                                                                                             |
| 7   | Per-field encryption is partial (name/mobile/email/groups encrypted; first/last name, address, memo, custom attributes plaintext)                                                                                                                     | False sense of protection and blocks search                         | Rely on DB-level encryption + RLS; encrypt only fields with an explicit requirement, consistently                                                                                                                     |
| 8   | "Imported" filter/badge always 0; status and source hidden inside `custom_attributes`, not shown or filterable                                                                                                                                        | Dead UI; source tracking unusable                                   | Real `source` and `status` columns, set by import/API/capture, shown and filterable                                                                                                                                   |
| 9   | Import "tags" knob accepted but ignored; no preview/mapping UI although endpoint exists; modal says 5 MB vs server 50 MB; docs overpromise                                                                                                            | Misleading product surface                                          | Build the wizard (preview, mapping, tags, consent, limits) and align copy and limits                                                                                                                                  |
| 10  | Import ignores group/status/source/tag knobs for existing contacts it updates                                                                                                                                                                         | Selected group is not applied to part of the file                   | Apply additive knobs (group, tags) to updated rows too                                                                                                                                                                |
| 11  | `contacts_limit` checked only at import start and only in the UI; API create and auto-capture ignore it                                                                                                                                               | Limit can be exceeded arbitrarily                                   | Enforce remaining quota in the service for every writer; import truncates/rejects with a report                                                                                                                       |
| 12  | UI `contact_group.*` validated with a global `exists`; import `group_id` not validated                                                                                                                                                                | Cross-tenant group id references                                    | Validate group ids against the workspace (RLS makes it automatic)                                                                                                                                                     |
| 13  | Edit form cannot clear the last group or any text field (null-coalescing, unchecked boxes post nothing)                                                                                                                                               | Data cannot be removed via UI                                       | PATCH with explicit nulls and an explicit groups array                                                                                                                                                                |
| 14  | No UI control for opt-out; manual/API changes do not set `unsubscribed_at` or emit the opt-in webhook                                                                                                                                                 | Consent evidence gaps                                               | Consent toggle with required timestamp+source on every change, audit entry, one event                                                                                                                                 |
| 15  | Bulk bar shows "T selected" for all-matching but only group actions honour it; Export/Tag/Delete use page rows                                                                                                                                        | Misleading, partial operations                                      | Every bulk action accepts ids or a filter; large ones run as jobs with progress                                                                                                                                       |
| 16  | Bulk delete 422s on any stale id; response echoes requested ids                                                                                                                                                                                       | All-or-nothing and false positives                                  | Ignore unknown ids, return actual deleted ids and per-row failures (`{succeeded, failed[]}`)                                                                                                                          |
| 17  | Deletes leave dangling `contact_id` in conversations, deals, campaigns, flow subscribers and `contact_tag`                                                                                                                                            | Orphans and ghost rows                                              | FK with SET NULL/cascade, or soft delete with a retention policy                                                                                                                                                      |
| 18  | Tags created from Contacts skip `tag.manage` and `tags_limit`; name validated at 80 but column 64; slug-based identity; non-Latin names get random slugs                                                                                              | Rule bypass, 500s, duplicate tags                                   | One tag service: name <= 64, unique `(workspace, lower(name))`, same permission and limit everywhere (or a deliberate documented exception)                                                                           |
| 19  | Tag filter has no control, cannot be cleared, drops on group change                                                                                                                                                                                   | Hidden state                                                        | Tag multi-select with AND/OR and removable pills                                                                                                                                                                      |
| 20  | Attribute active checkbox cannot be unticked (absent field defaults true); inactive attributes still resolve at send time                                                                                                                             | The inactive state is unreachable and semantically unclear          | Send explicit booleans; define inactive as hidden from pickers and not resolved (or document otherwise)                                                                                                               |
| 21  | Attributes CRUD open to every role incl. viewers; keys allow uppercase/unicode and collide with built-ins/`status`/`source`; delete ignores usage                                                                                                     | Security and integrity gaps                                         | Require a settings permission; key regex `^[a-z][a-z0-9_]{0,63}$`, reserved-word list, in-use check on delete                                                                                                         |
| 22  | Attributes have no types; a typed `contact_custom_fields` table exists but is unused; mobile feed reads that empty table                                                                                                                              | Two competing models                                                | Single typed custom-field registry (text, number, date, select, bool, url, email); drop `contact_custom_fields`                                                                                                       |
| 23  | Slash picker inserts named tokens while docs claim positional; two resolvers with opposite unresolved-token behaviour (blank vs literal)                                                                                                              | Inconsistent merge behaviour                                        | One token format end to end, one resolver; blank on unresolved for sends                                                                                                                                              |
| 24  | CSV export prefixes `'` to numbers starting with `+`, omits tags/attributes/consent, memo is not importable, no BOM                                                                                                                                   | Lossy, ugly, non round-trippable                                    | Export E.164, include tags/attributes/consent, apply formula guard only to free-text cells, round-trip with import                                                                                                    |
| 25  | Notification per touched contact on bulk group changes; notifications carry decrypted names; group notification link is a 404                                                                                                                         | Noise and PII duplication                                           | Audit log entries and one aggregated notification per bulk action, no PII in text                                                                                                                                     |
| 26  | Public API: `tags` key actually returns groups; 422 shape differs from the error envelope; `per_page=abc` becomes 1; PUT can null the phone; no group update, no tag endpoints, no filters; API update/delete emit no webhooks; key scopes unenforced | Confusing and unsafe public contract                                | Rename to `groups`, add real `tags`, problem+json errors, validate paging, forbid clearing the phone, add group PATCH and filters, emit events on every write, enforce scopes                                         |
| 27  | Webhooks fire only from UI add/edit and API create; flows fire on create/group/tag/opt-in but not on import or system capture; contacts with NULL `user_id` never trigger flows; group bulk adds launch flows synchronously per contact               | Inconsistent automation behaviour and slow requests                 | Domain events through the outbox for all write paths with an explicit "trigger automations" option on import; flow subscribers consume asynchronously and resolve the workspace directly (not through the owner user) |
| 28  | Contact 360 page crashes (route name); avatar image uploaded but never shown; old file not deleted                                                                                                                                                    | Dead or broken features                                             | Build the real detail screen; drop or show avatars and delete replaced files                                                                                                                                          |
| 29  | Group create de-dups by name only on the UI; rename and API/import can create duplicates; free-form colour string; unused `status`; encrypted name in a varchar(255) column probably overflows for names over ~30-35 chars                            | Inconsistent group identity and a latent 500                        | Unique `(workspace, lower(name))`, hex colour validation, drop `status`, plain `text`/varchar(191) name column                                                                                                        |
| 30  | Memo limit 1024 in the browser vs 2000 on the server; import copy says 5 MB; many hard-coded English strings                                                                                                                                          | UX inconsistencies                                                  | Single source of limits shared via contracts; full i18n                                                                                                                                                               |

## Port decisions

Recorded by the API port of the contacts-area gaps (groups, bulk actions, import, dedupe, list filters, tags,
attributes). The default was to **fix clear bugs and keep intended behaviour**; every place the port differs from Reference is
listed here, with the id of the "Differences to decide" row it settles where there is one. Code: `apps/api/src/modules/crm/*`
(`contact-groups`, `contact-bulk`, `contact-import`, `contact-dedupe`, `attributes`, plus the extended `contacts` and `tags`),
contracts in `packages/contracts/src/contacts-attributes-tags/`, endpoints in `docs/api/contacts-attributes-tags.md`.

### Decided as recommended (fixes)

| Diff # | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Where                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 1      | No default title. The display name is the typed name, else first + middle + last; the title is never part of it. Applies to create (API) and import.                                                                                                                                                                                                                                                                                                                                                                                                                     | TW-CON-012                                                                                                                      |
| 2      | An import stores the CSV name as `name` and fills `first_name` / `last_name` only from their own columns. The full name is no longer copied into `first_name`, so nothing rebuilds "Aarav Sharma Sharma".                                                                                                                                                                                                                                                                                                                                                                | TW-CON-012, 030                                                                                                                 |
| 3, 4   | ONE canonicaliser (`canonicalizePhone` in `@crm/contracts`) for create, import, dedupe and every identity lookup: digits; a leading `+` or `00` means "already international" (the `00` is dropped); else the row's country code (or the import's `defaultCountryCode`) is prefixed unless the digits already start with it; 7-15 digits, no leading 0. Phones are stored E.164 and exported E.164. Create/update normalise the phone and write the same `contact_identities` key the importer writes, so creating a number an import made returns the imported contact. | TW-CON-013                                                                                                                      |
| 5      | Import updates the OLDEST duplicate, dedupe keeps the oldest: one winner. Dedupe merges instead of deleting (below).                                                                                                                                                                                                                                                                                                                                                                                                                                                     | TW-CON-025, 030                                                                                                                 |
| 6      | Group membership is the join table `contact_group_members` (composite FKs, ON DELETE CASCADE, forced RLS). Counts, filters and "no group" are SQL; deleting a group is one `DELETE` and touches no contact (the `mobile_hash` null-out bug cannot occur). Orphan ids cannot exist, so a contact that lost its only group is simply "no group".                                                                                                                                                                                                                           | TW-CON-036, 037                                                                                                                 |
| 8      | `contacts.source` is a column (and `status` already was); `contacts.import_job_id` makes "Imported" a real filter (`imported=true`) and a real stat. Create/update accept `source`. An import with no source knob stamps `source = 'import'`.                                                                                                                                                                                                                                                                                                                            | TW-CON-006, 015                                                                                                                 |
| 9      | Import wizard backend: preview (`POST /contacts/import/preview`), explicit mapping, the group/tag/status/source knobs with tags really applied, rejects report, one limit (20 MB, 200,000 rows) in `@crm/contracts`.                                                                                                                                                                                                                                                                                                                                                     | TW-CON-027..031                                                                                                                 |
| 10     | Group and tag knobs (and the file's own group/tag columns) apply to rows the file only UPDATES. Status and source are stamped on CREATED contacts only, so an import never overwrites a contact's existing status or source.                                                                                                                                                                                                                                                                                                                                             | TW-CON-029                                                                                                                      |
| 11     | The plan contact cap is enforced for every writer that goes through the service: contact create (API) and import. The import refuses at the cap before reading the file (TW-CON-026 #1), and counts the cap PER NEW CONTACT inside a run: rows that would exceed it are reported `plan_limit_reached` and counted in `limitExceeded`, rows that only update still apply. Inbound capture is an inbox-domain writer and must call `ContactQuotaService` when it is ported.                                                                                                | TW-CON-026                                                                                                                      |
| 12     | Every uuid in a filter, selection, knob or membership is resolved inside the caller's workspace; a foreign group/tag is 404, a stale one in a filter matches nothing (never "ignore the condition").                                                                                                                                                                                                                                                                                                                                                                     | TW-CON-009, 029                                                                                                                 |
| 13     | Group membership is set with an explicit array (`PUT /contacts/:id/groups`), so the last group can be removed. Notes and colours clear with an explicit `null`, absent keeps.                                                                                                                                                                                                                                                                                                                                                                                            | TW-CON-010, 035                                                                                                                 |
| 15     | Every bulk action (delete, group add/remove, tag/untag, export) takes ids OR a saved filter plus `excludeIds`. "Select all matching" is the same filter code as the list, run set-based. Caps: 5,000 explicit ids, 50,000 contacts per filter-based change (422 `CON_SELECTION_TOO_LARGE` beyond it), 200,000 rows per export.                                                                                                                                                                                                                                           | TW-CON-019..024                                                                                                                 |
| 16     | Bulk delete never 422s on a stale id: unknown ids and ids outside the caller's record scope are listed in `failed`, the rest are deleted, and the answer reports what was actually changed.                                                                                                                                                                                                                                                                                                                                                                              | TW-CON-020                                                                                                                      |
| 17     | Deleting a contact relies on the existing FKs (CASCADE for notes/files/tags/groups/identities, SET NULL for deals, conversations, campaign recipients...). Dedupe re-points those rows to the survivor first.                                                                                                                                                                                                                                                                                                                                                            | TW-CON-011, 025                                                                                                                 |
| 18     | One tag rule: name 1-64 characters, unique per workspace ignoring case (409 `CON_TAG_NAME_TAKEN`), creating a tag from Contacts (bulk, attach-by-name, import, CSV tags column) needs `record.tags.create` and counts against the plan `tags` limit, exactly like `POST /tags`. Attaching an EXISTING tag needs only `record.contacts.update`.                                                                                                                                                                                                                           | TW-CON-024, 039                                                                                                                 |
| 19     | The tag filter is `tagIds` (list) with `tagMode=any                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | all`; the single `tagId` chip-link spelling still works. A value that is not a uuid is a 422 instead of being silently ignored. | TW-CON-004                                                                                                                   |
| 20     | `isActive` is an explicit boolean on create and update, so an attribute can be switched off. An inactive attribute is hidden from the picker AND not resolved at send time.                                                                                                                                                                                                                                                                                                                                                                                              | TW-CON-043, 044, 048                                                                                                            |
| 21     | Attribute management needs the Contact Properties permissions (`record.contact-properties.*`); viewers and agents without them get 403. Keys are `^[a-z][a-z0-9_]{0,63}$`, unique, and may not be a built-in token, a contact column, `status` or `source` (422 `CON_ATTRIBUTE_KEY_RESERVED`). Deleting an attribute that contacts hold a value for is 409 `CON_ATTRIBUTE_IN_USE` until `force=true`; the values stay on the contacts either way.                                                                                                                        | TW-CON-043..045                                                                                                                 |
| 22     | Attributes are rows of the typed field registry (`fields`, `module_key = 'contacts'`, section "Custom attributes"; default value and description in `config`). Types: text, long_text, integer, decimal, boolean, date, datetime, url, email, phone. `contact_custom_fields` is not ported.                                                                                                                                                                                                                                                                              | TW-CON-043, 051                                                                                                                 |
| 23     | One token format (named `{{key}}`), one resolver (`MergeTagService` / `renderMergeTags`) with the Reference precedence (contact column, contact attribute, workspace default, system) and one alias table. An unresolved token is the empty string, never the braces. `groups` resolves to group NAMES.                                                                                                                                                                                                                                                                     | TW-CON-047, 048                                                                                                                 |
| 24     | Export columns: `name, first_name, last_name, phone (E.164), country_code, email, groups, tags, language, title, address, memo, status, source, unsubscribed, created_at`, then one `attr:<key>` column per active attribute. Groups and tags by name. UTF-8 BOM by default (`bom=false` to drop). The formula-injection guard applies to free-text cells only, so `+91...` is not turned into `'+91...`.                                                                                                                                                                | TW-CON-021, 022                                                                                                                 |
| 25     | A bulk action writes ONE audit row and ONE aggregated outbox event (`contact_group.members_changed`, `tag.contacts_changed`), plus one `contact.group_added                                                                                                                                                                                                                                                                                                                                                                                                              | removed`/`contact.tag_added                                                                                                     | removed` event per contact that really changed (what flows subscribe to). No notification per contact, no PII in event text. | TW-CON-023, 024 |
| 29     | Groups: unique `(org, lower(name))` by index (simultaneous creates cannot both win), name 1-191, `#RRGGBB` colour or null, note <= 500, no `status` column. Create of an existing name still returns that group (200, `existing: true`); renaming onto a taken name is 409 `CON_GROUP_NAME_TAKEN`.                                                                                                                                                                                                                                                                       | TW-CON-034, 035                                                                                                                 |
| 30     | Limits live once in `@crm/contracts` (page size, names, import size/rows, bulk caps).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | all                                                                                                                             |

### Decided differently from the recommendation, or left as Reference

| Item                       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dedupe is two calls        | `GET /contacts/duplicates` previews the sets; `POST /contacts/dedupe` merges (default 1,000 sets per call, `remainingSets` says whether to call again). It needs `record.contacts.merge` at scope `all` (a merge reaches across owners); `own`/`team` get 403 `CON_MERGE_SCOPE_REQUIRED`. The survivor keeps its own fields and takes the ones it lacks, unions groups and tags, merges attribute values (its own value wins), keeps an opt-out, and receives every row that pointed at a duplicate (savepoint per table; a unique clash leaves that row to cascade or SET NULL). |
| Trunk zero                 | A number like `09812345678` with country code `91` canonicalises to `9109812345678`, i.e. Reference's literal rule (prefix unless the digits already start with the code). A national trunk `0` is not stripped, because for some countries it is part of the number. Such a number is not detected as a duplicate of `+919812345678`.                                                                                                                                                                                                                                               |
| No-country-code numbers    | With no country code on the row and no `defaultCountryCode`, the digits are taken to include their own country code (bare `919812345678`). A number that cannot be 7-15 digits is rejected `invalid_phone`.                                                                                                                                                                                                                                                                                                                                                                       |
| Column mapping             | `First Name` / `Last Name` / `Title` / `Address` / `Notes` / `Tags` / `Status` / `Source` are recognised. TW-CON-028 #2 (`Name, First Name` ignores the second) changes: with both, `name` takes column 0 and `firstName` takes the second, as a separate field. `Mail Address` is still not recognised (TW-CON-028 #1).                                                                                                                                                                                                                                                          |
| Required columns           | A phone and some name (`name`, `firstName` or `lastName`). A file without them is 422 `CON_IMPORT_FILE_INVALID` naming the missing field (Reference answered ok with "imported 0"). A row with no name or no valid phone is rejected with a reason; a bad email is rejected (Reference imported both). Blank lines are not rows.                                                                                                                                                                                                                                                        |
| Sync threshold             | Up to 1,000 data rows run inside the request (200 with the finished job); above that the file is stored on the job row, queued on `con-import` and answered 202. The worker commits every 500 rows and resumes from `processed_rows` after a crash. The uploaded text is cleared when the job finishes. The sample header is Reference's.                                                                                                                                                                                                                                            |
| Import events              | An import writes `contact.import_started` / `contact.import_completed` only. Per-contact `contact.created` / group / tag events are emitted when the request sets `triggerAutomations: true`; Reference never triggered flows from an import and the default keeps that.                                                                                                                                                                                                                                                                                                             |
| Contact list paging        | Cursor pagination (any `limit` 1-1000, default 50) replaces page numbers and the 12/50/100/500/1000 whitelist; `includeTotal=true` adds `meta.total`. Sorting stays newest first. `expand=groups,tags` adds the row chips.                                                                                                                                                                                                                                                                                                                                                        |
| Search                     | Every whitespace-separated word must match name, first/last name, email or phone (ILIKE, trigram-indexed), and a numeric word also matches the digits of the phone. TW-CON-002 #2 changes: `acme x` now matches `x@acme.io`. `%` and `_` are literal.                                                                                                                                                                                                                                                                                                                             |
| Legacy NULL-workspace rows | Not ported (the table is tenant-scoped by `org_id`). The page gate is the capability, not a hard-coded role.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Stats                      | `GET /contacts/stats` (total, groups, subscribed, unsubscribed, noGroup, grouped, imported) is workspace-wide, inside the caller's record scope, archived excluded like the list.                                                                                                                                                                                                                                                                                                                                                                                                 |
| Detach                     | Detaching a tag the contact does not carry is a quiet 204; a tag id that does not exist in the workspace is 404 (Reference answered ok for any id).                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Picker rate limit          | The 120 requests/minute throttle on the attribute feed is not applied (no throttler in the API yet); `GET /attributes/picker` is cheap and cached by the client.                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Not done in this slice

| Item                                                                                                                                  | Why                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TW-CON-041 starter tags for new workspaces                                                                                            | Provisioning lives in `modules/auth` (`TenantDirectory.provisionOrganization`); it needs one call to `TagsService.findOrCreateByName` for the six names. Tags created that way count against the plan tag limit.                         |
| TW-CON-050 attribute feeds for the Node bridge, mobile app and extension                                                              | Belong to the node-bridge / mobile / extension domains; they should read `AttributesRepository.listActive` / the field registry.                                                                                                         |
| TW-CON-052, 053 webhooks and flow triggers                                                                                            | The events they need are emitted (`contact.created`, `contact.updated`, `contact.group_added`, `contact.tag_added`, `contact.opted_in` is not emitted: consent has no write path yet); the consumers belong to the INTG and FLW domains. |
| TW-CON-014 avatar upload, TW-CON-017 consent UI/endpoint, TW-CON-018 contact 360, TW-CON-055 auto-capture, TW-CON-056..064 public API | Out of this scope (other tracks); the quota service and the canonicaliser are what they should call.                                                                                                                                     |
| Per-type validation of attribute values on contacts                                                                                   | `contacts.data` stays free-form (the contact PATCH merges `customFields`); only the definitions are typed.                                                                                                                               |
| Background export for very large workspaces                                                                                           | Export streams in batches of 2,000 up to 200,000 rows per call; above that the caller narrows the filter.                                                                                                                                |
| A stuck-job recovery sweep for `con-import`                                                                                           | BullMQ retries and stalled-job handling cover a dead worker; no separate sweeper.                                                                                                                                                        |

### Port decision: Lifecycle stage and Status are linked (not in Reference)

Reference keeps `status` (a free label on the contact) and the lifecycle stage as two independent values with no relationship, and so did this port until now:
"Quote sent" could sit on a contact that was New or Lost. The owner asked whether they should be linked. Decision: **a light, optional link**, nothing more.

- **Model.** Stage = where the person is in the sales journey. Status = a sub-state inside the stage, or a state outside the journey (Do not contact). A status option may be
  scoped to one stage (`status_options.stage_option_id`, composite FK `(org_id, stage_option_id)` to a `lifecycle_stage` option of the same workspace, migration
  `20261009090000_status_option_stage_scope`); no scope = valid in every stage, which is every existing status, so a workspace that never scopes one behaves exactly as before.
- **Default per stage.** `is_default` on a scoped status is that stage's default status (at most one per stage, the database enforces it; the group's unscoped default is separate).
- **Rules on a contact (create, update, bulk update).** A stage change keeps a status that is still valid for the new stage; otherwise (or when there is none) the new stage's
  default status is applied, else the status is cleared. A status set explicitly that belongs to another stage is 422 `CON_STATUS_STAGE_MISMATCH` naming the stage. A status sent
  unchanged is not re-validated. Won and lost stages need no special case: they are stages that can have a default (for example Lost -> Not interested). The rule is one pure function
  shared by API and web (`@crm/contracts` `status-stage.ts`), so the contact form, the inline stage menu ("Status becomes X" under each stage) and the toast after the move
  ("Stage changed to Lost. Status reset to Not interested.") say what the server will do.
- **Deliberate limits.** Only statuses are scoped (not stages, not lost reasons, not deal statuses); a scope change is not retro-applied to contacts that hold the status (they are
  fixed the next time their stage changes); import and the public/partner APIs do not validate a status against a stage; deleting a stage keeps its statuses as "all stages".
- **Web.** Contact stages > Statuses: each status shows its scope ("All stages" or the stage), the edit dialog has an "Applies to" select and "Default status of this stage"; the
  contact form lists only the statuses valid for the chosen stage and resets the status field when the stage changes; both tabs carry a short explanation of stage vs status.

## Coverage

```json threadwise-coverage
{
  "routes": [
    "GET contacts",
    "POST contacts",
    "PUT contacts/{id}",
    "DELETE contacts/{id}",
    "GET contacts/{id}",
    "GET contacts/{id}/tags",
    "POST contacts/{id}/tags",
    "DELETE contacts/{id}/tags/{tagId}",
    "POST contacts/bulk-delete",
    "POST contacts/bulk-export",
    "POST contacts/bulk-group",
    "POST contacts/bulk-tag",
    "POST contacts/dedupe",
    "POST contacts/import",
    "POST contacts/import-preview",
    "GET contacts/sample-csv",
    "GET contact-groups",
    "POST contact-groups",
    "PUT contact-groups/{id}",
    "DELETE contact-groups/{id}",
    "GET attributes",
    "POST attributes",
    "GET attributes/api/list",
    "PUT attributes/{id}",
    "DELETE attributes/{id}",
    "GET api/v1/contacts",
    "POST api/v1/contacts",
    "GET api/v1/contacts/{id}",
    "PUT api/v1/contacts/{id}",
    "DELETE api/v1/contacts/{id}",
    "GET api/v1/contact-groups",
    "POST api/v1/contact-groups",
    "DELETE api/v1/contact-groups/{id}",
    "GET api/workspace-attributes/{workspaceId}"
  ],
  "controllers": [
    "app/Http/Controllers/ContactsController.php",
    "app/Http/Controllers/AttributesController.php",
    "app/Http/Controllers/Api/V1/ContactController.php",
    "app/Http/Controllers/Api/V1/ContactGroupController.php"
  ],
  "services": ["app/Services/AttributeResolver.php", "app/Services/SendAttributes.php"],
  "models": ["Contact", "ContactGroup", "Attribute", "Tag", "ContactCustomField"],
  "tables": [
    "contacts",
    "contact_groups",
    "contact_tag",
    "tags",
    "attributes",
    "contact_custom_fields"
  ],
  "views": [
    "resources/views/user/contacts/index.blade.php",
    "resources/views/user/contacts/show.blade.php",
    "resources/views/user/attributes/index.blade.php",
    "resources/views/user/attributes/_rows.blade.php"
  ],
  "commands": [],
  "permissions": [],
  "middleware": [
    "app/Http/Middleware/AuthenticateApiKey.php",
    "app/Http/Middleware/ApiPlanRateLimit.php",
    "app/Http/Middleware/EnsureWorkspaceRole.php"
  ],
  "node_files": [],
  "js_assets": [
    "resources/js/charts/user-contacts-index.js",
    "resources/js/attribute-picker.js",
    "resources/js/list-grid-toggle.js"
  ],
  "misc_files": [
    "app/Http/Resources/Api/V1/ContactResource.php",
    "app/Http/Resources/Api/V1/ContactGroupResource.php",
    "app/Http/Requests/Api/V1/Contact/StoreContactRequest.php",
    "app/Http/Requests/Api/V1/Contact/UpdateContactRequest.php",
    "app/Http/Requests/Api/V1/Group/StoreContactGroupRequest.php"
  ],
  "config_files": [],
  "doc_pages": [
    "Documentation/pages/growth/contacts.html",
    "Documentation/pages/growth/attributes.html",
    "Documentation/pages/developer-guide/rest-api.html"
  ],
  "feature_map": {
    "TW-CON-001": ["GET contacts", "GET contact-groups"],
    "TW-CON-009": ["POST contacts"],
    "TW-CON-010": ["PUT contacts/{id}"],
    "TW-CON-011": ["DELETE contacts/{id}"],
    "TW-CON-018": ["GET contacts/{id}"],
    "TW-CON-020": ["POST contacts/bulk-delete"],
    "TW-CON-021": ["POST contacts/bulk-export"],
    "TW-CON-023": ["POST contacts/bulk-group"],
    "TW-CON-024": ["POST contacts/bulk-tag"],
    "TW-CON-025": ["POST contacts/dedupe"],
    "TW-CON-027": ["POST contacts/import"],
    "TW-CON-031": ["POST contacts/import-preview"],
    "TW-CON-032": ["GET contacts/sample-csv"],
    "TW-CON-034": ["POST contact-groups"],
    "TW-CON-035": ["PUT contact-groups/{id}"],
    "TW-CON-036": ["DELETE contact-groups/{id}"],
    "TW-CON-038": ["GET contacts/{id}/tags"],
    "TW-CON-039": ["POST contacts/{id}/tags"],
    "TW-CON-040": ["DELETE contacts/{id}/tags/{tagId}"],
    "TW-CON-042": ["GET attributes"],
    "TW-CON-043": ["POST attributes"],
    "TW-CON-044": ["PUT attributes/{id}"],
    "TW-CON-045": ["DELETE attributes/{id}"],
    "TW-CON-046": ["GET attributes/api/list"],
    "TW-CON-050": ["GET api/workspace-attributes/{workspaceId}"],
    "TW-CON-057": ["GET api/v1/contacts"],
    "TW-CON-058": ["GET api/v1/contacts/{id}"],
    "TW-CON-059": ["POST api/v1/contacts"],
    "TW-CON-060": ["PUT api/v1/contacts/{id}"],
    "TW-CON-061": ["DELETE api/v1/contacts/{id}"],
    "TW-CON-062": ["GET api/v1/contact-groups"],
    "TW-CON-063": ["POST api/v1/contact-groups"],
    "TW-CON-064": ["DELETE api/v1/contact-groups/{id}"]
  }
}
```

## Follow-ups closed: stage flags, required properties

| What                        | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Won / lost lifecycle stages | `status_options.is_won` / `is_lost` (mutually exclusive by a CHECK; the API accepts them on contacts' `lifecycle_stage` group only, else 422 `STATUS_OPTION_FLAG_INVALID`) and `contacts.won_at` / `lost_at`. Entering a won stage stamps `won_at`, a lost stage stamps `lost_at` and needs `lostReason` (a `lost_reason` option) or `otherLostReason` (422 `CON_LOST_REASON_REQUIRED`), leaving clears the stamps and the reasons. Nothing is flagged by the migration; a new workspace seeded from the platform stages gets `enrolled` as won and `lost` as lost. The web app asks for the reason in a dialog when a stage menu moves a contact to a lost stage and inline in the edit form.                                                                                                                                                                                                   |
| One default stage per group | A partial unique index (`uq_status_options_one_default`); the migration keeps the lowest-id default where a group had two.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Required properties         | Enforced on `POST /contacts` and on a `PATCH /contacts/:id` that carries `customFields` (422 `CON_REQUIRED_PROPERTY_MISSING`, one `customFields.<key>` entry per property), honouring "show only when" dependencies. Skipped: system, inactive, hidden and read-only properties, formulas and checkboxes. A stage or owner change alone is not held to the rules, so contacts that predate a newly required property stay editable; bulk edit may only not blank what it sets. **Bulk update of custom properties** (product extension, TW-CON-019): the Update dialog of the selection bar can set or clear any active custom property on every selected contact (`values.customFields`, `null` clears; unknown or inactive key is 422 `CON_PROPERTY_NOT_EDITABLE`, a value of the wrong type is 422 `VALIDATION_FAILED`, nothing written). CSV import is unchanged (it does not enforce them). |
