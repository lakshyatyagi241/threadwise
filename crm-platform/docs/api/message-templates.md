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

## Behaviour worth knowing

- **Order of work on create:** lint (errors stop everything with 422 `TPL_LINT_FAILED`, `errors[]` lists them, nothing saved or sent) -> text normalised (`{{first_name}}` becomes `{{1}}`, the attribute stays in `variableMap`) -> saved -> Meta called outside any transaction -> Meta's id, status and category (read back by name) written. A draft (`submit:false`) is saved without lint blocking.
- **Meta refuses:** the row is kept with `status: "rejected"`, Meta's words in `rejectionReason` and in the response's `metaError`; fix the form and `PUT` or `POST /:id/submit`. A Meta outage or throttle is not a refusal: the row stays `draft`, `metaError` says why.
- **Status** is derived from Meta's state in one place for the webhook, refresh and sync: `APPROVED/REINSTATED` approved, `REJECTED` rejected, `PENDING/IN_APPEAL/PENDING_DELETION` pending, `PAUSED` paused, `DISABLED/LIMIT_EXCEEDED/FLAGGED` disabled, `DELETED` deleted. `metaStatus` keeps Meta's own word. A RED quality or a PAUSED state sets `pausedUntil` a day ahead.
- **Sync** never removes a local row. A template Meta no longer lists is flagged `deleted`, and only when Meta's list was read to the end; if it broke off, what was fetched is saved, nothing is flagged and the call fails with 503 `WABA_PROVIDER_UNAVAILABLE` (run it again). A never-submitted local template with the same name and language (`en` matches `en_US`) is linked, not duplicated.
- **Failures from Meta** on refresh, sync and media are 422 `TPL_META_REJECTED` (Meta's reason in `detail`) or, for a throttle or outage, 503 `WABA_PROVIDER_UNAVAILABLE`.
- **Stale sweep:** a worker job every ten minutes re-reads templates PENDING on Meta for more than an hour and unchecked for 30 minutes (queue `tpl-sweep`, 50 per pass).
- **Events** (outbox): `template.created`, `template.updated`, `template.submitted`, `template.submit_failed`, `template.status_changed`, `template.synced`, `template.deleted`.


## API cURL example (web only)

`tpl.templates.api_curl` lets a person see the "Send with the API (cURL)" card on an approved template and the cURL shortcut on its library card. It is shown only together with `api.keys.read`, and it tells the person to create an API key first when the workspace has no live key. It grants no API access by itself: the example calls `POST /api/v1/templates/{id}/send`, which an API key still authorises.
