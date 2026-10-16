# API: lead sources and the lead pipeline

A product extension: Reference has a generic incoming webhook that makes a contact from a phone number, and nothing else (see
`docs/threadwise-port/parity/product-extensions.md`, "Lead sources"). Spec:
[docs/specs/email-channel-and-social-leads.md](../specs/email-channel-and-social-leads.md) (L-01 to L-12), and
[docs/specs/marketplace-mini-apps-and-integrations.md](../specs/marketplace-mini-apps-and-integrations.md) 6.3 and 6.4 for the connectors that
call the same pipeline. Base path `/v2`. Errors are `application/problem+json` with a stable `code` and a `requestId`; the codes this adds are
`LEAD_*` in `@crm/contracts` (`leads/errors.ts`). Request and response shapes live in `packages/contracts/src/leads/`. Every id on the wire is a
uuid. The management routes need a staff bearer token; the hook needs none.

**One pipeline, several doors.** A lead source is a door; every door ends in the same pipeline (`LeadIngestService`), the only writer of
lead-originated contacts. Today a workspace creates one kind of door, the generic webhook (covers LinkedIn, TikTok, Google Ads and any
landing-page tool through Zapier, Make or a native webhook). `kind` already names the doors that follow (`meta_lead_ads`, `tiktok`, `linkedin`,
`google_ads`) and `connector` (a marketplace portal such as IndiaMART), which reaches the pipeline through the port in
[The port](#the-port-for-other-domains).

## Capabilities

| Key                    | Scope | Grants                                                                                                                   |
| ---------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------ |
| `leads.sources.read`   | no    | list and get sources, list events (no payloads)                                                                          |
| `leads.sources.manage` | no    | create, change, delete, rotate the token, mapping preview, send a test lead, retry an event, open an event's raw payload |

Held by the Owner and Admin presets (the trigger on `permission_defs` grants a new key to them, migration `20261020090100`). No other preset
holds them by default. `GET /contacts/:id/attribution` needs only `record.contacts.read` (and the contact's own record scope).

**Plan.** Every `/lead-sources` route needs the plan feature `lead_sources` (422 `PLAN_FEATURE_LOCKED`, reads too); creating a source counts
against the plan limit `lead_sources` (0 = unlimited, 422 `PLAN_LIMIT_REACHED`; the problem's `errors` carry `limit` (`lead_sources`), `used`
(how many the workspace has) and `limitValue` (the cap), so the screen says "You have used 5 of 5 lead sources"). Both default to open, so a plan row that predates them is
neither locked nor capped. A workspace whose plan has no lead sources answers its public hooks like an unknown token: 404.

## The source

```json
{
  "id": "5c1e…",
  "kind": "webhook",
  "providerKey": null,
  "name": "Zapier: Facebook lead ads",
  "status": "active",
  "tokenHint": "x9Qk",
  "tokenRotatedAt": "2026-10-03T09:00:00.000Z",
  "hasSecret": true,
  "externalIdPath": "lead.id",
  "mapping": {
    "name": "lead.full_name",
    "phone": "lead.mobile",
    "customFields": { "budget": "lead.budget" }
  },
  "defaults": {
    "countryCode": "91",
    "platform": "Facebook",
    "lifecycleStage": "ad_lead",
    "tag": "Lead",
    "owner": { "mode": "round_robin", "userIds": ["…", "…"] },
    "deal": {
      "enabled": true,
      "pipelineId": "…",
      "stageId": "…",
      "title": "{{name}} ({{source}})"
    },
    "notify": { "owner": true, "userIds": ["…"] }
  },
  "rawRetentionDays": 30,
  "lastEventAt": "…",
  "needsAttention": 2,
  "rowVersion": 4,
  "createdAt": "…",
  "updatedAt": "…"
}
```

Names are unique per workspace ignoring case (`409 LEAD_SOURCE_NAME_TAKEN`). `rowVersion` is the optimistic lock: the round-robin cursor and
the last-event stamp, which every incoming lead moves, never change it. `needsAttention` counts the source's `needs_review` and `failed`
events that are not test leads.

**The complete address (BL-061).** Create and rotate answer, besides `token` and `hookPath`, a `hookUrl`: the platform's public API address in
front of the path, built by the server from `APP_URL` (the setting the channel webhooks and the marketplace hooks use). When that address is
not set, or in production points at the machine itself or a private network (`localhost`, `127.*`, `10.*`, `172.16-31.*`, `192.168.*`,
`*.local`, `*.internal`), `hookUrl` is `null` and `hookUrlProblem` is `base_url_not_configured` or `base_url_not_public`: no address is
better than a wrong one that never receives a lead. `GET /lead-sources` carries the same verdict as `hookAddress` (`baseUrl`, `problem`), so
the screen can warn before a source is created. The raw environment is read, not the schema default (`http://localhost:3000`), so an unset
`APP_URL` is reported, not papered over.

**Secrets are write-only.** The URL token is returned once, by create and by rotate (`token`, `hookPath`, `hookUrl`), and only its SHA-256 and its last
four characters are stored. The shared secret (`secret`, 12 to 200 characters) is sealed with the credentials key and never returned: the
source shows `hasSecret`. No other response, audit row or outbox event carries a token, a hash or a secret.

### Routes

| Method and path                                | Permission | What                                                                                                                                                  |
| ---------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /lead-sources`                            | read       | every source of the workspace, newest first, with `needsAttention`                                                                                    |
| `POST /lead-sources`                           | manage     | create a webhook source; response is the source plus `token` and `hookPath` (shown once)                                                              |
| `GET /lead-sources/:id`                        | read       | one source                                                                                                                                            |
| `PATCH /lead-sources/:id`                      | manage     | change it; needs the `rowVersion` read (409 `ROW_VERSION_CONFLICT`); `secret` sets, `null` clears, absent keeps; `status: "paused"` makes the URL 404 |
| `DELETE /lead-sources/:id`                     | manage     | 204. The URL stops, its events go with it, contacts it made stay (their attribution stays, its source link is cleared)                                |
| `POST /lead-sources/:id/rotate-token`          | manage     | a new token, returned once; the old URL answers 404 from the next request (422 for a connector, which has no token)                                   |
| `POST /lead-sources/:id/mapping-preview`       | manage     | what a (saved or draft) mapping makes of a payload; writes nothing                                                                                    |
| `GET /lead-sources/speed-to-lead/options`      | manage     | for a `channel`: the templates it can send and the connected senders (names only), for the first-message pickers                                      |
| `POST /lead-sources/:id/test`                  | manage     | a sample (or the posted payload) through the real pipeline, flagged as a test; 409 `LEAD_SOURCE_PAUSED`                                               |
| `GET /lead-sources/:id/events`                 | read       | recent events, newest first, cursor paged; filters `status`, `isTest`, `limit` (1 to 100), `cursor`                                                   |
| `GET /lead-sources/:id/events/:eventId`        | manage     | one event with its stored payload (audited)                                                                                                           |
| `POST /lead-sources/:id/events/:eventId/retry` | manage     | re-run a `needs_review` or `failed` lead from its stored payload under the source's current settings                                                  |
| `GET /contacts/:id/attribution`                | contacts   | first touch, latest touch and up to 50 touches of a contact                                                                                           |

Validation against the workspace, all 422: `LEAD_MAPPING_INVALID` (a mapped custom property that does not exist, belongs to another workspace,
or is a formula or a lookup), `LEAD_DEFAULTS_INVALID` (an owner or notify user who is not an active member, a pipeline or stage that is not the
workspace's, a stage not in the pipeline, a stage given without its pipeline, a lifecycle stage that does not exist or is a lost stage), and the
zod rules of the contract (a fixed owner is exactly one user, a round robin at least two).

## The public hook

`POST /v2/public/lead-hooks/:token`. The token in the path is the only credential: no API key, no HMAC (a Zapier step cannot sign). Reference's
`/hooks/in/{token}` is the behavioural reference.

- Body: a JSON object, or `application/x-www-form-urlencoded` (nested keys work: `lead[phone]=...`). Another content type is 415, a non-object or
  empty body 422, a body over the cap 413. The route's own cap is 1 MB (`LEAD_HOOK_MAX_BODY_BYTES`); the platform's body parser (100 KB) applies
  first, so today anything above 100 KB is refused 413 before the route.
- Optional shared secret: if the source has one, send it in `X-Webhook-Secret`; missing or wrong is 401 (compared in constant time).
- Rate limits per minute: 120 per client address (checked before the token is looked up, so a scan with random tokens never reaches the
  database) and 600 per token. Over either is 429 `RATE_LIMITED` with `retryAfterSeconds`. Fixed windows on Redis, fail-open if Redis is down.
- Answer: always `200 { "ok": true, "received": true }` once the lead is stored, whatever became of it. It never says whether a contact
  existed, was created, was updated or needs review. An unknown, malformed, paused or plan-locked token is one 404 with one body.
- The lead is stored before it is processed, so a 200 means "we have it". A sender never needs to retry for our sake.

### The idempotency key

`(source, external id)` is unique in the database. The external id is the payload value at the source's `externalIdPath` when it has one (`lead.id`);
otherwise, or when the payload lacks it, a hash of the body (`h:` + 40 hex, keys sorted, so the same body in another key order is the same
lead). The second delivery of a lead is acknowledged, counted on the event (`duplicateCount`) and writes nothing. A `failed` event delivered
again is processed again; a `needs_review` one waits for the admin (retry); an abandoned `received` one (a crash, older than 5 minutes) is taken over.

## Mapping a payload (L-05)

Each source maps payload fields to the contact: `name`, `firstName`, `lastName`, `email`, `phone`, `customFields` (a contact property key to a
payload path) and `attribution` (platform, campaign, adset, ad, form). A path is a key (`phone_number`, `Full Name`) or a dotted/indexed path
(`lead.contact.phone`, `answers[0].value`). A key matches ignoring case and punctuation (`Phone Number` finds `phone_number`).

What is not mapped is looked for under its common names, Reference's lists plus what lead forms send: phone (`phone`, `mobile`, `phone_number`,
`whatsapp`, `msisdn`, ...), email (`email`, `email_address`, `mail`), name (`full_name`, `name`, `contact_name`), first and last name (a first
name with a separate last name is joined), and for attribution `campaign` / `utm_campaign`, `adset` / `adgroup`, `ad`, `form`, `platform` /
`utm_source`. A top-level key beats a nested one, an earlier alias a later one, and the shortest nested path wins, so the answer never depends on
key order.

- **Phone** becomes E.164 through the one canonicaliser every contact writer uses. A `+` or `00` number is taken as written; a local number (10
  digits or fewer once a leading trunk `0` is dropped) gets the source's `defaults.countryCode`; a number that carries its country code without a
  plus (12 digits) is left alone; with no default code a bare 10 digit number is not a number (never a guess).
- **Email** is lowercased and checked; one that is not an address is ignored (and noted in the preview).
- **Custom properties** are typed by the property (numbers parsed, booleans read from yes/no, a multi select split on `,;|`); a value that does
  not fit its type is skipped. Only active contact properties of the workspace can be mapped.
- `POST /mapping-preview` runs all of this on a posted `payload`, a stored `eventId`, or the newest real payload the source still holds, with the
  saved mapping or a draft one, and returns `contact`, `customFields`, `attribution`, the `availablePaths` of the payload, whether the lead would be
  `usable` and why not (`reasons`). It writes nothing; reading a stored payload writes an audit row.

## What the pipeline does (L-01 to L-10)

1. **Store** the delivery (`lead_events`) with its payload and a retention clock. Paused sources and unknown ids never get here. What the
   public sends is made storable first: the NUL character (which Postgres refuses in text and jsonb) is removed from every string and key, and
   a raw payload over 512 KB (a connector's provider response) is dropped, the flattened `fields` being what mapping reads.
2. **Map** the fields. No usable email and no readable phone: the event is `needs_review` with reason `no_contact_point` (or `invalid_phone` when a
   phone was sent but cannot be read), the payload is kept, nothing else happens.
3. **Dedupe**, identity first, in the order `ContactsService.create` uses: the email identity, then the phone identity, then the stored
   normalised email or phone of a contact that predates identities, then `resolveOrCreateByIdentity` (which also takes an advisory lock so two
   simultaneous leads for one number cannot make two contacts, and enforces the plan's contact cap).
4. **Contact.** New: created with the source's lifecycle stage (else the workspace default), name, the platform label as `contacts.source`.
   Existing: UPDATED. Blank name, first and last name, email, phone, source, owner and custom values are filled; nothing a person may have
   curated is overwritten; the other identity the lead brought is linked to the contact so the next lead finds it. If that email or phone already
   belongs to another contact it is not moved: the lead joins one contact and the event carries reason `identity_conflict`.
5. **Plan contact cap reached** and the lead would be a new contact: `needs_review` with reason `plan_limit_reached`, payload kept. A lead for a
   contact that already exists still works at the cap.
6. **Attribution**: one append-only row per lead event in `contact_attributions` (platform, campaign, ad set, ad, form, source label, when).
7. **Tag**: the contact is tagged `defaults.tag` (default "Lead", as Reference did; `null` for none); skipped quietly if the plan's tag cap is reached.
8. **Owner** (only when the contact has none): `unassigned`, `fixed` (one user), or `round_robin` over the listed users who are still active. A
   contact that already has an owner keeps them and costs the rotation no turn. Contacts and deals had no auto-assignment before this; this is the
   minimum, not a routing engine.
9. **Outbox** in the same transaction: `lead.created` / `lead.updated` / `lead.needs_review` / `lead.failed` (aggregate `leads`), and for a new
   contact the existing `contact.created` with `via` (the platform label), `leadSource`, `leadSourceId`, `campaign` and `origin: "lead"` in its
   payload, so a flow can react (L-10). An existing contact emits `contact.updated` with `via: "lead"`. A test lead emits no `contact.created`.
10. **Deal** (optional, off by default): after the commit, in a transaction of its own, `DealsService.create(..., 'lead_ad')` in the source's
    pipeline and stage, owned by the contact's owner, titled from `defaults.deal.title` (`{{name}}`, `{{source}}`, `{{campaign}}`). A returning
    contact that already has an open deal gets no second one. If the deal cannot be made (the plan has no sales pipeline, a pipeline was deleted) the
    lead stays and the event's `error` says `deal_skipped: ...` or `deal_failed: <code>`.
11. **Notification**: the worker consumer writes an in-app `new_lead` notification (deduplicated on the lead event, so a redelivery or a retry
    never notifies twice) to the owner (when `notify.owner`) and the extra users named in `notify.userIds`; "Lead came in again" for a returning
    contact. Test leads and leads that need review do not notify.

An unexpected error rolls the outcome back and is recorded as `failed` (reason `internal_error`, the message in `error`) in a transaction of its
own, with `lead.failed` on the outbox; the sender's redelivery or an admin retry processes it again.

### Event statuses and reasons

`received` (being processed), `created`, `updated`, `needs_review`, `failed`, and `duplicate` (the answer to a repeat delivery: it is counted on
the event, not stored as a row). Reasons: `no_contact_point`, `invalid_phone`, `plan_limit_reached`, `identity_conflict` (informational, on an
`updated`), `internal_error`. `error` holds the human text.

A **test lead** (`POST /test`) runs the same pipeline with a recognisable sample (fictional 202-555-01xx number) or the posted payload. It is
flagged `isTest`, creates real rows the admin can delete, and never notifies nor emits `contact.created`.

**Retry** re-runs the stored payload under the source's CURRENT mapping, defaults, plan and quota: fix the mapping or the default country code,
upgrade the plan, then retry. 409 `LEAD_EVENT_NOT_RETRYABLE` for any other status, 409 `LEAD_PAYLOAD_PURGED`, 409 `LEAD_SOURCE_PAUSED`.

## Speed-to-lead: the first message to a new lead (BL-014, L-16)

A source can send a new lead a first message by itself. It is `defaults.speedToLead` (so it has no route of its own; it is saved with the
source, off by default):

```json
{
  "enabled": true,
  "channel": "whatsapp",
  "templateId": "…",
  "senderId": null,
  "delayMinutes": 0,
  "businessHoursOnly": false
}
```

- **Channel and template.** `whatsapp`: an approved WhatsApp template the contact alone can fill (a body with variables the template's own
  variable map takes from the contact; no media header, no variable in the header or in a button link, not an authentication template). The
  number that sends it is the template's. `sms`: an approved SMS template, sent from `senderId` or the primary connected number. `email`: a
  shared email template (a personal one is its author's), sent as the text version from `senderId` or the oldest connected shared mailbox
  (never a personal mailbox). Saving with `enabled` checks all of this against the workspace (422 `LEAD_DEFAULTS_INVALID`, details
  `template_required`, `template_not_found`, `template_not_sendable`, `sender_not_found` under `defaults.speedToLead.*`).
- **When.** On `lead.created` only: a lead that becomes a NEW contact. A returning contact (`lead.updated`) and a test lead get none. The
  message is due after `delayMinutes` (0 to 60). With `businessHoursOnly` and the workspace's business hours set, it is held until they open
  (no hours set means always open). A held message that has not gone within 24 hours ends `failed / expired`.
- **Never twice.** One row per lead event in `lead_first_replies` (`UNIQUE (org_id, lead_event_id)`): a redelivered outbox event, a second
  worker and a retry of the lead meet the same row. The WhatsApp message carries the row's uuid as its `clientMessageId`, so even a
  repeated attempt returns the first message. An SMS or an email has no such key at the provider, so one whose claim was interrupted is
  `failed / interrupted` and is never sent again by itself.
- **What decides whether it goes** (in this order; the worker, not the screen): the setting is still on and the source active; business
  hours; the template, sender and address for the channel (`skipped` with a reason when one is missing); quiet hours; the ConsentGate;
  then the dispatcher of the channel (WhatsApp: `ConversationsFacade.enqueueOutbound`, which checks the connection, the plan's monthly cap,
  the wallet, the emergency halt and the consent again and holds a marketing template for the quiet hours; SMS and email: the broadcast
  engines, which check the sender, the plan's cap and, for email, the bounce list and the unsubscribe link).
- **Consent is never inferred.** A WhatsApp **utility** template is a service message (allowed unless the contact withdrew the service
  purpose on that channel); a **marketing** template is marketing. SMS and email have no template categories in this product and every
  one the business starts is marketing: it needs a recorded grant on the channel where the workspace requires one, waits out quiet hours,
  and is blocked for a contact who opted out. A lead that arrives with proof of consent (BL-168) has a grant in the ledger and the gate sees
  it; one that did not is asked about as a stranger. There is no override.
- **Result.** `scheduled`, `sending`, `held` (quiet hours, business hours, channel down, wallet empty, sending halted: goes by itself),
  `sent` (handed to the dispatcher: WhatsApp is queued on the contact's conversation, where delivery shows; SMS and email are accepted by
  the provider), `blocked` (opted out, no consent, minor, plan limit: final), `skipped` (nothing to send: no number or address, no sender,
  template gone, a template value the contact lacks, setting off, source paused), `failed`. The `reason` is a stable code, never provider
  text. It is on every lead event as `firstReply`, in the lead inbox, and on the contact's timeline as an activity of type `speed_to_lead`
  (title and reason only: never the message or an address). Audit rows: module `lead_first_replies`. Outbox: `lead.first_reply.scheduled`
  and `lead.first_reply.<status>`.
- **Where it runs.** `LeadFirstReplyConsumer` (the outbox consumer, schedules) and `LeadFirstReplySweepService` (every 10 seconds, sends what
  is due and frees abandoned claims) in `LeadsWorkerModule`, the worker process only.

## Attribution (L-03)

`GET /contacts/:id/attribution`:

```json
{
  "first": {
    "id": "…",
    "platform": "facebook",
    "sourceLabel": "facebook",
    "campaign": "Launch",
    "adset": "AS-1",
    "ad": "Ad-1",
    "form": "F-1",
    "leadSourceId": "…",
    "capturedAt": "…"
  },
  "latest": { "…": "…" },
  "touches": ["…newest first, at most 50…"],
  "total": 2
}
```

Why an append-only table and not columns on `contacts`: a person who answers three ads has three touches, and two pairs of columns would keep
two; the contacts row is locked and written by other domains; and "leads by campaign" is a query over this table. First touch is the earliest
row, latest touch the newest. The table refuses an update of anything a touch says (a trigger); only its links to the lead event and the source
may be cleared (by their own `ON DELETE SET NULL`). `contacts.source` keeps working: it is set to the platform label of the first lead and never
overwritten.

## Retention and audit (L-12)

- The raw payload (`lead_events.payload`) is personal data, kept for the source's `rawRetentionDays` (30 by default, 1 to 365), then nulled by
  the worker's hourly sweep (`LeadRetentionSweepService`, `payload_purged_at` set). The event, its status and the contact stay. An event whose
  payload is purged has `hasPayload: false` and cannot be retried.
- Audit rows (`audit_log`): module `lead_sources` (insert, update with a diff that never holds a secret, delete), module `lead_events` (insert on
  receipt, update on each outcome, and action `export` whenever a stored payload is opened or previewed).
- Outbox: `lead_source.created`, `.updated`, `.token_rotated`, `.deleted` (aggregate `lead_sources`, payloads hold the uuid, name and kind only),
  and the `lead.*` outcomes above.

## The port for other domains

A connector (a marketplace portal, a channel) is not a URL an admin creates, it is an installation. It injects the pipeline by token and imports
only two leaf files, which import nothing, so it never pulls the CRM, plans and notifications modules into its own import graph:

```ts
// apps/api/src/modules/leads/lead-ingest.port.ts
export const LEAD_INGEST = Symbol('LEAD_INGEST');
export interface NormalisedLead {
  externalId: string;
  receivedAt?: string;
  fields: Record<string, string | number | boolean | null>;
  attribution?: {
    platform?: string;
    campaign?: string;
    adset?: string;
    ad?: string;
    form?: string;
  };
  raw?: unknown;
}
export interface LeadIngestResult {
  status: 'created' | 'updated' | 'duplicate' | 'needs_review' | 'failed';
  contactId?: number;
  dealId?: number;
  reason?: string;
}
export interface LeadIngestPort {
  ingest(orgId: number, sourceId: number, lead: NormalisedLead): Promise<LeadIngestResult>;
}
```

```ts
// apps/api/src/modules/leads/lead-source-directory.port.ts
export const LEAD_SOURCE_DIRECTORY = Symbol('LEAD_SOURCE_DIRECTORY');
export interface LeadSourceDirectoryPort {
  ensureConnectorSource(
    orgId,
    { providerKey, externalRef, name },
  ): Promise<{ sourceId: number; sourceUuid: string }>; // idempotent per externalRef
  releaseConnectorSource(orgId, externalRef): Promise<void>;
}
```

The module that provides both tokens is `LeadIngestModule`, exported from `modules/leads/index.ts` (the HTTP side is `LeadsModule`, the worker side
`LeadsWorkerModule`). A caller imports `LeadIngestModule`, injects `@Inject(LEAD_INGEST)`, and passes the `orgId` and `sourceId` it was handed at
install time, never ones read from a payload. Results: a paused or unknown source (or a source of another workspace) is
`{ status: 'failed', reason: 'source_paused' | 'source_not_found' }`, nothing is stored; everything else is stored and answered as above.
`fields` use our names (`full_name`, `email`, `phone_number`) or whatever the source's mapping points at; `raw` is kept for the retention period so
a mapping can be fixed and the lead retried. A connector source (`kind: connector`) has no URL token, counts toward the plan's `lead_sources` cap
(`ensureConnectorSource` throws `PLAN_LIMIT_REACHED` at the cap), is audited and announced like a webhook, and is tuned in the same screen.
`releaseConnectorSource` deletes it with its events (the contacts it made stay).

## Decisions and limits

- **New tables, not the ported `incoming_webhooks`.** Their token is plain text, there is no idempotency key, the raw body is capped at 64 KB with
  no retention clock, and they carry a relay URL and a template-send config that belong to a different feature. They stay for the integrations
  domain's own hook inspector.
- **Open questions** (spec section 9) answered: 9 retention 30 days, per source up to a year; 11 deals off until the admin enables them; 12 a
  per-source default country code, a number that cannot be read is `invalid_phone` when there is no email and ignored when there is one.
- **Not built here:** Meta lead ads, TikTok and LinkedIn doors (L-06, L-13, L-14: their kinds exist, no door does); backfill and manual sync (L-18); Reference's per-hook flow enrolment, template send and forward URL (see the parity file); the web screens;
  the operator console toggles for provider credentials (nothing to configure for a webhook).
- `lead_sources.secret_enc` is sealed with the credentials key like other secrets, but is not yet listed in the re-encryption command's targets
  (`auth/maintenance/reencrypt-secrets.ts`), the same as the other domains' sealed columns.
- Verified: the API's own tests against a real Postgres and Redis (`apps/api/test/e2e/leads/`). Not verified: any real portal or ad platform; no
  live Meta, TikTok, LinkedIn or IndiaMART exists here, so the doors that will call this port are untested against the real thing.

## Flow of a source (`defaults.flowId`)

A source may name a flow (uuid, validated against the workspace, 422 `unknown_flow`). `lead.created` / `lead.updated` carry `flowId`; the flow runtime enrols the contact once (source `webhook_lead`). Test leads start nothing.

## Proof of consent with a lead (BL-168)

A lead grants no marketing consent by itself. If the sender already holds the person's agreement, the body of the webhook may carry it as a
top-level `consent` object (or flat `consent_*` keys):

```json
{
  "name": "Ada",
  "phone": "+919876543210",
  "email": "ada@example.com",
  "consent": {
    "given": true,
    "text": "I agree to receive offers on WhatsApp and email.",
    "version": "lp-3",
    "at": "2026-10-01T08:00:00Z",
    "form_id": "FORM-9",
    "ad_id": "AD-5",
    "channels": ["whatsapp", "email"]
  }
}
```

A grant is written only when `given` is a yes (true, yes, 1, accepted...) and at least one of `text`, `version`, `form_id`, `ad_id` is
present. Without `channels` a phone is WhatsApp and an address is email; SMS only when named. The grant is in the ledger with source `lead`;
a test lead from the source screen never grants; an opt-out of the person is never overridden. Marketplace recipes map the same block with
`mapping.consent` (explicit mode). The stored raw lead keeps the block for the source's retention period.
