# API: Meta lead ads (Facebook and Instagram lead forms)

A product extension: Reference has no lead-ads ingestion (see `docs/threadwise-port/parity/product-extensions.md`, "Meta lead ads"). Spec:
[docs/specs/email-channel-and-social-leads.md](../specs/email-channel-and-social-leads.md) L-06 (BL-011, BL-064). Base path `/v2`. Errors are
`application/problem+json` with a stable `code` and a `requestId`; the codes this adds are `MLA_*` in `@crm/contracts`
(`meta-lead-ads/errors.ts`). Request and response shapes live in `packages/contracts/src/meta-lead-ads/`. Every id on the wire is a uuid except
Meta's own ids (`pageId`, `formId`), which are Meta's strings. Operator setup and how to test with the approved Meta app:
[runbooks/meta-lead-ads-setup.md](../runbooks/meta-lead-ads-setup.md). Wiring: [wiring/meta-lead-ads.md](../threadwise-port/wiring/meta-lead-ads.md).

**One pipeline, one more door.** A lead from a Meta lead form ends in the same pipeline as every other door (`LeadIngestService`, see
[leads.md](leads.md)): stored under its idempotency key, mapped, deduplicated, attributed, assigned, optionally given a deal, notified. This
module only brings the lead to the door: it connects a Page, subscribes it to the `leadgen` webhook field, fetches each lead from Meta, and
re-reads recent leads so a missed webhook never loses one.

## How a lead gets in

```
Facebook Page ──(admin: Grant lead access, Turn on lead sync)──> Page subscribed to `leadgen`
lead form submitted at Meta
   │  POST /v2/facebook/webhook   (the Facebook channel's door: X-Hub-Signature-256 with the app secret, acked at once)
   ▼
queue `meta-leadgen`  ── one job per workspace and lead (job id leadgen-<org>-<leadgen_id>)
   ▼  worker: LeadgenService.handleWebhook
fetch the lead from Meta (GET /<leadgen_id>) ── map field_data ── LEAD_INGEST.ingest(source of the form)
                                                                    └─ idempotent on (source, leadgen_id)
every 10 minutes: LeadSweepService ── queue `meta-lead-sweep` (one job per Page) ── LeadgenService.sweepPage
   re-reads each picked form's leads since its checkpoint and ingests those the pipeline does not already hold
```

- **The webhook is the Facebook channel's.** Meta has one callback URL per app for the `Page` object, so `leadgen` events arrive at
  `POST /v2/facebook/webhook` with the messages and comments. `GET /v2/facebook/webhook` is the handshake (the verify token). The signature
  is checked against the app secret before anything is read (a bad signature is 403, nothing is queued). The channel finds the workspace(s)
  that connected the Page (`fb_page_lookup`, the narrow SECURITY DEFINER function) and queues one job per workspace; it fetches nothing.
- **Idempotent three ways.** The queue job id dedupes Meta's redeliveries; the pipeline's unique key `(source, leadgen_id)` makes any second
  delivery (a retry, the sweep) `duplicate`; and the sweep asks the pipeline which leads it already holds (`LeadIngestPort.settled`) before
  ingesting, so re-reading a window does not count every lead as a duplicate delivery.
- **No lead from a form that was not picked** and none while lead sync is off or the form's source is paused (the worker drops the event
  before any call to Meta; a paused form is caught up by the sweep after it is resumed, within the 80 day lookback).

## Capabilities and plan

| Key                    | Grants                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `leads.sources.read`   | the overview (Pages, lead access, sync state) and a form source's health                                                              |
| `leads.sources.manage` | turn lead sync on or off, list a Page's forms from Meta, pick or stop a form, start the lead-access login                             |
| `fb.pages.manage`      | also needed for the lead-access login (`POST /connect/start`): it stores Page tokens, which the Facebook channel guards with this key |

No new permission keys. The routes need BOTH plan features `lead_sources` (the pipeline) and `extra_channels` (Facebook); picking a form counts
toward the plan limit `lead_sources` (422 `PLAN_LIMIT_REACHED`).

## Routes

| Method | Path                                             | Permission                                 | Answer                                                                                                         |
| ------ | ------------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| GET    | `/meta-lead-ads`                                 | `leads.sources.read`                       | `configured`, `webhookUrl`, `verifyTokenConfigured`, `requiredScopes`, and every connected Page with its state |
| POST   | `/meta-lead-ads/connect/start`                   | `leads.sources.manage` + `fb.pages.manage` | `{ url }`: the Facebook login (asks again for the lead permissions); the callback is the Facebook channel's    |
| POST   | `/meta-lead-ads/pages/:id/enable`                | `leads.sources.manage`                     | the Page with `sync.state` `subscribed`                                                                        |
| POST   | `/meta-lead-ads/pages/:id/disable`               | `leads.sources.manage`                     | the Page with `sync.state` `off`                                                                               |
| GET    | `/meta-lead-ads/pages/:id/forms`                 | `leads.sources.manage`                     | the Page's lead forms read from Meta, each `connected` or not, with its questions                              |
| POST   | `/meta-lead-ads/pages/:id/forms/:formId/connect` | `leads.sources.manage`                     | the form, now `connected`, with the uuid of its lead source                                                    |
| DELETE | `/meta-lead-ads/pages/:id/forms/:formId`         | `leads.sources.manage`                     | 204; the form's source and its stored leads go, the contacts stay                                              |
| GET    | `/meta-lead-ads/sources/:id/health`              | `leads.sources.read`                       | health of a lead source that is a Meta form (`connected: false` for any other source)                          |

`:id` of a Page is the Facebook channel's Page uuid (what `GET /facebook/pages` calls `id`); `:id` of a source is a lead source uuid. Mutations
are idempotent-keyed. Nothing returned carries a token, the app secret or the verify token.

### Errors

| Code                      | When                                                                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MLA_NOT_CONFIGURED`      | no Meta app (id and secret) on this install                                                                                                                                                          |
| `MLA_LEAD_ACCESS_MISSING` | the Page was connected without `leads_retrieval`, `pages_manage_ads` and `pages_read_engagement` (details list the missing ones), or Meta refused with a permission error: run the lead-access login |
| `MLA_PAGE_RECONNECT`      | the Page's status is not `connected`, or Meta says its token is revoked or expired                                                                                                                   |
| `MLA_SYNC_OFF`            | picking a form before lead sync is on                                                                                                                                                                |
| `MLA_SUBSCRIBE_FAILED`    | Meta refused the `leadgen` subscription, or accepted it but does not list the field afterwards (the answer is read back)                                                                             |
| `MLA_FORMS_UNAVAILABLE`   | Meta did not answer the request for the Page's forms (its own words are in the message)                                                                                                              |
| `MLA_FORM_NOT_FOUND`      | the form is not one of this Page's lead forms                                                                                                                                                        |

## The Page: lead access and sync state

`leadAccess` is read from the scopes the Facebook channel stored when the Page was connected (`facebook_pages.scopes`, from Meta's token check).
It is `granted` only when all of `leads_retrieval`, `pages_manage_ads` and `pages_read_engagement` are held; otherwise `missing` and
`missingScopes` names them. **Re-consent** is the login `POST /connect/start`: the Facebook channel's own login (same sealed state, same callback
address already registered in the Meta app) with the lead scopes added and `auth_type=rerequest`, so a Page connected earlier gets the
permission without a second app. The callback stores the Pages again with the scopes Meta actually granted and sends the browser back to
`/lead-sources?tab=ads&fb=connected|error&message=...` (the sealed state carries `returnTo: lead-sources`; any other value is ignored). With a
Login-for-Business configuration (`FB_CONFIG_ID`) Meta takes the permissions from that configuration, not from the request: add the lead
permissions to it (`usesLoginConfiguration` tells the screen).

`sync.state`, in the order the person has to act: `off` (not switched on) / `needs_reconnect` (the Page's channel status is not `connected`, or the
last Meta error was a token error) / `needs_lead_access` (permission missing, or Meta withheld one) / `error` (Meta refused something else, its words
in `lastError`) / `subscribed`. `lastLeadAt` is when a lead last arrived (webhook or sweep), `lastSweepAt` when the sweep last read every picked
form to the end. A success (a fetched lead, a complete sweep) clears the error.

**Turning sync on** subscribes the Page to `leadgen` **without dropping the fields it already has**: Meta replaces the whole list on a subscribe,
so the adapter reads the list, adds `leadgen` (and the Facebook channel's own fields), posts it, and reads it back. The Facebook channel's
"Fix inbound" and reconnect keep `leadgen` for a Page that has it. If the read-back does not show `leadgen`, nothing is stored and the request
is 422 `MLA_SUBSCRIBE_FAILED`. Turning sync off removes only `leadgen`.

## Forms and mapping

`GET /pages/:id/forms` reads `leadgen_forms` from Meta (questions, consent checkboxes, status, lead count). Picking a form creates (idempotently)
a **lead source of kind `meta_lead_ads`**, reference `meta_lead_form:<pageId>:<formId>`, named "<Page> - <form>", platform "Facebook", no URL
token, counted in the plan's `lead_sources` limit. It is edited like any source in `/lead-sources/:id`: mapping, default country code, owner
rule (fixed or round robin), deal pipeline and stage, notifications, tag, flow, raw retention.

A lead's answers are filed under the form's own question keys (`full_name`, `email`, `phone_number`, `what_is_your_budget`), several answers
joined with ", ", and Meta's `p:` marker removed from phones. The pipeline's aliases already read Meta's standard keys; a custom question is
mapped to a contact property with `mapping.customFields`. Every question carries `suggestedTarget` (name, firstName, lastName, email, phone) from
its type or Meta's standard key, which the web screen uses to prefill the mapping.

Attribution (BL-012): the **names** of the campaign, ad set and ad and the form's name go to `contact_attributions` (campaign, adset, ad, form);
the platform is `Instagram` when Meta's `platform` says so, else `Facebook` (Instagram placements arrive through the same Page and form).
Meta's ids ride in the stored lead payload as `meta_lead_id`, `meta_form_id`, `meta_form_name`, `meta_page_id`, `meta_ad_id`,
`meta_adset_id`, `meta_campaign_id` (usable in a mapping preview; never under a name the pipeline's aliases would take for a campaign).

## Consent proof

Policy: a lead is not consent. A grant (source `lead`) is written only when the form has a **custom disclaimer checkbox with wording** and the
lead **ticked it**: the proof is the checkbox text, the form id, the ad id and the time of the lead, handed to the pipeline as `NormalisedLead.consent`
(channels default to the ones the lead can be reached on: a phone is WhatsApp, an address is email; SMS is never granted from a lead form).
Nothing else is read as consent: an ordinary question such as "I agree to be messaged" is not, an unticked box is not, a ticked box whose wording
is not known (the form changed at Meta, never cached) is not. A test lead never grants (the pipeline's rule).

## Reconciliation sweep

`LeadSweepService` (worker only, every 10 minutes) queues one job per Page that has sync on and at least one picked form (job id
`sweep-<org>-<pageId>`, removed when done, so a sweep still running is never doubled and replicas do not multiply it). `LeadgenService.sweepPage`
reads each picked, **active** form's leads created after its checkpoint minus a 2 hour overlap (never further back than 80 days, Meta keeps a lead
about 90), oldest first, at most 2000 per form per run, and ingests those the pipeline does not hold. The checkpoint (`meta_lead_forms.sweep_checkpoint_at`,
which starts when the form is picked, so a form brings in leads from then on and no surprise backlog) moves only when the read reached the end and
every delivery succeeded; otherwise the next run reads the window again. A failed event is processed again by the pipeline's own `failed` rule.

## Data

`meta_lead_pages` (per Page: sync on/off, `subscribed_at`, `last_lead_at`, `last_sweep_at`, `last_error`, `last_error_kind` token / permission /
other) and `meta_lead_forms` (per picked form: Meta ids, cached questions and consent wording, `source_id` unique, health and the sweep
checkpoint). Both tenant tables with forced RLS (migration `20261219090000_meta_lead_ads.sql`). `meta_lead_pages.page_id` has no foreign key to
`facebook_pages`: when a Page is disconnected, `PageDisconnectConsumer` (outbox `facebook.page.disconnected`, worker) first releases the lead
source of each picked form (the pipeline deletes the source and its stored events; contacts stay) and then removes these rows, unless the Page
has been connected again meanwhile. Deleting a form's source from the Social leads screen removes the form row (ON DELETE CASCADE).

Audit rows: modules `meta_lead_pages` and `meta_lead_forms` (insert, update, delete). Outbox: `meta_lead_ads.page.enabled`, `.page.disabled`,
`.form.connected`, `.form.disconnected`; the leads themselves announce `lead.created` / `lead.updated` through the pipeline.

## Ports and providers

- `META_LEAD_ADS_GRAPH` (`infra/providers/meta-lead-ads/meta-lead-ads.port.ts`): `forPage(token, pageId)` with `listForms`, `getForm`, `getLead`,
  `listFormLeads`, `subscribedFields`, `subscribeLeadgen`, `unsubscribeLeadgen`. Every call returns `{ ok, data?, error?, code? }` and never throws.
  The adapter reads the Meta app (id, secret, Graph version) from the Facebook channel's settings (`FACEBOOK_GRAPH.settings`: `FB_APP_ID` or
  `META_APP_ID`, `FB_APP_SECRET` or `WHATSAPP_APP_SECRET`, `FB_WEBHOOK_VERIFY_TOKEN` or `WHATSAPP_VERIFY_TOKEN`, `FB_GRAPH_VERSION` or
  `META_GRAPH_VERSION`). No new environment variable. The token travels in an `Authorization` header only; a paging address is followed only when it
  stays on `facebook.com` over https. The fake for tests is `test/support/fake-meta-lead-ads-graph.ts`; no test makes a Meta call.
- It uses `LEAD_INGEST` and `LEAD_SOURCE_DIRECTORY` (leaf ports in `modules/leads`); `ConnectorSourceInput.kind` (`connector` | `meta_lead_ads`)
  and `LeadIngestPort.settled` are the two additions to those ports.

## Decisions and limits

- **Native module, not a Marketplace recipe.** A recipe is data over five generic connector types; Meta needs a signed webhook shared with the
  Facebook channel, a token sealed in another domain, a form picker and Graph paging. It is a module that uses the lead pipeline's ports, like
  a connector does.
- **Form pick, not Page pick.** The workspace chooses forms; a lead from a form that is not picked is dropped (no surprise contacts).
- **Reference to the form is the source.** One form, one source: mapping, owner and deal rules are per form, as the spec asks (L-05, L-07, L-08).
- **IDs are not columns.** `contact_attributions` keeps names; Meta's ids stay in the stored payload (30 day retention by default). A column per id
  waits for the Meta Ads domain (BL-043).
- **Not built:** backfill of leads from before a form was picked and a "sync now" button (L-18, BL-204); campaign and ad-name enrichment when a lead
  arrives without names; conversions API back to Meta.
