# Geta outbound WhatsApp messaging and media: how production really does it

Source: /home/getaweblpubt24/Documents/geta (read-only survey). All paths below are relative to that folder.
No secret values are reproduced; env names and config key names only.
Legend: [GETA] = what the production code emits. [META-SPEC] = Meta Cloud API shape that Geta does not emit itself (kept so the port can support it). "not found" = searched, absent.

Short names used for files:

- WA-SVC = geta-whatsapp-service/src
- ASYNC = Voice/geta-async/src (this is the only copy of geta-async; there is no top-level geta-async)
- BC = geta-broadcast-service/src
- CORE = geta-core/src
- CONV = conversational-service-node/src

---

## 0. Architecture in one picture (who calls whom)

```
Inbox UI / bot flow / public API / automation                     Broadcast v2 (campaign)
  |  (CONV channels/whatsapp.ts, CORE, ASYNC SendWhatsappMeta.py)    |  (ASYNC helpers/messages.py)
  v                                                                 |
POST {WHATSAPP_SERVICE_API_URL}/api/v1/whatsapp/send_template_message   |   (bypasses whatsapp-service)
POST {WHATSAPP_SERVICE_API_URL}/api/v1/whatsapp/message/send           |
  header: geta-host: <AES-encrypted "domain:workspace_id">               |
  v                                                                 v
geta-whatsapp-service (Node/Express, Mongo+Redis)  ---->  Interakt amped-express  /  Meta Graph  /  Pinnacle
```

Key facts:

- Only geta-whatsapp-service (WA-SVC) talks to the BSP for single sends (template, interactive, static). Callers: CONV `channels/whatsapp.ts:33-35`, ASYNC `helpers/SendWhatsappMeta.py:469`, ASYNC `helpers/whatsapp.py:186,845,938`, CORE `whatsapp/message.py:667`, CORE `Broadcast/Credits.py:416`, CORE `Broadcast/TestingWhatsapp.py:467`.
- Broadcast v2 sends call the BSP directly from the celery gevent worker (ASYNC `helpers/messages.py:127-207`), not through whatsapp-service.
- geta-notifier-service is NOT Meta: its WhatsApp code is legacy Exotel/Gupshup (`geta-notifier-service/src/libraries/exotel_message_lib.py`, `src/Resource/Whatsapp.py`). Facebook.py / Instagram.py there are Messenger/IG. Nothing to port for WhatsApp Cloud API. (Security note: `geta-broadcast-service/src/libraries/exotel_lib.py:34-40` has hard-coded Exotel credentials as a default config; do not copy.)
- geta-whatsapp-service has no retry, no per-request timeout, no rate limiter and no webhook signature check (grep for `x-hub-signature`, `APP_SECRET`, `timeout`: nothing in `src/`).

---

## 1. Base URL, version, auth headers, per route and per workspace

### 1.1 The flag and the two URL families

- Flag: env `IS_INTERAKT_ENABLED` (string, trimmed, lower-cased, `"true"` enables; default false).
  - WA-SVC `helpers/metaHeaders.js:14-15` and `utils/enum.js:60-61`
  - CORE `util/global_enums.py:15-19`; ASYNC `helpers/global_enums.py:19-24`; BC `util/global_enums.py` (same pattern).
- Env names for URLs: `META_API_ENDPOINT`, `META_API_VERSION`, `INTERAKT_API_ENDPOINT`, `INTERAKT_API_VERSION`.
- Defaults:
  - Meta native: `https://graph.facebook.com` + `v25.0` (WA-SVC `utils/enum.js:65-66`, CORE `util/global_enums.py:4-5`, ASYNC `global_enums.py:10-11`).
  - Interakt: `https://amped-express.interakt.ai/api` + `v25.0` in WA-SVC (`enum.js:68-69`), CORE and BC; BUT ASYNC defaults Interakt to `v17.0` (`ASYNC helpers/global_enums.py:13-16`).
  - Resulting base: `{INTERAKT_API_ENDPOINT}/{INTERAKT_API_VERSION}` = `https://amped-express.interakt.ai/api/v25.0` (or `.../api/v17.0`), versus `https://graph.facebook.com/v25.0`.
  - WA-SVC getter: `MetaApiEnum.META_API_BASE_URL` (`utils/enum.js:72-76`) switches on the flag at call time.
- Header builder (WA-SVC `helpers/metaHeaders.js:22-37`):
  - Interakt on: `x-access-token: <config.auth_key>`, `x-waba-id: <config.waba_id>`, `Content-Type: application/json`.
  - Interakt off: `Authorization: Bearer <config.access_token>`, `Content-Type: application/json`.
  - Optional `extra` merged in (only use: `x-phone-number-id: <phoneID>` on Flow asset upload, `models/whatsapp/whsatappFlow.js:91`).
- Python equivalents: CORE `util/meta_api_helper.py:11-46`, ASYNC `helpers/meta_api_helper.py`, BC `Meta/meta_api_helper.py:13-49`: `get_meta_base_url()`, `get_meta_headers(access_token, waba_id, content_type)`, `get_meta_credential(config)` (returns `auth_key` when flag on else `access_token`). For multipart uploads `content_type=None` is passed so `requests` writes the boundary.

### 1.2 IMPORTANT: the flag is NOT honoured on the send path

The flag-aware helper is used only for template CRUD, Flows, catalog and media-URL retrieval. The message SEND code paths hard-code Interakt v17.0 and choose route by workspace config instead:

Route precedence for each send in WA-SVC (identical in `sendWhatsapp` `services/whasapp/whatappService.js:248-306`, `sendTemplateMessage` `:350-716` (URL block `:516-553`), `sendInteractiveMessage` `:718-788`, typing `conversations/whatsapp.js:55-118`, flow test `models/whatsapp/whsatappFlow.js:258-320`):

1. `phoneID === "108911612034746"` (hard-coded internal test number): `POST {META_API_ENDPOINT}/{META_API_VERSION}/{phoneID}/messages`, header `Authorization: Bearer <config.access_token>` (facebook-native, flag ignored).
2. else `config.provider === "pinnacle"` (`MetaProviderEnum.PINNACLE`): `POST {PINNACLE_URL}/v3/{phoneID}/messages` (env `PINNACLE_URL`; broadcast hard-codes `https://partnersv1.pinbot.ai/v3/{phoneID}/{endpoint}`), header `apikey: <config.auth_key>`.
3. else (default; `provider` missing defaults to `"interakt"`): `POST https://amped-express.interakt.ai/api/v17.0/{phoneID}/messages` with `x-access-token: <config.auth_key>`, `x-waba-id: <config.waba_id>`, `Content-type: application/json`. Version `v17.0` is a literal in the string (`whatappService.js:253,524,734`; `whatsapp.js:97`; `whsatappFlow.js:290`; `messages.py:148`).
4. Marketing with Marketing-Messages-Lite: if `config.is_mm_lite_onboarded` and template category is marketing, the path suffix is `/marketing_messages` instead of `/messages` (`whatappService.js:516-524,545`; `messages.py:145-147`). Body is identical.
5. Broadcast only: `config.load_testing` true replaces the URL with a mock lambda URL and adds `load_testing/category/phoneId/mock_type` to the body (`messages.py:157-167`). Do not port.

For the port: implement a provider port with Interakt, Meta-native (and optionally Pinnacle) adapters; Geta's observable behaviour is "Interakt v17.0 by default, per-workspace override". Honour the flag + version from env instead of the literal (the flag-aware helper shows the intended design).

### 1.3 Per-workspace config and token lookup

- Source of truth: Mongo, DB named by workspace id, collection `chatbot_misc_config`, doc `{config_key: "META_WHATSAPP_CONFIG", config_value: {...}}`.
- Redis cache key: `{workspace_id}:chatbot_misc_config:META_WHATSAPP_CONFIG` (JSON string). WA-SVC reads it in middleware (`middlewares/customMiddleware.js:140`); ASYNC reads/sets it with `ex=3600` (`helpers/messages.py:1149-1156`) and a second cache `{ws}:sendmeta:chatbot_misc_config:META_WHATSAPP_CONFIG` (`SendWhatsappMeta.py:38-45`).
- Fields of `config_value` used by outbound code (names only):
  - `access_token` (Meta business integration user token; used as Bearer on native route, and ALWAYS for media download), `auth_key` (Interakt token or Pinnacle apikey), `waba_id`, `phoneID`, `whatsapp_no`, `provider`, `is_mm_lite_onboarded`, `load_testing`, `business_id` (for catalog), `messaging_limit`, `limit`, `status`, `display_name_status`, `business_info`, `business_compliance_info`, `current_status.*`.
  - `meta_onboarded` is derived: requires `access_token` and `whatsapp_no` present (`messages.py:49-58`, `SendWhatsappMeta.py:49-54`). If false the send returns `{"error": "WABA not configured"}`.
- Webhook-side reverse mapping (waba/phone to workspace): Redis `meta_account_mapping:account_waba_ids:{waba_id}` and `meta_account_mapping:account_phone_numbers:{phone_id}` (WA-SVC `controllers/whatsappCallbackController.js:32-35`; CORE `whatsapp/MetaAPI.py:803,815`).
- Auth into WA-SVC (internal): header `geta-host` = AES-256-CBC hex of the JSON string `"<business_domain>:<workspace_id>"` formatted `"<iv>:<hex>"` (`utils/auth.js`, `utils/getaHost.js`, key from env `SECRET_KEY`). Middleware decrypts and splits on `:` to get `workspaceId` (`customMiddleware.js:135-141`), loads the config, and stores BOTH in `global.workspaceId` / `global.whatsappConfig` (process-wide mutable globals: a race under concurrency; do not port). Excluded from auth: `/api/v1/health-check`, `/api/v1/whatsapp/webhook/callback`, `/api/v1/whatsapp/webhook/interakt/callback` (`:16`). `send_template_message` and `get-template` also accept `source: "api"` with an API-token flow comparing `{ws}:chatbot_misc_config:api_token:META_WHATSAPP_CONFIG` (`:17,30-99`).

---

## 2. Every send call as an HTTP request

All sends are `POST {base}/{phone_number_id}/messages` (or `/marketing_messages`), with the headers from section 1.2 (`Content-Type: application/json`). Common envelope built by Geta for non-template sends (WA-SVC `sendWhatsapp`, `whatappService.js:282-289`):

```json
{"messaging_product":"whatsapp","recipient_type":"individual","to":"<E164 digits, + optional>","type":"<type>","<type>":{...}}
```

(`payload[data.type] = data[data.type]`: any Meta message object is passed through verbatim, so the body of the caller's `<type>` key is the Meta object.) Template envelope omits `recipient_type`.

Internal call into WA-SVC (what the caller sends): `POST /api/v1/whatsapp/message/send` for non-template and interactive, `POST /api/v1/whatsapp/send_template_message` for templates; header `geta-host`; JSON body described per type below as "Geta internal body".

Response used everywhere: `response.data.messages[0].id` (the `wamid.*` string; stored as `message_id`) and optionally `messages[0].message_status` (WA-SVC only compares to `"failed"`, `whatappService.js:574-578`). `contacts[0].wa_id` is read in exactly one place (`CORE APILibrary/APILibraryClass.py:534`, fallback for recipient). WA-SVC wraps Meta's body as `{success:true,message:"Message sent successfully",data:<Meta body>}` (`controllers/whatsappController.js:145-149,285-289`); callers read `data.messages[0].id` (`SendWhatsappMeta.py:479-482`).

### 2.1 Text

- Geta internal body (CONV `channels/whatsapp.ts:176-184`; ASYNC `helpers/whatsapp.py:938-946`): `{"to":"+9199...","type":"text","text":{"body":"Hello"}}`.
- Sent to BSP: `{"messaging_product":"whatsapp","recipient_type":"individual","to":"+9199...","type":"text","text":{"body":"Hello"}}`. `preview_url` not set by Geta (a Joi schema requires it but is never invoked: see 4.7).

### 2.2 Template (business-initiated or in-window)

- Geta internal body (built by `prepareDataToSendMessage` in `CONV channels/whatsapp.ts:1260-1607`, `ASYNC SendWhatsappMeta.py:503-906`, `ASYNC messages.py:209-628`):

```json
{"to":"+919999999999","source":"inbox|api|broadcast|automation|contact","category":"MARKETING","meta_template_id":"123",
 "content":{"type":"Template","template":{"name":"order_update","language":{"policy":"deterministic","code":"en"},"components":[ ... ]}}}
```

Note `type` is literally `"Template"` (capital T) in production, and `language.policy:"deterministic"` is always set.

- Sent to BSP by WA-SVC (`whatappService.js:555-564`): `{"messaging_product":"whatsapp","to":data.to,"type":data.content.type,"template":data.content.template}`. `to` is forwarded untouched (WA-SVC validates `^\+[1-9]\d{1,14}$` only for its own checks, `:381-394`). Broadcast v2 sends the same shape (`messages.py:135-140`).
- Component builders (exact shapes Geta emits):
  - Header text: `{"type":"header","parameters":[{"type":"text","text":"Hi"}]}`.
  - Header image/video/audio: `{"type":"header","parameters":[{"type":"image","image":{"link":"https://..."}}]}`; header document adds `"filename": <last path segment>`: `{"type":"document","document":{"link":"https://x/y.pdf","filename":"y.pdf"}}`. Media goes by public `link`, never by media id.
  - Body: `{"type":"body","parameters":[{"type":"text","text":"Asha"},{"type":"text","text":"ORD-1"}]}` (values stringified; per-recipient resolution in section 5.4).
  - Buttons (`index` is the 0-based position in the template button list):
    - URL (only if template button has `example`): `{"type":"button","sub_type":"url","index":0,"parameters":[{"type":"text","text":"abc123"}]}`
    - Copy code: `{"type":"button","sub_type":"copy_code","index":1,"parameters":[{"type":"coupon_code","coupon_code":"SAVE10"}]}` (coupon longer than 15 chars falls back to the template default, `messages.py:410-411`)
    - Quick reply: `{"type":"button","sub_type":"quick_reply","index":2,"parameters":[{"type":"payload","payload":"STOP"}]}`
    - Flow button: `{"type":"button","sub_type":"flow","index":0,"parameters":[{"type":"action","action":{"flow_action_data":{"screen":"<navigate_screen>"}}}]}` (`flow_token` commented out)
    - CATALOG / MPM template buttons: the caller's `button` value is dropped in as the whole `components` array (`messages.py:469-472`): i.e. caller supplies raw Meta components.
  - Limited-time offer: `{"type":"limited_time_offer","parameters":[{"type":"limited_time_offer","limited_time_offer":{"expiration_time_ms":<int>}}]}` Default expiry is now+1 day. BUG in Python: `int(dt.timestamp())` is SECONDS (`messages.py:284`, `SendWhatsappMeta.py:650`); the Node builder correctly uses `dayjs.valueOf()` ms (`whatsapp.ts:1303`). Port with ms.
  - Carousel: `{"type":"CAROUSEL","cards":[{"card_index":0,"components":[{"type":"header","parameters":[{"type":"image","image":{"link":"https://..."}}]},{"type":"body","parameters":[{"type":"text","text":"..."}]},{"type":"button","sub_type":"url","index":0,"parameters":[{"type":"text","text":"slug"}]}]}]}` (component `type` for the carousel itself is upper-case `CAROUSEL`; per-card quick-reply payload buttons also supported in Node `whatsapp.ts:1556-1578`). Dynamic card arrays (`is_dynamic_array_resolve`) fan one source card out by index (`SendWhatsappMeta.py:968-1119`).
  - Authentication (OTP) template: no dedicated builder; callers pass raw components. Meta-spec shape the port must emit: `components:[{"type":"body","parameters":[{"type":"text","text":"123456"}]},{"type":"button","sub_type":"url","index":0,"parameters":[{"type":"text","text":"123456"}]}]`. Template creation constraints enforced in `BC Meta/MetaTemplateValidation.py:121-196,327-429,532` (auth body only `add_security_recommendation`, footer `code_expiration_minutes` 1..90, only OTP button allowed, button text <=25).
- Pre-send gates inside WA-SVC for `source` api/inbox (`whatappService.js:445-512`): phone regex; template lookup in Mongo `broadcast_templates {type:"whatsapp",name}` for `category` (`:24-78`, categories utility|marketing|authentication, name sanitised of `{}$`, <=255); credit price from `credits_mapping_new` (`helpers/credits.js:31-55`); reseller check; free if FEP window or (utility and open service window); else `credits - amount >= 0` or HTTP 400 "Insufficient Credits". Broadcast/automation sources skip WA-SVC's gating.

### 2.3 Image, video, audio, document, sticker (session messages, in 24h window)

Geta internal body (CONV `whatsapp.ts:75-174`), forwarded as `payload[type]`:

- image: `{"to":"+91..","type":"image","image":{"link":"https://cdn/x.jpg","caption":"cap"}}`
- video: `{"type":"video","video":{"link":"https://cdn/x.mp4","caption":"cap"}}`. YouTube URLs are rewritten to an image of `https://img.youtube.com/vi/<id>/maxresdefault.jpg` with caption `"<text>\n\n🎬 Watch Video: <url>"`, or text fallback (`:93-117`).
- audio: `{"type":"audio","audio":{"link":"https://cdn/x.ogg"}}` (no caption).
- document: `{"type":"document","document":{"link":"https://cdn/x.pdf","caption":"cap","filename":"x.pdf"}}`; filename = given, else last URL segment only if the extension is in a fixed list (pdf doc docx txt xls xlsx ppt pptx odt ods odp rtf jpg jpeg png csv zip), else `"Untitled"` (`:129-147,1217-1256`).
- sticker: `{"type":"sticker","sticker":{"link":"https://cdn/x.webp"}}`.
  All by `link` (HTTPS public URL, files live at `https://assets.getalabs.com/<workspace>/<name>` after S3 upload). No outbound `{"id": media_id}` form exists in Geta.

### 2.4 Location

`{"to":"+91..","type":"location","location":{"latitude":12.97,"longitude":77.59,"name":"Office","address":"MG Road"}}` (CONV `whatsapp.ts:156-167`).

### 2.5 Contact card

Not found as an outbound builder (only inbound parsing `conversations/whatsapp.js:866-875`). Pass-through would work: `{"type":"contacts","contacts":[{"name":{"formatted_name":"A B","first_name":"A"},"phones":[{"phone":"+91...","type":"CELL","wa_id":"91..."}]}]}` [META-SPEC].

### 2.6 Interactive (all go to `/api/v1/whatsapp/message/send` with `type:"interactive"`)

WA-SVC builds (`whatappService.js:718-788`): `{"messaging_product":"whatsapp","to":data.to,"type":"interactive","interactive":{"type":data.interactiveType,"header":data.header,"body":data.body,"footer":data.footer,"action":<data.action or {"buttons":data.buttons}>}}` (note: no `recipient_type`; undefined keys are dropped by JSON). Mapping from bot nodes is done in CONV `channels/whatsapp.ts:835-1195` (shapes below are what is sent; `header` only included if present, `footer` as `{"text":..}`):

- Reply buttons (`interactiveType:"button"`): `body:{"text":"Pick"}`, `action:{"buttons":[{"type":"reply","reply":{"id":"<nodeId>_<nanoid8>","title":"Yes"}}]}`. Ids are `<nodeId>_<8 char nanoid>` or literal `"b2184"` (live-agent hand-off id) so the inbound handler can route (`conversations/whatsapp.js:700-731`).
- List (`"list"`): `action:{"button":"Menu","sections":[{"title":"S","rows":[{"id":"<nodeId>_<nanoid8>","title":"Row","description":"d"}]}]}`.
- CTA URL (`"cta_url"`): `action:{"name":"cta_url","parameters":{"display_text":"Open","url":"https://..."}}` (`:805-811`).
- Single product (`"product"`): `action:{"catalog_id":"<id>","product_retailer_id":"<sku>"}` (`:1141-1144`).
- Product list (`"product_list"`): `header` required by Meta, `action:{"catalog_id":"<id>","sections":[{"title":"Sec","product_items":[{"product_retailer_id":"<sku>"}]}]}` (`:1145-1159`).
- Catalog message (Geta's own label `"catalog_message"`): `action:{"name":"catalog_message","parameters":{"thumbnail_product_retailer_id":"<sku>"}}` (`:1161-1167`).
- Flow (`"flow"`): `action:{"name":"flow","parameters":{"flow_message_version":"3","flow_id":"<id>","flow_action":"navigate|data_exchange","flow_token":"<tok>","flow_cta":"Continue","mode":"draft|published","flow_action_payload":{"screen":"<ScreenId>"}}}` (`:1057-1071`; WA-SVC test send `whatsappFlowService.js:318-370`, header text "Flow message header", mode "draft").
- Template-as-interactive is NOT a send type; `whatsapp_interactive` is only the live-chat render shape of a sent template.
- Inbound replies to these arrive as `button_reply`, `list_reply`, `nfm_reply` (Flow, `response_json`, `flow_token` stripped) (`whatsapp.js:700-765`).

### 2.7 Reaction

Outbound: not found (only inbound parse `whatsapp.js:823-831`). Pass-through possible via `/message/send`: `{"to":"91..","type":"reaction","reaction":{"message_id":"wamid.X","emoji":"👍"}}` [META-SPEC].

### 2.8 Reply with context (quoted reply)

Not found / not supported: `sendWhatsapp` builds the body from fixed keys only and drops any `context` (`whatappService.js:283-289`). [META-SPEC] shape the port should add: top-level `"context":{"message_id":"wamid.X"}`.

### 2.9 Mark as read and typing indicator

Geta only sends the combined read + typing form, before invoking the bot (`conversations/whatsapp.js:55-118`), same URL and routing as 1.2, body:

```json
{
  "messaging_product": "whatsapp",
  "status": "read",
  "message_id": "<inbound wamid>",
  "typing_indicator": { "type": "text" }
}
```

Errors are swallowed (`.catch(...)` returns null). No standalone mark-as-read without typing. There is a latent bug: `response` is out of scope at `:112-113` (returns undefined).

### 2.10 Generic session-message API for third parties

`APILibraryClass.validate_api` (CORE `APILibrary/APILibraryClass.py:486-560`) proxies a stored user-defined HTTP call (method/url/header/body) that targets the same WA-SVC endpoints and reads `data.messages[0].id` and `data.contacts[0].wa_id` from the reply to mirror the template into `chathistory`.

---

## 3. Media

### 3.1 What Geta does and does not do

- Outbound session/template media: public HTTPS `link` only (2.2, 2.3). `POST /{phone_number_id}/media` is NOT called anywhere in these repos (grep `/media`, `media_id`: nothing outbound).
- Upload to Meta only exists for TEMPLATE-CREATION header examples (`header_handle`): two implementations, switched by `IS_INTERAKT_ENABLED`.

### 3.2 Interakt route: `POST {INTERAKT_BASE}/{phoneID}/media_handle` (multipart)

- BC `Resource/Template/Whatsapp.py:200-262` (user upload) and `Meta/MetaTemplateValidation.py:1060-1100` (re-host a `https://scontent.whatsapp.net/...` CDN URL).
- Headers: `x-access-token: <auth_key>`, `x-waba-id: <waba_id>`, no `Content-Type` (let the client set the multipart boundary).
- Multipart: file part `file` = `(filename, bytes, mime)`; form fields `messaging_product=whatsapp`, `type=<mime>`. Timeout 30 s.
- Response: JSON with `h` = media handle (used as `example.header_handle[0]` in template create). Failure returns the BSP status and body.
- Allowed ext to mime (`Whatsapp.py:213-219`): pdf `application/pdf`; jpeg and jpg `image/jpeg` (`image/jpg` is non-standard and rejected); png `image/png`; mp4 `video/mp4`. Others return 400 "Invalid file type".

### 3.3 Meta-native route: resumable upload (BC `Meta/MetaMediaUpload.py`)

1. `POST {META_BASE}/{app_id}/uploads` with query params `file_name`, `file_length`, `file_type=<mime>`, `access_token=<access_token>` (no body). `app_id` = `client_id` of `geta_core.app_configuration {config_key:"META_WHATSAPP_CONFIG"}` (`:25-33,34-55`). Response `{"id":"upload:<session>"}`. NOTE here `jpg` maps to `image/jpg` (`:10-14`), unlike the Interakt route.
2. `POST {META_BASE}/{upload_session_id}` with headers `Authorization: OAuth <access_token>`, `file_offset: 0`, body = raw bytes (`:57-80`). Response `{"h":"<handle>"}`.
   Handle goes into template component `example.header_handle`. A CDN URL is re-uploaded only if it matches `^https://scontent\.whatsapp\.net/.*`; anything else is assumed to already be a handle (`MetaTemplateValidation.py:1020-1056`).

### 3.4 Limits enforced in code

- Size: per-extension limit from Mongo `geta_core.file_extension {name:<ext>}.size` compared to byte length; over returns 400 "Unsupported File Size."; unknown extension returns 400 "Unsupported File Type." (`Whatsapp.py:202-211`). The numeric limits are data, not in code ("not found" in repo).
- Type: only pdf, jpeg, jpg, png, mp4 for upload. Media-URL download allows `file_extension` map in `conversations/whatsapp.js:24-43` (aac amr mp3 m4a ogg text xls xlsx doc docx ppt pptx pdf jpeg png webp 3gp mp4).
- Document send filename list: 2.3. Template text limits: header text 60, body 1024, footer 60, button text 25 (`MetaTemplateValidation.py:70,138,189,217,244`). Interactive Joi limits (unused, see 4.7): body 1024, footer 60, list title 24, row title 20, row description 72, 1..10 sections, 1..10 rows (`helpers/validators.js`).

### 3.5 Inbound media: retrieve URL then download with auth (`conversations/whatsapp.js:884-944`)

1. `GET {base}/{media_id}` with flag-aware headers (`getMetaHeaders(whatsappConfig)`, `:901-910`). Response (Meta): `{"url":"https://lookaside.fbsbx.com/...","mime_type":"image/jpeg","sha256":"..","file_size":123,"id":"<media_id>"}`; Geta reads `response.data.url`.
2. `GET <url>` with `Authorization: Bearer <config.access_token>` (ALWAYS access_token, even when Interakt is on, `:926-928`), `responseType: stream`.
3. Stream to S3 (`PUT` via `@aws-sdk/lib-storage` Upload to bucket env `PUBLIC_AWS_S3_STORAGE_BUCKET`, key `<workspace_id>/<filename>`, `ContentType` = mime), public URL `https://assets.getalabs.com/<workspace_id>/<filename>`. Filename = given or `<8hex>_Untitled.<ext>`.
4. Needs `access_token` present, else returns null (no media). Failure in step 2 returns null; step 1 failure throws.

### 3.6 [META-SPEC] upload for send-by-id (not used by Geta, provide as optional)

`POST {base}/{phone_number_id}/media`, multipart fields `messaging_product=whatsapp`, `type=<mime>`, `file=@<bytes>`; response `{"id":"<media_id>"}`; then send `{"type":"image","image":{"id":"<media_id>"}}`. `GET {base}/{media_id}` to resolve, `DELETE {base}/{media_id}` to remove.

---

## 4. Error handling, retries, rate limiting, 24h window, opt-out, persistence

### 4.1 Meta error codes the code branches on

Almost nothing branches on Meta error codes:

- `100` only on Flow create: `error.code === 100` returns "Flow name must be unique" (WA-SVC `services/whasapp/whatsappFlowService.js:52`).
- `131049` (per-user marketing frequency cap): the retry Lambda finds failed rows with that error and re-sends (`ASYNC Broadcast/retry_scheduler.py` docstring; the Lambda `geta-async-lambda` source is NOT in the repos).
- `190` appears only in a comment (CORE `Resource/Integrations/ChatbotFacebookIntegrations.py:58`).
- `131026`, `131047`, `131048`, `130429`, `131056`, `131053`, `132001`, `135000`: only as a text-to-code lookup in a one-off migration script (CORE `shared/scripts/whatsapp_logs_migration.py:125-135`); no runtime branching. NOT FOUND: any logic keyed on 131047 (re-engagement), 131048 (spam rate limit), 130429 (throughput) or 131056 (pair rate limit).
- Error text format persisted from webhooks: `"<code> : <message>"` using `statuses[0].errors[0]` (`messagesHandler.js:472-476`).
- Template-create errors surface Meta's `error.{message,type,code,error_subcode,is_transient,error_user_title,error_user_msg,fbtrace_id}` as HTTP 400 (`controllers/whatsappController.js:350-374`); BC shows `error_user_msg` else `message`, maps "not a valid phone number" to "Invalid phone number" (`BC Meta/Meta.py:93-105`).

### 4.2 Retry/backoff

- Single sends via WA-SVC: none. Any axios error is rethrown and mapped to HTTP 500 `{success:false,message:"Failed to send message",error:<Meta body or message>}` (`whatsappController.js:150-158,290-297`); no request timeout anywhere in WA-SVC.
- Broadcast v2 batch task (`ASYNC app.py:1687-1699`, base class `BroadcastBatchTask`): celery `autoretry_for=(Exception, KeyError)`, `max_retries=3`, `retry_backoff=60`, `retry_backoff_max=600`, `retry_jitter=True` (`app.py:228-237`). On retry (`retry_count>0`) already-attempted rows (`status.sent` exists) are dropped so nothing is double-sent (`messages.py:1117-1145,1159-1163`). `on_failure` still decrements `pending_jobs` so reconcile can run (`app.py:239-255`).
- Per-message HTTP in broadcast: one try, no timeout, exceptions become `ResponseClass()` with `status_code=500` and the row is marked failed (`messages.py:184-189`).
- Automation tasks: retries intentionally disabled (`app.py:282-296`).
- Frequency-cap retry: schedules at `send_time + k * interval` (default 24h from `system_settings {module:"broadcast",feature:"retry_broadcast",type:"retry_interval"}`), k=1..min(`max_retries`,7), EventBridge Scheduler one-shot, name `retry_broadcast_{broadcast_id}_{k}` (`retry_scheduler.py`).

### 4.3 Rate limiting / throughput

- Broadcast v2: cluster-wide Redis token bucket, key `wa_send_v2_rate`, rate = env `WHATSAPP_SEND_V2_RATE_PER_SEC` (default 44/s; the comment mentions a per-workspace `send_rate_per_sec` override that is not implemented), capacity = rate (1 s burst), Lua script uses Redis TIME, fail-open on Redis error, `acquire_blocking(max_wait=30)` with gevent sleep (`helpers/rate_limiter.py`, `messages.py:1165-1178`). Note: if the 30 s wait expires, `acquire_blocking` returns False but the caller ignores it and sends anyway.
- Worker: gevent pool, `--concurrency=50` prod (100 dev), queue `whatsapp_broadcast_v2_queue` (`ASYNC whatsapp_send_v2_worker.sh`).
- Daily tier guard at schedule time: `messaging_limit` from config or `"TIER_UNLIMITED"`; remaining = limit - count of distinct `conversation_id` among billable rows sent today (`BC Resource/Broadcast/Broadcast.py:95-130`); sizes capped at 50000 per CSV/query broadcast. Tier values map `TIER_50..TIER_100K` (`CORE whatsapp/MetaAPI.py:30-37`, `WA-SVC utils/enum.js:109-125`). Limits refreshed by webhooks `phone_number_quality_update` and `account_update` (`handlers/phoneNumberQualityUpdateHandler.js:51-114`, `accountUpdateHandler.js`).
- No handling of HTTP 429 / `Retry-After`.

### 4.4 24-hour window logic (billing and UI, not enforcement)

Geta never blocks a free-form send because the window is closed; it lets Meta reject (error 131047 appears nowhere). The window is tracked in Redis for cost and UI:

- Key `{ws}:whatsapp-windows:{+E164}_service_window` is set/refreshed with TTL 24 h on every inbound user message (`messagesHandler.js:360-370`); UI reads TTL for the countdown (`CONV models/chathistory.ts:465-468,1026-1029`).
- Key `{ws}:whatsapp-windows:{+E164}_fep_window`, TTL 72 h, set when inbound `referral.source_type` is `ad` or `post` (Click-to-WhatsApp free entry point) (`messagesHandler.js:339-352`).
- Per-category conversation windows `{ws}:whatsapp-windows:{+E164}_{marketing|utility|authentication|service}` hold `{<wamid>:{status,template_id},cost}` with 24 h TTL, created on send (`whatappService.js:585-706`).
- A utility template is free when `_service_window` exists or FEP exists (`:485-492`, `ASYNC messages.py:73-85`, `SendWhatsappMeta.py:87-99`). Free-form service sends: if any category window open, no deduction, else take 1 free conversation from `workspace.credits.free_conversation` or charge category `"service"` (`whatsappController.js:188-281`).
- Inbound duplicate guard: `{ws}:messages:{wamid}` TTL 1 h (`messagesHandler.js:330-337`).

### 4.5 Opt-out / opt-in

- Contact field `whatsapp_subscription_status` (option ids per workspace in `contact_properties_field_options` where `label` "Yes"/"No"). Broadcast audience filter requires `whatsapp_subscription_status == <"Yes" option id>` (`ASYNC Broadcast/pricing.py:30-37,74`). New contacts default to Yes (`CORE Resource/ContactModule/Contacts.py:1573`, `SubmitContacts.py:341-344`).
- Inbound opt-in/out via bot buttons with node ids `OPT-IN-678-466` and `OPT-OUT-678-688`, which set the field to hard-coded option ids `BCr5atez2M5PA6st` (yes) / `T7poSSdtHqPTVEvL` (no) in the journey context (`conversations/whatsapp.js:383-413`). Template quick reply with `quick_reply_action == "Opt_out"` renders as an `opt_out` button in the live-chat view (`ASYNC SendWhatsappMeta.py:206-215`).
- No reaction to Meta error 131050 (user opted out of marketing). `RESTRICTED_BIZ_INITIATED_MESSAGING` account restriction webhook sets `config_value.current_status.restricted/restriction_alert/all_restrictions` (`accountUpdateHandler.js:154-165`) but nothing stops broadcasts from reading it.
- Blocked inbound numbers: env-free list `BlockedNumbers` in `utils/enum.js:133-135`; webhook for those is acknowledged 200 and dropped (`utils/blockedNumberChecker.js`).

### 4.6 How failures are persisted

Collection `<workspace>.whatsapp_broadcasting_data` (one row per send, also for api/inbox/automation sends). Fields (`WA-SVC helpers/logs.js:8-31`): `id` (uuid), `message_id` (wamid), `phone_no`, `status{sent,delivered,seen,failed,replied}` (datetimes), `error` (string), `amount`, `reseller_amount`, `reseller_margin`, `revert` (bool, credit refunded), `created_time`, `source`, `cost_description` (`billable|free_entry_point|open_conversation_window|free_tier|error`), `meta_template_id`, `template_category`, `origin`, `conversation_id`, `contact_id`, `broadcast_id`, `run_id`.

- Send HTTP error, WA-SVC: no row written (only when HTTP 200 with `message_status:"failed"`: row with `cost_description:"error"`, `revert:true`, `:578-581`).
- Send error, automation: row with `message_id:null`, `status.failed`, `error:<message>`, `cost_description:"error"`, and trigger lambda `nodeClass:"whatsapp", nodeFunction:"failed"` with `{mobile, meta_template_id, contactId}` (`SendWhatsappMeta.py:379-397`). The error string is `response.error.error.message` from WA-SVC's wrapper else "Error in Sending Whatsapp Message" (`:493-497`).
- Send error, broadcast v2: bulk `$set {error:"Error in Sending Whatsapp Message", revert:true, cost_description:"error", status:{sent:t,failed:t}, interakt_reponse_time}` (the Meta error body is discarded; `messages.py:1040-1051,204`); flushed immediately on failure and every 50 rows otherwise (`:1189-1195`). Success row sets `message_id`, `status.sent`, plus `cost_description` and `revert:true` if the send fell in a free window (`:1028-1038`).
- Later webhook status updates (async): `status.delivered`, `status.seen` (read, also `$min` sets delivered), `status.replied`, `status.failed` + `error:"<code> : <message>"`, `conversation_id`, `origin`, credit revert; written through SQS (`WHATSAPP_CALLBACK_SQS_QUEUE_URL`) keyed by `{message_id}` (`messagesHandler.js:186-290`).
- Credits are pre-reserved for the whole broadcast, then refunded at the end: `refund = billable_amount - cost_actual` where `cost_actual` = sum of `amount` of rows with `status.sent`, no `status.failed`, `cost_description:"billable"` (`ASYNC Broadcast/reconciler.py`); reconcile triggered by `conv.handle_credits_and_reconcile_broadcast` with `countdown=600` when `pending_jobs` hits 0 (`messages.py:1088-1115`).

### 4.7 Validation that does not actually run (do not copy blindly)

`DataValidator.validateUser` is `async` but the interactive controller does not `await` it (`whatsappController.js:166-178`), so `{error}` is always undefined: the Joi schemas in `helpers/validators.js` (button, list, cta_url, product, product_list, flow, "catalogue_message" spelling mismatch) are never enforced on interactive sends. Meta is the real validator. The template path does `await` it (`:126`): required `to`, `content.type`, `content.template.name`, `content.template.components`.

---

## 5. Business-initiated broadcast sending

Flow (ASYNC): UI/API creates `broadcasting` doc (BC) then v2 pipeline:

1. Materialise recipients (`ASYNC Broadcast/materializer.py`): Mongo aggregation over `contact_list` (or CSV) into one outbox row per recipient in `<ws>.whatsapp_broadcasting_data` with `status:null`, `message_id:null`, `id:"Broadcast_ID_<8 shortuuid>"`, price/margin per country dial code from `credits_mapping_new` (fallback doc `{name:"other"}`), `cost_description:"billable"`, `source:"broadcast"`, `meta_template_id`, `template_category`, `contact_id`, bulk inserted 1000 at a time (`:build_recipient_row`, `batch_size=1000`). Opt-in filter in the pipeline (4.5). Recipient number = `+<mobile_phone_number>`.
2. Send now or schedule: `send_now` enqueues `conv.create_and_send_whatsapp_v2_campaign` immediately; `schedule_send` uses celery countdown if due within 900 s else a celery-beat one-shot crontab (UTC) named `Broadcast_{broadcast_id}` (`Broadcast/send_scheduler.py`).
3. Fan-out (`messages.py:1245-1304`, `get_v2_fallback_value_map_with_variable`): set broadcast `status:"processing"`; keyset-paginate unsent rows (`status:null`, ordered by `_id`) in pages of env `WHATSAPP_BROADCAST_BATCH_SIZE` (default 100); for each page build payloads (`createQueuePayload`, `:651-668`) and enqueue celery `conv.create_and_send_whatsapp_v2_campaign_batch` on queue `whatsapp_broadcast_v2_queue`. `pending_jobs` counter = batches outstanding.
4. Batch worker (`send_v2_batch_whatsapp`, `:1147-1202`): load config, drop already-attempted on retry, build the token bucket (44 msg/s cluster-wide), for each row `acquire_blocking()` then `send_whatsapp_message_broadcast` (section 1.2 route), collect `UpdateOne` per row and bulk-write every 50, insert the rendered template into live-chat `chathistory` (best-effort), `_finalize_broadcast_job` decrements `pending_jobs`; at zero set status `completed` and schedule reconcile.
5. Retry of failed (frequency-capped 131049) rows: 4.2.

### 5.1 Request actually sent per recipient (`messages.py:127-190`)

`POST https://amped-express.interakt.ai/api/v17.0/{phoneID}/{messages|marketing_messages}` headers `x-access-token`, `x-waba-id`, `Content-type: application/json`; body `{"messaging_product":"whatsapp","to":"+9199..","type":"Template","template":{"name":..,"language":{"policy":"deterministic","code":..},"components":[..]}}` serialised with `json.dumps` via `requests.request("POST", ...)`. Success = HTTP 200 and `messages[0].id`; otherwise generic error (no body kept). Then `check_whatsapp_window` decides if credit is refunded (`refund_required`, `:73-85`).

### 5.2 Throttling

Per-second throttle: Redis token bucket 44/s default (4.3); concurrency: 50 gevent greenlets/process; batch granularity 100 rows.

### 5.3 Status persistence per recipient

Row in `whatsapp_broadcasting_data` as in 4.6; counters on `broadcasting` doc recomputed by `conv.update_whatsapp_broadcast_stats` via `count_documents` on `status.sent/delivered/seen/failed/replied` (`ASYNC helpers/whatsapp.py:~870-930`).

### 5.4 Recipient template variable resolution (per recipient, at send time)

Broadcast stores `components` on the `broadcasting` doc: `body.value = [{"index":"<contact field name>","value":"<fallback>","key":"{{1}}"}]`, `header {type,value,index}`, `button.value[{index,value,payload}]`, `carousel.value[...]`, `limited_time_offer.value` (`messages.py:209-628`).

- Contact source: `contact_list` doc by `contact_id` (fallback: the outbox row itself) (`:651-659`).
- Rule: `text = contact[index] if contact[index] else value` (empty/None falls back to the broadcast default). If the row has a `context` dict (event/automation context) it is used instead of the contact (`:331-345`).
- Date/datetime contact fields are converted to the workspace timezone (default `Asia/Kolkata`) and formatted `%Y-%m-%d` or `%Y-%m-%d %H:%M:%S` (`handle_date_time_fields`, `:1306-1333`).
- Header text token `<<field>>` is replaced by contact field; header media uses `value` as `link`.
- Automation variant uses `VariableResolver` which also resolves order, product, checkout and context objects (`ASYNC SendWhatsappMeta.py:503-560`, `AutomationJourney/Helpers/custom_resolver.py`).
- Limits baked in: coupon_code <=15 chars, quick-reply payload fallback <=25 chars.

### 5.5 Correlation id for webhook statuses

`message_id` = the `messages[0].id` wamid returned by the send; webhook `statuses[].id` is matched on `whatsapp_broadcasting_data.message_id` (`messagesHandler.js:19,277-278`). `biz_opaque_callback_data` is NOT used anywhere (grep: nothing), and the broadcast row id `Broadcast_ID_xxxx` is NOT sent to Meta (the old Exotel `status_callback` URL pattern in `ASYNC helpers/whatsapp.py:~150` is legacy). Replies are tied back through `messages[].context.id` (the wamid of our message) to the redis window keys, then flagged `status.replied` (`messagesHandler.js:372-411`). Status fields used: `status.id`, `status.status` in {`sent`,`delivered`,`read`,`failed`}, `status.timestamp`, `status.recipient_id` (prefixed `+`), `status.conversation.id`, `status.conversation.origin.type`, `status.pricing.category`, `status.errors[0]`.

---

## 6. Templates, catalog/commerce and WhatsApp Flows endpoints (short)

All via flag-aware `MetaApiEnum.META_API_BASE_URL` + `getMetaHeaders(config)` (section 1.1). WA-SVC routes: `routes.js:27-29,32-62,67-77`.

Templates (WABA-scoped):

- Create: `POST {base}/{waba_id}/message_templates` body `{name,language,category,components}` (`whatsappController.js:335-341`); BC validates first (`MetaTemplateValidation.validate_template`) then calls WA-SVC `POST /api/v1/whatsapp/create-template` (BC `Meta/Meta.py:84-93`).
- List/get: `GET {base}/{waba_id}/message_templates?limit=&status=&name=` (`:456-464`; BC refresh `Meta.py:24-33`).
- Delete: `DELETE {base}/{waba_id}/message_templates?name=<name>` (`:395-402`); BC blocks delete when used by processing/scheduled broadcast or automation (`Meta.py:117-125`).
- Webhooks update status: `message_template_status_update`, `message_template_quality_update`, `template_category_update` (`callbackHandlerMap.js`).

Flows (WA-SVC `models/whatsapp/whsatappFlow.js`, `services/whasapp/whatsappFlowService.js`, routes `/api/v1/whatsapp/{default_flows,create_flow,update_flow,flow_list,delete_flow,deprecated_flow,clone,publish_flow,flow_preview,test_flow,sync_flow}`):

- Create: `POST {base}/{waba_id}/flows` body `{"name":..,"categories":[..]}` (`:47-53`), response `{id}`.
- Upload JSON: `POST {base}/{flow_id}/assets` multipart `file` (blob `flow.json`, application/json), `name=flow.json`, `asset_type=FLOW_JSON`, extra header `x-phone-number-id` (`:81-108`); success iff `validation_errors` empty; first error is rewritten from JSON-pointer messages (`convertMessage`).
- Get JSON: `GET {base}/{flow_id}/assets` then download `data[0].download_url` (`:150-163`, sync `:~230-300`).
- List: `GET {base}/{waba_id}/flows` (`:132`). Preview/details: `GET {base}/{flow_id}` (`:170,242`). Publish: `POST {base}/{flow_id}/publish`. Deprecate: `POST {base}/{flow_id}/deprecate`. Delete: `DELETE {base}/{flow_id}` (only drafts: published/deprecated blocked in code, `whatsappFlowService.js:~178`).
- Send flow: interactive `flow` (2.6). Test send is only for `+91` numbers (regex `^\+91\s?\d{10}$`), `mode:"draft"`, first screen id.
- Webhook `flows` handler stores status events (`handlers/flowsHandler.js`).

Catalog (WA-SVC `models/catalog/catalogModel.js`, `services/catalog/catalogService.js`; Mongo `chatbot_misc_config {config_key:"META_CATALOGUE_CONFIG"}`, collections `catalog_set`, `catalog_product`):

- List catalogs: `GET {base}/{business_id}/owned_product_catalogs` (business_id from META_WHATSAPP_CONFIG, `:160`).
- Sets: `GET {base}/{catalogue_id}/product_sets?fields=["product_catalog","name","errors","product_count"]` (`:181`).
- Products: `GET {base}/{catalogue_id}/products?limit=500&fields=["id","name","description","price","availability","brand","category","condition","link","retailer_id","errors","group","size","color","retailer_product_group_id","product_sets","image_url","url"]` + cursor `&after=<paging.cursors.after>` (`:202,221`; loop in `catalogService.js:65-121`).
- Auth: facebook-native uses the CATALOG config's own `access_token`; Interakt uses workspace `auth_key`/`waba_id` (`catalogModel.js:14-18`).
- Push products to Meta (Shopify sync): `POST {META_BASE}/{catalogue_id}/batch?access_token=<token>` with `{"requests":[...]}`, headers JSON (`ASYNC whatsapp/MetaCatalogueConnect.py:117-121,165-201`); OAuth code/exchange calls `GET {META_BASE}/oauth/access_token?...` (`:24,38,52`, uses env `META_API_ENDPOINT/VERSION` directly).
- Order messages inbound (`type:"order"`) handled in `conversations/whatsapp.js:845-856`. No outbound order/checkout/payment messages (not found).
- Commerce settings (`/{phone_id}/whatsapp_commerce_settings`): not found.

Account/onboarding calls (context only): `GET {base}/{waba_id}/phone_numbers`, `GET {base}/{phone_id}?fields=quality_rating,whatsapp_business_manager_messaging_limit,status,is_official_business_account,id,name_status,code_verification_status,display_phone_number,platform_type,messaging_limit_tier,throughput`, `GET/POST {base}/{phone_id}/whatsapp_business_profile`, `GET/POST {base}/{phone_id}/business_compliance_info` (not yet confirmed against Interakt, keep native), `POST https://interakt-amped-express.azurewebsites.net/api/v17.0/{phoneID}/subscribed_apps` (legacy host, CORE `whatsapp/MetaOnboarding.py:153-156`), Interakt partner signup `https://api.interakt.ai/v1/organizations/tp-signup/` (`ASYNC whatsapp/onboarding_helpers.py:221`) (`CORE whatsapp/MetaAPI.py:78-137,730,754`).

Webhooks (inbound side that closes the outbound loop): `GET /api/v1/whatsapp/webhook/callback` and `/webhook/interakt/callback` verify with env `WHATSAPP_VERIFY_TOKEN` (`whatsappController.js:58-119`); `POST` same paths dispatch by `entry[].changes[].field` to handlers (`callbackHandlerMap.js`); 16 fields handled: messages, message_template_status_update, message_template_quality_update, template_category_update, phone_number_quality_update, phone_number_name_update, account_update, account_review_update, account_alerts, business_status_update, business_capability_update, flows, campaign_status_update, partner_solutions, messaging_handovers, security. No `X-Hub-Signature-256` verification.

---

## 7. Port checklist (what to replicate vs fix)

Replicate:

1. Provider port with Interakt (`x-access-token`, `x-waba-id`) and Meta-native (`Bearer`) adapters, plus workspace-level `provider`; base URL from env (`IS_INTERAKT_ENABLED`, `META_API_*`, `INTERAKT_API_*`); endpoint `/{phoneID}/messages` or `/marketing_messages` for MM-Lite marketing.
2. Template payload builder with the exact component shapes in 2.2 (header/body/url/copy_code/quick_reply/flow/limited_time_offer/carousel), `language.policy=deterministic`.
3. Send media by `link`; template header examples via Interakt `media_handle` or Meta resumable `uploads`.
4. Persist one outbox row per send keyed by wamid; update by webhook `statuses[]`; store `"<code> : <message>"` on failure; refund pre-reserved credits at the end.
5. Token bucket (44/s default), 100-row batches, 3 retries with exponential backoff 60..600 s with jitter, skip already-sent rows on retry, 131049 daily retry up to 7 times.
6. Redis windows: 24 h service window on inbound, 72 h FEP window on ad referral, per-category 24 h conversation windows for billing.
7. Opt-in filter `whatsapp_subscription_status = Yes` on audience resolution.

Fix rather than copy:

- Hard-coded `v17.0` in send URLs and the ignored flag (1.2); hard-coded test phone id `108911612034746`; hard-coded opt-in/out option ids.
- `expiration_time_ms` in seconds (Python builder).
- Meta error body dropped for broadcast failures; no handling for 131026, 131047, 131048, 131049 (outside the Lambda), 131050, 131056, 130429, 190, 100; add classification and backoff on 429/130429/131056 and mark 190/token errors as workspace-level pause.
- Unvalidated interactive payloads (non-awaited Joi); `type:"Template"` capitalisation (send lowercase `template`); missing `context`, reaction, contacts, standalone mark-as-read; `acquire_blocking` give-up ignored; no webhook signature check; process-global `global.whatsappConfig`; typing helper `response` scope bug; no request timeouts.
