# Wiring map: forms-builder (FORMS)

**Not a WaDesk feature.** The owner asked for a paid first-party Marketplace app that builds, hosts and embeds web forms and lands every
submission in the CRM (2026-10-05, backlog BL-093). WaDesk has no web form builder and no public form URL: its "forms" are WhatsApp Flows forms
(`wa_forms`, `wa_form_submissions`, plan feature `forms_and_links`, inventory domain `forms-links-groups`, owner Vedant) and are **not touched**. The
names are different on purpose (`web_forms*`, `form_builder`, `/f/<key>`). There is no inventory page, so this file is the inventory and the wiring
map in one. Spec: [forms-builder-app.md](../../specs/forms-builder-app.md). API and rules: [docs/api/forms-builder.md](../../api/forms-builder.md).
Deviations (this is a new feature, so "intended" means "differs from the spec"): [product-extensions.md](../parity/product-extensions.md), "Forms".
Built so far: **v0.9 = phases 0 and 1, backend only** (the web builder, the hosted page and the embed are a UI agent's).

## Route, permission, plan

| Id             | What                | Where                                                                                                                                                                                                                                                                                          |
| -------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-FORMS-001 | Admin API           | `/v2/forms` (templates, `meta/properties`, list, create, get, patch, delete, publish, pause, resume, archive, duplicate, rotate-key, versions, restore) in `forms.controller.ts`                                                                                                               |
| WIRE-FORMS-002 | Submissions API     | `/v2/forms/:id/submissions` (list, get, retry, delete, `export`) in `form-submissions.controller.ts`                                                                                                                                                                                           |
| WIRE-FORMS-003 | Public form         | `GET /v2/public/forms/:publicKey`, `POST .../events`, `POST .../submit` in `public-forms.controller.ts` (`@Public`, the key is the only identifier); the loader `GET /form-embed/:publicKey/embed.js` (`FormEmbedController`, version neutral)                                                 |
| WIRE-FORMS-004 | Preflight           | `FormsPreflightMiddleware`, mounted in `forms-builder.module.ts` and, ahead of the API-wide CORS, in `main.ts`                                                                                                                                                                                 |
| WIRE-FORMS-005 | Permission keys     | `record.forms.read\|create\|update\|delete`, `record.form-submissions.read\|update\|delete\|export` (migration `20261031100100`), tagged `permission_defs.plan_feature = 'form_builder'`; Owner and Admin by the trigger, existing Manager and Agent presets by the migration                  |
| WIRE-FORMS-006 | Plan gate           | `@RequirePlanFeature('form_builder')` on both admin controllers; plan limit `forms` on create, duplicate and resume-from-archive (`FormsPlan`); public routes answer 404 when the feature is off (`FormLookupService`)                                                                         |
| WIRE-FORMS-007 | Marketplace listing | app `forms` (draft, `paid_monthly`, price unset, `grants_plan_features: ['form_builder']`, `grandfather_existing: false`) and version `1.0.0` (migration `20261031100200`); scopes `forms.read`, `forms.write` in `marketplace/scopes.ts`                                                      |
| WIRE-FORMS-008 | Web                 | not built (a UI agent): `Forms` menu entry (`gates: { permission: 'record.forms.read', app: 'form_builder' }`, Campaigns group, D7), `/forms`, `/forms/[id]`, `/forms/[id]/submissions`, `/f/[publicKey]`, Settings tile, help guides, `LIMIT_UNITS` keys, plan feature labels in the messages |

## Tables

`web_forms`, `web_form_versions`, `web_form_submissions`, `web_form_events` (monthly-partitioned stream), `web_form_usage_monthly` (migration
`20261031100000_forms_core.sql`, Drizzle in `packages/db/src/schema/forms-builder/`), `idx_companies_domain` (`20261031100300`).
`web_form_lookup(public_key)` is a SECURITY DEFINER function: ids, a status and the embed allow-list, nothing for an archived form, called by the
public routes only. Referenced by: `web_form_submissions.contact_id`, `.company_id`, `.deal_id` (composite foreign keys; a deleted contact, company
or deal clears the link, a deleted form deletes its versions, submissions and events). Written by this domain in other domains' tables: `contacts`
(create through `ContactsService.resolveOrCreateByIdentity`, fill blanks through `ContactsRepository.updateFieldsById`; subscription status on a
ticked marketing box), `contact_identities` (`addIdentity`), `contact_tags` and `tags` (`TagsRepository`), `companies` (new
`CompaniesService.resolveForSubmission`, `CompaniesRepository.findByDomainOrName` and `fillBlanks`), `contact_attributions` (platform `form`),
`contact_activities` (`form_submission`), `inbox_notifications` (the worker consumer). `audit_log` rows with `module` `web_forms`,
`web_form_submissions` (including the new action `read`), `contacts`, `companies`; `event_outbox` rows `form.*`.

## Writers of a form-originated contact

| Id             | Writer                                                      | Where                                                                                                                                     |
| -------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-FORMS-009 | A visitor's submission (hosted page, embed, a script)       | `FormSubmitService.submit` (one transaction; the only writer of a form-originated contact)                                                |
| WIRE-FORMS-010 | A staff retry of a held submission, "not spam"              | `POST /forms/:id/submissions/:sid/retry` -> `FormSubmitService.reprocess` (the caller's own request context, so the audit rows name them) |
| WIRE-FORMS-011 | Nothing else: not an import, not a flow, not the public API | the lead pipeline (`LeadIngestService`) is a different door and is unchanged                                                              |

## Consumers

| Id             | Consumer                                                                                                                                | Where                                                                                                                                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-FORMS-012 | Notifications `form_submission` and `form_needs_review` (in-app, deduplicated) and the notification email to the listed addresses       | `FormNotificationConsumer` in `FormsBuilderWorkerModule` (worker only), reads `form.submitted` and `form.needs_review`; the web notification copy needs the two new types (the title and body are stored, so a generic render works)                  |
| WIRE-FORMS-013 | Flows and automations: `contact.created` carries `origin: 'form'`, `formId`, `submissionId`; `contact.opt_in` on a ticked marketing box | the flow runtime's `contact_created` and `contact_opt_in` triggers (unchanged; `contact.opt_in` was already read)                                                                                                                                     |
| WIRE-FORMS-014 | Answer retention and analytics-event retention                                                                                          | `FormRetentionSweepService` in `FormsBuilderWorkerModule`, daily 03:17                                                                                                                                                                                |
| WIRE-FORMS-015 | Plan editor: the feature and the three limits                                                                                           | `PLAN_FEATURE_DEFS` / `PLAN_LIMIT_DEFS` / `PLAN_FEATURE_LABELS` / `PLAN_CHIP_ORDER` (`catalogue.ts`), `METERS` in `plan-usage.service.ts`; `LIMIT_UNITS` in `apps/web/.../plan-editor-view.ts` and the labels in the messages are **the web agent's** |
| WIRE-FORMS-016 | Contact quota and tag quota                                                                                                             | `ContactQuotaService` through `resolveOrCreateByIdentity` (a new contact at the cap is `needs_review`); the `tags` limit (the tag is skipped)                                                                                                         |
| WIRE-FORMS-017 | Security headers                                                                                                                        | `FRAMEABLE` in `modules/auth/middleware-security-headers.ts` lists `form-embed`; the web app must answer `frame-ancestors` per form for `/f/*` from `PublicForm.frameAncestors`                                                                       |
| WIRE-FORMS-018 | Body-size class                                                                                                                         | `public-form` (256 KiB) in `platform-infrastructure/body-limits/body-limits.ts`, number `FORM_SUBMIT_MAX_BODY_BYTES` in the contracts                                                                                                                 |
| WIRE-FORMS-019 | CAPTCHA                                                                                                                                 | `CaptchaService` gained the action `'form'` and `publicConfig()` (version and the PUBLIC site key; the secret never leaves the settings service)                                                                                                      |
| WIRE-FORMS-020 | Audit                                                                                                                                   | `AuditInput.action` gained `'read'` (opening a submission's answers)                                                                                                                                                                                  |

## Upstream feeders and what is shared

- The Companies domain gained a small, tx-aware surface (WIRE-FORMS table above) and exports `CompaniesService`, `CompaniesRepository` and
  `normaliseCompanyDomain` from `modules/crm/index.ts`; the Contacts barrel exports `missingRequired`, `requiredPropertiesError` and `isBlank`. The
  leads barrel exports `coerceCustomValue`, `normaliseLeadEmail` and `pickOwner`, so a web form and a lead source coerce, dedupe and rotate the same way
  (the spec's "shared leaf"; the leads module keeps its behaviour).
- Settings: none yet. The per-workspace defaults of the spec (`/forms/settings`, `forms.settings.manage`) are not built.

## Not built, recorded

| Id            | What                                                                                                                                                      | Phase                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| FORMS-BLK-001 | Deal mapping, pipeline and stage, deal custom fields (Deals domain), the task for the owner                                                               | spec phase 2                          |
| FORMS-BLK-002 | Payments (`FRM-` settler, `web_form_payments`, amount types, tax, pay-return, mark paid), invoice and receipt                                             | spec phase 3 (needs PR #88 on `main`) |
| FORMS-BLK-003 | AI builder (text and browser voice), `ai_form_generations_monthly` enforcement                                                                            | spec phase 2                          |
| FORMS-BLK-004 | Conditional logic, multi-step, analytics endpoint and screen, outbound webhook delivery                                                                   | spec phase 2                          |
| FORMS-BLK-005 | Files, double opt-in, submitter confirmation, server-side transcription                                                                                   | spec phase 4                          |
| FORMS-BLK-006 | Workspace defaults (`GET/PUT /forms/settings`, `forms.settings.manage`: CAPTCHA, retention, notification defaults)                                        | with the Settings tile (phase 1 web)  |
| FORMS-BLK-007 | `seed:forms` dev script: DONE (apps/api/src/modules/marketplace/cli/seed-forms.ts, docs/runbooks/dev-seed-marketplace-apps.md)                            | after PR #89                          |
| FORMS-BLK-008 | Web: builder, design tab, share tab, submissions screen, hosted page `/f/<key>` and its embed mode, menu entry and Settings tile, help guides, Playwright | the UI lane                           |
| FORMS-BLK-009 | Async CSV export for very large sets (v0.9 exports up to 10,000 rows synchronously)                                                                       | later                                 |
