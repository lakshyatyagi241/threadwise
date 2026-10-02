# Geta WhatsApp message templates and Flows: behaviour spec for the WaDesk port

Source: read-only survey of /home/getaweblpubt24/Documents/geta (2026-10-02). Paths below are relative to that folder.
No secret values were read. Environment variable and config key NAMES only.

Conventions
- "native" = Meta Graph API at `https://graph.facebook.com` (IS_INTERAKT_ENABLED not "true").
- "Interakt" = BSP proxy `https://amped-express.interakt.ai/api` (IS_INTERAKT_ENABLED = "true").
- `BASE` = active base URL (see section 0). `WABA` = `META_WHATSAPP_CONFIG.waba_id`.
- "constructed" = I built the example from Geta's code (validation schemas plus frontend builder). The exact call shape (method, URL, headers) is verbatim from code. Geta never logs or stores a sample Meta payload, so body examples are Geta-shaped and not recorded wire captures.
- Anything not present in the Geta repos is marked "not found".

---------------------------------------------------------------------------------------------------

## 0. Architecture and provider switch

Request flow for create and delete (the only calls that mutate Meta):

```
Browser (bug/console-whatsapp-frontend)
  -> geta-broadcast-service (Flask/Python, Mongo)  : local validation, permission check, Mongo persistence
  -> geta-whatsapp-service (Node/Express, Joi)      : second validation (Joi), the ONLY place that calls Meta/Interakt for create/delete/get
  -> Meta Graph  OR  Interakt amped-express
```
Sync (list) is done separately by a Celery task in Voice/geta-async that calls Meta/Interakt directly. Template-status webhooks land in geta-whatsapp-service.

Provider switch
- Env flag `IS_INTERAKT_ENABLED` (string, case-insensitive "true"). Defined in:
  - geta-broadcast-service/src/util/global_enums.py:16-19
  - geta-whatsapp-service/src/utils/enum.js:60-61 and src/helpers/metaHeaders.js:1-39
  - Voice/geta-async/src/helpers/global_enums.py (same pattern), geta-core/src/util/global_enums.py:13-17
- Base URL (env names): `META_API_ENDPOINT` (default `https://graph.facebook.com`), `META_API_VERSION` (default `v25.0`), `INTERAKT_API_ENDPOINT` (default `https://amped-express.interakt.ai/api`), `INTERAKT_API_VERSION`.
  - Interakt version default differs per service: whatsapp-service enum.js:69 = `v25.0`; broadcast-service global_enums.py:13 = `v17.0`; geta-async global_enums.py:14 = `v17.0`; geta-core/auth = `v25.0`. The broadcast-service comment (global_enums.py:7-11) says v17.0 is kept because Interakt's `/media_handle` endpoint "has not been re-exposed on v24+". Treat `/media_handle` as v17.0-only on Interakt. Template CRUD works on whichever version is set.
  - `BASE` native = `https://graph.facebook.com/v25.0`. `BASE` Interakt = `https://amped-express.interakt.ai/api/v25.0` (whatsapp-service) or `.../api/v17.0` (broadcast/async).
- Headers (identical logic in all three services; broadcast-service/src/Meta/meta_api_helper.py:21-41, whatsapp-service/src/helpers/metaHeaders.js, geta-async/src/helpers/meta_api_helper.py:21-41):

| Mode | Header | Value source (META_WHATSAPP_CONFIG key) |
| --- | --- | --- |
| Native | `Authorization: Bearer <access_token>` | `access_token` |
| Interakt | `x-access-token: <auth_key>` | `auth_key` |
| Interakt | `x-waba-id: <waba_id>` | `waba_id` |
| both (JSON calls) | `Content-Type: application/json` | |
| Interakt flows asset upload only | `x-phone-number-id: <phoneID>` (extra) | `phoneID` |

- Per-workspace credentials come from the Mongo doc `chatbot_misc_config` where `config_key = "META_WHATSAPP_CONFIG"`, cached in Redis at key `{workspace_id}:chatbot_misc_config:META_WHATSAPP_CONFIG`. Keys used: `waba_id`, `access_token`, `auth_key`, `phoneID`, `chatbot_id`, `provider` (`interakt` | `pinnacle`), `migrated_to_interakt`. App id for native uploads: Mongo `geta_core.app_configuration` doc `config_key = "META_WHATSAPP_CONFIG"` field `config_value.client_id` (MetaMediaUpload.py:24-35).
- A third provider value exists (`pinnacle`, header `apikey`, `PINNACLE_URL`), used only for sending Flow test messages (whsatappFlow.js:280-288). Template CRUD has no Pinnacle path.

---------------------------------------------------------------------------------------------------

## 1. Template HTTP calls (exact requests)

### 1.1 Internal Geta endpoints (what the UI calls)

Broadcast service, routes at geta-broadcast-service/src/routers.py:166-174, prefix `workspace/broadcast` (routers.py:88):

| Purpose | Method + path | Handler |
| --- | --- | --- |
| Create | `POST /workspace/broadcast/whatsapp-template/create` | Resource/Template/Whatsapp.py:148-185 -> Meta.create_template (Meta/Meta.py:83-139) |
| Upload header media | `POST /workspace/broadcast/whatsapp-media-attach` (multipart field `source`) | Whatsapp.py:187-306 |
| List (paged, filtered) | `POST /workspace/broadcast/whatsapp-template-list` and duplicate `POST .../get-whatsapp-template-list` | Whatsapp.py:44-72, 74-102 -> MetaTemplates.py:66-189 |
| Get one | `GET /workspace/broadcast/whatsapp-templateById/<id>` and duplicate `.../get-whatsapp-templateById/<id>` | Whatsapp.py:105-145 -> MetaTemplates.py:222-237 |
| Delete | `POST /workspace/broadcast/delete-whatsapp-templateById/<id>` | Whatsapp.py:309-331 -> Meta.delete_template (Meta.py:142-182) |
| Sync | `GET /workspace/broadcast/sync-whatsapp-template` | Whatsapp.py:334-356 (queues Celery) |
| AI draft | `POST /workspace/broadcast/generate-template` | Whatsapp.py:359-793 (LLM, not Meta) |
| Options (core service) | `GET /core/whatsapp-template-options`, `/core/whatsapp-languages/`, `/core/whatsapp-categories/`, `/core/whatsapp-template-types/`, `/core/default-template` | geta-core/src/routers.py:371-377 (read Mongo `geta_core.whatsapp_template_configuration` and `default_whatsapp_template`; contents not in repo) |

WhatsApp service (called server-to-server from broadcast service with header `geta-host`), routes at geta-whatsapp-service/src/routes/routes.js:27-29:
- `POST {WHATSAPP_SERVICE_API_URL}/api/v1/whatsapp/create-template`  (Meta.py:102)
- `DELETE {WHATSAPP_SERVICE_API_URL}/api/v1/whatsapp/delete-template?template_name=<name>`  (Meta.py:155-163)
- `GET {WHATSAPP_SERVICE_API_URL}/api/v1/whatsapp/get-template?limit=&status=&name=` (exposed route, also used by API-key customers; controller whatsappController.js:442-477)
- Env var names: `WHATSAPP_SERVICE_API_URL`. Workspace is resolved by decrypting the `geta-host` header (customMiddleware.js:21-150). Not relevant to the port; we use our own tenancy.

### 1.2 CREATE template (Meta call)

whatsapp-service/src/controllers/whatsappController.js:302-379, call at 335-341.

```
POST {BASE}/{WABA}/message_templates
Native:   Authorization: Bearer <access_token>            Content-Type: application/json
Interakt: x-access-token: <auth_key>  x-waba-id: <WABA>   Content-Type: application/json
Body: { "name": ..., "language": ..., "category": ..., "components": [ ... ] }
```
IMPORTANT: only these four keys are forwarded (`const requestData = {name, language, category, components}`, controller:325-332). `allow_category_change`, `parameter_format`, `message_send_ttl_seconds`, `library_template_name`, `library_template_button_inputs` pass local validation but are DROPPED before the Meta call. So Geta never sends `allow_category_change` (Meta then applies its default: category may be auto-corrected or rejected depending on Meta version) and never sends `parameter_format` (so named params are unsupported; only positional `{{1}}`).

Success response (relayed as-is, HTTP 200): Meta returns `{ "id": "<template id>", "status": "PENDING"|"APPROVED"|"REJECTED", "category": "<MARKETING|UTILITY|AUTHENTICATION>" }`. Geta stores `id` as `meta_template_id`, `status` default "PENDING" (Meta.py:68-81).

Error mapping (controller:344-378): on Meta error returns HTTP 400 with only `{error:{message,type,code,error_subcode,is_transient,error_user_title,error_user_msg,fbtrace_id}}`. Broadcast service then returns to UI `{status:false, error: error_user_msg || error.message || "Invalid Parameter"}` with HTTP 400 (Meta.py:120-132). Special-case: message containing "not a valid phone number" is replaced by "Invalid phone number". Non-HTTP failures -> 500 `{"error":"Failed to create template"}`.

Post-create reconcile (Meta.py:25-54, called Meta.py:117): immediately after successful create, GET by name (see 1.5) and overwrite `status`, `language`, `category`, `name`, `components`, `modified_time` from Meta's canonical copy. This is how auto-corrected category or normalised components land in the DB.

Body examples (constructed; component shapes match what frontend sends, utils.tsx:479-760, and what validators accept):

MARKETING, text header with variable, positional body, footer, quick replies:
```json
{
  "name": "summer_sale_2026",
  "language": "en_US",
  "category": "MARKETING",
  "components": [
    {"type":"HEADER","format":"TEXT","text":"Hi {{1}}","example":{"header_text":["Asha"]}},
    {"type":"BODY","text":"Hello {{1}}, your code {{2}} gives {{3}} off.","example":{"body_text":[["Asha","SAVE20","20%"]]}},
    {"type":"FOOTER","text":"Reply STOP to opt out"},
    {"type":"BUTTONS","buttons":[{"type":"QUICK_REPLY","text":"Shop now"},{"type":"QUICK_REPLY","text":"Not interested"}]}
  ]
}
```
MARKETING, image header + URL (dynamic) + phone + copy code:
```json
{
  "name":"promo_with_cta","language":"en","category":"MARKETING",
  "components":[
    {"type":"HEADER","format":"IMAGE","example":{"header_handle":["4::aW1hZ2UvanBlZw==:ARb..."]}},
    {"type":"BODY","text":"Big news for you, see details."},
    {"type":"BUTTONS","buttons":[
      {"type":"COPY_CODE","example":"SAVE20"},
      {"type":"URL","text":"Visit","url":"https://example.com/p/{{1}}","example":["abc123"]},
      {"type":"PHONE_NUMBER","text":"Call us","phone_number":"+919876543210"}
    ]}
  ]
}
```
(Frontend builder order for copy-code+URL+phone+quick-reply: it iterates `copyUrlOptions` in a fixed order, quick replies first, then COPY_CODE, PHONE_NUMBER, URL; utils.tsx:~590-650.)

UTILITY, document header, flow button:
```json
{
  "name":"order_update","language":"en","category":"UTILITY",
  "components":[
    {"type":"HEADER","format":"DOCUMENT","example":{"header_handle":["4::..."]}},
    {"type":"BODY","text":"Your order {{1}} is ready.","example":{"body_text":[["#1042"]]}},
    {"type":"BUTTONS","buttons":[{"type":"flow","text":"Open form","flow_id":"1234567890","flow_action":"navigate","navigate_screen":"SCREEN_ONE"}]}
  ]
}
```
UTILITY, video header, location header (format only; no example, validator does `pass` for location, MetaTemplateValidation.py:106-108):
```json
{"type":"HEADER","format":"VIDEO","example":{"header_handle":["4::..."]}}
{"type":"HEADER","format":"LOCATION"}
```
AUTHENTICATION (exact shape sent by the UI, utils.tsx:~700-735; body must contain only `type` and `add_security_recommendation`, footer only `type` and `code_expiration_minutes`, header forbidden, exactly one OTP button):
```json
{
  "name":"login_otp","language":"en","category":"AUTHENTICATION",
  "components":[
    {"type":"BODY","add_security_recommendation":true},
    {"type":"FOOTER","code_expiration_minutes":10},
    {"type":"BUTTONS","buttons":[{"type":"OTP","otp_type":"COPY_CODE"}]}
  ]
}
```
One-tap / zero-tap OTP button shapes accepted by validator (constructed; UI only emits COPY_CODE):
```json
{"type":"OTP","otp_type":"ONE_TAP","text":"Copy code","autofill_text":"Autofill",
 "supported_apps":[{"package_name":"com.example.app","signature_hash":"K8a/AINcGX7"}]}
{"type":"OTP","otp_type":"ZERO_TAP","zero_tap_terms_accepted":true,
 "supported_apps":[{"package_name":"com.example.app","signature_hash":"K8a/AINcGX7"}]}
```
MPM and Catalog (frontend: utils.tsx:~520-545):
```json
{"type":"BUTTONS","buttons":[{"type":"MPM","text":"View items"}]}      // needs a TEXT header, marketing only
{"type":"BUTTONS","buttons":[{"type":"CATALOG","text":"View catalog"}]} // NO header allowed, marketing only
```
Limited-time offer (utils.tsx:~660-700; component types lower-case in this branch, accepted case-insensitively by Geta validators):
```json
{"type":"header","format":"IMAGE","example":{"header_handle":["4::..."]}},
{"type":"limited_time_offer","limited_time_offer":{"text":"Summer deal","has_expiration":true}},
{"type":"BODY","text":"Use code {{1}}","example":{"body_text":[["SAVE20"]]}},
{"type":"buttons","buttons":[{"type":"copy_code","example":"SAVE20"},{"type":"url","text":"Shop","url":"https://example.com/offer"}]}
```
Carousel (utils.tsx:348-440; each card has exactly HEADER(image|video, handle) + BODY + BUTTONS; max 10 cards; main bubble: BODY and optional FOOTER only):
```json
{"type":"BODY","text":"Check out our picks"},
{"type":"CAROUSEL","cards":[
  {"components":[
    {"type":"HEADER","format":"image","example":{"header_handle":["4::..."]}},
    {"type":"BODY","text":"Card text {{1}}","example":{"body_text":[["Item"]]}},
    {"type":"BUTTONS","buttons":[{"type":"QUICK_REPLY","text":"Buy"},{"type":"URL","text":"Open","url":"https://example.com/{{1}}","example":["x"]}]}
  ]}
]}
```

### 1.3 EDIT template
NOT FOUND. There is no edit call anywhere in Geta (no `POST /{template_id}`, no update route). The UI label "Edit Template" (TemplateCreate.tsx:~898) is cosmetic: when `template_id` is in the URL and status is APPROVED/REJECTED/PENDING the form is read-only with a Back button (TemplateCreate.tsx:432-436, 885-890); for other statuses (PAUSED, DISABLED, etc.) the submit just calls create again with the same name, which Meta rejects as duplicate. To change a template the user deletes it and re-creates it, or copies it ("copy template", `dataToTemplateFormData(..., isCopyTemplate)`).
Meta-side reference (not implemented in Geta): `POST {BASE}/{template_id}` with `components`/`category`; limits: 10 edits/30 days for approved, 1/day. Port should add this as an enhancement and mark it "beyond Geta".

### 1.4 DELETE template
whatsapp-service controller:382-440, call at 395-402:
```
DELETE {BASE}/{WABA}/message_templates?name=<template_name>
(same headers as 1.2; no body)
```
- By NAME only. Deletes ALL language variants of that name on Meta. `hsm_id` query param is NOT used anywhere ("hsm_id" not found).
- Joi: `template_name` required string (validation.js:335-351).
- Success -> `{success:true}` from Meta. Geta then deletes the Mongo doc (Meta.py:166-171).
- Pre-checks in broadcast service (Meta.py:142-178): permission `whatsapp_template.delete` (global/restricted/none), block if a broadcast with `broadcast_template_id = id` has status `processing` or `scheduled` ("Template is being used in a running broadcast"), block if `used_in_automation` is true ("Template is being used in an automation").
- Delete failure -> 400 `{status:false, deletion_error:"Template deletion failed", ...}`; Mongo doc kept.
- Not deleted on Meta in sync-delete direction (see section 4: sync deletes local docs missing on Meta).

### 1.5 LIST / GET templates (Meta calls)

(a) Status refresh for PENDING rows on listing: MetaTemplates.py:40-64
```
GET {BASE}/{WABA}/message_templates?fields=id,name,status&limit=1000
headers per 0 (timeout 30s)
```
Reads `data[].id -> status` into a map. No pagination follow-up (`paging.next` ignored), so only the first 1000 templates are considered; rows not found stay "PENDING". It runs at most once per list request and only if any listed row is PENDING (MetaTemplates.py:169-175). Updates Mongo by `meta_template_id` via bulk write (176-177).

(b) By name (post-create reconcile): Meta.py:25-33
```
GET {BASE}/{WABA}/message_templates?name=<name>      (timeout 30s)
```
Takes `data[0]` (first language variant only) and copies `status, language, category, name, components`.

(c) Full sync: Voice/geta-async/src/Meta/SyncMetaTemplates.py:50-68
```
GET {BASE}/{WABA}/message_templates          (first page; NO fields, NO limit param -> Meta defaults)
GET <paging.next URL verbatim>               (subsequent pages, same headers)
```
Response fields consumed per item: `id, name, language, status, category, components`. Loop ends when `paging.next` is absent.

(d) Exposed API: `GET /api/v1/whatsapp/get-template?limit=10&status=&name=` (whatsappController.js:442-477) -> `GET {BASE}/{WABA}/message_templates` with params `limit, status, name`; returns `{status:"success", message: <data array>}`. Joi also accepts `offset` but it is not forwarded.

Not found: `fields=` list including `quality_score,rejected_reason,correct_category,previous_category,sub_category`; `GET /{template_id}`; per-WABA `template_analytics` (graph `/{WABA}?fields=template_analytics...`) and `template_group_analytics` ("template_analytics" not found; the UI's "WhatsappTemplateAnalytics" screen at Templates/WhatsappTemplateAnalytics reads Geta's own broadcast stats, not Meta). Quality is only learned from webhooks.

### 1.6 Local list API (UI-facing)
`POST /workspace/broadcast/whatsapp-template-list`, body keys (MetaTemplates.py:66-80): `start`, `end` (dates, interpreted in workspace timezone, default Asia/Kolkata, filter on `modified_time`, end +1 day), `search` (regex, case-insensitive on `name` OR `meta_template_id`), `status` (case-insensitive regex), `category` (list, `$in`), `limit` (default 10), `offset` (page index, default 0). Always filters `type: "whatsapp"`, sorted by `created_time` desc. Response `{results:[...], count, pagination:{currentPage, perPage, totalPages, totalRecords}}`. Each row gets `can_delete`, `can_update` from RBAC (`whatsapp_template` read/update/delete = global_access|restricted_access|none; restricted compares `created_by.id`) and `used_automation_names`. `inputValues` is excluded from the list projection. UI status filter offers APPROVED, REJECTED, PENDING only (TemplatesListing.tsx:~570).

---------------------------------------------------------------------------------------------------

## 2. Media handle upload for template header examples

Template header `example.header_handle[0]` must be a Meta media handle (`4::...`), not a URL. Geta produces it in two places:

### 2.1 Explicit upload from the UI
`POST /workspace/broadcast/whatsapp-media-attach` (multipart, file part `source`), Whatsapp.py:187-306. Steps:
1. Look up extension in Mongo `geta_core.file_extension` (`{name:"pdf", size:<bytes>}`); unknown -> 400 "Unsupported File Type."; size greater than the limit -> 400 "Unsupported File Size." (limits stored in DB, values not in repo).
2. Branch on `IS_INTERAKT_ENABLED`.
3. On success the file is also stored in Geta attachments and the response is `{ "id": "<handle h>", "source": "<geta file url>", "file_name": ..., "attachment_id": ..., "status": true }`. The UI puts `id` into `header_handle` and keeps `attachment_id` for preview.

MIME map (Whatsapp.py:215-221 for Interakt; MetaMediaUpload.py:9-15 for native): pdf=application/pdf, jpeg=image/jpeg, jpg=image/jpeg (Interakt path) or image/jpg (native path, MetaMediaUpload.py:12 - non-standard), png=image/png, mp4=video/mp4. No gif, webp, 3gp, docx, etc.

### 2.2 Native (facebook) resumable upload
MetaMediaUpload.py, native only (always uses `MetaApiEnum.META_API_BASE_URL`, line 21 - NOT flag-aware):
```
Step 1  POST https://graph.facebook.com/{v}/{APP_ID}/uploads
        query params: file_name=<name>&file_length=<bytes>&file_type=<mime>&access_token=<access_token>
        (token is in the query string; no auth header)
        -> 200 {"id":"upload:<session>"}                              (MetaMediaUpload.py:33-59)
Step 2  POST https://graph.facebook.com/{v}/upload:<session>
        headers: Authorization: OAuth <access_token>   file_offset: 0
        body: raw file bytes (requests data=bytes, no Content-Type set)
        -> 200 {"h":"4::aW1h..."}                                       (MetaMediaUpload.py:62-88)
```
`APP_ID` = `geta_core.app_configuration[config_key=META_WHATSAPP_CONFIG].config_value.client_id`.

### 2.3 Interakt equivalent (single call)
Whatsapp.py:212-261 and MetaTemplateValidation.py:1070-1121:
```
POST https://amped-express.interakt.ai/api/v17.0/{phoneID}/media_handle
headers: x-access-token: <auth_key>   x-waba-id: <waba_id>          (NO Content-Type; requests sets multipart boundary)
multipart/form-data:
   file=(filename, bytes, mime)     messaging_product=whatsapp     type=<mime>
-> 200 {"h":"4::..."}
```
- Needs `phoneID` in META_WHATSAPP_CONFIG (error "phoneID not configured" otherwise). The path uses the PHONE NUMBER id, not the app id; no app id is involved.
- Version: broadcast-service pins v17.0 by default for this reason (global_enums.py:7-13).
- Non-200: error text of Interakt relayed with the same HTTP status.

### 2.4 Automatic CDN-URL to handle conversion (used by copy/default templates)
MetaTemplateValidation.handle_media_headers (1019-1041, called from header validation at line 104 and carousel header at line 657): if `header_handle[0]` matches regex `https://scontent\.whatsapp\.net/.*`, Geta downloads it (GET, 30s timeout), infers the extension from `content-type` or URL (`jpeg|jpg|png|mp4|pdf`), uploads it via 2.2 or 2.3, and substitutes the returned handle. If any step fails it silently returns the original URL (Meta will then reject). Any other string is passed through as already a handle.

---------------------------------------------------------------------------------------------------

## 3. Local validation rules (applied before submit)

Two validators run in sequence; both must pass. L1 = Python `MetaTemplateValidation.validate_template` (geta-broadcast-service/src/Meta/MetaTemplateValidation.py:879-1016, runs first, error returned as HTTP 400 `{error: <msg>, status:false}`). L2 = Joi `templateSchema` in whatsapp-service (validation.js:276-330, returns 400 `{errors:[{field,message}]}` which the broadcast service surfaces as "Invalid Parameter"-class text). L0 = UI Yup (Constants.ts:261-). Frontend-only rules listed last.

Counting rule: L1 `count_variables` only counts `{{\d+}}` (MetaTemplateValidation.py:17-22). L2 `countVariables` counts anything matching `{{...}}` (validation.js:4-8). Named variables (`{{first_name}}`) are therefore not validated by L1 and would be mishandled by L2 body-example matching. Treat Geta as positional-only.

### 3.1 Template level

| Rule | L1 | L2 |
| --- | --- | --- |
| `name`, `language`, `category`, `components` required | yes (879-889) | `whatsapp_business_account_id`, `access_token` also required (injected, see 6) |
| `name` string | yes; NO regex, NO length check in L1 | `max(512)`; no regex |
| `language` in allowed list | case-insensitive (898) | case-SENSITIVE `valid(...)` (validation.js:286) |
| `category` in utility, marketing, authentication | case-insensitive (900) | `valid(UTILITY, MARKETING, AUTHENTICATION).insensitive()` |
| optional `allow_category_change` bool, `library_template_name` str, `message_send_ttl_seconds` int, `library_template_button_inputs` list of str | yes (904-919) | yes (290-293) |
| unknown top-level keys | tolerated | REJECTED (Joi default, no `allowUnknown`), e.g. `businessName`, `parameter_format`, `code_expiration_minutes` |
| components list; each has `type` in header, body, footer, buttons, carousel, limited_time_offer (case-insens.) | yes (931-943) | yes |
| exactly 1 BODY; max 1 each of HEADER, FOOTER, BUTTONS, CAROUSEL, LIMITED_TIME_OFFER | yes (954-965) | HEADER/BODY/FOOTER/CAROUSEL/LTO only (buttons component count not enforced in L2) |

Allowed language codes (both lists identical, 79 codes): af, sq, ar, az, bn, bg, ca, zh_CN, zh_HK, zh_TW, hr, cs, da, nl, en, en_GB, en_US, et, fil, fi, fr, ka, de, el, gu, ha, he, hi, hu, id, ga, it, ja, kn, kk, rw_RW, ko, ky_KG, lo, lv, lt, mk, ms, ml, mr, nb, fa, pl, pt_BR, pt_PT, pa, ro, ru, sr, sk, sl, es, es_AR, es_ES, es_MX, sw, sv, ta, te, th, tr, uk, ur, uz, vi, zu. (L1 stores lower-case compare only; the value forwarded to Meta keeps the caller's case, so send canonical case like `en_US`.)

Name rule effectively enforced: UI Yup `^[a-z0-9_]+$`, min 2, max 100 (Constants.ts:262-272). Server enforces none except 512 max. A port should enforce Meta's own: lowercase alphanumeric + underscore, max 512, unique per WABA+language.

### 3.2 Category rules

| Rule | Where |
| --- | --- |
| AUTHENTICATION: HEADER forbidden | L1 975 |
| AUTHENTICATION: CAROUSEL forbidden; LIMITED_TIME_OFFER forbidden | L1 994, 1004 |
| AUTHENTICATION BODY: only keys `type`, `add_security_recommendation` (bool), no `text`, no `example` | L1 120-130 |
| AUTHENTICATION FOOTER: only keys `type`, `code_expiration_minutes` (int 1..90) | L1 169-181 |
| AUTHENTICATION BUTTONS: exactly 1 button and it must be `otp` | L1 526-537 |
| MPM and CATALOG buttons: MARKETING only | L1 559-569 |
| CATALOG: no header component allowed; alone in buttons | L1 950, 559-561 |
| MPM: header component REQUIRED and must be format TEXT; alone in buttons | L1 948, 59-60, 565-567 |
| UTILITY: UI hides send_products, limited_time_offer, otp, catalogue, carousel types | TemplateCreate.tsx:257-262 (UI only; server does not block) |
| UI AUTHENTICATION prefilled body `{{1}} is your verification code.` (UI-side only; Meta supplies its own text) | TemplateCreate.tsx:269-275 |

### 3.3 HEADER (L1 47-114, L2 11-39)

| Rule | Value |
| --- | --- |
| `format` required, in text, image, video, document, location | L1 50-57 |
| TEXT: `text` string, non-empty, max 60 | L1 63-71, L2 16 |
| TEXT: max 1 variable | L1 73-75, L2 17-22 |
| TEXT with variable: `example.header_text` list, 1 item exactly (L1: non-empty and not more than 1; L2 `length(1)`) | L1 76-88, L2 24-32 |
| TEXT without variable: `example` forbidden | L2 31 |
| IMAGE/VIDEO/DOCUMENT: `example.header_handle` non-empty list (L1), exactly 1 string (L2 `length(1)`) | L1 91-104, L2 33-38 |
| LOCATION: no extra checks, no example | L1 106-108 |
| Carousel header: format image or video only, example.header_handle exactly 1 | L2 211-217, L1 632-663 |

### 3.4 BODY (L1 116-163, L2 43-65)

| Rule | Value |
| --- | --- |
| `text` required (non-auth), string, non-empty | L1 132-137 |
| max 1024 chars | L1 138, L2 45 |
| variables present -> `example.body_text` required, list of lists; first row length must equal variable count | L1 145-157; L2 47-64 checks every row length equals count |
| `add_security_recommendation` bool if present | L1 141-144 |
| UI: body min 9 visible chars, cannot END with a variable (starting with one is allowed despite the message text), HTML stripped before count | Constants.ts:310-358 |
| Not validated: variable numbering is sequential from 1, no adjacent variables, variable-to-text ratio, no newlines/tabs/4 consecutive spaces in a variable example | n/a (Meta enforces) |

### 3.5 FOOTER (L1 165-202, L2 68-72)
Non-auth: `text` required, string, 1..60 chars; optional `code_expiration_minutes` int greater than 0 (L1 192-196). Auth: see 3.2. Footers with variables not supported (Joi has no `example`, so a footer carrying `example` fails L2).

### 3.6 BUTTONS (L1 517-630, L2 75-208)

| Rule | Value |
| --- | --- |
| total buttons | non-auth: 1..10 (L1 539-543; L2 `.max(10)`) |
| PHONE_NUMBER | max 1; text 1..25; phone_number string 1..20 (L1 204-227, 546; L2 75-79) |
| URL | max 2; text 1..25; url 1..2000; max 1 variable `{{n}}`; with variable `example` = list of exactly 1 non-empty string (max 2000); without variable `example` forbidden (L2 99) (L1 229-276, L2 86-101) |
| QUICK_REPLY | max 10; text 1..25; no variables (L1 278-300) |
| QUICK_REPLY position | all quick replies contiguous AND at the start OR the end of the list (L1 505-516); L2 rejects two separate groups mixed with other types (L2 192-204) |
| COPY_CODE | max 1; `example` required string, 1..15 chars, alphanumeric (`isalnum`) (L1 302-322; L2 108-111) |
| OTP | `otp_type` in ONE_TAP, COPY_CODE, ZERO_TAP; `text`/`autofill_text` 1..25 if present; ONE_TAP and ZERO_TAP need `supported_apps` (non-empty list of `{package_name, signature_hash}`); ZERO_TAP needs `zero_tap_terms_accepted` bool (L1 360-430; L2 113-127). L2 patterns: `package_name` `^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$` max 224, `signature_hash` `^[a-zA-Z0-9+/=]{11}$` |
| FLOW | max 1; `text` 1..25, `flow_id` non-empty string, `flow_action` in navigate, data_exchange, `navigate_screen` required when navigate (L1 432-471; L2 130-136) |
| MPM | text must equal exactly `View items`; max 1; alone (L1 473-487) |
| CATALOG | text must equal exactly `View catalog`; alone; marketing only (L1 489-503) |
| SEND_LOCATION | Joi accepts it (L2 143-146, max 1) but L1 button-type allow-list (line 581) rejects it ("Invalid button type"). Effectively unsupported. |
| Known L1 defects to NOT port | `validate_supported_apps` uses `package_name.isalnum()` (rejects dots, so valid package names fail, L1 346) and `if len(signature_hash) == 11: return False` (inverted, rejects the valid length, L1 356). One-tap/zero-tap OTP therefore cannot pass L1 today. Port the intent (L2 regexes), not the code. |

### 3.7 CAROUSEL (L1 632-853, L2 211-265)
- `cards` list 1..10 (L1 800-804).
- Each card: exactly 3 components: 1 HEADER (image|video), 1 BODY, 1 BUTTONS (L1 819-828).
- All cards must share the same header format as card 1, and the same button type sequence as card 1 (L1 641-642, 718-719). Button types allowed per card: PHONE_NUMBER, URL, QUICK_REPLY (L1 785); 1..2 buttons per card.
- Card BODY: text 1..160; variables need `example.body_text` first row length equal count (L1 665-696).
- Main message: no HEADER or FOOTER allowed with CAROUSEL in L1 (996-999), but note `header_contains`/`footer_contains` are never set to True in the loop (L1 967-969 vs. 973-1011), so this check is dead code; the frontend never sends them. Port should enforce it.

### 3.8 LIMITED_TIME_OFFER (L1 855-877, L2 267-273)
`limited_time_offer.text` required, 1..16 chars; `has_expiration` bool optional. Not validated: needs a COPY_CODE button and a URL button, header image/video only; the UI always sends both buttons.

### 3.9 Frontend-only rules (Constants.ts:261-521)
Coupon code `^[a-zA-Z0-9]*$` max 15; offer coupon `^[a-zA-Z0-9_]*$` max 15; website URL `^https?:\/\/([a-zA-Z0-9.-]+|\{\{\d+\}\})(\/[^\s]*)?(\?[^\s]*)?$`; offer title max 16; offer button text max 25; flow requires at least 1 flow object; for `copy_code_url_quick_replies_etc` at least one option checked.
UI "template types" (button_type): `none`, `copy_code_url_quick_replies_etc`, `otp`, `flow`, `carousel`, `limited_time_offer`, `catalogue`, `send_products` (options come from DB `whatsapp_template_type`; stored on the doc as `template_type`).

---------------------------------------------------------------------------------------------------

## 4. Sync and reconcile into the DB

### 4.1 Manual / scheduled full sync
- Trigger: `GET /workspace/broadcast/sync-whatsapp-template` -> Celery `send_task(name='meta.sync_templates', args=[workspace_id, meta_whatsapp_config], queue=CHATBOT_CRM_SYNC)` (Whatsapp.py:344-347). Worker: Voice/geta-async/app.py:3935-3944 (`NoRetry` base). UI button "Sync With Meta" (TemplatesListing.tsx:~253, 644). No periodic schedule for it was found ("beat"/cron for templates not found), so sync is user-triggered only.
- Algorithm (Voice/geta-async/src/Meta/SyncMetaTemplates.py:147-166):
  1. `geta_templates_list` = distinct `meta_template_id` in `broadcast_templates` where `type = "whatsapp"`.
  2. Resolve a `user_obj` for `created_by` = first `business_user` in the workspace with `group_id = 1` (admin), joined to `geta_core.user` (get_user_object 75-95).
  3. Loop pages of `GET {BASE}/{WABA}/message_templates` following `paging.next` (get_meta_templates 50-73). Per item build a bulk op (create_update_one_query 97-145):
     - Match key is `{type:"whatsapp", name, language}` (NOT the id).
     - If `item.id` already known: `$set` `template_type`, `components`, `language`, `status`, `category`, `modified_time`, `upsert=False`.
     - Else: `$set` `id` (16-char random shortuuid), `name`, `type:"whatsapp"`, `template_type`, `meta_template_id`, `components`, `language`, `status`, `category`, `created_time`, `modified_time`, `created_by`, `updated_by`, `upsert=True`.
  4. After all pages, delete local docs whose `meta_template_id` is not in the set seen from Meta (delete_templates 28-39): a template deleted on Meta disappears locally. (If the Meta fetch partially fails, `get_meta_templates` returns `(False, error)` and the loop would crash; there is no guard against mass deletion.)
- Not synced: `quality`, `rejection_reason`, `sub_category` (never read from the list response because `fields` is not requested; Meta returns `rejected_reason`/`quality_score` only when asked via `fields=`; webhooks are the only source).
- `template_type` is derived from components (geta-async/src/Meta/MetaTemplate.py:19-40): category AUTHENTICATION -> `otp`; any CAROUSEL component -> `carousel`; LIMITED_TIME_OFFER -> `limited_time_offer`; BUTTONS containing flow -> `flow`, catalog or mpm -> `catalogue`, otherwise `copy_code_url_quick_replies_etc`; no buttons -> `none`. (Quirk: first component of type buttons returns immediately, and AUTHENTICATION check happens first.)
- Interakt gotcha: `paging.next` is followed verbatim with the same headers (SyncMetaTemplates.py:54-57). Whether Interakt rewrites `next` to its own host is NOT verified in the repo; if it returns a graph.facebook.com URL the Interakt headers would fail against it. Port: build the next call from the `paging.cursors.after` value on `BASE` instead of trusting `next`.

### 4.2 Lazy status refresh
While listing, PENDING rows are refreshed from Meta (section 1.5a). Opening a template by id does not refresh.

### 4.3 Status values and mapping
Stored in `status` as Meta's string. Allowed set (whatsapp-service/src/utils/enum.js:15-26): `APPROVED, IN_APPEAL, PENDING, REJECTED, PENDING_DELETION, DELETED, DISABLED, PAUSED, LIMIT_EXCEEDED, ARCHIVED`. UI filters only APPROVED/REJECTED/PENDING and treats APPROVED/REJECTED/PENDING as "locked". Not in the enum (so the webhook handler THROWS): `FLAGGED`, `REINSTATED`. Port must add both (Meta semantics, not Geta behaviour: `FLAGGED` is the warning state before PAUSED/DISABLED, `REINSTATED` returns a template to usable).
Quality set (enum.js:28-33): `GREEN, YELLOW, RED, UNKNOWN`.
Category set accepted by the category webhook (enum.js:1-18): MARKETING, UTILITY, AUTHENTICATION plus legacy values (SERVICE, ACCOUNT_UPDATE, ..., OTP).

### 4.4 Webhooks
Receivers (geta-whatsapp-service/src/routes/routes.js:12-17): `GET/POST /api/v1/whatsapp/webhook/callback` (native) and `GET/POST /api/v1/whatsapp/webhook/interakt/callback` (Interakt). Both POSTs use the same handler `whatsAppCallbackController.whatsAppCallback` (controllers/whatsappCallbackController.js:14-70). GET verification: `hub.mode=subscribe` and `hub.verify_token == env WHATSAPP_VERIFY_TOKEN` -> echo `hub.challenge` as text/plain (whatsappController.js:58-94 native, 96-119 Interakt).
- No `X-Hub-Signature-256` verification anywhere (grep for signature and app secret: not found). The port should add it for native; Interakt's signing scheme is unknown here.
- Interakt webhook override: `POST {INTERAKT_BASE}/{phone_number_id}` with headers `x-access-token`, `x-waba-id`, `x-phone-number-id`, body `{"webhook_configuration":{"override_callback_uri":"https://api-whatsapp.geta.ai/api/v1/whatsapp/webhook/interakt/callback"}}` (geta-core/src/shared/scripts/migrate_waba.py:61-80). Subscription: `POST https://interakt-amped-express.azurewebsites.net/api/v17.0/{phoneID}/subscribed_apps` with `x-access-token`, `x-waba-id` headers, empty body (geta-core/src/whatsapp/MetaOnboarding.py:153-165, a hard-coded alternate Interakt host).
- Routing: payload `object == "whatsapp_business_account"`; for each `entry[i]` the workspace is found via Redis key `meta_account_mapping:account_waba_ids:{entry.id}` -> `{workspace_id, ...}`; each `changes[j].field` is dispatched through callbackHandlerMap.js:17-34. Raw callback stored in Mongo `meta_callbacks` / `meta_callbacks_error` (helpers/callbackHelper.js).
- Template-related fields handled:

| `change.field` | Handler | Effect on Mongo `broadcast_templates` |
| --- | --- | --- |
| `message_template_status_update` | handlers/messageTemplateStatusUpdateHandler.js:1-41 | match `{meta_template_id: String(value.message_template_id), type:"whatsapp", language: value.message_template_language}`; `$set status = value.event`, `modified_time = entry.time` (epoch seconds converted) , `rejection_reason = value.reason`. Throws on events not in the enum above (so FLAGGED/REINSTATED -> HTTP 500 to Meta -> Meta retries). Also does NOT use `value.disable_info`, `value.other_info`, `value.message_template_name`. |
| `message_template_quality_update` | handlers/messageTemplateQualityUpdateHandler.js:1-35 | match `{meta_template_id, type:"whatsapp"}` (all languages); `$set quality = value.new_quality_score` (GREEN/YELLOW/RED/UNKNOWN). `previous_quality_score` ignored. |
| `template_category_update` | handlers/templateCategoryUpdateHandler.js:1-37 | match as above; `$set category = value.correct_category` and `inputValues.template_category = value.correct_category`. Ignores `previous_category`. |
| `message_template_components_update` | NOT HANDLED. Absent from callbackHandlerMap.js; such an event gets HTTP 400 `Invalid or unsupported field type`. Port should handle it (value carries `message_template_id`, `message_template_name`, `message_template_language`, `message_template_element`, `message_template_title`, `message_template_footer`, `message_template_buttons`). |
| `flows` | handlers/flowsHandler.js:1-35 | match `{meta_id: value.flow_id}` in `whatsapp_flow`; `$set status = value.new_status` in DRAFT, PUBLISHED, DEPRECATED, BLOCKED, THROTTLED. |
| `phone_number_quality_update`, `phone_number_name_update`, `account_update`, `account_review_update`, `business_capability_update`, `messages` | other handlers (not template related) | |
| `campaign_status_update`, `business_status_update`, `partner_solutions`, `messaging_handovers`, `security`, `account_alerts` | empty stubs | no-op |

- Handler response bug to avoid: the controller sends `response.status(...).json(...)` once per change inside the loop (whatsappCallbackController.js:44-52), so multi-change entries throw "headers already sent". Respond 200 once after processing.
- Race hazard to avoid: workspace identity and config are kept in `global.workspaceId` / `global.whatsappConfig` (customMiddleware.js, whatsappCallbackController.js:35-36), shared across concurrent requests. Pass the tenant explicitly in the port.
- Status events carry no template-level race protection: a webhook can arrive before the create response is persisted (create then `insert_one`, Meta.py:111-118). Match on `meta_template_id` and tolerate "not found yet" (the update is `upsert=False`, silently dropped). Port: insert the row with `meta_template_id` before/atomically with returning, or park events and reconcile.

---------------------------------------------------------------------------------------------------

## 5. DB persistence per template

Mongo collection `broadcast_templates` (workspace DB `{workspace_id}`), WhatsApp docs have `type: "whatsapp"` (the same collection also holds SMS and email templates).

Fields written at create (Meta.py:68-81, with the validated request merged in):

| Field | Source |
| --- | --- |
| `id` | 16-char random short UUID (Geta internal id, used in all internal URLs) |
| `meta_template_id` | Meta create response `id` (string) |
| `type` | `"whatsapp"` |
| `created_time`, `modified_time` | server now |
| `status` | Meta create response `status`, default `"PENDING"`; overwritten by reconcile GET |
| `template_type` | UI button_type: none, copy_code_url_quick_replies_etc, otp, flow, carousel, limited_time_offer, catalogue, send_products (popped from payload before Meta/validation then re-added, Meta.py:90-95) |
| `created_by`, `updated_by` | `{id, first_name, last_name, email, phone}` of the user (empty `{}` if none) |
| `name`, `language`, `category`, `components` | request (then overwritten with Meta's canonical values by `get_and_update_template`) |
| `businessName` | optional, default-template flow (passes L1 but fails Joi L2 unknown-key rule, see 3.1; behaviour unverified end to end) |
| `inputValues` | UI form state, popped before validation (Meta.py:94) and re-attached by the frontend only on its own request; list API excludes it; category webhook writes `inputValues.template_category` |

Fields written later:
- `status`, `modified_time`, `rejection_reason` by status webhook; `status` by lazy refresh and sync.
- `quality` by quality webhook.
- `category` by category webhook and sync.
- `used_automation_ids` (list) and `used_in_automation` (bool): maintained by the automation module (delete guard Meta.py:151, list enrichment MetaTemplates.py:131-140).
- Legacy Exotel era: `exotel_id` (migration script), name normalisation `name.replace(" ","_").lower()` in geta-core/src/Business/Templates.py:410-441 (pre-Meta path; geta-core's template status/delete still calls Exotel and is NOT the Meta path).
- Not stored: Meta `sub_category`, `previous_category`, `rejected_reason` from list, `quality_score`, `message_send_ttl_seconds`, `parameter_format`, template analytics, `last_updated_time`, `library_template_name`.

Flows collection `whatsapp_flow` (whatsapp-service models/whatsapp/whsatappFlow.js, service whatsappFlowService.js:66-79): `name`, `categories` (array), `template_flow` (the Flow JSON object), `mapping_object` (UI-side variable mapping, opaque), `meta_id` (Meta flow id), `status` (DRAFT at create), `created_time`, `modified_time`, `clone_id` when cloned. Default categories list lives in `geta_core.whatsapp_template_configuration` with `config_key: "whatsapp_flow_categories"`.

---------------------------------------------------------------------------------------------------

## 6. Interakt-specific differences and gotchas

1. Switch is global per deployment (env), not per workspace. In Interakt mode every call uses `auth_key` + `waba_id`, never `access_token`. Workspaces migrated to Interakt carry `migrated_to_interakt: true` and `meta_provider` in {"interakt","pinnacle"} (geta-core sub_accounts.py:1564).
2. CREATE VALIDATION BUG in Interakt mode: `createTemplate` injects `access_token = global.whatsappConfig.access_token` into the Joi payload and Joi requires it (validation.js:280; controller:307-309). A workspace that has only `auth_key` (pure Interakt) fails with `(#100) The parameter access_token is required.` Port: do not require `access_token` in validation; require the provider credential that matches the mode.
3. Media upload is different: native = resumable app-level upload (`/{app_id}/uploads` then `/upload:<id>`); Interakt = one multipart call `/{phone_id}/media_handle`. The Interakt call needs `phoneID`; the broadcast-service default pins v17.0 for it. `MetaMediaUpload` class itself is native-only (not flag aware); only `UploadWhatsappMediaFile` and `handle_media_headers` branch on the flag.
4. Version defaults differ between services (v17.0 vs v25.0). Template CRUD calls are issued by whatsapp-service (v25.0 default) so they go to `.../api/v25.0/{WABA}/message_templates`. Only `/media_handle` and the Flow test message (`https://amped-express.interakt.ai/api/v17.0/{phoneID}/messages`, whsatappFlow.js:290, hard-coded, ignores the flag) are tied to v17.0. Make the version configurable per call-type in the port.
5. Interakt endpoints used for templates are path-identical to Graph: `/{WABA}/message_templates` (POST, GET, DELETE) and `/{WABA}/flows` family. Interakt may restrict some Graph features (the code has a TODO that `business_compliance_info` is "not yet confirmed" on Interakt, MetaAPI.py:149-152). Anything not exercised by Geta (template edit `POST /{template_id}`, `template_analytics`, `fields=quality_score,...`, `GET /{template_id}`) is UNVERIFIED on Interakt.
6. Flow assets upload adds header `x-phone-number-id` on Interakt (whsatappFlow.js:91) and drops `Content-Type` so FormData sets the boundary.
7. Webhooks: separate receiver path `/api/v1/whatsapp/webhook/interakt/callback`; Geta reuses one handler for both paths, so Interakt evidently forwards Meta-shaped payloads (`object: whatsapp_business_account`, `entry[].id` = WABA id); this is inferred from the shared code, no Interakt payload sample is in the repos. The webhook override URL is set per phone number via the Interakt `override_callback_uri` call (section 4.4).
8. `paging.next` may point at Meta host (see 4.1).
9. Per-workspace global mutable state in whatsapp-service (global.whatsappConfig) is a concurrency hazard under both providers.
10. Error shape: errors from Interakt are relayed like Meta's (code/type/error_user_msg/fbtrace_id fields are destructured, controller:352-361). If Interakt returns a differently shaped error object that has no `error` key, `error.response.data.error` is undefined and destructuring throws, yielding an unhandled 500. Port should guard.

---------------------------------------------------------------------------------------------------

## 7. WhatsApp Flows (managed in geta-whatsapp-service)

Routes (routes.js:31-62), controller whatsappFlowController.js, service services/whasapp/whatsappFlowService.js, model models/whatsapp/whsatappFlow.js. All Meta calls use `BASE` + `getMetaHeaders(config)` (section 0).

| Operation | Geta route | Meta call (BASE-relative) | Notes |
| --- | --- | --- | --- |
| default categories | `GET /whatsapp/default_flows` | Mongo only (`geta_core.whatsapp_template_configuration`, `config_key: whatsapp_flow_categories`) | |
| create | `POST /whatsapp/create_flow` body `{name, categories[], template_flow{}, mapping_object{}}` (Joi helpers/validators.js:227-233) | `POST {BASE}/{WABA}/flows` JSON `{"name":..,"categories":[..]}` -> `{id}` (whsatappFlow.js:46-68) | Name unique check in Mongo first ("Flow name must be unique"); Meta error code 100 mapped to same message. Row saved status DRAFT, then FlowJSON uploaded (below). |
| upload Flow JSON | (inside create/update/clone) | `POST {BASE}/{flow_id}/assets` multipart: `file` = Blob(JSON, filename `flow.json`, `application/json`), `name=flow.json`, `asset_type=FLOW_JSON` (whsatappFlow.js:81-111) | Response `validation_errors[]`; update succeeds only when it is empty. |
| update | `POST /whatsapp/update_flow` body `{flow{}, mapping_data{}, flow_id}` (helpers/validators.js:235-239) | same assets call | On validation errors returns first error message, rewritten from JSON-pointer paths like `/screens/0/layout/children/1/...` into "Screen N of Content M should ...". Stores `template_flow`, `mapping_object`, `modified_time`. |
| list | `GET /whatsapp/flow_list?search=&status=a,b&limit=&offset=` | Mongo only (name regex case-insensitive, status `$in`, sorted by `modified_time` desc, pagination `currentPage,perPage,totalPages,totalRecords`) | List-from-Meta merge is commented out. |
| clone | `POST /whatsapp/clone` body `{name, categories[], clone_id}` (validators.js:242-247) | create flow then upload the source flow's stored `template_flow` | |
| publish | `POST /whatsapp/publish_flow?flow_id=` (flow_id is a QUERY param although POST) | `POST {BASE}/{flow_id}/publish` body `{}` (whsatappFlow.js:222-239) | "Flow Already Published" guard; local status set PUBLISHED. |
| deprecate | `POST /whatsapp/deprecated_flow?flow_id=` | `POST {BASE}/{flow_id}/deprecate` body `{}` (202-221) | status DEPRECATED. |
| delete | `GET /whatsapp/delete_flow?flow_id=` (GET!) | `DELETE {BASE}/{flow_id}` (169-187) | Blocked locally if PUBLISHED or DEPRECATED. Always HTTP 200 envelope `{data:{status,data}}`. |
| preview URL | `GET /whatsapp/flow_preview?flow_id=` | `GET {BASE}/{flow_id}` (241-258); Meta returns `preview.preview_url` etc. only if `fields=preview.invalidate(false)` is requested; Geta does NOT send `fields`, so behaviour depends on Meta defaults (unverified). | |
| get assets | (sync) | `GET {BASE}/{flow_id}/assets` -> `data[0].download_url`, then plain GET of that URL for the JSON (150-168) | |
| sync | `POST /whatsapp/sync_flow` | `GET {BASE}/{WABA}/flows`, then per flow assets (131-149) | Union of local and Meta ids: both -> refresh `status`+`template_flow`; local only -> delete local; Meta only -> insert (`mapping_object:{}`). Uses `allMetaIds.forEach(async ...)` (fire-and-forget, errors not awaited) - do not copy. |
| test send | `POST /whatsapp/test_flow` body `{flow_id, recipient_number}` | `POST .../{phoneID}/messages` interactive flow message, `mode:"draft"`, `flow_message_version:"3"`, `flow_action:"navigate"`, first screen id, recipient must match `^\+91\s?\d{10}$` (whatsappFlowService.js:318-385) | Provider-specific URL logic in whsatappFlow.js:260-314 (a hard-coded test phone id uses native Graph, Pinnacle uses `PINNACLE_URL/v3/{phoneID}/messages` + `apikey`, default is Interakt v17.0 regardless of flag). |
| status webhook | `flows` field | see 4.4 | statuses DRAFT, PUBLISHED, DEPRECATED, BLOCKED, THROTTLED |

Flow data-endpoint (encrypted `flow_action: data_exchange` requests: RSA/AES endpoint, `data_api_version`, `endpoint_uri`): NOT FOUND in the repos. Flow buttons in templates can use `flow_action: data_exchange` (L1 allows it), but no data-exchange server exists.

Template flow-button reference: BUTTONS entry `{"type":"flow","text":..,"flow_id":..,"flow_action":"navigate","navigate_screen":..}` (UI always sends `navigate`, utils.tsx:~690-710). Meta also accepts `flow_name` and `flow_json`; Geta does not.

---------------------------------------------------------------------------------------------------

## 8. OTP / authentication templates in geta-auth-service
geta-auth-service does not create, edit or sync Meta templates ("message_templates" and "media_handle" not found there). It only contains `src/Business/whatsapp.py` (builds a send payload `generate_template_data_for_message` for an Exotel-shaped message), and `global_enums.py` copies of the provider switch. Authentication-category templates are created through the same broadcast-service path as any other template (section 1.2 AUTHENTICATION). Sending OTP messages is out of scope here.

---------------------------------------------------------------------------------------------------

## 9. Port recommendations (derived, not Geta behaviour)

1. Implement one `TemplateProvider` port with two adapters (native, Interakt) differing only in base URL, headers and media-upload strategy; every template/flow call is path-identical across them.
2. Validation: implement a single validator (do not port the L1/L2 split). Combine L1 rules, L2 rules and Meta's own (name regex `^[a-z0-9_]{1,512}$`, sequential variable indexes, example presence). Fix the L1 OTP defects. Accept `allow_category_change`, `parameter_format` (positional|named), `message_send_ttl_seconds` and actually forward them (Geta drops them).
3. Add what Geta lacks and WaDesk-parity may need: edit (`POST /{template_id}`), `fields=` including `quality_score,rejected_reason,correct_category,previous_category,sub_category,last_updated_time`, `message_template_components_update` webhook, FLAGGED/REINSTATED statuses, delete by `hsm_id` (`DELETE /{WABA}/message_templates?hsm_id=..&name=..`), `template_analytics`; all UNVERIFIED on Interakt so make each capability-flagged.
4. Sync: page with cursors, request explicit `fields` and `limit`, match on `meta_template_id`, never delete locally on a partial/failed fetch, and persist quality/rejection reason.
5. Webhooks: verify `X-Hub-Signature-256` on native, respond 200 once, make handlers idempotent and tolerate events that precede the DB row.
6. Media: native uses `/{app_id}/uploads` resumable flow (session id then `h`); Interakt uses `/{phone_id}/media_handle` multipart. Use the standard MIME `image/jpeg` for jpg, and widen supported types (png, jpeg, mp4, pdf is Geta's full list).
