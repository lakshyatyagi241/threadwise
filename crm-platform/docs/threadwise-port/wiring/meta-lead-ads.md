# Wiring map: meta-lead-ads (MLA)

An owner-requested extension, not a Reference port: Reference has no lead-ads ingestion. The spec is
[email-channel-and-social-leads.md](../../specs/email-channel-and-social-leads.md) (L-06; backlog BL-011, BL-064), so this file is the inventory and
the wiring map in one. API and rules: [docs/api/meta-lead-ads.md](../../api/meta-lead-ads.md); operator setup:
[docs/runbooks/meta-lead-ads-setup.md](../../runbooks/meta-lead-ads-setup.md). It is a door of the lead pipeline ([leads.md](leads.md)) built on the
Facebook channel's connected Pages ([channel-facebook.md](channel-facebook.md)). Deviations: [product-extensions.md](../parity/product-extensions.md),
"Meta lead ads".

## Route, permission, plan

| Id           | What                | Where                                                                                                                                                                                                                 |
| ------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-MLA-001 | Management API      | `/v2/meta-lead-ads` (overview, `connect/start`, `pages/:id/enable`, `disable`, `forms`, `forms/:formId/connect`, `DELETE forms/:formId`, `sources/:id/health`) in `modules/meta-lead-ads/meta-lead-ads.controller.ts` |
| WIRE-MLA-002 | Permission keys     | none new: `leads.sources.read` / `leads.sources.manage` (migration `20261020090100`); `connect/start` also needs `fb.pages.manage` (checked in the service)                                                           |
| WIRE-MLA-003 | Plan gate           | `@RequirePlanFeature('lead_sources', 'extra_channels')` on the controller; the form pick counts toward the `lead_sources` limit through the source directory                                                          |
| WIRE-MLA-004 | The leadgen webhook | the Facebook channel's `POST /v2/facebook/webhook` (signature, ack), `InboundService.queueLead`, `readLeadgen` in `channel-facebook/event-rules.ts`                                                                   |
| WIRE-MLA-005 | Web                 | the Ads tab of `/lead-sources` (`features/lead-sources`): the Meta lead forms card and panel, the form picker, the mapping and rules dialogs, the health card on a source                                             |
| WIRE-MLA-006 | Login (re-consent)  | `PagesService.startLogin({ extraScopes, rerequest, returnTo })` and `FacebookPublicController.callback` redirect to `/lead-sources?tab=ads` (sealed `returnTo`)                                                       |

## Tables

`meta_lead_pages`, `meta_lead_forms` (this domain; migration `20261219090000_mla_meta_lead_ads.sql`, Drizzle in `packages/db/src/schema/meta-lead-ads/`).
Read here from other domains: `facebook_pages` (Page row, scopes, sealed token: through the channel's `PagesRepository`), `lead_sources` (uuid and
status of a form's source, a read-only join in `MetaLeadAdsRepository`). Written by this domain in other domains' tables: none directly; the lead
pipeline writes `lead_sources` (through `LEAD_SOURCE_DIRECTORY`), `lead_events`, `contacts`, `contact_attributions`, `contact_consent_events`,
`deals` (through `LEAD_INGEST`). `meta_lead_forms.source_id` has a composite foreign key to `lead_sources` (ON DELETE CASCADE); `meta_lead_pages.page_id`
has no foreign key to `facebook_pages` on purpose (see the migration and `PageDisconnectConsumer`).

## Queues, jobs and schedules

| Id           | What                                                               | Where                                                                                                       |
| ------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| WIRE-MLA-007 | Queue `meta-leadgen`: one job per workspace and lead               | produced by the Facebook channel; consumed by `LeadgenProcessor` in `MetaLeadAdsWorkerModule` (worker only) |
| WIRE-MLA-008 | Queue `meta-lead-sweep`: one job per Page, queued every 10 minutes | `LeadSweepService` (cron) and `LeadSweepProcessor`, worker only                                             |
| WIRE-MLA-009 | Outbox consumer `facebook.page.disconnected`                       | `PageDisconnectConsumer` (worker only): releases the sources of the Page's forms, removes the rows          |

## Upstream feeders and consumers

- **Feeders:** the Facebook channel's connected Page (sealed token, scopes from the token check at connect, `status`), the Meta app settings
  (`FACEBOOK_GRAPH.settings`), the lead pipeline's ports (`LEAD_INGEST` with `settled`, `LEAD_SOURCE_DIRECTORY` with `kind`).
- **Consumers:** everything downstream of the lead pipeline ([leads.md](leads.md) WIRE-LEAD-011 to 016): the `new_lead` notification, `contact.created`
  for flows (`origin: lead`, `via: Facebook` or `Instagram`), the deals `lead_ad` source, the contact's attribution card, consent ledger grants
  (source `lead`), plan quotas.
- **Audit and outbox:** audit modules `meta_lead_pages`, `meta_lead_forms`; events `meta_lead_ads.page.enabled`, `.page.disabled`,
  `.form.connected`, `.form.disconnected`.
- **Shared change in the Facebook channel:** `PageApi.subscribeWebhooks` keeps `leadgen` for a Page that has it (Meta replaces the whole field list on
  a subscribe); `ChannelFacebookModule` exports `FACEBOOK_GRAPH`; the barrel exports `FacebookPagesService`, `FacebookPagesRepository`.
- **Settings:** none in the workspace; no operator-console switch (the Meta app is the Facebook channel's). No environment variable was added.

## Not built, recorded

| Id           | What                                                                                                                                                  | Status                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| WIRE-MLA-010 | Backfill of leads from before a form was picked and a "sync now" button (L-18)                                                                        | BL-204                 |
| WIRE-MLA-011 | A real call to Meta from this build: first run with the approved app and the Lead Ads Testing Tool                                                    | BL-205; runbook step 5 |
| WIRE-MLA-012 | Meta ids as columns of `contact_attributions` (campaign, ad set, ad, form ids), campaign and ad name enrichment for a lead that arrives without names | BL-206                 |
| WIRE-MLA-013 | Live browser verification of the new Ads tab (390 px, RTL, dark)                                                                                      | BL-207                 |
