# Wiring map: leads (LEAD)

An owner-requested extension, not a WaDesk port: WaDesk's incoming webhook (`IncomingWebhookController`, `/hooks/in/{token}`) is the behavioural
reference, the spec is [email-channel-and-social-leads.md](../../specs/email-channel-and-social-leads.md) (L-01 to L-12). There is no WaDesk
inventory page for it, so this file is the inventory and the wiring map in one. API and rules: [docs/api/leads.md](../../api/leads.md). Deviations
from the reference: [product-extensions.md](../parity/product-extensions.md), "Lead sources".

## Route, permission, plan

| Id            | What            | Where                                                                                                                                                                        |
| ------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-LEAD-001 | Public door     | `POST /v2/public/lead-hooks/:token` in `apps/api/src/modules/leads/lead-hooks.controller.ts` (`@Public`, token is the credential)                                            |
| WIRE-LEAD-002 | Management API  | `/v2/lead-sources` (list, create, get, patch, delete, `rotate-token`, `mapping-preview`, `test`, `events`, `events/:id`, `events/:id/retry`) in `lead-sources.controller.ts` |
| WIRE-LEAD-003 | Contact detail  | `GET /v2/contacts/:id/attribution` in `contact-attribution.controller.ts` (gated by `record.contacts.read` and the contact's record scope)                                   |
| WIRE-LEAD-004 | Permission keys | `leads.sources.read`, `leads.sources.manage` (migration `20261020090100`); Owner and Admin presets only, by the trigger on `permission_defs`                                 |
| WIRE-LEAD-005 | Plan gate       | `@RequirePlanFeature('lead_sources')` on the management controller; plan limit `lead_sources` on create (`LeadsPlan`); the public door answers 404 when the feature is off   |
| WIRE-LEAD-006 | Web             | not built (a UI agent follows): a "Social leads" Settings tile (`/lead-sources`, spec 5.6), the contact detail's attribution card, the deals filter value `lead_ad`          |

## Tables

`lead_sources`, `lead_events`, `contact_attributions` (this domain; migration `20261020090000_lead_sources.sql`, Drizzle in
`packages/db/src/schema/leads/`). `lead_source_lookup(token_hash)` is a SECURITY DEFINER function returning ids and a status, called by the public
door only. `chk_deals_source` gained `lead_ad` (`20261020090200_lead_deal_source.sql`). Referenced by: `lead_events.contact_id`, `.deal_id`,
`contact_attributions.contact_id` (composite foreign keys; a deleted contact or deal clears the link, a deleted contact deletes its attribution).
Written by this domain in other domains' tables: `contacts` (create through `ContactsService.resolveOrCreateByIdentity`, fill blanks through
`ContactsRepository.updateFieldsById`), `contact_identities` (`addIdentity`), `contact_tags` and `tags` (`TagsRepository`), `deals`
(`DealsService.create(..., 'lead_ad')`), `inbox_notifications` (the worker consumer, `NotificationsRepository.insertOnce`). `audit_log` rows with
`module` `lead_sources`, `lead_events`, `contacts`; `event_outbox` rows `lead_source.*` and `lead.*`.

## Writers of a lead-originated contact

| Id            | Writer                                                                                    | Where                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| WIRE-LEAD-007 | The generic webhook (JSON or form body)                                                   | `LeadHooksService.receive` -> `LeadIngestService.process`                                                               |
| WIRE-LEAD-008 | An admin's test lead and a retry of a stored lead                                         | `POST /lead-sources/:id/test`, `.../events/:id/retry` -> `LeadIngestService.process` / `.run`                           |
| WIRE-LEAD-009 | Marketplace connectors (IndiaMART, JustDial, ...) and the Meta, TikTok and LinkedIn doors | not built; they inject `LEAD_INGEST` and import only `lead-ingest.port.ts` (and `lead-source-directory.port.ts`)        |
| WIRE-LEAD-010 | Nothing else: no import, no flow, no public API writes a contact as a lead                | `POST /public/v1/leads` (API key + HMAC) is a separate door and does not record a lead event or attribution (unchanged) |

## Consumers

| Id            | Consumer                                                                                                                                | Where                                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-LEAD-011 | Notification `new_lead` (owner and extra users, deduplicated on the lead event)                                                         | `LeadNotificationConsumer` in `LeadsWorkerModule` (worker only), reads `lead.created` and `lead.updated`; new `NOTIFICATION_TYPES` value    |
| WIRE-LEAD-012 | Flows and automations: `contact.created` carries `leadSource`, `leadSourceId`, `campaign`, `origin: "lead"`, `via` (the platform label) | the flow runtime's `contact_created` trigger (unchanged); a test lead emits none                                                            |
| WIRE-LEAD-013 | Deals list and board: the `lead_ad` source value                                                                                        | `DEAL_SOURCES`, `chk_deals_source`; the web filter and message `sources.lead_ad` (added)                                                    |
| WIRE-LEAD-014 | Payload retention                                                                                                                       | `LeadRetentionSweepService` in `LeadsWorkerModule`, hourly                                                                                  |
| WIRE-LEAD-015 | Plan editor: the feature and limit `lead_sources`                                                                                       | `PLAN_FEATURE_DEFS` / `PLAN_LIMIT_DEFS` (labels in `apps/web/messages/*/plans-subscriptions-trials.json` and the two auth plan files)       |
| WIRE-LEAD-016 | Contact quota and tag quota                                                                                                             | `ContactQuotaService` through `resolveOrCreateByIdentity` (a lead at the cap is `needs_review`); the `tags` limit (the lead tag is skipped) |

## Upstream feeders and what is shared

- `ContactsService.resolveOrCreateByIdentity` gained three optional inputs, used only by this domain: `lifecycleStage` (a created contact's start
  stage), `ownerId` and `eventPayload` (extra keys of `contact.created`). Callers that pass none behave exactly as before.
- `CrmModule` now exports `TagsRepository`, and `modules/crm/index.ts` exports `assertContactScope` (the record-scope check of the contact
  sub-resources), so a sub-resource in another module can enforce the same scope.
- Settings: none. A workspace configures a source; the operator console has nothing to switch for a webhook (the Meta, TikTok and LinkedIn
  credentials arrive with those doors).

## Not built, recorded

| Id            | What                                                                                                 | Status                                               |
| ------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| WIRE-LEAD-017 | Meta lead ads door, reconciliation sweep, re-consent (L-06)                                          | blocked on the Facebook module and Meta app review   |
| WIRE-LEAD-018 | TikTok and LinkedIn doors (L-13, L-14), Google Ads template (L-15)                                   | blocked on partner approval                          |
| WIRE-LEAD-019 | Speed-to-lead first message (L-16), backfill and "sync now" (L-18), Zapier and Make templates (L-19) | later phases                                         |
| WIRE-LEAD-020 | WaDesk's per-hook flow enrolment, template send and forward URL                                      | integrations domain (the ported `incoming_webhooks`) |
| WIRE-LEAD-021 | The web screens (WIRE-LEAD-006)                                                                      | the UI agent                                         |
