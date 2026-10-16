# API: WhatsApp message templates

Base `/v2/templates`. Errors are `application/problem+json`; switch on `code`. Identifiers are uuids. Mutations take an `Idempotency-Key`; updates carry `rowVersion` (409 `ROW_VERSION_CONFLICT` on a stale one).
Contracts: `@crm/contracts` (`message-templates`). Every route is tenant-scoped: another organization's template or WhatsApp number is a 404.

| Route               | Permission                        | What                                                                                                                                                                    |
| ------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`             | `tpl.templates.read`              | List, newest first, cursor. Filters `status`, `category`, `connectionId`, `q` (name, Meta id, body).                                                                    |
| `GET /:id`          | `tpl.templates.read`              | Detail with `metaPayload` (what Meta is or would be sent) and `lint`.                                                                                                   |
| `POST /`            | `tpl.templates.create`            | Create. `submit` (default true) also sends it to Meta and then needs `tpl.templates.sync`. 201 with `{template, warnings, metaError}`.                                  |
| `PUT /:id`          | `tpl.templates.create`            | Edit a `pending`, `rejected` or `draft` template (else 409 `TPL_NOT_EDITABLE`). With `submit`, the Meta copy is deleted by name and created again.                      |
| `DELETE /:id`       | `tpl.templates.delete`            | 204. Deletes on Meta (best effort, one language via `hsm_id`) then here. 409 `TPL_IN_USE` while a processing or scheduled broadcast uses it.                            |
| `POST /:id/submit`  | `tpl.templates.sync`              | Send a saved template, or retry after a refusal. A template already on Meta is returned unchanged. Same result shape as create.                                         |
| `POST /:id/refresh` | `tpl.templates.sync`              | Re-read status, quality and category from Meta; returns the detail. Never-submitted templates and a second call within 15 s answer from the row.                        |
| `POST /sync`        | `tpl.templates.sync`              | Body `{connectionId}`. Pull every template of one number. Returns `{created, updated, missing, total}`.                                                                 |
| `POST /lint`        | `tpl.templates.create`            | The form's instant feedback: `{issues, normalized, metaPayload}`. Nothing saved, nothing sent.                                                                          |
| `POST /media`       | `tpl.templates.create` (+ `sync`) | Multipart `file` + `connectionId`. JPG/PNG up to 5 MB, MP4/3GP up to 16 MB, PDF up to 100 MB; content is checked, not the name. Returns `{handle, fileName, mimeType}`. |
| `POST /ai-generate` | `tpl.templates.create`            | "Build with AI" (TW-TPL-016): a business brief in, a template draft out. Nothing saved, nothing sent to Meta. See below.                                       |

## Behaviour worth knowing

- **Order of work on create:** lint (errors stop everything with 422 `TPL_LINT_FAILED`, `errors[]` lists them, nothing saved or sent) -> text normalised (`{{first_name}}` becomes `{{1}}`, the attribute stays in `variableMap`) -> saved -> Meta called outside any transaction -> Meta's id, status and category (read back by name) written. A draft (`submit:false`) is saved without lint blocking.
- **Meta refuses:** the row is kept with `status: "rejected"`, Meta's words in `rejectionReason` and in the response's `metaError`; fix the form and `PUT` or `POST /:id/submit`. A Meta outage or throttle is not a refusal: the row stays `draft`, `metaError` says why.
- **Status** is derived from Meta's state in one place for the webhook, refresh and sync: `APPROVED/REINSTATED` approved, `REJECTED` rejected, `PENDING/IN_APPEAL/PENDING_DELETION` pending, `PAUSED` paused, `DISABLED/LIMIT_EXCEEDED/FLAGGED` disabled, `DELETED` deleted. `metaStatus` keeps Meta's own word. A RED quality or a PAUSED state sets `pausedUntil` a day ahead.
- **Sync** never removes a local row. A template Meta no longer lists is flagged `deleted`, and only when Meta's list was read to the end; if it broke off, what was fetched is saved, nothing is flagged and the call fails with 503 `WABA_PROVIDER_UNAVAILABLE` (run it again). A never-submitted local template with the same name and language (`en` matches `en_US`) is linked, not duplicated.
- **Failures from Meta** on refresh, sync and media are 422 `TPL_META_REJECTED` (Meta's reason in `detail`) or, for a throttle or outage, 503 `WABA_PROVIDER_UNAVAILABLE`.
- **Stale sweep:** a worker job every ten minutes re-reads templates PENDING on Meta for more than an hour and unchecked for 30 minutes (queue `tpl-sweep`, 50 per pass).
- **Events** (outbox): `template.created`, `template.updated`, `template.submitted`, `template.submit_failed`, `template.status_changed`, `template.synced`, `template.deleted`.


## Build with AI (TW-TPL-016)

`POST /v2/templates/ai-generate` (200, `tpl.templates.create`): a brief in, a template draft out. Nothing is stored and nothing goes to Meta; the form fills its own fields and the person reviews before submitting. The model picker is `GET /v2/ai/models`.

Request: `provider` (`openai`, `anthropic`, `gemini`), `model`, `businessName` (required, 191), `metaCategory` (`MARKETING` default, or `UTILITY`; AUTHENTICATION templates are not drafted), `language` (a Meta code, default `en_US`), and optional `industry`, `occasion`, `purpose`, `action` (120), `tone` (60), `customPrompt` (2,000).

Response: `{ template: { name, header, body, footer, buttons[] }, model }`. Every field is cut to what the form and Meta take: the name is made a lower-case slug (60), the header and footer lose any variable (60), the body is 1,024, at most three buttons (label 25): `URL` needs an http(s) address, `PHONE_NUMBER` a phone number, `QUICK_REPLY` is dropped when a link button is present (Meta's order rule). A button the model got wrong is dropped, not repaired.

The key is the workspace's own when its plan allows one, else the platform's; a call on the platform's key counts against the monthly token allowance, and the tokens are written to the usage ledger either way. The key is never returned.
Errors are the campaign builder's: 422 `CAMP_AI_NO_KEY`, 422 `CAMP_AI_LIMIT_REACHED`, 502 `CAMP_AI_PROVIDER_FAILED`, 422 `CAMP_AI_BAD_JSON` (the model answered prose, or an empty body).

Differences from Reference, on purpose: no carousel draft (a carousel needs cards with their own media; recorded as blocked in the inventory), no copy-code button (Meta reviews an example code a model cannot know), and Reference's `visit_website` / `call_phone` button names are the form's `URL` / `PHONE_NUMBER`.

## Button and header vocabulary (one reading everywhere)

A template's buttons and header reach the code in three spellings, and every consumer reads all of them the same way through `infra/providers/whatsapp/template-vocab.ts` (the web has the same table in `features/broadcasts/lib/overrides-model.ts`; both are tested against one list of spellings).

| Kind | Meta's / our form's | Reference's | At send time |
| --- | --- | --- | --- |
| link | `URL` (`url`, sample in `example`) | `visit_website`, `cta_url` (`value` is the whole address) | a parameter only when the address has a placeholder |
| quick reply | `QUICK_REPLY` | `quick_reply` | a payload, none when empty (the button's own text is used) |
| phone | `PHONE_NUMBER` (`phone_number`) | `call_phone`, `call`, `phone` (`value`) | none |
| copy code | `COPY_CODE` (`example`) | `copy_text`, `coupon_code` | the code |
| static | `VOICE_CALL`, `CATALOG`, `FLOW`, `OTP`, `MPM`, `SPM` | `voice_call`, `catalog` | none (a parameter is #132000) |

- Case never matters; a type nobody knows is a quick reply, as in Reference.
- A **link of our own form** (`url` with `{{1}}`, sample in `example`) used to go out with an empty parameter unless the wizard mapped it, because the send path read only Reference's `value`; and a blank link or code parameter had no fallback (#131008). Now a placeholder that is a field name resolves to that field (only the part that changes goes out, as Meta wants), a numbered one is filled by the wizard's mapping or an override, and a blank one falls back to the button's own example, then to `-`, as the body does.
- A button type Reference never had (`FLOW`, `OTP`, `MPM`, `SPM`) was sent as a quick reply; it now carries no parameter.
- A **Messenger or Telegram broadcast** read only the lower-case `url`/`phone` spellings, so Meta's `URL` / `PHONE_NUMBER` buttons from our form went out as plain replies; they are now links and calls, and Reference's `visit_website` / `call_phone` (address in `value`) too.
- The inbox bubble draws `visit_website`, `call_phone` and `copy_text` as a link, a call and a code (it knew Meta's spelling only), and the broadcast overrides take any spelling of a button kind (`URL`, `visit_website`, `copy_text`...), anything they cannot carry being a link.
- The header is `image`, `video`, `document`, `location`, `text` or none in any case (`attachment_type` is stored lower-case; Meta's `format` is upper-case).

## API cURL example (web only)

`tpl.templates.api_curl` lets a person see the "Send with the API (cURL)" card on an approved template and the cURL shortcut on its library card. It is shown only together with `api.keys.read`, and it tells the person to create an API key first when the workspace has no live key. It grants no API access by itself: the example calls `POST /api/v1/templates/{id}/send`, which an API key still authorises.
