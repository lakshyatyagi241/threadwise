# Wiring map: companies (CTP)

Scope of this map: the company entity, everything that writes a company or a company link, and every screen or endpoint that reads one.
Inventory: [companies.md](../inventory/companies.md). API: [docs/api/companies.md](../../api/companies.md).

## Route, permission, plan

| Id           | What            | Where                                                                                                                                                                                           |
| ------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-CTP-001 | Web routes      | `/companies`, `/companies/[id]` in `apps/web/src/app/(app)/(companies)`; menu entry `features/companies/nav.ts` (order 70, CRM group)                                                           |
| WIRE-CTP-002 | API routes      | `apps/api/src/modules/crm/companies/companies.controller.ts` (registered in `crm.module.ts`)                                                                                                    |
| WIRE-CTP-003 | Permission keys | `record.companies.read/create/update/delete` (0008, labels `20261019090100`); a contact link also needs `record.contacts.update`; the rollup needs `record.contacts.read` / `record.deals.read` |
| WIRE-CTP-004 | Plan gate       | `SalesPipelineGuard` on every route; menu gate `planFeature: sales_pipeline` (paywall sheet and lock)                                                                                           |
| WIRE-CTP-005 | Default grants  | Owner/Admin/Manager: every key (`provision_workspace_presets`); Agent: `workspace_preset_baseline` rows (read all, create all, update own); dev seed Counsellor                                 |

## Tables

`companies` (this domain). Referenced by: `contacts.company_id`, `deals.company_id`, `tasks.company_id`, `projects.company_id`, `sales_docs.company_id`, `invoices.company_id`, `recurring_invoices.company_id`, `sales_orders.company_id`, `payments.company_id`: each a composite foreign key `(org_id, company_id)` with `ON DELETE SET NULL (company_id)`. Written by this domain: `contacts.company_id` (link and unlink). `audit_log` rows with `module = companies`; `event_outbox` rows `company.*`.

## Writers of a company

| Id           | Writer                                                                          | Where                                                  |
| ------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------ |
| WIRE-CTP-006 | New / edit modal on `/companies` and the page                                   | `POST /companies`, `PATCH /companies/:id`              |
| WIRE-CTP-007 | Delete (page, row button, bulk bar)                                             | `DELETE /companies/:id`, `POST /companies/bulk/delete` |
| WIRE-CTP-008 | AI copilot (`create_company`, `link_contact_company`)                           | not built (AI domain); calls `CompaniesService`        |
| WIRE-CTP-009 | Nothing else: no import, no flow, no public API, no shop sync creates companies | Reference has none either                                 |

## Writers of a company link

| Id           | Link                                      | Writer                                                                                                                                                                                     |
| ------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WIRE-CTP-010 | `contacts.company_id`                     | `POST /companies/:id/contacts`, `DELETE /companies/:id/contacts/:contactId` (company page); `POST/PATCH /contacts` with `companyId` (API only: Reference's contact form has no company field) |
| WIRE-CTP-011 | `deals.company_id`                        | `POST/PATCH /deals` with `companyId`; a deal inherits its contact's company (deals domain, TW-DEAL-038)                                                                                    |
| WIRE-CTP-012 | `tasks.company_id`                        | `POST/PATCH /tasks`, `PUT /tasks/:id/links`; a task created from a deal inherits the deal's company                                                                                        |
| WIRE-CTP-013 | `projects`, proposals, invoices, payments | their own domains (not built or not wired to a company picker yet); the foreign keys already unlink on delete                                                                              |

## Consumers of a company

| Id           | Consumer                                                                  | Where                                                                                                                            |
| ------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-CTP-014 | Companies list, tiles, picker                                             | `GET /companies`, `/stats`, `/industries`, `/select-data`                                                                        |
| WIRE-CTP-015 | Company page: contacts, deals, activity                                   | `GET /companies/:id`, `/:id/contacts`, `/:id/activity`; `GET /deals?companyId=`                                                  |
| WIRE-CTP-016 | Contact page: company link in the header                                  | `features/contacts-attributes-tags/components/contact-detail.tsx` -> `<CompanyLink id={companyId}>` (reads `GET /companies/:id`) |
| WIRE-CTP-017 | Deal drawer: company line                                                 | `features/deals-pipelines/components/deal-drawer.tsx` -> `<CompanyLink>` (the deal carries `company: {id, name}`)                |
| WIRE-CTP-018 | Task rows and the task API                                                | `company: {id, name}` on every task (tasks domain); filter `GET /tasks?companyId=`                                               |
| WIRE-CTP-019 | Deal list filter                                                          | `GET /deals?companyId=`                                                                                                          |
| WIRE-CTP-020 | Sales docs, invoices, payments                                            | `companyId` on their own screens/contracts (their domains)                                                                       |
| WIRE-CTP-021 | Client brief (company subject)                                            | not built (CRM dashboard domain); the company page does not show "Generate brief" until it exists                                |
| WIRE-CTP-022 | AI copilot tools `find_company`, `create_company`, `link_contact_company` | not built (AI domain)                                                                                                            |
| WIRE-CTP-023 | Notifications, flows, webhooks                                            | outbox events `company.created/updated/deleted/contact_linked/contact_unlinked`; no consumer yet                                 |

## Settings

None. Reference has no company settings screen and no company limit in the plan; the plan flag is `access_sales_pipeline` (`sales_pipeline` here). The platform's property registry
accepts `moduleKey = companies` (`record.company-properties.*`), but no company properties screen exists and `custom_attributes` is not exposed.

## Gaps recorded (not lost)

- "Generate brief" (WIRE-CTP-021) and the AI tools (WIRE-CTP-022) are `blocked` on their domains.
- A company picker on the contact and deal forms, a company's tasks card, and the Tasks hub's company filter are follow-ups (inventory "Not built here").
