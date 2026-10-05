---
domain: companies
code: CTP
title: Companies (the B2B layer over contacts and deals)
wadesk_version: '1.7.0'
sources_read: 24
---

# Companies (the B2B layer over contacts and deals)

## Overview

"Company / Organization CRM (Phase 1)" groups contacts and deals under one business, so a workspace sees "ACME has 3 contacts, 2 open
deals and 50k won" in one place. A company has a name, an email, a phone, a website, an industry, a size range, an address and notes.
`contacts.company_id` and `deals.company_id` point at it; so do `tasks`, `projects`, `sales_docs` and `payments` (all untyped
integers, no foreign keys).

The `/companies` page lists the workspace's companies (name, industry, contacts, open deals, won value), has three tiles (companies,
with open deals, won revenue), one search box and a "New company" modal. A row opens the company page: the name and contact line, three
rollup tiles, the company's contacts and its deals side by side, the notes, a "Generate brief" button and a Delete button. Deleting
keeps the contacts and deals and unlinks them.

It is gated by the same plan flag as deals and tasks (`access_sales_pipeline`); there is no permission key and no role check. Every
member of the workspace who can open the area sees and edits every company. The menu entry carries `tier: admin` (a menu, not a gate).
Platform admins bypass the plan gate. `name`, `email` and `phone` are encrypted at rest, which is why the list is searched in PHP over
the newest 500 rows.

WaDesk has **no way to put a contact under a company from the web**: the contact forms have no company field and the CSV import has no
company column. The only writer of `contacts.company_id` is the AI copilot tool `link_contact_company`; the only writer of
`deals.company_id` is nothing at all (WD-DEAL-038). The Companies page can therefore show a company with no contacts unless an AI chat
linked them. There is no company properties screen either: `custom_attributes` is cast but nothing reads or writes it.

Connections: `contacts-attributes-tags` (`contacts.company_id`, the contact page's company link), `deals-pipelines` (`deals.company_id`,
WD-DEAL-038), `tasks` (WD-TASK-008), the AI CRM copilot (`CrmToolkit` company tools), the client brief (`BriefService`, not built),
projects, proposals and estimates, invoices and payments (each carries a `company_id`), `workspaces-teams-tenancy` (workspace
scoping, members), `roles-permissions` (record scope), `plans-subscriptions-trials` (the `access_sales_pipeline` flag).

## Feature index

| Id         | Feature                                            | Status        | Priority | Effort | Depends on  |
| ---------- | -------------------------------------------------- | ------------- | -------- | ------ | ----------- |
| WD-CTP-001 | Plan gate (no role gate)                           | implemented   | P0       | S      |             |
| WD-CTP-002 | Companies list: search, tiles, rollups             | implemented   | P0       | M      | 001         |
| WD-CTP-003 | Create company                                     | implemented   | P0       | S      | 001         |
| WD-CTP-004 | Update company                                     | partial       | P1       | S      | 003         |
| WD-CTP-005 | Company page (360): contacts, deals, rollup, notes | implemented   | P0       | M      | 002         |
| WD-CTP-006 | Contacts of a company: link and unlink             | partial       | P1       | M      | 005         |
| WD-CTP-007 | Company activity trail                             | not in WaDesk | P2       | S      | 003         |
| WD-CTP-008 | Delete company (contacts and deals are unlinked)   | implemented   | P0       | S      | 003         |
| WD-CTP-009 | Picker search endpoint (`GET companies/search`)    | implemented   | P1       | S      | 001         |
| WD-CTP-010 | Deals of a company (`deals.company_id`)            | partial       | P1       | S      | WD-DEAL-038 |
| WD-CTP-011 | AI copilot company tools                           | implemented   | P2       | S      | 003, 006    |
| WD-CTP-012 | Client brief for a company ("Generate brief")      | implemented   | P2       | M      | 005         |
| WD-CTP-013 | Other records that point at a company              | partial       | P1       | S      | 008         |

## Features

### WD-CTP-001 — Plan gate (no role gate)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** none
- **Summary:** every companies route sits behind the `plan:access_sales_pipeline` middleware, nothing else.
- **Actors & access:** any member of the workspace on a plan with the flag; platform admins bypass. No role middleware, no permission key.
  The class comment calls it "Workspace-scoped"; the controller reads the caller's `current_workspace_id` and filters on it.
- **Endpoints:**

| METHOD uri            | route name             | Controller@action           | middleware                       | request                                                           | response                                 |
| --------------------- | ---------------------- | --------------------------- | -------------------------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| GET companies         | user.companies.index   | CompaniesController@index   | auth, plan:access_sales_pipeline | `q`                                                               | Blade page                               |
| GET companies/search  | user.companies.search  | CompaniesController@search  | same                             | `q`                                                               | `{success, data:[{id,name,industry}]}`   |
| POST companies        | user.companies.store   | CompaniesController@store   | same                             | name, email, phone, website, industry, size_range, address, notes | JSON `{success,id,name}` or redirect     |
| GET companies/{id}    | user.companies.show    | CompaniesController@show    | same                             | none                                                              | Blade page                               |
| PATCH companies/{id}  | user.companies.update  | CompaniesController@update  | same                             | any of the create fields                                          | JSON `{success,id}` or redirect back     |
| DELETE companies/{id} | user.companies.destroy | CompaniesController@destroy | same                             | none                                                              | JSON `{success}` or redirect to the list |

- **Acceptance criteria:**
  - Given a plan without the flag, When any companies route is called, Then access is refused.
  - Given a member of a plan with the flag, When they call any companies route, Then it works whatever their role.
- **Source refs:** routes/web.php:1448-1458, app/Http/Controllers/CompaniesController.php:1-25, resources/views/components/user/header.blade.php:118.
- **Port notes:** reuse `SalesPipelineGuard` (`features.sales_pipeline`); replace "any member" with permission keys (D-02).

### WD-CTP-002 — Companies list: search, tiles, rollups

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-CTP-001
- **Summary:** one page with a header, three tiles, a search box and a table of the workspace's companies.
- **UX & screens:** `resources/views/user/companies/index.blade.php`. Header: "CRM · Organizations", "Companies", a one-line description, "New company"
  button. Tiles: Companies, With open deals, Won revenue (two decimals). Search: a GET form with one text box, placeholder "Search companies…", no
  submit button (Enter submits). Table columns: Company (bold, the whole row opens `/companies/{id}`), Industry ("—" when empty), Contacts, Open deals,
  Won value (right aligned, monospace, two decimals), and a delete button per row (confirm "Delete this company? Its contacts and deals are kept and
  just unlinked."). Empty: "No companies yet. Create your first one."
- **Data:** the 500 newest companies of the workspace (`latest('id')`), each with its contact count and deal count; then, in two grouped queries over
  those ids, the open-deal count and the sum of `value_minor` of won deals.
- **Rules & edge cases:**
  1. QUIRK: the cap is 500 and the search runs **after** it, in PHP, as a case-insensitive substring of the name only (the name is encrypted, so SQL
     cannot search it). A workspace with more than 500 companies cannot find or even list the older ones.
  2. QUIRK: the tiles are computed from the rows after the search: "Companies" is the number of rows shown, "With open deals" the rows with at least one
     open deal, "Won revenue" the sum of the won values of those rows. Typing a search changes the tiles.
  3. QUIRK: the won value is the sum of `value_minor` over all currencies divided by 100, printed with two decimals and no currency, whatever the
     currency of each deal (a JPY deal of 1000 reads as 10.00).
  4. The withCount of deals is loaded and never shown; "Open deals" counts `status = open`.
  5. No sort control, no pagination, no filters other than the box. Order is newest first.
  6. The page is server-rendered; a delete is a form post with a browser `confirm`, then a redirect and the flash "Company deleted."
- **Acceptance criteria:**
  - Given three companies, When the page loads, Then they are listed newest first with their contact count, open-deal count and won value.
  - Given a search "acm", When the page loads, Then only companies whose name contains it (any case) are listed and the tiles follow.
  - Given a company with an open deal and a won deal of 40, Then "With open deals" counts it and its Won value reads 40.00.
- **Source refs:** CompaniesController.php:26-65, resources/views/user/companies/index.blade.php, resources/js/charts/user-companies-index.js.
- **Port notes:** DB-side search and cursor paging (D-04, D-05); tiles from a stats endpoint with the same filter; value per currency (D-06).

### WD-CTP-003 — Create company

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-CTP-001
- **UX & screens:** the "New company" modal (index page): Company name \*, Industry, Website, Email, Phone, Notes, Cancel, Create. Create posts JSON and
  opens `/companies/{id}`; a failure is a browser `alert` with the server message. Size range and address exist in the API but not in the modal.
- **Rules & edge cases:**
  1. `name` required, string, max 191. `email` nullable, an email address, max 191. `phone` nullable, max 32 (free text). `website` nullable, max 191
     (free text, no URL check). `industry` max 100. `size_range` max 40. `address` max 500. `notes` max 2000.
  2. Input is trimmed and an empty string becomes null (the framework's input middleware), so a whitespace-only name is "required" and fails.
  3. `workspace_id` is the current workspace, `user_id` the caller (the creator). `owner_user_id` is never set.
  4. Duplicate names are allowed: there is no uniqueness check.
  5. No audit row, no event, no notification, no plan limit on the number of companies.
  6. The modal does nothing when the name is blank; the button is disabled while the request runs.
- **Acceptance criteria:**
  - Given a name only, When created, Then the company exists with every other field empty and the browser opens its page.
  - Given a 192-character name, Then it is refused. Given an email "nope", Then it is refused.
  - Given two creates with the same name, Then both exist.
- **Source refs:** CompaniesController.php:100-121, resources/views/user/companies/index.blade.php:91-115, user-companies-index.js:29-56.

### WD-CTP-004 — Update company

- **Status:** partial (route and controller exist, no UI)
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CTP-003
- **Rules & edge cases:** `PATCH companies/{id}` takes any of the create fields; the name is `sometimes|required` (absent keeps, an explicit empty or null
  name fails); every other field is nullable, so an empty string clears it. Nothing in the UI calls it: the company page has no edit form. A company of
  another workspace is 404. Last write wins (no version), no audit, no event.
- **Acceptance criteria:**
  - Given a company, When PATCHed with a new phone, Then only the phone changes.
  - Given `name: ""`, Then it is refused; given `industry: ""`, Then the industry is cleared.
- **Source refs:** CompaniesController.php:123-142.
- **Port notes:** a real edit form and `rowVersion` (D-07).

### WD-CTP-005 — Company page (360): contacts, deals, rollup, notes

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-CTP-002
- **UX & screens:** `resources/views/user/companies/show.blade.php`. Back link "All companies". Header: the name, then industry, website (a link whose `href`
  is `#`, so it goes nowhere), email, phone. Buttons: "Generate brief" (WD-CTP-012) and Delete (same confirm as the list). Three tiles: Contacts, Open deals,
  Won revenue. Two cards: Contacts (name, or "(no name)", and the phone; each a link to `/contacts/{id}`) and Deals (title, a chip with the stage name
  coloured by status, the value with two decimals and no currency; each links to `/deals`, not to the deal). Empty: "No contacts linked to this company.",
  "No deals for this company.". A Notes card when there are notes (line breaks kept).
- **Data:** the company (workspace-checked, 404 otherwise); up to 200 contacts (newest first by id) with their canonical phone; up to 200 deals, open first
  then newest; the stage names of the workspace.
- **Rules & edge cases:**
  1. QUIRK: the Contacts tile is the number of contacts **loaded** (at most 200) and Open deals the open ones among the (at most 200) deals loaded; only the
     Won revenue is a full sum.
  2. QUIRK: size range and address are stored and never shown.
  3. QUIRK: the contact rows link to `/contacts/{id}`, whose page 500s in WaDesk (WD-CON-018); the port's contact page works.
  4. The page shows nothing for the owner (`owner_user_id` is never written).
- **Acceptance criteria:**
  - Given a company with two contacts and an open and a won deal, When the page loads, Then both lists show and the tiles read 2, 1 and the won value.
  - Given a company of another workspace, When its id is requested, Then the answer is 404.
- **Source refs:** CompaniesController.php:67-98, Company.php:34-55, resources/views/user/companies/show.blade.php.

### WD-CTP-006 — Contacts of a company: link and unlink

- **Status:** partial (no web path; only the AI copilot links)
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CTP-005
- **Rules & edge cases:** `contacts.company_id` is a nullable integer with an index and no foreign key. The contact create/edit forms and the CSV import never
  set it. The AI tool `link_contact_company` finds or creates a company by name (case-insensitive over all of the workspace's companies, in PHP) and sets it on
  a contact it resolves from a phone number. A contact has at most one company. There is no unlink except deleting the company (WD-CTP-008).
- **Acceptance criteria:**
  - Given a contact, When the AI links it to "Acme", Then the company exists once and the contact's page shows the link.
- **Source refs:** CrmToolkit.php:655-682, Contact.php:73-77, ContactsController.php:387-389.
- **Port notes:** link and unlink endpoints on the company and a picker on its page (D-09); no change to the contact forms.

### WD-CTP-007 — Company activity trail

- **Status:** not in WaDesk (port addition: WaDesk keeps no history of a company)
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CTP-003
- **Summary:** WaDesk writes no audit row, no event and no notification for any company change. The port records them (D-12).
- **Acceptance criteria:**
  - Given a company edited twice, When its activity is read, Then both edits show, newest first, with who and what changed.

### WD-CTP-008 — Delete company (contacts and deals are unlinked)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-CTP-003
- **Rules & edge cases:**
  1. `DELETE companies/{id}` (a form post with `_method`, after a browser confirm) sets `company_id = null` on the workspace's contacts and deals that point
     at the company, then deletes it. No transaction, no audit, no event.
  2. Tasks (`related_type = company`), projects, proposals and estimates, payments and invoices that point at it keep the dangling id (no foreign keys):
     the task board then labels them with a lookup that finds nothing.
  3. Hard delete. A company of another workspace is 404. Deleting twice is 404 the second time.
- **Acceptance criteria:**
  - Given a company with contacts and deals, When it is deleted, Then the company is gone and every contact and deal is still there with no company.
- **Source refs:** CompaniesController.php:144-157.

### WD-CTP-009 — Picker search endpoint (`GET companies/search`)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CTP-001
- **Rules & edge cases:** JSON `{success, data:[{id,name,industry}]}`: the newest 500 companies, filtered in PHP by a case-insensitive substring of the name,
  at most 20 returned. Documented as "for pickers / the AI copilot"; no screen of WaDesk calls it.
- **Acceptance criteria:**
  - Given 25 companies, When searched with no text, Then 20 come back, newest first.
- **Source refs:** CompaniesController.php:159-172.

### WD-CTP-010 — Deals of a company (`deals.company_id`)

- **Status:** partial (the column is read, nothing writes it)
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-DEAL-038
- **Rules & edge cases:** the company page and list read the deals by `company_id`; no deal form, API route, flow or AI tool sets it, so in a stock
  WaDesk every company shows no deals unless data was seeded. See WD-DEAL-038 for the rule and the port decision (deals take `companyId` and inherit
  their contact's company).
- **Acceptance criteria:**
  - Given a deal linked to a company, Then the company's page and list count it.
- **Source refs:** Deal.php:154-157, CompaniesController.php:39-54, 74-82.

### WD-CTP-011 — AI copilot company tools

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CTP-003, WD-CTP-006
- **Rules & edge cases:** `find_company` (a substring of the name over the newest 300, at most 10 with contact and open-deal counts), `create_company`
  (name required, optional industry, website, email, phone; creator = the caller), `link_contact_company` (WD-CTP-006). The tools run as the staff member.
- **Source refs:** app/Services/AiCrm/CrmToolkit.php:108, 614-682.
- **Port notes:** owned by the AI domain; it calls `CompaniesService`.

### WD-CTP-012 — Client brief for a company ("Generate brief")

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-CTP-005
- **Rules & edge cases:** the company page's "Generate brief" posts `subject_type=company` to `crm/briefs`, which builds a shareable deck (the company, its
  contact count, open deals and value, won value, up to 6 recent deals) and opens it in a new tab. The brief feature (`BriefsController`, `BriefService`,
  `crm_briefs`) belongs to the CRM dashboard domain.
- **Source refs:** resources/views/user/companies/show.blade.php:28-38, app/Services/Crm/BriefService.php:60-127.
- **Port notes:** blocked on the briefs feature; the button is not shown until it exists.

### WD-CTP-013 — Other records that point at a company

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CTP-008
- **Rules & edge cases:** `tasks.related_type = company` (label via an unscoped `Company::find`), `projects.company_id` (the project form's company select
  lists the workspace's first 500 companies), `sales_docs.company_id`, `payments.company_id`, invoices (in `meta`). None has a foreign key, so a delete
  leaves them dangling (WD-CTP-008 #2). The mobile API's contact has a free-text `company` string that is not this entity. The contact CSV import and the
  contact forms have no company field.
- **Source refs:** Task.php:62-79, ProjectsController.php:45-73, migrations 2026_08_22_000100 / 000400 / 000500.

## Data model

### companies (WaDesk MySQL, `2026_08_22_000000_create_companies_table`)

`id`, `workspace_id` (indexed, NOT NULL), `user_id` null (creator), `owner_user_id` null (never written), `name` text (encrypted), `email` text null
(encrypted), `phone` text null (encrypted), `website` varchar null, `industry` varchar null, `size_range` varchar null, `address` text null, `notes` text
null, `custom_attributes` json null (cast to array, never read or written), `created_at`, `updated_at`. Index `(workspace_id, created_at)`. No foreign
keys, no uniqueness, no soft delete. The same migration adds `contacts.company_id` and `deals.company_id` (nullable bigint, indexed, no foreign key).

### Our table (migrations 0004, 20261001103900, 20261019090000, 20261019090200, 20261019090300)

`org_id` + `id` (composite primary key), `uuid`, `name` NOT NULL (CHECK not blank, at most 191), `domain` (WaDesk's `website`), `email` citext, `phone`,
`industry`, `size_range`, `address`, `notes` (each with a length CHECK), `owner_id` and `created_by` (composite foreign keys to `users`, SET NULL),
`display_id` (`COM-00001`), `data` (WaDesk's `custom_attributes`; not exposed), `lifecycle_state`, `status`, `is_archived` (platform columns, unused here),
`row_version`, `created_at`, `updated_at`. Forced RLS with `tenant_isolation` (USING and WITH CHECK), the `touch_row` trigger, indexes on
`(org_id, created_at desc, id desc)`, `(org_id, lower(name), id)`, owner, creator and a trigram index on `name`. Every table that points at companies
(contacts, deals, tasks, projects, sales docs, invoices, payments, recurring invoices, sales orders) has a composite foreign key with
`ON DELETE SET NULL (company_id)`; `contacts` also has an index on `(org_id, company_id)`. Drizzle mirror in `packages/db/src/schema/crm.ts`.

## Cross-domain contracts

- **Consumes** `contacts-attributes-tags`: contacts (`company_id`, record scope on the contact list and on link/unlink, the contact's own audit trail),
  `deals-pipelines`: deals (`company_id`, the `GET /deals?companyId=` list on the company page, rollup figures), `workspaces-teams-tenancy`: members (the
  owner), teams (record scope `team`), `roles-permissions`: the capability keys and the preset baseline, `plans-subscriptions-trials`: the `sales_pipeline` flag.
- **Exposes** to contacts, deals, tasks, projects, proposals, invoices and payments: `companies.uuid` as the thing their `companyId` resolves; to pickers
  and other screens: `GET /companies/select-data`; to the contact page and the deal drawer: `<CompanyLink>` in `apps/web/src/features/companies`; to the
  AI, flows and public API: `CompaniesService` (`create`, `get`, `list`); to notifications and automations: the outbox events `company.created`,
  `company.updated`, `company.deleted`, `company.contact_linked`, `company.contact_unlinked`.

## Open questions & quirks

- No role gate; the controller comment and the menu say "admin" but nothing enforces it.
- The list is capped at 500 and searched after the cap (WD-CTP-002 #1); the tiles follow the search (#2); won value mixes currencies (#3).
- `custom_attributes` and `owner_user_id` are fillable and never used; size range and address are stored and never shown.
- The website link is a dead `#`.
- Nothing in the web UI links a contact or a deal to a company (WD-CTP-006, 010); only the AI copilot writes `contacts.company_id`.
- A delete leaves tasks, projects, proposals, payments and invoices dangling (WD-CTP-008 #2).
- `GET companies/search` has no caller in the UI (WD-CTP-009).
- The contact 360 page that the company page links to returns 500 (WD-CON-018).

## Differences to decide

| Id   | WaDesk behavior                                                                      | Recommendation for the port                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 | Plan gate on the routes only, nothing else                                           | `PLAN_FEATURE_LOCKED` on every route, reads included (the same `SalesPipelineGuard` as deals and tasks)                                                                 |
| D-02 | No permission keys: any member does anything                                         | `record.companies.read/create/update/delete` with a record scope (own = owned or created by me, team, all); Owner/Admin/Manager all, Agent read/create all and edit own |
| D-03 | `name`, `email`, `phone` encrypted at rest                                           | Plain columns (the same as contacts): the database searches and sorts them, and RLS isolates the tenant                                                                 |
| D-04 | 500 newest rows, searched in PHP after the cap                                       | Database search (case-insensitive substring of the name, `%` and `_` literal, trigram index), cursor paging, no cap                                                     |
| D-05 | Tiles and rollups from the loaded rows; contacts capped at 200                       | Exact counts in SQL; the tiles come from `GET /companies/stats` with the list's own filters; the lists page by cursor                                                   |
| D-06 | Won value = sum of minor units of every currency / 100, printed with no currency     | Per currency, never added together, in the currency's own decimals, with the currency shown; a caller who may not read deals gets no figure (`null`), not a zero        |
| D-07 | PATCH without a version, no edit UI                                                  | An edit form; `rowVersion` on update (409 `ROW_VERSION_CONFLICT`); a no-op edit writes nothing                                                                          |
| D-08 | Free-text website, dead link                                                         | The field stays free text (not validated); the page links it only when it is a plain http(s) address (a bare domain gets https), otherwise it is plain text             |
| D-09 | Nothing in the web links a contact to a company                                      | `POST /companies/:id/contacts` (existing contacts, partial failures listed) and `DELETE /companies/:id/contacts/:contactId`, with an "Add contacts" picker on the page  |
| D-10 | `owner_user_id` never set                                                            | An optional owner (an active member; omitted on create means the caller, `null` nobody), editable; it is part of the record scope with the creator                      |
| D-11 | Delete unlinks contacts and deals by hand, leaves everything else dangling, no audit | Hard delete, audited with what it unlinked, `company.deleted` event; every referencing table unlinks through its foreign key (SET NULL)                                 |
| D-12 | No history of changes                                                                | Audit rows and outbox events for create, edit, link, unlink, delete; `GET /companies/:id/activity` reads them                                                           |
| D-13 | `GET companies/search` (JSON for pickers)                                            | `GET /companies/select-data` (up to 20, newest first, by a substring of the name), the same shape as the contacts picker                                                |
| D-14 | "Generate brief" on the company page                                                 | Not shown until the client brief exists (blocked, WD-CTP-012)                                                                                                           |
| D-15 | Contacts listed from every record, whatever the viewer may see                       | The contact list of a company applies the caller's contact scope; link and unlink need `record.contacts.update` on each contact                                         |
| D-16 | Deals link to `/deals`, values with no currency                                      | Each deal links to its own page; the value carries its currency; open deals first, then newest (cursor paging)                                                          |
| D-17 | Duplicate names allowed                                                              | Kept: companies are not unique by name (two branches can share one)                                                                                                     |
| D-18 | No company properties screen, `custom_attributes` unused                             | Not exposed: the platform's property registry already supports `moduleKey = companies`, but WaDesk has nothing to port; a company properties screen is a follow-up      |

## Coverage

```json wadesk-coverage
{
  "routes": [
    "GET companies",
    "GET companies/search",
    "POST companies",
    "GET companies/{id}",
    "PATCH companies/{id}",
    "DELETE companies/{id}"
  ],
  "controllers": ["app/Http/Controllers/CompaniesController.php"],
  "services": [],
  "models": ["Company"],
  "tables": ["companies"],
  "views": [
    "resources/views/user/companies/index.blade.php",
    "resources/views/user/companies/show.blade.php"
  ],
  "commands": [],
  "permissions": [],
  "middleware": [],
  "js_assets": ["resources/js/charts/user-companies-index.js"],
  "misc_files": [],
  "feature_map": {
    "WD-CTP-001": ["GET companies"],
    "WD-CTP-003": ["POST companies"],
    "WD-CTP-004": ["PATCH companies/{id}"],
    "WD-CTP-005": ["GET companies/{id}"],
    "WD-CTP-008": ["DELETE companies/{id}"],
    "WD-CTP-009": ["GET companies/search"]
  }
}
```

## Port decisions

Recorded by the port of companies. The default was to **keep intended behaviour and fix clear bugs**; every place the port differs from WaDesk
is listed here with the "Differences to decide" row it settles. Code: `apps/api/src/modules/crm/companies`, contracts in
`packages/contracts/src/companies/`, migrations `20261019090000..090300_company_*`, endpoints in `docs/api/companies.md`, tests in
`apps/api/test/{unit,integration,e2e}/companies` and `apps/web/src/features/companies`.

### Decided as recommended

| Diff # | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Where           |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| D-01   | Every route is behind `SalesPipelineGuard` (`422 PLAN_FEATURE_LOCKED`, reads included). There is no company-count limit (WaDesk has none).                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | WD-CTP-001      |
| D-02   | `record.companies.read/create/update/delete` (the keys 0008 seeded for the generic CRM, labels refreshed by `20261019090100`). Scope is on the PEOPLE of the company: `own` = owned by me or created by me, `team` adds teammates, `all` is the workspace; an out-of-scope company is 404, never 403. Owner and Admin and Manager hold all four; the Agent preset gets read and create at `all` and update at `own` through the new `workspace_preset_baseline` rows (companies are shared accounts, so an Agent must see them all to pick one; deleting is a Manager right); the dev seed's Counsellor the same. | WD-CTP-001      |
| D-03   | `name`, `email` and `phone` are plain columns, with length CHECKs (191, 191, 32); a trigram index serves the name search.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | WD-CTP-002      |
| D-04   | `GET /companies`: `q` (substring of the name, `%` `_` literal), `ownerId`, `unassigned`, `industry`, `hasOpenDeals`, `sort` (`created` newest first, `name` A to Z), cursor over `(created_at, id)` or `(lower(name), id)` with the sort inside the cursor, `limit` up to 200. No row cap.                                                                                                                                                                                                                                                                                                                        | WD-CTP-002      |
| D-05   | Every company comes with its `rollup`: linked non-archived contacts, and deals `{total, open, won, openValue[], wonValue[]}`. `GET /companies/stats` returns the three tiles for the same filters and scope. `GET /companies/industries` feeds the industry filter.                                                                                                                                                                                                                                                                                                                                               | WD-CTP-002, 005 |
| D-06   | Money is per currency (`[{currency, amount}]`, decimal strings, the currency's own exponent, never added across currencies). `rollup.contacts` and `rollup.deals` are `null` for a caller without `record.contacts.read` / `record.deals.read`.                                                                                                                                                                                                                                                                                                                                                                   | WD-CTP-002, 005 |
| D-07   | `PATCH` requires `rowVersion`; absent keeps, `null` or an empty string clears (the name cannot be cleared); an edit that changes nothing writes no audit row and no event.                                                                                                                                                                                                                                                                                                                                                                                                                                        | WD-CTP-004      |
| D-08   | The website stays free text (max 191). The page links it only through `websiteHref`: a bare domain gets `https://`, `javascript:`, `data:` and any non-http(s) value is plain text.                                                                                                                                                                                                                                                                                                                                                                                                                               | WD-CTP-005      |
| D-09   | `POST /companies/:id/contacts {contactIds}` (1 to 100; a contact of another company moves; each in its own savepoint; failures listed) and `DELETE /companies/:id/contacts/:contactId`. Both need `record.companies.update` and `record.contacts.update` on each contact (its scope applies). The contact gets its own audit row (`companyId` change, visible in its field history) and `contact.updated`; each company involved gets `contactLinked` / `contactUnlinked`.                                                                                                                                        | WD-CTP-006      |
| D-10   | `ownerId`: omitted on create is the caller, `null` nobody, anything else must be an ACTIVE member (`422 COMPANY_OWNER_INVALID`). `createdBy` is recorded.                                                                                                                                                                                                                                                                                                                                                                                                                                                         | WD-CTP-003, 004 |
| D-11   | Hard delete, audited (`name`, how many contacts and deals it unlinked), `company.deleted` with the counts. Bulk delete (`POST /companies/bulk/delete`, 1 to 100 ids, per-id failures listed). Contacts, deals, tasks, projects, proposals, invoices and payments are unlinked by their composite foreign keys.                                                                                                                                                                                                                                                                                                    | WD-CTP-008, 013 |
| D-12   | Create, edit, link, unlink and delete write an audit row in the same transaction and an outbox event (`company.created`, `.updated`, `.deleted`, `.contact_linked`, `.contact_unlinked`). `GET /companies/:id/activity` folds the audit rows (actor, time, field by field, contacts by name).                                                                                                                                                                                                                                                                                                                     | WD-CTP-007      |
| D-13   | `GET /companies/select-data?q&limit` (default 20, at most 100), rows `{id, name, industry}`, newest first, inside the caller's scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | WD-CTP-009      |
| D-14   | The "Generate brief" button is not built nor shown (blocked on WD-CTP-012).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | WD-CTP-012      |
| D-15   | `GET /companies/:id/contacts` applies the caller's contact scope (and needs `record.contacts.read`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | WD-CTP-005      |
| D-16   | The company page lists deals through the deals API (`GET /deals?companyId=`), open first within the loaded page, each linking to its own page, with its currency.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | WD-CTP-005, 010 |
| D-17   | Duplicate names stay allowed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | WD-CTP-003      |
| D-18   | `custom_attributes` (`data`) is not exposed: WaDesk never wrote or read it and has no company properties screen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | WD-CTP-013      |

### Other decisions

| Decision                                                                                                                                                                                                                               | Where      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Ids on the wire, in audit rows and in events are uuids; the audit trail names owners and contacts by uuid and the activity read resolves them to names.                                                                                | all        |
| `GET /companies/:id/contacts` lists non-archived contacts only (the contacts list does the same), newest first by id like WaDesk, so a contact archived in the contacts screen leaves the company's list and count together.           | WD-CTP-005 |
| The search matches the name only, as WaDesk's did. Matching the website, email or industry too is possible later; it was left out so the search box means what it did.                                                                 | WD-CTP-002 |
| A migration cannot clear the permission cache: on a running environment the Agent's new grants appear when the 10-minute grant cache expires (or after flushing the `rbac:*` Redis keys), as with deals and tasks.                     | rbac       |
| `companies.name` is NOT NULL and length-checked now; the migration repairs older rows first (trim, cut to length, a missing name filled from the website or `Company <id>`), so it also runs on a database that already has companies. | schema     |

### Not built here (follow-ups)

| What                                                                                          | Why / where it goes                                                                                            |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| "Generate brief" (WD-CTP-012)                                                                 | The client brief feature is not built (CRM dashboard domain).                                                  |
| AI copilot company tools (WD-CTP-011)                                                         | Owned by the AI domain; it calls `CompaniesService`.                                                           |
| A company's tasks card on its page                                                            | `GET /tasks?companyId=` exists; the Tasks hub needs a company filter and the linked-tasks card a company kind. |
| A company picker on the contact and deal forms                                                | The APIs take `companyId`; WaDesk's forms have no company field, so it is an extension left for later.         |
| A company properties screen (the platform's registry already accepts `moduleKey = companies`) | WaDesk has none (D-18).                                                                                        |
| Companies in the contacts CSV import                                                          | WaDesk's import has no company column.                                                                         |
| Company export, merge and duplicate detection                                                 | Not in WaDesk.                                                                                                 |

### Build status (tracker vocabulary)

`tracker.py` cannot hold these rows: the `companies` domain id is not in `ownership.json` (the CRM domains deals, tasks and contacts have no tracker
rows either, and `tracker.py validate` already reports 258 problems), so the status is kept here until the ownership file names the domain. Nothing is
`verified`: the twin run against the reference was not done (see [the parity file](../parity/companies.md)).

| Feature    | Status        | Note                                                                                             |
| ---------- | ------------- | ------------------------------------------------------------------------------------------------ |
| WD-CTP-001 | frontend-done | plan gate and permissions on every route; the menu entry replaced the planned "Soon" item        |
| WD-CTP-002 | frontend-done | list, search, filters, sort, cursor paging, tiles, rollups                                       |
| WD-CTP-003 | frontend-done | create modal (WaDesk's fields + More details)                                                    |
| WD-CTP-004 | frontend-done | edit form and `rowVersion`                                                                       |
| WD-CTP-005 | frontend-done | company page: tiles, contacts, deals, notes, details                                             |
| WD-CTP-006 | frontend-done | add and remove contacts from the company page                                                    |
| WD-CTP-007 | frontend-done | activity card from the audit trail (port addition)                                               |
| WD-CTP-008 | frontend-done | delete, bulk delete, every referencing table unlinks                                             |
| WD-CTP-009 | backend-done  | `GET /companies/select-data`; no screen uses it yet                                              |
| WD-CTP-010 | frontend-done | deals card through `GET /deals?companyId=`; deal creation and inheritance are the deals domain's |
| WD-CTP-011 | blocked       | AI domain; waits for its copilot to call `CompaniesService`                                      |
| WD-CTP-012 | blocked       | the client brief feature is not built; the button is not shown                                   |
| WD-CTP-013 | backend-done  | foreign keys unlink on delete; the other domains' company pickers are theirs                     |
