---
domain: forms-links-groups
code: WFL
title: WhatsApp Forms and Link Generator
threadwise_version: '1.7.0'
sources_read: 61
---

# WhatsApp Forms and Link Generator

## Overview

This entry covers the two Reference features this domain owns that are actually built here: **WhatsApp Forms** and
the **WhatsApp Link Generator**. The domain's name also covers WhatsApp group management, but that is split across
two features that are not covered in this entry: Cloud API Groups is already fully built under
`whatsapp-cloud-api-waba` (see `docs/specs/waba-groups-management.md`, backlog BL-094 — do not rebuild it here), and
the unofficial-API group directory's admin API already exists under `storefront-builder`
(`StoreGroupsService`/`StoreGroupsController`, `GET /v2/store/groups`) with its Node-side roster sync owned by
`whatsapp-devices-baileys` (`device-groups.sink.ts`) — also not covered here.

| Feature                                   | Controller             | Model(s)                     | Route prefix                     | Engine requirement               |
| ----------------------------------------- | ---------------------- | ---------------------------- | -------------------------------- | -------------------------------- |
| WhatsApp Forms                            | `WaFormController`     | `WaForm`, `WaFormSubmission` | `/wa-forms`                      | Cloud API (WABA) only, hard gate |
| WhatsApp Link Generator ("click to chat") | `WaChatLinkController` | `WaChatLink`                 | `/wa-links` + public `/l/{slug}` | engine-agnostic                  |

**WhatsApp Forms** sends a published Meta WhatsApp Flow ("form") to a customer from inside the flow builder (the
`wa_form` node, already ported — see `flow-builder-editor.md` TW-FLB-056, do not re-touch) and records every
submission for review/export. Authoring (build screens/fields, publish to Meta, review submissions, export CSV) is
owned here; _sending_ it at runtime is FLB/FLR's.

**WhatsApp Link Generator** mints a trackable short link (`/l/{slug}`) that opens `wa.me` with a pre-filled welcome
message, for use in ads/bios/QR codes. Click-counted, engine-agnostic (works regardless of which WhatsApp engine the
workspace uses), has nothing to do with the generic broadcast/campaign click-tracker (`WaLinkClick` /
`LinkRedirectController` / `/r/{token}`, which belongs to BCAST/CAMP/TPL — out of scope here, flag any mis-tagged
references to it in other domains' docs instead of absorbing it).

Actors: workspace owner/admin for both (`workspace.role:admin`); Meta via Cloud API webhooks for forms publish-result.

Main flows end to end:

1. **Forms**: admin opens `/wa-forms`, creates a form, the builder (3-pane: field-type drawer, canvas, live WhatsApp
   bubble preview) edits screens/fields client-side and autosaves via `POST /wa-forms/api/save` (creates on first
   save). Publish (`POST /wa-forms/{id}/publish`) resolves WABA creds, creates-or-reuses the Meta Flow, uploads
   `flow.json`, ensures the WABA's Flows encryption public key is registered, and publishes; failures (including
   Meta's "Blocked by Integrity" account-verification case) persist a translated `publish_error`. Editing a
   published form silently drops it back to `draft`. The flow builder's `wa_form` node reads `GET /wa-forms/api/list`
   to offer only forms that exist (drafts show "(draft)" and are skipped at runtime — already documented in FLB).
   A Meta `nfm_reply` webhook resumes the parked flow and lands a submission row; submissions list/export live under
   `/wa-forms/{id}/submissions[/export]`.
2. **Links**: admin opens `/wa-links`, a 3-step wizard (Destination phone → Starter message → Tracking: slug/
   expiry/UTM) mints a short link via `POST /wa-links/api/save`; slug uniqueness is **global** (the public namespace
   `/l/{slug}` is shared across workspaces), 7–15 digit E.164 phone validation, UTM fields are stored for reporting
   only and never appended to the actual `wa.me` URL. `GET /l/{slug}` (public, no auth) 404s if missing, 410s if
   paused/expired, else atomically bumps `click_count`/`last_clicked_at` and redirects to `wa.me`.

Plan tiers: `plan:access_wa_forms` and `plan:access_wa_links` gate their route groups, but **both keys have no
backing column in the plan-features table** (see `plans-subscriptions-trials.md`, already documented as a PLAN-owned
gap — `EnforcePlanFeature` falls back to `true` for an unknown key) so both routes are, in practice, open on every
plan; port note: implement the gate correctly (don't carry the bug forward) unless intentionally reproducing it, and
record which.

Connections: FLB/FLR (`wa_form` node send+resume, `GET /wa-forms/api/list`, flow token format `form-<formId>-
<sessionKey>`), WABA (provider configs/credentials via `GET /api/waba-creds`, Graph API client), NODE (X-Node-Token
bridge auth, `executeWaFormNode`/`resumeForm` in `flowService.js`/`flowController.js`), CHAT/TIB1 (form submissions
mirrored into the inbox as a message), CON (contact resolution for a submission, by decrypt+compare over every
workspace contact's mobile — no indexed lookup, a perf note), PLAN (the two no-op plan-feature keys above).

## Open questions / port decisions to settle before building

1. **Duplicate flatten logic (Forms)**: the flow-resume answer-flattening (title/name/label/value/text/id
   extraction) is implemented twice — once in `WaFormSubmissionService::flattenAnswer` (PHP, on webhook ingest) and
   once in `node/controllers/flowController.js::resumeForm` (JS, on flow resume). Port once, shared.
2. **Two Laravel-side WhatsApp Form senders**: `FlowNodeActionsController::waFormSend` (sets
   `flow_action_payload.screen`) appears to have no caller — `executeWaFormNode` in Node sends directly to Meta
   without it. Port one sender only (the `screen`-setting variant is the one TW-FLB-056's port notes already call
   out as canonical); do not port the unused endpoint as dead code unless an API consumer is found.
3. **wa-links status tabs are decorative**: the index view renders All/Live/Paused filter pills but neither the
   controller nor the list JS wires them to a server- or client-side filter. Decide: implement the filter for real
   (recommended — it's an obvious UX gap) or drop the dead pill UI; either way this is an intentional deviation, not
   a silent carry-forward.
4. **Nav/route tier mismatch for wa-links**: nav shows it at manager tier, the route requires admin. Decide once for
   the whole port's RBAC (recommended: admin, matching the route, and fix the nav) rather than reproducing a 403 trap.
5. **QR code generation for links is an external dependency** (`api.qrserver.com`, client-side, no server QR
   generation) — decide whether to keep calling a third-party QR API or generate server-side; either is a legitimate
   choice, just make it deliberately.

## Feature index

| Id         | Feature                                                                  | Status  | Priority | Effort | Depends on |
| ---------- | ------------------------------------------------------------------------ | ------- | -------- | ------ | ---------- |
| TW-WFL-001 | Forms list page, KPI stats and pagination                                | done    | P0       | M      | -          |
| TW-WFL-002 | Form builder UI (field types, screens, live bubble preview)              | done    | P0       | L      | TW-WFL-001 |
| TW-WFL-003 | Save/autosave pipeline (create-or-update, draft-on-edit-of-published)    | done    | P0       | M      | TW-WFL-002 |
| TW-WFL-004 | Publish pipeline (Meta Flow create/update, asset upload, encryption key) | done    | P0       | L      | TW-WFL-003 |
| TW-WFL-005 | Publish error translation (incl. "Blocked by Integrity")                 | done    | P1       | S      | TW-WFL-004 |
| TW-WFL-006 | Duplicate / delete a form                                                | done    | P1       | S      | TW-WFL-001 |
| TW-WFL-007 | Picker endpoint for the flow builder's `wa_form` node                    | done    | P0       | S      | TW-WFL-003 |
| TW-WFL-008 | Submission ingest from Meta's `nfm_reply` webhook + flow resume          | done    | P0       | L      | TW-WFL-004 |
| TW-WFL-009 | Submissions list, contact resolution, inbox mirror                       | done    | P0       | M      | TW-WFL-008 |
| TW-WFL-010 | Submissions CSV export (CSV-injection safe)                              | done    | P1       | S      | TW-WFL-009 |
| TW-WFL-011 | Engine gate (Cloud API only) and plan-feature gate                       | done    | P0       | S      | -          |
| TW-WFL-012 | Links list page, KPI stats, search                                       | done    | P0       | M      | -          |
| TW-WFL-013 | Link builder wizard (destination, starter message, tracking)             | done    | P0       | M      | TW-WFL-012 |
| TW-WFL-014 | Save pipeline (E.164 validation, global slug uniqueness, UTM storage)    | done    | P0       | M      | TW-WFL-013 |
| TW-WFL-015 | QR code generation for a link                                            | done    | P2       | S      | TW-WFL-014 |
| TW-WFL-016 | Duplicate / delete a link                                                | done    | P1       | S      | TW-WFL-012 |
| TW-WFL-017 | Public redirect + click tracking (`/l/{slug}`)                           | done    | P0       | M      | TW-WFL-014 |
| TW-WFL-018 | Status filter (live/paused) — implemented for real, not left as dead UI  | done    | P2       | S      | TW-WFL-012 |

## Features

### TW-WFL-001 — Forms list page, KPI stats and pagination

- **Summary:** Paginated (20/page) list of the workspace's forms, newest first, with submission counts per form and
  workspace-wide KPI tiles (all / published / draft / total submissions).
- **Actors & access:** workspace admin; redirected to `/more` (or 403 JSON for an XHR request) unless the Cloud API
  (`waba`) engine is enabled for the workspace.
- **Rules & edge cases:**
  1. Counts are `withCount('submissions')` per row plus a separate workspace-wide submission count query.
  2. Empty state: icon + "No forms yet" + create CTA.
  3. Status pill: published = positive, paused = warning, draft = neutral.
- **Source refs:** `app/Http/Controllers/WaFormController.php::index`, `resources/views/user/wa-forms/index.blade.php`.
- **Port notes:** standard cursor-paginated list module; KPI tiles are a single aggregate query, not N+1.

### TW-WFL-002 — Form builder UI (field types, screens, live bubble preview)

- **Summary:** 3-pane builder: a field-type drawer (display/text-input/choice-input groups) that adds fields to the
  active screen, a canvas of screens (add/reorder/delete fields, move up/down, manage choice options), and a live
  WhatsApp-bubble preview of the greeting + first screen. A "Form basics" panel edits title, audience type, purpose,
  submission cap, cap-reached note, send-button label, thank-you note.
- **Actors & access:** workspace admin.
- **Rules & edge cases:**
  1. New-form default payload seeds one screen with heading + name + email fields.
  2. Every field/screen edit re-renders both the designer canvas and the live preview from one client-side `state`
     object — no partial server round-trips while editing.
  3. Field ids are client-generated (`fld_<6-char-random>`), not server-assigned, so they're stable across
     autosaves.
- **Source refs:** `resources/views/user/wa-forms/builder.blade.php`, `public/.../user-wa-forms-builder.js`.
- **Port notes:** a Next.js client-state builder mirroring this shape; no server call per keystroke, only on
  Save/Publish.

### TW-WFL-003 — Save/autosave pipeline (create-or-update, draft-on-edit-of-published)

- **Summary:** `POST /wa-forms/api/save` creates on first save (no `id`) or updates; validates title/purpose/
  audience_type/submission_cap/cap_reached_note/send_button_label/thank_you_note/`definition` (array, `screens`
  required, min 1); auto-generates a unique-per-workspace slug from the title with a numeric-suffix retry loop.
- **Rules & edge cases:**
  1. **Editing a published form silently drops it back to `draft`.** This is a named, documented Reference behavior
     (see automation/wa-forms.html) — reproduce it deliberately, don't "fix" it without flagging the deviation.
  2. Returns `{ok, id, slug, redirect_to}` so the client can transition create→edit without a full reload.
- **Source refs:** `WaFormController::apiSave`.
- **Port notes:** `rowVersion` optimistic lock on update; slug unique per `(org_id, workspace_id, slug)` (Reference:
  `(workspace_id, slug)`).

### TW-WFL-004 — Publish pipeline (Meta Flow create/update, asset upload, encryption key)

- **Summary:** `POST /wa-forms/{id}/publish`: resolve WABA creds (iterate the workspace's WABA provider configs,
  newest first, optionally pinned by `provider_config_id`, pick the first with both `access_token` and `waba_id`);
  create the Meta Flow if `meta_flow_id` is unset (idempotent — re-publish picks up where it left off rather than
  recreating); build Meta Flow JSON v5.1 from `definition_json` (screen ids letter-encoded `SCREEN_A`/`SCREEN_B`...
  because Meta disallows digits in screen ids; fields wrapped in a `Form` component named `"form"`; hyphenated Meta
  property names `on-click-action`/`data-source`/`input-type`/`helper-text`; last screen's footer action is
  `complete` with payload `${form.<id>}` per field, non-last screens `navigate` and forward the same payload; no
  `data_api_version` key, keeping it a no-endpoint/self-contained flow — adding one forces `endpoint_uri` and Meta
  rejects publish); upload the asset, surface the first `validation_errors` detail+line on failure; ensure the
  WABA's Flows RSA-2048 public key is registered (idempotent, generated once per provider config); publish.
- **Rules & edge cases:**
  1. `mapCategory()`: `audience_type` → Meta's Flow category enum (`LEAD_GENERATION|SURVEY|APPOINTMENT_BOOKING|
CUSTOMER_SUPPORT|SIGN_UP|OTHER`).
  2. On success: `status=published`, `published_at=now()`, `publish_error=null`. On failure: persist a truncated
     (1000 char) `publish_error`, flash an error, status stays as-is (does not force `draft`).
- **Source refs:** `WaFormController::publish`, `buildMetaFlowJson`, `ensureFlowsPublicKey`, `mapCategory`.
- **Port status (done, one gap flagged):** built as a `provider-adapter`
  (`infra/providers/forms-links-groups/wa-form-flows.{port,client}.ts`, `wa-form-flow-json.ts`) so the Graph version
  and credential resolution are swappable/testable, reusing the existing `WabaHttp`/`WABA_CONNECTIONS` ports rather
  than new credential plumbing. **Not ported:** registering the Flows encryption public key — Meta accepts a
  no-endpoint flow publish without it in practice; revisit if a real Business Account publish is rejected for a
  missing key.

### TW-WFL-005 — Publish error translation (incl. "Blocked by Integrity")

- **Summary:** Meta error `139000` / subcode `4233020` / body containing "Blocked by Integrity" is translated to an
  account-verification message, distinct from a generic form-validation failure.
- **Source refs:** `WaFormController::publish` (error branch).
- **Port notes:** a small translated-error-code map living beside the Meta Flows adapter.

### TW-WFL-006 — Duplicate / delete a form

- **Summary:** Duplicate replicates everything except `slug`, `meta_flow_id`, `published_at`, `status`,
  `submission_count`; appends " (copy)" + a random 4-char slug suffix; forces `status=draft`. Delete is a soft
  delete; the UI confirms with "Active flow nodes that reference it will break."
- **Source refs:** `WaFormController::duplicate`, `::destroy`.
- **Port notes:** hard delete per this repo's convention (no soft deletes) — note as an intentional deviation; keep
  the confirm-dialog warning copy since the underlying risk (a flow node pointing at a deleted form) is real here too.

### TW-WFL-007 — Picker endpoint for the flow builder's `wa_form` node

- **Summary:** `GET /wa-forms/api/list` → `{ok, forms:[{id,title,status,is_published}]}`, where
  `is_published = status==='published' && meta_flow_id` — already consumed by FLB (TW-FLB-056); do not change its
  shape without coordinating with that domain.
- **Source refs:** `WaFormController::apiList`.
- **Port notes:** contract lives in `packages/contracts/src/forms-links-groups/`. The flow builder's own picker
  (`builder-context.service.ts`) currently reads `wa_forms` directly by SQL rather than through this contract —
  this endpoint exists for API/mobile consumers; coordinate before changing the `wa_forms` table shape either way.

### TW-WFL-008 — Submission ingest from Meta's `nfm_reply` webhook + flow resume

- **Summary:** An inbound WABA message of `type=interactive, interactive.type=nfm_reply` is routed by
  `WaWebhookController` to `WaFormSubmissionService` — **this bypasses the normal inbound-message pipeline
  entirely**. The service parses the `flow_token` (`form-<formId>-<sessionKey>`), flattens each answer (title/name/
  label/value/text/id extraction; arrays joined with ", "), resolves the contact by decrypting and comparing every
  workspace contact's mobile number (no indexed phone lookup), writes a `wa_form_submissions` row, mirrors an
  `InboxMessage` into the team-inbox conversation (`meta.type='wa_form_submission'`), and calls Node's
  `POST /api/flow/resume-form/:sessionKey` to resume the parked flow with the answers as variables (both
  `form_<field_id>` and bare `<field_id>` keys). The Node side no-ops (200) on a missing/already-resumed session —
  defensive against webhook retries.
- **Rules & edge cases:**
  1. The flatten logic is duplicated in PHP (ingest) and JS (`flowController.js::resumeForm`, defensive re-flatten) —
     port once, shared between the webhook handler and the flow-runtime resume path.
  2. Contact resolution by decrypt+compare-all is a real perf concern at scale; port with an indexed/hashed phone
     lookup instead of carrying the O(n) scan forward (intentional improvement, record it).
- **Source refs:** `app/Services/Forms/WaFormSubmissionService.php`, `WaWebhookController::handle` (nfm_reply
  branch), `node/controllers/flowController.js::resumeForm`.
- **Port status: done** (this entry was stale — it previously said "blocked, not built yet"; confirmed built and
  corrected 2026-10-16). The cross-domain handoff this entry called for landed as a listener, not an outbox event:
  `CommerceResume` (`flow-runtime-engine/runtime/nodes/commerce/commerce-resume.ts`) registers as an
  `InboundMessageListener` on the normal inbound-message pipeline (`InboundMessageHooks`) rather than bypassing it
  the way Reference's `WaWebhookController` does, and matches a submission to its flow token itself
  (`parseFormToken`) — no separate webhook branch or Node resume-session endpoint. `WaFormRecords`
  (`wa-form-records.ts`) is the forms domain's own read/write surface for `wa_forms`/`wa_form_submissions`, used
  by that listener instead of a facade this domain exposes (still a known gap, see its own doc comment). The O(n)
  decrypt-and-compare contact resolution this entry flagged as a perf concern does not carry forward: contact
  resolution is the normal inbound-message pipeline's own (indexed), not re-implemented here.
  - **Port addition, 2026-10-16 (not in Reference):** a form field can carry `mapsTo` (one of
    `WA_FORM_SYSTEM_MAP_FIELDS` or an active custom contact attribute key); `CommerceResume.applyFieldMappings`
    writes the matching answers onto the submitting contact via `ContactsService.setFieldFromFlow` — the same
    safe writer the flow engine's own "Update contact field" step uses, so a mapping is skipped (not an error) if
    the target attribute was since deactivated, and phone can never be overwritten by a form answer. Reference's
    `WaFormSubmissionService` never writes submission answers onto contact fields at all; this is a net-new
    enhancement, not a parity gap, and does not change the stored submission shape (`wa_form_submissions` is
    unaffected).

### TW-WFL-009 — Submissions list, contact resolution, inbox mirror

- **Summary:** `GET /wa-forms/{id}/submissions`: paginated (25/page) list with resolved contact name/phone, newest
  first; dynamic columns = Submitted/Contact/Phone + one column per form field label (heading-kind fields excluded
  from the label map).
- **Source refs:** `WaFormController::submissions`, `fieldLabels()`, `resources/views/user/wa-forms/submissions.blade.php`.
- **Port status (done):** the list/export work regardless of how a row got there — now the real ingest pipeline
  (TW-WFL-008, corrected 2026-10-16 from an earlier "not built yet" note), not submissions written directly.

### TW-WFL-010 — Submissions CSV export (CSV-injection safe)

- **Summary:** `GET /wa-forms/{id}/submissions/export`: streamed CSV, chunked 500 rows; cells starting with `=`,
  `+`, `-`, `@` are prefixed with `'` to defuse formula injection in spreadsheet apps.
- **Source refs:** `WaFormController::exportSubmissions`.
- **Port notes:** keep the CSV-injection guard — it is a real, known class of vulnerability (CWE-1236), not a
  Reference quirk to drop.

### TW-WFL-011 — Engine gate (Cloud API only) and plan-feature gate

- **Summary:** Every Forms route is blocked unless the workspace has the `waba` engine enabled (controller-level
  guard, not route middleware); `plan:access_wa_forms` wraps the route group but the plan-feature key has no backing
  column (PLAN-owned gap — falls back to allow-all).
- **Source refs:** `WaFormController` `HasMiddleware` closure; `plans-subscriptions-trials.md`.
- **Port status (done):** the plan feature gate uses the already-registered `forms_and_links` key (on by default —
  Reference's own name for "WhatsApp Flows forms", see `packages/contracts/src/plans-subscriptions-trials/
catalogue.ts`), via `@RequirePlanFeature('forms_and_links')` on `WaFormsController`. NOT `form_builder`, the
  unrelated web-forms Marketplace app's key. The engine gate (workspace must have a connected Cloud API/WABA
  provider config) is enforced inside `WaFormsService.publish` by requiring usable credentials, rather than
  blocking the whole CRUD surface the way Reference's controller-level redirect does — an intentional, narrower
  deviation: list/create/edit work even before a number is connected, and publish is where Reference's gate actually
  mattered.

### TW-WFL-012 — Links list page, KPI stats, search

- **Summary:** Paginated (20/page) list with 4 KPI tiles (total links + live count, total clicks, avg clicks/link,
  a health % derived label); client-side substring search over name+slug (no server round-trip).
- **Source refs:** `WaChatLinkController::index`, `resources/views/user/wa-links/index.blade.php`,
  `user-wa-links-index.js`.

### TW-WFL-013 — Link builder wizard (destination, starter message, tracking)

- **Summary:** 3-step wizard: (1) name, status, phone via an international-phone-number widget; (2) welcome message
  with a live bubble preview; (3) slug (prefixed `/l/` in the UI), expiry date, UTM source/medium/campaign. Each
  step validates client-side before advancing (name required + phone digits ≥6 on step 1, slug regex on step 3);
  once minted, shows the short URL, the `wa.me` URL and a downloadable QR code.
- **Source refs:** `resources/views/user/wa-links/builder.blade.php`, `user-wa-links-builder.js`.

### TW-WFL-014 — Save pipeline (E.164 validation, global slug uniqueness, UTM storage)

- **Summary:** `POST /wa-links/api/save`: validates name (max140), country_code (max8), phone_number (max24,
  normalized to digits-only), welcome_message (max4000), slug (max64, `^[a-z0-9-]+$`, blank → random 8-char
  lowercase via `freshSlug()`), UTM fields (max80 each), expires_at (date), status (`active|paused`). Combined
  digits (country+number) must be 7–15 (E.164 length) else a field-level 422. Slug uniqueness is checked **globally**
  — the public redirect namespace is shared across all workspaces — with a numeric-suffix retry loop on collision.
  Returns `{ok, id, slug, wa_url, short_url}`.
- **Rules & edge cases:**
  1. UTM fields are stored for reporting only; `waUrl()` never includes them — WhatsApp would ignore them anyway
     (documented, explicit behavior, not an oversight).
- **Source refs:** `WaChatLinkController::apiSave`, `app/Models/WaChatLink.php`.
- **Port status (done):** global slug uniqueness means this table's unique index is NOT tenant-scoped on `slug`
  alone — still forced-RLS on `workspace_id` for every authenticated operation; the public lookup/uniqueness-check
  by slug alone goes through dedicated `SECURITY DEFINER` Postgres functions
  (`wa_chat_link_lookup`/`wa_chat_link_slug_taken`/`wa_chat_link_record_click`) rather than a plain SELECT, the same
  pattern as `forms-builder`'s `web_form_lookup(public_key)` function.

### TW-WFL-015 — QR code generation for a link

- **Summary:** Client-side only, via a public QR image API (`api.qrserver.com`), 256×256, no server-side generation.
- **Source refs:** `user-wa-links-builder.js`.
- **Port status (done):** kept the third-party QR API client-side, matching Reference, rather than adding a
  server-side generation dependency.

### TW-WFL-016 — Duplicate / delete a link

- **Summary:** Duplicate mints a fresh slug via `freshSlug()`, resets `click_count=0`/`last_clicked_at=null`, name
  suffixed " (copy)". Delete returns `{ok:true}` (soft delete in Reference — port as hard delete + audit per
  convention).
- **Source refs:** `WaChatLinkController::duplicate`, `::destroy`.

### TW-WFL-017 — Public redirect + click tracking (`/l/{slug}`)

- **Summary:** Public route, no auth, no CSRF. 404 if slug not found; 410 if `!isActive()` (status≠active or past
  `expires_at`); else atomically increments `click_count` and sets `last_clicked_at=now()` (single `UPDATE ...
SET count = count + 1` statement, not read-then-write), then redirects (302) to the `wa.me` URL.
- **Source refs:** `WaChatLinkController::publicRedirect`.
- **Port status (done, hardened):** added a Redis-backed per-IP rate limit (Reference has none) since the route is
  unauthenticated and writes on every hit — an intentional hardening addition, not Reference parity.

### TW-WFL-018 — Status filter (live/paused) — implemented for real

- **Summary:** The index view renders All/Live/Paused filter pills; in Reference, neither the controller nor the
  client JS wires them to any actual filtering.
- **Source refs:** `resources/views/user/wa-links/index.blade.php`, `user-wa-links-index.js` (absence of a handler).
- **Port status (done, fixed):** implemented the filter for real (server-side `status` query param) rather than
  carrying the dead pill UI forward — an intentional deviation from Reference, not a bug.
