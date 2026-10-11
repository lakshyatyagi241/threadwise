# Parity: WhatsApp message templates (TPL), backend slice

Scope of this file: the NestJS side of TW-TPL-007, 017, 019, 020, 022, 023, 024 (shared rules, already done), 025, 026, 027, 028, 029, 030 (status writes) and 041 (see below), against `docs/threadwise-port/inventory/message-templates.md` and the Geta evidence in `waba-interakt/geta-api-templates-and-flows.md` (sections 1, 4, 5). The screens are the web slice's; this file does not cover them.

Evidence: unit tests in `apps/api/test/unit/message-templates/` (rules, Meta state, parsing, errors, mapper; and the agreement of the webhook and the sync on the local status) and `apps/api/test/e2e/message-templates/message-templates.e2e.spec.ts` (create+submit, Meta refusal, outage, lint failure, name clash, edit and row version, delete blocked by a broadcast, refresh, sync with a partial fetch, media, tenancy, permissions).

**Not run:** the e2e file needs Docker (testcontainers); it was written and type-checked in a container without Docker and has NOT been executed. The migration `20261015110000_tpl_permissions.sql` has not been applied to a live database by this work either. No reference comparison (Playwright) was run: this slice has no screen.

## Status

| Id              | State   | Notes                                                                                                                                                            |
| --------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TW-TPL-007      | backend | create pipeline; plan limits (rule 1) and non-WABA channels (rules 2, 3, 6, 8) not built, see below                                                              |
| TW-TPL-017      | backend | detail with payload and lint; the banners and pills are derived by the web from `status`, `metaStatus`, `pausedUntil`, `rejectionReason`, `metaTemplateId`       |
| TW-TPL-019      | backend | resubmission by delete + create (documented difference)                                                                                                          |
| TW-TPL-020      | backend | with the running-broadcast block                                                                                                                                 |
| TW-TPL-022      | backend | list and detail endpoints; the unused `preview` is not built, `apiList` is the `status=approved` filter of `GET /`                                               |
| TW-TPL-023, 024 | done    | before this slice                                                                                                                                                |
| TW-TPL-025      | backend | submit, retry, media upload, error translation                                                                                                                   |
| TW-TPL-026      | backend | refresh with a 15 s cooldown in the row (no Redis lock)                                                                                                          |
| TW-TPL-027      | backend | worker sweep every ten minutes; the page-load trigger is dropped as the port note says; the opportunistic hourly import is not built (the sync button covers it) |
| TW-TPL-028      | backend | sync by cursor, never deletes locally                                                                                                                            |
| TW-TPL-029, 030 | backend | the webhook shim now writes the same local statuses as the sync (see below)                                                                                      |
| TW-TPL-041      | partial | the list endpoint filters by status, category and number; the in-process picker contract for other domains (`listSendable`) is not exported yet                  |

## Intended differences from Reference

| Where                         | Reference                                                                 | Here                                                                                                                                                                                               | Why                                                                               |
| ----------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Lint failure on create        | row saved as `pending`, errors shown on the detail page                   | 422 `TPL_LINT_FAILED` with the list, nothing saved and nothing sent (a draft is still saved without blocking)                                                                                      | the task's contract; no row that can never be sent                                |
| Meta refuses the create       | row stays `pending` with no Meta id ("Not submitted")                     | row kept with `status: rejected` and Meta's words in `rejectionReason`; an outage keeps it `draft`                                                                                                 | `tplStatusSchema`; a refusal and an outage are different to the author            |
| Name                          | stored as typed, normalised only in the payload                           | stored as Meta will hold it (`Order Update` becomes `order_update`)                                                                                                                                | one name everywhere; the webhook and sync match on it                             |
| Duplicate name                | not checked locally                                                       | 409 `TPL_NAME_TAKEN` per number and language (serialised with an advisory lock)                                                                                                                    | Reference's QUIRK (double submit makes two rows)                                  |
| Local `status`                | PAUSED/DISABLED left the local status as it was ("Approved")              | `paused`, `disabled`, `deleted` are written; the send gate still reads `meta_status` and `paused_until`. Changed in `localStatusFor` (WABA module) and its unit test                               | the contract has those values; webhook, refresh and sync must agree               |
| `meta_category`               | importer lowercase, refresh/webhook uppercase                             | uppercase everywhere (`category` keeps the lowercase local vertical)                                                                                                                               | TW-TPL-027 QUIRK, port note                                                       |
| Edit of a live template       | `POST /{id}` edit to Meta (TW-TPL-019); Geta never edited                 | PUT only for pending, rejected or draft; with `submit` the Meta copy is deleted by name (and `hsm_id`) and created again, which restarts the review                                                | Geta evidence 1.3: Meta's edit limits; an approved template is copied, not edited |
| Delete                        | by name, all languages; no in-use check                                   | `hsm_id` narrows Meta's delete to this language; refused (`TPL_IN_USE`) while a processing or scheduled broadcast uses it. A Meta failure is logged and the local delete goes ahead (as Reference) | port note of TW-TPL-020, Geta's delete guard                                      |
| Sync on a partial list        | Geta deleted every local row Meta did not list, even after a failed fetch | rows are only flagged `deleted`, never removed, and only when the list was read to the end; a broken fetch saves what it has and answers 503                                                       | the task's rule                                                                   |
| Sync scope                    | every WABA of the workspace in one click                                  | one number per call (`connectionId`); the web calls it per number                                                                                                                                  | the contract                                                                      |
| Another workspace's templates | `approved()` scope was unscoped (cross-tenant read)                       | every read and write is tenant-scoped; Meta ids owned by another organization are skipped on import                                                                                                | TW-TPL-017 QUIRK                                                                  |
| Header media handle           | the stored file is uploaded again on every submit                         | the handle Meta returned is kept in `attachment_file`; a media template re-sent after the handle expired needs a new upload (`POST /media`)                                                        | files are not stored by this domain                                               |

## Not built (recorded, not dropped)

- Carousel, catalog and limited-time-offer builders (TW-TPL-011, 012): imported rows keep their type (`carousel`, `limited_time_offer`) and are displayed, but cannot be edited (`TPL_NOT_EDITABLE`) or re-sent.
- Twilio Content SID and Instagram templates (TW-TPL-031, 032), Build with AI (016), manual approve/reject (021), starter library seed (047), legacy chat snippets (049).
- Send-time features (TW-TPL-033 to 040, 042), REST v1 CRUD and the mobile API (043, 044), button-click analytics (045).
- Plan gating and limits (TW-TPL-046): there is no plans equivalent yet.
- Platform flags (TW-TPL-048): `waba_templates_v2_enabled` is not read; templates are available whenever a number is connected.
- `NAMED` parameter format is stored and sent as a format, but the named example shape Meta wants (`body_text_named_params`) is not built by the payload builder; use positional.
- The `Edit on Meta` call (`POST /{template_id}`) and an `edit_pending` state with the previous snapshot (TW-TPL-019 port note).
- The shared picker (TW-TPL-041): broadcasts keep their own `TemplateDirectory` shim.

## Shims

- `TemplateDirectory` of the broadcasts module (`modules/broadcasts/_shims/sql-template-directory.ts`) is NOT replaced. Binding it to a service of this module would make `message-templates -> whatsapp-cloud-api-waba -> broadcasts -> message-templates`, a cycle that `pnpm arch:check` (rule `no-circular`) forbids, because the templates service needs the WABA connection and the WABA module imports the broadcasts barrel. The shim reads the same table with the same `TemplateRecord` shape, so nothing is lost; it can go once the WABA module stops importing broadcasts (or a connection lookup moves below both).
- `WabaTemplateEvents` (the webhook shim) keeps its behaviour. Only `localStatusFor` changed (now the single mapping, re-used by the sync and refresh through the WABA barrel).
