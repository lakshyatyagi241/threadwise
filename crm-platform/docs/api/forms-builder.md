# API: Forms (the Form Builder add-on)

A paid first-party Marketplace app, **not a Reference port**: Reference's "forms" are WhatsApp Flows forms (`wa_forms`, domain `forms-links-groups`) and have
no web form builder and no public form URL. Nothing here touches them; the names are different on purpose (`web_forms*`, plan feature
`form_builder`, public path `/f/<key>`). Spec: [docs/specs/forms-builder-app.md](../specs/forms-builder-app.md) (backlog BL-093). This document
covers **v0.9 = phases 0 and 1**: capture forms, hosted and embedded, with CRM mapping. Not in v0.9: deals, payments, AI, voice, conditional logic,
multi-step, outbound webhooks, file upload, double opt-in, submitter confirmation (spec phases 2 to 4).

Base path `/v2`. Errors are `application/problem+json` with a stable `code`, a `requestId`, and `errors: [{ path, message }]` for field-level
problems. The codes this adds are `FORMS_*` in `@crm/contracts` (`forms-builder/errors.ts`). Request and response shapes live in
`packages/contracts/src/forms-builder/`. Every id on the wire is a uuid. The admin routes need a staff bearer token; the public routes need none.

## The three parts

| Part         | Where                                                                                  | Who calls it                                             |
| ------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Admin API    | `/v2/forms`, `/v2/forms/:id/submissions` (staff, bearer token)                         | the builder, the submissions screen                      |
| Public form  | `/v2/public/forms/:publicKey` (no auth)                                                | the hosted page `/f/<key>`, a customer's embed, a script |
| Embed loader | `GET /form-embed/:publicKey/embed.js` (version neutral, no database, cached 5 minutes) | a `<script>` tag on the customer's site                  |

## Plan packaging (phase 0)

- Plan feature **`form_builder`**, default **off**. Only the Marketplace app `forms` grants it (`grants_plan_features`). Not `forms_and_links`
  (Reference's Flows forms, on by default) and not `chatbot_widgets`.
- Plan limits (0 = unlimited): **`forms`** (active forms: every one that is not archived), **`form_submissions_monthly`** (accepted submissions per
  calendar month, spam and the ones the cap itself held excluded), **`ai_form_generations_monthly`** (registered, metered from `web_form_usage_monthly`,
  enforced by the AI builder in phase 2). Migration `20261031100200_mkt_forms_app.sql` seeds the decision D1 defaults on every plan row: 10, 500, 50.
  Meters are in `plan-usage.service.ts` (`METERS`); the web plan editor needs a unit per key (`LIMIT_UNITS`).
- Every admin route carries `@RequirePlanFeature('form_builder')`: a workspace without the app answers **422 `PLAN_FEATURE_LOCKED`**, reads included,
  even to a hand-typed URL. The public routes cannot answer 422 (the visitor learns nothing about the workspace): they answer the **one 404**.
- Lifecycle: subscribing opens everything; when the subscription lapses the admin routes lock and the public forms answer 404 **at once**, and the
  data is kept (forms, versions, submissions) so a renewal restores it. Nothing is deleted on a lapse.
- The listing is seeded as a **draft**, `paid_monthly`, price **unset**, `first_party`, `grandfather_existing = false` (Forms has no existing users),
  category Sales tools, version `1.0.0` draft with scopes `contacts.read`, `contacts.write`, `forms.read`, `forms.write` (the last two are new in
  `marketplace/scopes.ts` and map to the `record.forms.*` and `record.form-submissions.*` keys). Pricing and publishing: see
  [the operator runbook](../runbooks/forms-app-operator-setup.md).

## Capabilities

| Key                              | Scope | Grants                                                                                         |
| -------------------------------- | ----- | ---------------------------------------------------------------------------------------------- |
| `record.forms.read`              | yes   | list and open forms, versions, templates, the field picker's catalogue                         |
| `record.forms.create`            | no    | create (blank, template, definition), duplicate                                                |
| `record.forms.update`            | yes   | edit the draft and the live settings, publish, pause, resume, archive, rotate the key, restore |
| `record.forms.delete`            | yes   | delete a draft or archived form                                                                |
| `record.form-submissions.read`   | yes   | list and open submissions (opening answers is audited)                                         |
| `record.form-submissions.update` | yes   | retry a submission, "not spam"                                                                 |
| `record.form-submissions.delete` | yes   | erase the answers of a submission (GDPR)                                                       |
| `record.form-submissions.export` | no    | CSV export                                                                                     |

Registered in `20261031100100_forms_permissions.sql`, tagged `permission_defs.plan_feature = 'form_builder'` (hidden from the Roles editor until the
app is owned). Owner and Admin hold all of them (the trigger on `permission_defs`). Existing Manager presets get forms read, create, update and
submissions read, export; existing Agent presets get submissions read at scope `own`. A workspace created later is provisioned by
`provision_workspace_presets`, which does not know these keys: its Manager and Agent start without them (widen them in the Roles editor).

**Record scope.** A form has no owner column: `own` means "I created it", `team` adds the people on my teams. A submission is visible to whoever may
see its form **or** owns the contact it made. A form or submission outside the caller's scope is a 404.

## Admin routes

All mutations take `rowVersion` (the value read; 409 `ROW_VERSION_CONFLICT` when stale) and accept `Idempotency-Key`. Literal paths are declared
before `:id`.

| Method and path                                      | Permission                       | Request, response (contract names)                                                                                                                                                                                                                |
| ---------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /forms/templates`                               | `record.forms.read`              | `FormTemplateList` (five templates, static, validated at build)                                                                                                                                                                                   |
| `GET /forms/meta/properties?object=contact\|company` | `record.forms.read`              | `FormPropertiesQuery` -> `FormPropertyList` (built-ins and custom properties of the registry, typed, with options)                                                                                                                                |
| `GET /forms`                                         | `record.forms.read`              | `ListFormsQuery` (`status`, `includeArchived`, `q`, cursor) -> page of `FormSummary`                                                                                                                                                              |
| `POST /forms`                                        | `record.forms.create`            | `CreateFormInput` (`name`, `templateKey` or `definition`, `settings`) -> `FormDetail` (201)                                                                                                                                                       |
| `GET /forms/:id`                                     | `record.forms.read`              | `FormDetail` (draft document, live settings, share links)                                                                                                                                                                                         |
| `PATCH /forms/:id`                                   | `record.forms.update`            | `UpdateFormInput` (`name`, `definition`, `settings`, `rowVersion`) -> `FormDetail`                                                                                                                                                                |
| `DELETE /forms/:id`                                  | `record.forms.delete`            | 204; only a draft or archived form (409 `FORMS_STATE_INVALID`); cascades versions, submissions, events                                                                                                                                            |
| `POST /forms/:id/publish`                            | `record.forms.update`            | `FormActionInput` -> `FormDetail`; 422 `FORMS_PUBLISH_INVALID` with `errors: [{ path, message: reason }]`                                                                                                                                         |
| `POST /forms/:id/pause`, `/resume`, `/archive`       | `record.forms.update`            | `FormActionInput` -> `FormDetail`                                                                                                                                                                                                                 |
| `POST /forms/:id/duplicate`                          | `record.forms.create`            | `DuplicateFormInput` -> `FormDetail` (201): "Copy of X", new key, draft and settings, not published                                                                                                                                               |
| `POST /forms/:id/rotate-key`                         | `record.forms.update`            | `FormActionInput` -> `FormDetail`; the old URL, embed and loader answer 404 at once                                                                                                                                                               |
| `GET /forms/:id/versions`                            | `record.forms.read`              | `FormVersionList` (newest first, `isLive`)                                                                                                                                                                                                        |
| `POST /forms/:id/versions/:n/restore`                | `record.forms.update`            | `RestoreFormVersionInput` -> `FormDetail`; copies the version into the draft (not republished); 404 `FORMS_VERSION_UNKNOWN`                                                                                                                       |
| `GET /forms/:id/submissions`                         | `record.form-submissions.read`   | `ListFormSubmissionsQuery` (`status`, `tab`, `from`, `to`, `q`, `contactId`, cursor, `order`) -> `FormSubmissionList`                                                                                                                             |
| `GET /forms/:id/submissions/:sid`                    | `record.form-submissions.read`   | `FormSubmissionDetail` (answers with the labels of the version they were made against; **audited** `read`)                                                                                                                                        |
| `GET /forms/meta/protection`                         | `record.forms.read`              | `FormProtection { captcha: { available, version }, blockedThisMonth, heldAsSpam }`: whether the PLATFORM has a CAPTCHA provider (a workspace cannot configure one), the bots the hidden trap dropped this month, and the submissions held as spam |
| `GET /forms/meta/payment-gateway`                    | `record.forms.read`              | `FormPaymentGateway { ready, slug, name, mode, reason }`: can the workspace take payment on a form (the shared gateway exists and can make a hosted link)                                                                                         |
| `POST /forms/:id/submissions/:sid/payment-link`      | `record.form-submissions.update` | a fresh attempt and hosted link for a submission `awaiting_payment` -> `{ url \| null }`; 409 `FORMS_PAYMENT_STATE`, 422 `FORMS_PAYMENT_UNAVAILABLE`, 410 when the answers were purged                                                            |
| `POST /forms/:id/submissions/:sid/mark-paid`         | `record.form-submissions.update` | money that arrived outside the gateway; audited under the caller; `FormSubmissionSummary`; 409 `FORMS_PAYMENT_STATE` unless `awaiting_payment`                                                                                                    |
| `POST /forms/:id/submissions/:sid/retry`             | `record.form-submissions.update` | `FormSubmissionSummary`; for `needs_review`, `failed`, `spam` ("not spam"); 409 `FORMS_SUBMISSION_NOT_RETRYABLE`, 410 `FORMS_SUBMISSION_PURGED`                                                                                                   |
| `DELETE /forms/:id/submissions/:sid`                 | `record.form-submissions.delete` | 204; erase (below)                                                                                                                                                                                                                                |
| `POST /forms/:id/submissions/export`                 | `record.form-submissions.export` | `ExportFormSubmissionsInput` -> `text/csv` attachment; `X-Export-Truncated`, `X-Export-Rows`                                                                                                                                                      |

`GET /forms/:id/analytics`, `GET/PUT /forms/settings`, `POST /forms/ai/*` are spec phase 2 and are not built.

### The definition

One Zod document (`formDefinitionSchema`) shared by the builder, the public renderer and the server: `title`, `description` (rich text), **one**
step of blocks (`field`, `heading`, `paragraph`, `divider`), `settings` (submit label, success message or https redirect, locale `en`/`ar`, phone
country code), `consent`, `theme` (tokens only), `mapping.company.match`, `after` (tags, lifecycle stage). Field kinds: `short_text`, `long_text`,
`email`, `phone`, `number`, `currency`, `date`, `dropdown`, `radio`, `checkbox_group`, `checkbox`, `rating`, `hidden`. Limits: 100 blocks, 50
options, 200 characters per label, 5,000 for rich text, 256 KB. Every object is `.strict()`: there is **no place for HTML, CSS or script** (custom
CSS is out of scope until a CSS sanitiser exists); unknown keys are refused. v0.9 accepts one step and no rules (`steps` max 1, `rules` max 0, with a
message saying so); the shape does not change when phase 2 widens them. A pattern an admin types is checked by `isSafeFormPattern` (no
backreferences, no lookaround, no nested repeats, max 200 characters) and only ever tested against values of at most 500 characters.

Rich text (the description, a paragraph block, the thank-you message) is sanitised **on save** (`HtmlSanitizerService`) and again **when rendered**.

### Binding fields to CRM properties

A field's `bind: { object: 'contact' | 'company', property }` names a built-in column (`contact`: `name`, `first_name`, `last_name`, `email`, `phone`,
`title`, `address`, `message`; `company`: `name`, `domain`, `email`, `phone`, `industry`, `size_range`, `address`, `notes`) or the key of an active,
writable custom property of the registry (`GET /forms/meta/properties`). Never offered, and ignored if a hand-crafted bind names them: owner,
lifecycle stage, tags, pipeline, formulas, lookups, system and read-only properties. Unbound fields are kept in the submission only. Deals are phase 2.

### Publish checks

`POST /forms/:id/publish` freezes the draft as the next immutable `web_form_versions` row and makes it live (a draft that is already live changes
nothing). It is refused with 422 `FORMS_PUBLISH_INVALID`, one `{ path, message }` per problem:

| Reason                      | Meaning                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `no_fields`                 | nothing for a visitor to fill                                                                            |
| `no_contact_point`          | neither `contact.email` nor `contact.phone` is bound                                                     |
| `crm_required_unbound`      | a property the workspace marks required is not collected (`contact.<key>`)                               |
| `crm_required_not_required` | it is collected but the field is not required                                                            |
| `bind_unknown_property`     | the property is not a built-in and not in the registry (or inactive)                                     |
| `bind_type_mismatch`        | the kind of field does not suit the property (email must come from an `email` field, a date from `date`) |
| `company_fields_need_match` | company fields are bound but `mapping.company.match` is `none`                                           |
| `lifecycle_stage_unknown`   | `after.lifecycleStage` is not a usable stage of the workspace                                            |

## The public form

`/v2/public/forms/:publicKey` (version `2`). The key is 22 random letters and digits. **Unknown, malformed, archived, plan-locked: one 404 body.** A
`paused` form is returned by GET with `closed: true` (and no steps); a submit to it is a 404. The origin is judged only after the key proved to exist.

| Method and path                      | What                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /:publicKey`                    | `PublicForm`: steps (bindings removed, rich text sanitised), theme, consent line, honeypot input name, captcha need and **public** site key, `poweredBy`, `frameAncestors`. `Cache-Control: public, max-age=30`, `ETag`, `If-None-Match` -> 304, `X-Robots-Tag: noindex`, `Vary: Origin` |
| `POST /:publicKey/events`            | `PublicFormEventInput` (`visitId`, `kind` view/start/step/submit/complete, `step`) -> **204 always** (also for an unknown key); nothing personal is stored                                                                                                                               |
| `GET /:publicKey/submissions/:token` | `PublicFormSubmissionStatus { payment: not_required \| awaiting_payment \| paid \| expired \| failed, next, payUrl }` for the page the visitor returns to from the gateway; `Cache-Control: no-store`; 404 for any token that is not this form's receipt                                 |
| `POST /:publicKey/submit`            | `PublicFormSubmitInput` -> **201** `PublicFormSubmitResponse { submissionToken, next: { type: 'message' \| 'redirect' \| 'pay' } }`; JSON only (415 otherwise); body class `public-form` (256 KiB)                                                                                       |

`PublicForm.frameAncestors` carries the `Content-Security-Policy: frame-ancestors` value the web page must answer with: `'none'` for the hosted page,
the form's allow-list for `?embed=1`. The API computes it so the web app never decides what may frame a form.

### What the submit door says

Always the same 201 whatever happened: it never says whether a contact existed, was created or updated, or whether the submission was spam, held for
review, or over the plan's cap. The only specifics a sender learns are about their own input: **422 `FORMS_VALIDATION`** with
`errors: [{ path: <fieldId>, message: <rule> }]` (rules: `required`, `invalid_email`, `invalid_phone`, `invalid_number`, `invalid_date`,
`invalid_option`, `too_short`, `too_long`, `too_small`, `too_large`, `pattern`; `path: 'consent'` for an unticked required consent box). Other
answers: 400 `AUTH_CAPTCHA_FAILED`, 403 `FORMS_ORIGIN_DENIED`, 404, 413, 415, 429 `RATE_LIMITED` (with `retryAfterSeconds`), 500 `INTERNAL` (generic; retry
with the same idempotency key).

### Origins, CORS and frames

`allowedOrigins` is a list of exact origins (`https://example.com`, with the port when it is not the default) or one wildcard level
(`https://*.example.com`, any subdomain depth, never the apex, never a bare `*`); plain `http` only for localhost. **Empty = the hosted page only.**

- The check is for **browsers**: a request with no `Origin` (a server, a script) is not refused by an allow-list; the rate limits, the CAPTCHA and the
  spam rules hold it. The web app's own origin (`WEB_APP_URL`) is always allowed.
- A matched origin is echoed in `Access-Control-Allow-Origin` (no credentials, `Vary: Origin`, also on the 422 of a submit); a refused one gets
  403 `FORMS_ORIGIN_DENIED` and **no** CORS headers. The preflight (`OPTIONS`) is answered from the same list by `FormsPreflightMiddleware`, mounted
  ahead of the API-wide CORS policy in `main.ts` (and in the module, so a test app behaves the same); an unknown key and a refused origin look alike.
- `FRAMEABLE` in `modules/auth/middleware-security-headers.ts` now lists `form-embed` next to `widget`, so the loader script carries no blanket frame
  policy. The form **page** is the web app's: it must answer `frame-ancestors` per form (see `next.config.ts` in the report).

### The embed loader

`<script src="https://<api origin>/form-embed/<publicKey>/embed.js" async></script><div data-forms-key="<publicKey>"></div>` injects an iframe of
`<web origin>/f/<publicKey>?embed=1`, sizes it from `postMessage` and relays `forms:submitted`. The channel is **one way**: the page posts
`{ source: 'forms', type: 'resize' | 'submitted' | 'redirect', key, height?, url? }` to its parent; the loader acts on a message only when
`event.origin` is the form's origin **and** `event.source` is its own iframe, follows a `redirect` only to an `https:` URL, and the page never
accepts a message from its parent. Values are put in as JSON literals (`<` escaped), so a key cannot break out of the script.

## The submission pipeline

Checks, in order, before anything is written: the address budget (120 a minute, before the lookup) -> key shape -> tenant lookup -> plan feature ->
origin -> the form's own budgets (per address 20 a minute, per form 120 a minute, both editable per form) -> honeypot -> CAPTCHA -> validation against
the **frozen version** -> per-contact budget (5 an hour per email or phone) -> spam score -> the monthly cap. Then **one transaction** as the system
actor of the workspace the key proved:

1. **Claim** the submission under `(org, form, idempotencyKey)` (`INSERT ... ON CONFLICT DO NOTHING`). A repeat returns the stored receipt and writes
   nothing; a `failed` submission, or a `received` one older than 5 minutes, is taken over.
2. **Contact**: identity-first dedupe in the lead pipeline's order (email, then phone, then the stored normalised email), then
   `ContactsService.resolveOrCreateByIdentity` (advisory lock, contact quota -> `needs_review: plan_limit_reached`; an existing contact still updates).
   No usable email or phone -> `needs_review: no_contact_point` (or `invalid_phone`), the answers kept.
3. **Fill blanks only**: a name, title, address, message, owner, custom property, email or phone is only written where the contact has none; a phone or
   email that belongs to another contact is not stolen. Custom values are coerced with `coerceCustomValue` to the registry's type. A required
   workspace property still missing on a new contact is noted on the submission (`error`), the submission still counts.
4. **Company** (`mapping.company.match`): by website (every common spelling, on the new index `idx_companies_domain`), then by exact name; a match is
   filled and linked, never overwritten; no match creates one (`company.created`, `via: 'form'`). `email_domain` derives the website from a business
   address (a built-in free-mail list is skipped). A contact already in a company is never moved. New: `CompaniesService.resolveForSubmission`,
   `CompaniesRepository.findByDomainOrName` and `fillBlanks` (tx-aware, through the Companies barrel).
5. **Tags** (`after.tags`, skipped past the plan's tag cap, never an error), **owner** (`unassigned`, `fixed`, `round_robin` with a cursor on the form that
   does not bump its `row_version`; a contact that already has an owner keeps them and costs no turn), a **`contact_attributions`** row (platform
   `form`, campaign from `utm_campaign`, the form's name), the **consent** line, the **timeline** entry `Submitted <form>` (`form_submission`).
6. **Consent**: the text shown, its version and the time are stored on the submission (`consent`). A ticked marketing box sets
   `email_subscription_status` / `whatsapp_subscription_status` to `subscribed` where they have none, never for a contact flagged `is_unsubscribed`,
   and emits `contact.opt_in` once, on a real change. An unticked box never changes anything. (Decision D10; the value `subscribed` is the first the
   product defines, flagged for the Contacts owner.)
7. The submission's outcome, **audit** rows, and **outbox** events, in the same transaction.

An unexpected error rolls the whole transaction back, is recorded `failed` in a transaction of its own (`form.submission_failed`), the sender gets a
generic 500, and the **same idempotency key** retried recovers it.

**Popup mode.** An element with `data-forms-mode="popup"` opens the same hosted page in a dialog instead of inline. Options are attributes the Share tab
writes (the loader clamps each to the same limits): `data-forms-trigger` = `delay` (default) | `scroll_down` | `scroll_up` | `click`;
`data-forms-delay` seconds 0 to 600 (default 5); `data-forms-scroll` percent 5 to 100 (default 50); `data-forms-position` = `center` (dims the page,
click outside closes) | `bottom_right` (no dimming); `data-forms-days` 0 to 365 (default 7; 0 = every visit); `data-forms-title`, `data-forms-close` (labels).
`scroll_up` opens after the visitor went at least 200px down and then back up by 80px or more. Any element with `data-forms-open="<publicKey>"`, or
`FormsPopup[<publicKey>].open()`, opens it on demand whatever the trigger. The dialog has `role="dialog"` and `aria-modal`, closes on its button, Escape or
(centre only) the backdrop, locks page scroll while centred, returns focus on close, rises from the bottom as a full-width sheet at 480px and below, and
uses the same one-way, origin-checked message channel. The "seen" state is in `localStorage` (`forms:popup:<key>`: an expiry time, or `done` after a
submit); a blocked storage only means it may show again. The Design tab and the Preview dialog have a **Popup** preview (the page dimmed, a dialog, a close
button).

### Spam and abuse controls

- **Honeypot** (`form.honeypot`, default on): any text in the input named by `honeypotField` is a bot. Silent 201, **nothing stored**, a counter
  (`web_form_usage_monthly.spam_blocked`).
- **Spam score** (`SPAM_THRESHOLD` 100): links (30 each), stock phrases (45 each), markup (60), shouting (20), a submit under 2 seconds after `start`
  (50, so alone it only scores). Only free text is read (long text, short text not bound to a company website). Over the threshold: stored `spam`
  (`reason: spam_score`), no CRM write, the sender sees a normal success; "not spam" (retry) runs it.
- **CAPTCHA**: `captchaMode` `inherit` or `on` calls `CaptchaService.assert(token, 'form')` (a new action); `off` skips it. With no provider
  configured on the platform there is nothing to enforce (`on` cannot force one).
- **Rate limits**: Redis fixed windows, **fail-open** with a warning (as the lead hook), the CAPTCHA and honeypot still run.
- A raw IP is never stored: `ip_hash` is an HMAC keyed by a server secret and the UTC day. The `answers` column is purged by the retention sweep.

### Retention, erase, export

- `retentionDays` (30 to 3650, default 365, `null` = forever): `answers_expires_at` is set when the submission is stored. The daily worker sweep
  (`FormRetentionSweepService`, 03:17) empties `answers`, `utm`, `referrer`, `page_url`, `user_agent` and `ip_hash` and stamps `payload_purged_at`; the
  row, its outcome, its contact and company links and the consent evidence stay. Analytics events older than 90 days are deleted.
- **Erase** (`DELETE .../submissions/:sid`): same wipe at once plus `erased_at`; the contact is an ordinary CRM record and is never touched; audited.
- **Export**: newest first, at most 10,000 rows (`X-Export-Truncated: true` says when it was cut; larger exports as an async job are phase 2), one column
  per field of the versions the rows were made against, every cell safe in a spreadsheet (a cell starting `=`, `+`, `-`, `@`, tab or CR is prefixed
  with `'`), audited (`export`). Spam is left out unless `status=spam`.

## Events (outbox)

| Event                                                                                                    | When                                          | Payload (no email address, no answers)                                                                                                  |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `form.created`, `.updated`, `.published`, `.paused`, `.resumed`, `.archived`, `.deleted`, `.key_rotated` | admin actions                                 | `uuid`, `name`, `status` / `version` / `changed`                                                                                        |
| `form.submitted`                                                                                         | a submission became or updated a contact      | `formId`, `formName`, `submissionId`, `contactId`, `contactName`, `created`, `status`, `ownerId`, `notify` (user uuids), `notifyEmails` |
| `form.needs_review`                                                                                      | held: no contact point, quota, monthly cap    | `formId`, `formName`, `submissionId`, `reason`, `notify`                                                                                |
| `form.submission_failed`                                                                                 | an unexpected error                           | `formId`, `formName`, `reason`                                                                                                          |
| `form.submission_erased`                                                                                 | an erase                                      | `formId`, `submissionId`                                                                                                                |
| `contact.created`                                                                                        | a submission made the contact                 | the existing event plus `origin: 'form'`, `formId`, `submissionId`                                                                      |
| `contact.updated`                                                                                        | a returning contact had blanks filled         | `via: 'form'`                                                                                                                           |
| `company.created`, `.updated`                                                                            | a company made or filled                      | the existing events plus `via: 'form'`                                                                                                  |
| `contact.opt_in`                                                                                         | a ticked marketing box subscribed the contact | `optedIn: true`, `action: 'subscribed'`, `source: 'form'`, `formId`, `submissionId` (the flow trigger already reads it)                 |

`FormNotificationConsumer` (`FormsBuilderWorkerModule`, worker only) turns `form.submitted` and `form.needs_review` into in-app notifications
(types `form_submission` and `form_needs_review`, link `/forms/<formId>/submissions?submission=<submissionId>`, deduplicated on the submission; a full
plan is announced once a day per form) and a notification email through `MAIL_PORT` to the listed addresses (once per address and submission, a
Redis `SET NX` of a week; a mail failure is logged and never fails the event; the mail carries a name and a link, not the answers).

## Tables

Migration `20261031100000_forms_core.sql` (Drizzle: `packages/db/src/schema/forms-builder/`), all tenant tables with forced RLS, composite foreign
keys and `touch_row`: `web_forms` (the draft, status, live settings, `public_key` unique globally, a round-robin cursor that does not bump the
version), `web_form_versions` (**immutable**: an update trigger refuses any change but the publisher link), `web_form_submissions` (unique
idempotency key and receipt token, `answers`, `consent`, outcome links), `web_form_events` (a monthly-partitioned stream, 90 days, no personal data),
`web_form_usage_monthly` (`spam_blocked`, `ai_generations`). `web_form_lookup(public_key)` is a `SECURITY DEFINER` function returning ids, a status
and the allow-list (nothing for an archived form), the only door for an anonymous request. `20261031100300` adds `idx_companies_domain`.

Differences from the spec, recorded: the module is `modules/forms-builder`; the `web_form_lookup` function does not return `plan_ok` (the plan is read
by `PlanEntitlementService` right after, as the lead hook does); `webhook_url` is not a column (phase 2); `web_form_payments`, `web_form_files`,
`web_form_deliveries` are later phases; the workspace defaults route and its `forms.settings.manage` key (spec 7.1) are not built; the export is
synchronous with a row cap. See [the wiring map](../threadwise-port/wiring/forms-builder.md) and the parity note in
[product-extensions.md](../threadwise-port/parity/product-extensions.md).

## Payments (spec section 10, phase 3)

A form with `payment.enabled` charges the visitor on the workspace's shared gateway (`WorkspaceGatewayResolver`, a hosted payment link made by
`GatewayLinkService`; Razorpay and Stripe are the verified drivers). Card data never touches this app.

- **Definition.** `payment { enabled, amountType: fixed | from_field | pay_what_you_want, amountMinor, fieldId, minMinor, maxMinor, currency, description }`;
  a `from_field` option carries `amountMinor`. The contract refuses a payment block without its price, a choice field whose options lack a price,
  or a pay-what-you-want field that is not a required number. Publish adds `payment_no_gateway` when no usable gateway exists.
- **The server decides the amount** (`computeAmount`, `form-payment-rules.ts`) from the frozen version and the validated answers; no amount the
  browser sends is read. An answer that does not name a priced option, or an amount outside the limits, is a 422 `invalid_amount` on the field. Money is
  `bigint` minor units with the currency's exponent; no float.
- **Submit.** With payment on and no usable gateway the door answers 422 `FORMS_PAYMENT_UNAVAILABLE` and stores nothing (closed, never a free pass).
  Otherwise one transaction stores the submission, writes the CRM, inserts a `web_form_payments` attempt `pending` (reference `FRM-<uuid>`, 48-hour
  expiry) and sets the submission `awaiting_payment`; after commit the link is minted and the visitor gets `next: { type: 'pay', url }`. The same
  idempotency key again returns the open attempt's link (re-minted when it lapsed). A gateway that refuses leaves the attempt pending: staff use
  _new payment link_.
- **Settle.** The gateway's verified notification reaches `FormPaymentsService.settle` by the `FRM-` prefix (`GatewayPaymentRegistry`). The
  attempt must exist in this workspace, on this gateway, with the same amount and currency (a provider that states no amount is refused, outbox
  `form.payment_rejected`); a replay is `duplicate`; money that arrives for an expired attempt is still recorded. The attempt and the submission become
  `paid`, the contact timeline gets _Paid ..._, outbox `form.payment_succeeded`. A second paid attempt for a submission is recorded and flags
  `duplicatePayment` (refund by hand; there is no gateway refund call).
- **The redirect back is never proof.** `/f/<key>/pay-return?s=<receipt>` only reads `GET .../submissions/:token` and polls until `paid`.
- **Expiry.** `FormPaymentSweepService` (worker, every 30 minutes) marks attempts past `expires_at` `expired`; the submission stays `awaiting_payment`.
- **Not built (recorded):** per-item and deposit amounts, tax, coupon field, invoice and receipt (phase 3b), resend link by email or WhatsApp, in-app
  notification for a payment, failed-payment and refund webhooks (the shared gateway only handles "paid").

**Payment notifications.** `FormNotificationConsumer` also reads `form.payment_succeeded` and `form.payment_duplicate` (payload carries `contactName`, `amount`
(major units), `currency`, `paymentId`, `ownerId`, `notify`, `notifyEmails`). The people are the same as for a submission (the contact's owner when the form
says so, plus the listed users still active). In-app types `form_payment` and `form_payment_duplicate` (link to the submission, deduplicated on the payment
attempt, so a redelivery tells nobody twice); the listed addresses get one mail per payment (not for a duplicate), with the name, the amount and a link, no answers.

**CAPTCHA is the platform's, not the workspace's.** `captchaMode` is `inherit` (check when the platform has a provider), `on` (the same check, but the form
cannot be PUBLISHED without a provider: 422 `FORMS_PUBLISH_INVALID`, `settings.captchaMode: captcha_not_configured`) or `off` (skip). A form already
live whose provider is later removed degrades to the hidden trap, rate limits and spam score rather than refusing every lead. The builder always shows
whether the platform has a provider (`GET /forms/meta/protection`) and warns when `on` would do nothing.

**Notification links.** Every in-app notification and notification email links to `/forms/<formId>/submissions?submission=<submissionId>`; the screen
opens that submission even when it is not in the first page of the list.
