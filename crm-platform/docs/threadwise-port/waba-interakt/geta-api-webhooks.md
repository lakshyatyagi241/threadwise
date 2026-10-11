# Geta inbound WhatsApp webhooks: how they arrive and how they are processed

Survey date 2026-10-02. Read-only. All paths are under `/home/getaweblpubt24/Documents/geta/`.
"Not found" means I grepped the listed repos and found nothing. No secret values were read or copied; env var NAMES only.

Short version: the live inbound pipeline is a single Node/Express Lambda, `geta-whatsapp-service`. It handles Meta-direct and Interakt callbacks with the same code. It does no signature check, resolves the tenant only by `entry[].id` (WABA id) via Redis, does the work inline inside the HTTP request, and hands off to the chatbot/live-chat service over HTTP. Status updates go through a FIFO SQS queue and a cron consumer in `geta-core`. Nothing Pinnacle-specific exists on the inbound side.

---

## 0. Component map

| Piece                                    | Repo / file                                                                                 | Role                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Callback endpoint (live)                 | `geta-whatsapp-service/src/routes/routes.js:12-17`                                          | GET/POST for Meta and Interakt                                                     |
| Controller                               | `geta-whatsapp-service/src/controllers/whatsappCallbackController.js:14-73`                 | blocked-number check, WABA to workspace lookup, dispatch by `change.field`         |
| Dispatch map                             | `geta-whatsapp-service/src/services/whatsappCallback/callbackHandlerMap.js:19-36`           | field to handler                                                                   |
| Handlers                                 | `geta-whatsapp-service/src/services/whatsappCallback/handlers/*.js`                         | one per field                                                                      |
| Inbound message to bot / live chat       | `geta-whatsapp-service/src/conversations/inbox.js`, `conversations/whatsapp.js`             | session, media download, HTTP to conversational service                            |
| Status write-back queue                  | `geta-whatsapp-service/src/utils/sqs.js:3-32` (`pushToSqs`)                                 | FIFO `geta-prod-whatsapp-callback-serverless.fifo` (`secrets/prod.secrets.yml:31`) |
| Queue consumer                           | `geta-core/src/shared/scripts/whatsapp_callback_handler.py` and `callback_handler.py:33-53` | `bulk_write` into `whatsapp_broadcasting_data` per workspace DB                    |
| Bot / live-chat API                      | `conversational-service-node/src/routes/conversation.ts:17,24` (`/query`, `/live-chat`)     | session, agent routing, opt-in/out, contact sync                                   |
| Automation hand-off                      | `geta-whatsapp-service/src/utils/sendToLambda.js:8-54`                                      | Celery `automation.trigger` for status events                                      |
| Onboarding (writes the WABA mapping)     | `Voice/geta-async/src/whatsapp/onboarding.py:106-127`, `pinnacle_onboarding.py:160-181`     | Redis `meta_account_mapping:*`                                                     |
| Legacy Exotel callback (not Meta format) | `geta-notifier-service/src/Resource/Whatsapp.py:51-126`                                     | see 1.5                                                                            |
| Stub                                     | `geta-webhook-service/src/controllers/providerWebhookController.js`                         | GET verify only, no POST                                                           |

`geta-core/src/whatsapp/*` has NO inbound webhook code (onboarding, profile, send, templates, price-ack only). `geta-automation-service` has no webhook endpoint. It only defines trigger shapes (`src/shared/scripts/add_whatsapp_trigger_shapes.py:29-62`: WhatsappSent/Delivered/Seen/Replied/Failed) and consumes the Celery `automation.trigger` task (`src/jobs.py:24`). `geta-notifier-service` has only the legacy Exotel path.

---

## 1. Endpoints, GET handshake, POST authenticity

### 1.1 URLs (geta-whatsapp-service, mounted at `/api/v1`, `handler.js:49`)

| Method + path                                     | Handler                                                                           | Used by                                           |
| ------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| `GET /api/v1/whatsapp/webhook/callback`           | `whatsappController.getWhatsAppCallback` (`whatsappController.js:58-94`)          | Meta app-level webhook verification (Meta direct) |
| `POST /api/v1/whatsapp/webhook/callback`          | `whatsAppCallbackController.whatsAppCallback` (`routes.js:13`)                    | Meta direct events                                |
| `GET /api/v1/whatsapp/webhook/interakt/callback`  | `whatsappController.getInteraktWhatsAppCallback` (`whatsappController.js:96-119`) | Interakt verification                             |
| `POST /api/v1/whatsapp/webhook/interakt/callback` | the same `whatsAppCallback` (`routes.js:17`)                                      | Interakt-forwarded events                         |
| `GET /api/v1/health-check`                        | `routes.js:9`                                                                     | n/a                                               |

- Production host registered with Interakt: `https://api-whatsapp.geta.ai/api/v1/whatsapp/webhook/interakt/callback`. It is hardcoded in `geta-core/src/shared/scripts/migrate_waba.py:13`.
- The Meta-direct URL is configured in the Meta App dashboard. That setting is not in any repo, so the exact callback host for Meta direct is "not found". The path above is the only Meta-shaped route.
- The auth middleware (`src/middlewares/customMiddleware.js:16`) explicitly skips `/api/v1/health-check`, `/api/v1/whatsapp/webhook/callback` and `/api/v1/whatsapp/webhook/interakt/callback`. All other routes require a `geta-host` header. The webhook routes need nothing.
- There is NO per-tenant path or query param. One URL serves all tenants.
- Lambda: API Gateway `ANY /` and `ANY /{proxy+}`, `timeout: 30`, `memorySize: 512` (`serverless.yml:78-82`). The whole inbound pipeline runs synchronously inside this request (see section 4 and 6).

### 1.2 How Interakt is pointed at Geta

- Per-number override via `POST {INTERAKT_API_BASE}/{phone_number_id}` (`migrate_waba.py:59-77`), where `INTERAKT_API_BASE` is `MetaApiEnum.INTERAKT_API_BASE_URL` (`geta-core/src/util/global_enums.py:20-27`). Headers: `x-access-token: <auth_key>`, `x-waba-id`, `x-phone-number-id`, `Content-Type: application/json`. Body: `{"webhook_configuration":{"override_callback_uri": "<URL above>"}}`. No `verify_token` is sent here.
- Customer-defined callback: `geta-core/src/whatsapp/MetaOnboarding.py:105-180` (`WhatsAppSetupWebhook`, route `workspace/whatsapp/setup/webhook`, `geta-core/src/routers.py:786`). It takes `callback_url` and `verify_token` from the user and builds `{"override_callback_uri":..., "verify_token":...}`. It then calls `POST https://interakt-amped-express.azurewebsites.net/api/v17.0/{phoneID}/subscribed_apps` with `x-access-token` and `x-waba-id`. Bug: line 141-143 builds `payload`, then line 154 overwrites it with `payload={}` before the request. The override is therefore never actually sent. It stores `{callback_url, verify_token}` in `workspace_settings` type `callback-url`.
- Meta direct: `OnboardingHelpers.subscribeApp` (`Voice/geta-async/src/whatsapp/onboarding_helpers.py:188-202`) does `POST {META_API_ENDPOINT}/{META_API_VERSION}/{waba}/subscribed_apps` with the business-integration token. There is no `override_callback_uri`, so Meta delivers to the App-level callback.
- Interakt partner registration at onboarding: `interaktTPSignup` (`onboarding_helpers.py:219-252`) posts `object: "tech_partner"`, event `PARTNER_ADDED`, `waba_info{waba_id, solution_id, phone_number}` to `https://api.interakt.ai/v1/organizations/tp-signup/`.

### 1.3 GET verification handshake (exactly what is validated)

Meta route, `whatsappController.js:58-94`:

- Reads `hub.mode`, `hub.verify_token`, `hub.challenge` from `req.query`.
- Expected token: `process.env.WHATSAPP_VERIFY_TOKEN`. This is a single global token for every tenant. Its value is in the env files and was not read.
- If `hub.mode` and `hub.verify_token` are both present: match gives `200`, `Content-Type: text/plain`, body = the raw `hub.challenge`. Mismatch gives `403` JSON `{status:403,message:"Authentication Error"}`.
- If those params are absent: `200` JSON `{status:200,message:"Success"}`.
- Any exception gives `400`.

Interakt route, `whatsappController.js:96-119`: the same token (`WHATSAPP_VERIFY_TOKEN`). `mode==="subscribe" && token===VERIFY_TOKEN` gives `200 text/plain challenge`. If `mode` or `token` is present but wrong, `403`. Otherwise `200 {status:200,message:"Success"}`.

geta-webhook-service stub, `src/routes/routes.js:18` and `controllers/providerWebhookController.js:3-56`: `GET /api/v1/provider/whatsapp/webhook`.

- `400 "Missing query parameters"` if any hub param is missing.
- It loads Mongo `geta_core.app_configuration` where `config_key = "INTERAKT_CONFIG"` and compares `hub.verify_token` to that document's `verify_token` field. This is a DB-stored token, not env.
- Responses: `404` (no config), `500` (no token configured), `200 <challenge>` (match), `403 "Forbidden"` (mismatch).
- Caveats: there is NO POST counterpart. A POST to `/api/v1/provider/whatsapp/webhook` matches no route and falls to `app.all("*")` (`handler.js`), which never responds. Nothing in the survey points Interakt or Meta at this endpoint. Treat it as an unfinished stub. It logs the verify token to stdout (`console.log("🚀 ~ token:", token)`).
- The only POST in that service is the generic lead-capture webhook `POST /api/v1/:workspace_id/:action` (`routes.js:16`, `webhookUpdate.js:13-55`). It is not WhatsApp.

### 1.4 POST authenticity: nothing is validated

- No `X-Hub-Signature-256` / `X-Hub-Signature` check anywhere. Grepped `x-hub-signature`, `hmac`, `createHmac` and `app_secret` across geta-whatsapp-service and geta-webhook-service: no hits.
- No Interakt-specific header or token check on POST. No shared secret in the URL. The URL is public and unauthenticated.
- The only "gates" are: `body.object === "whatsapp_business_account"` (`whatsappCallbackController.js:26`), a hardcoded blocked-sender list (`src/utils/enum.js:133`, `src/utils/blockedNumberChecker.js`), and the Redis WABA lookup. A forged POST naming a known WABA id would be processed for that tenant.
- A historical commit (216ebac, Feb 2026) forwarded one hardcoded `phone_number_id` from prod to the staging callback with a `geta-host` header. It is not in the current file.

### 1.5 Legacy path: geta-notifier-service (Exotel/Gupshup-style, NOT Meta format)

`geta-notifier-service/src/routers.py:49`: `WhatsAppCallback` at `/whatsapp/webhook/callback` (a different service from the Node one).

- GET verify uses the same `WHATSAPP_VERIFY_TOKEN` env name (`Resource/Whatsapp.py:53-74`).
- POST expects `data["whatsapp"]["messages"][0]` with `callback_type: "incoming_message"` and `sid` / `to` / `from`. This is the Exotel format.
- It resolves the tenant by `geta_core.workspace.whatsapp_no == message.to`, dedupes with Redis `{clientid}:whatsapp_sid:{sid}` (TTL 3600), and always returns `200 {"status":"Ok"}`.
- `WhatsAppClientCallback` `/whatsapp/webhook/<clientid>/<messageid>` handles `callback_type: dlr`.
- Do not port this to a Meta/Interakt target. It is the old BSP route.

---

## 2. Attribution to workspace / number

`whatsappCallbackController.js:26-37`:

1. Reject if `body.object !== "whatsapp_business_account"`: it logs and returns `200 {status:200,message:"Success"}` (line 61-65).
2. For each `entry[i]`, `waba_id = entry[i].id`.
3. Redis `GET meta_account_mapping:account_waba_ids:<waba_id>` → JSON. Written by onboarding as `{waba_id, phone_number, phoneId, workspace_id, limit}` (`Voice/geta-async/src/whatsapp/onboarding.py:111-127`, `pinnacle_onboarding.py:166-181`). The key is built by `RedisManager.insert_one(db, collection, key)` as `db:collection:key`.
4. `global.workspaceId = whatsappConfig.workspace_id` (or `null`), a process-global. A Lambda container serves one request at a time, so it is safe there but not in a threaded server.
5. The workspace DB is then Mongo database `<workspace_id>`. Per-workspace config is Redis `<workspace_id>:chatbot_misc_config:META_WHATSAPP_CONFIG` (value: `phoneID`, `waba_id`, `auth_key`, `access_token`, `provider` = `interakt` or `pinnacle`, `display_number`, `limit`, `messaging_limit`, `status`, ...). The durable copy is Mongo `chatbot_misc_config` where `config_key = "META_WHATSAPP_CONFIG"`.

Facts that matter for the port:

- Attribution is by WABA id only. `metadata.phone_number_id` and `metadata.display_phone_number` are never used for routing. One WABA maps to exactly one workspace, so several numbers on one WABA all land in the same tenant.
- `meta_account_mapping:account_phone_numbers:<id>` exists but is keyed by WABA id by mistake at onboarding (`onboarding.py:127`, `pinnacle_onboarding.py:181`). `MetaAPI.py:815` reads it by phone id. It is unused on the inbound path.
- Missing mapping (unknown WABA): `whatsappConfig=null`, `global.workspaceId=null`. For `statuses` the handler logs "Workspace ID not found" and returns without work (`messagesHandler.js:459-463`). For `messages` it continues with a null workspace, will fail inside, and the error is swallowed. The HTTP result is still 200. There is no dead-letter.
- Mapping is Redis only (no DB fallback). A flushed Redis loses all inbound routing until re-onboarded.
- `geta-core/src/shared/scripts/meta_callback_handler.py` holds a hardcoded `waba_workspace_mapping` for a single test WABA. It is a one-off script, not a routing path.

---

## 3. Payload shapes

Envelope for all events (Meta documented; the fixtures are not in the repos, and I found no captured sample payloads):

```json
{"object":"whatsapp_business_account","entry":[{"id":"<WABA_ID>","time":1700000000,"changes":[{"field":"messages","value":{...}}]}]}
```

Dispatch: `callbackHandlerMap.js:19-36` keys are `template_category_update, phone_number_quality_update, phone_number_name_update, partner_solutions, messaging_handovers, messages, message_template_status_update, message_template_quality_update, flows, campaign_status_update, business_status_update, business_capability_update, account_update, account_review_update, account_alerts, security`. Any other field, such as `calls`, `history`, `smb_message_echoes`, `smb_app_state_sync` or `user_preferences`, gets HTTP 400 "Invalid or unsupported field type" (controller line 54). The `calls` field is not handled anywhere (grep'd the services). `phone_number_settings`, `template_*_update` variants and `message_echoes` are also unhandled.

`value` common part for messages and statuses:

```json
{
  "messaging_product": "whatsapp",
  "metadata": { "display_phone_number": "15550001111", "phone_number_id": "123456789012345" }
}
```

Geta ignores `metadata` entirely.

### 3.1 `field: "messages"` with `value.messages[]` (handled by `messagesHandler.js:320-455`)

Only `messages[0]` and `contacts[0]` are read (`inbox.js:34-35`, `messagesHandler.js:325`). A batched webhook with several messages silently drops all but the first.

Common envelope:

```json
{
  "contacts": [{ "profile": { "name": "Asha" }, "wa_id": "919876543210" }],
  "messages": [
    {
      "from": "919876543210",
      "id": "wamid.HBgM...",
      "timestamp": "1700000000",
      "type": "text",
      "...type-specific...": {}
    }
  ]
}
```

Geta type to bot-payload conversion is in `conversations/whatsapp.js:662-882` (`handleWhatsappMessageType`).

| type                            | example fragment (Meta shape)                                                                                                                                                                                                       | Geta handling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| text                            | `"type":"text","text":{"body":"hi"}`                                                                                                                                                                                                | `{type:"text",value:body}` (`:665-672`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| image                           | `"type":"image","image":{"id":"1234","mime_type":"image/jpeg","sha256":"..","caption":"x"}`                                                                                                                                         | media downloaded and re-hosted, `{type:"image",value:{url,text:caption}}` (`:767-781`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| video                           | `"video":{"id":"..","mime_type":"video/mp4","caption":".."}`                                                                                                                                                                        | same (`:782-795`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| audio                           | `"audio":{"id":"..","mime_type":"audio/ogg; codecs=opus","voice":true}`                                                                                                                                                             | same; no caption (`:809-822`). The `file_extension` map (`:24-43`) lacks `audio/ogg; codecs=opus`, so the filename ext becomes `undefined`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| document                        | `"document":{"id":"..","mime_type":"application/pdf","filename":"a.pdf","caption":".."}`                                                                                                                                            | same, uses `filename` (`:796-808`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| sticker                         | `"sticker":{"id":"..","mime_type":"image/webp","animated":false}`                                                                                                                                                                   | mapped to `type:"image"` (`:832-844`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| location                        | `"location":{"latitude":12.9,"longitude":77.6,"name":"..","address":".."}`                                                                                                                                                          | `{type:"location",value:<object>}` (`:857-865`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| contacts                        | `"contacts":[{"name":{"formatted_name":".."},"phones":[{"phone":"+91..","wa_id":".."}]}]`                                                                                                                                           | `{type:"contact",value:<array>}` (`:866-875`). Note `value.contacts` on a message is a different field from the envelope `contacts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| interactive button_reply        | `"type":"interactive","interactive":{"type":"button_reply","button_reply":{"id":"node1_x","title":"Yes"}},"context":{"from":"..","id":"wamid.OUT"}`                                                                                 | `nodeId` = part of `id` before the first `_`, `value=title`, `journey:{nodeId,query}`, `messageID=context.id` (`:700-715`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| interactive list_reply          | `"interactive":{"type":"list_reply","list_reply":{"id":"node2_1","title":"Opt A","description":".."}}`                                                                                                                              | same; uses `interactive.context.id` (`:716-731`; probably a bug, since Meta puts `context` on the message)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| interactive nfm_reply (Flow)    | `"interactive":{"type":"nfm_reply","nfm_reply":{"name":"flow","body":"Sent","response_json":"{\"flow_token\":\"..\",\"email\":\"a@b.c\"}"}}`                                                                                        | `response_json` parsed, `flow_token` stripped, `email` becomes `visitor_email`, sent as `journey:{nodeId:"whatsapp-flow", context: flow_data}`, `value:"Sent"` (`:732-765`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| button (template quick reply)   | `"type":"button","button":{"text":"Stop","payload":"OPT-OUT-678-688"},"context":{"id":"wamid.OUT"}`                                                                                                                                 | if `text == payload`: plain text. Else `journey.nodeId = payload`, `value = text` (`:673-698`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| order                           | `"type":"order","order":{"catalog_id":"..","text":"..","product_items":[{"product_retailer_id":"..","quantity":1,"item_price":10,"currency":"INR"}]}`                                                                               | `{type:"order",value:text,order:<obj>}` (`:845-856`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| reaction                        | `"type":"reaction","reaction":{"message_id":"wamid.OUT","emoji":"👍"}`                                                                                                                                                              | `{type:"reaction",messageId:data.id,value:emoji}` (`:823-831`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| referral (click-to-WhatsApp ad) | `"type":"text","text":{...},"referral":{"source_url":"https://fb.me/..","source_id":"ad_id","source_type":"ad","headline":"..","body":"..","media_type":"image","image_url":"..","ctwa_clid":"..","welcome_message":{"text":".."}}` | (a) FEP window: `referral.source_type` is `ad` or `post` gives Redis `<ws>:whatsapp-windows:+<from>_fep_window` TTL 72h (`messagesHandler.js:339-352`), which makes later template sends free (`whatappService.js:478-483`). (b) Referral to contact context: only if `referral.type === "referral"` (`whatsapp.js:226`, `modifyRefferalData` `:146-180`). Mapped keys: `wa_source_url, wa_ad_id, wa_source_type, wa_ad_headline, wa_media_type, wa_image_url, wa_video_url, wa_thumbnail_url, wa_ctwa_click_id, wa_referral_type, wa_source_category, utm_source, utm_campaign`. Meta's referral object has no `type` field. This branch likely only fires if Interakt adds `type:"referral"`, which I cannot confirm. `source_category`, `source` and `source_name` are not standard Meta referral fields |
| system                          | `"type":"system","system":{"body":"user changed number","new_wa_id":"..","type":"user_changed_number"}`                                                                                                                             | not handled: `handleWhatsappMessageType` returns `null` (no branch)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| unsupported                     | `"type":"unsupported","errors":[{"code":131051,"title":"Message type is not supported"}]`                                                                                                                                           | not handled, returns `null`. The `payload` is falsy so for new sessions the code still proceeds with null (possible crash, caught, `return true`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| call events                     | Meta `field:"calls"`                                                                                                                                                                                                                | not found. Rejected with 400                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### 3.2 `field: "messages"` with `value.statuses[]`

Example (Meta shape; the code reads `id`, `status`, `timestamp`, `recipient_id`, `conversation.id`, `conversation.origin.type`, `pricing.category`, `errors[0]`):

```json
{
  "messaging_product": "whatsapp",
  "metadata": { "display_phone_number": "15550001111", "phone_number_id": "123456789012345" },
  "statuses": [
    {
      "id": "wamid.OUT",
      "status": "delivered",
      "timestamp": "1700000005",
      "recipient_id": "919876543210",
      "conversation": {
        "id": "conv123",
        "origin": { "type": "marketing" },
        "expiration_timestamp": "1700086400"
      },
      "pricing": { "billable": true, "pricing_model": "CBP", "category": "marketing" },
      "biz_opaque_callback_data": "optional"
    }
  ]
}
```

failed variant: `"status":"failed","errors":[{"code":131026,"title":"Message undeliverable","message":"..","error_data":{"details":".."}}]`. Statuses are `sent | delivered | read | failed`.

- Geta maps `read` to `seen`, adds a synthetic `replied` status (see 4.4), and ignores any other status value ("Invalid Status", `messagesHandler.js:256-259`).
- Fields used: `status.id`, `timestamp`, `recipient_id` (prefixed with `+`), `conversation.id`, `conversation.origin.type`, `pricing.category`, `errors[0]` only, stored as the string `"<code> : <message>"`.
- `biz_opaque_callback_data`, `pricing.billable`, `pricing.pricing_model` and `conversation.expiration_timestamp` are never read (grep for `biz_opaque_callback_data`: no hits in any repo). Outbound sends do not set it. Message correlation is by wamid only.

### 3.3 Account and template events (examples are the Meta shape; the fields read are cited)

| field                                                                                                 | example `value`                                                                                                                                                                                                                                                                                         | Geta handler / effect                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `account_update`                                                                                      | `{"event":"ACCOUNT_VIOLATION","violation_info":{"violation_type":"SPAM"}}`; also `DISABLED_UPDATE{ban_info:{waba_ban_state,waba_ban_date}}`, `ACCOUNT_RESTRICTION{restriction_info:[{restriction_type,expiration}]}`, `VERIFIED_ACCOUNT`, `PHONE_NUMBER_REMOVED`, `BUSINESS_VERIFICATION_STATUS_UPDATE` | `accountUpdateHandler.js:85-224`. Only events in `EventEnum.account_update` (`enum.js:79`). Saves the raw change to `meta_callbacks` in the workspace DB (`callbackHelper.js`; failures go to `meta_callbacks_error`). Pushes `config_value.status_history` and sets `config_value.current_status.{disabled,violation,restricted,...}` on Mongo `chatbot_misc_config` and the Redis config copy. `PHONE_NUMBER_REMOVED` and verification events only write history        |
| `phone_number_quality_update`                                                                         | `{"display_phone_number":"..","event":"UPGRADE","current_limit":"TIER_10K","old_limit":"TIER_1K"}`; also `DOWNGRADE`, `ONBOARDING`, `FLAGGED`, `UNFLAGGED`                                                                                                                                              | `phoneNumberQualityUpdateHandler.js:32-125`. Sets `limit`, `messaging_limit` (TIER_50=50, TIER_250=250, TIER_1K=1000, TIER_10K=10000, TIER_100K=100000, `TIER_UNLIMITED`; `enum.js:109-125`), or `current_status.flagged*`, plus history. Mongo + Redis                                                                                                                                                                                                                   |
| `phone_number_name_update`                                                                            | `{"display_phone_number":"..","decision":"APPROVED","requested_verified_name":"Acme"}`                                                                                                                                                                                                                  | `phoneNumberNameUpdateHandler.js`. On APPROVED sets `config_value.display_name`; REJECTED only logs                                                                                                                                                                                                                                                                                                                                                                       |
| `message_template_status_update`                                                                      | `{"event":"APPROVED","message_template_id":123,"message_template_name":"x","message_template_language":"en","reason":"NONE"}`                                                                                                                                                                           | `messageTemplateStatusUpdateHandler.js:5-41`. Updates `broadcast_templates` matching `{meta_template_id:String(id),type:"whatsapp",language}` with `status`, `modified_time`, `rejection_reason`. Throws on an event outside `StatusEnum` (`APPROVED, IN_APPEAL, PENDING, REJECTED, PENDING_DELETION, DELETED, DISABLED, PAUSED, LIMIT_EXCEEDED, ARCHIVED`). Meta's `FLAGGED` and `REINSTATED` are not in the enum, so the handler throws and the HTTP result becomes 500 |
| `message_template_quality_update`                                                                     | `{"message_template_id":123,"previous_quality_score":"GREEN","new_quality_score":"YELLOW"}`                                                                                                                                                                                                             | `messageTemplateQualityUpdateHandler.js`. Sets `broadcast_templates.quality`. Enum GREEN/YELLOW/RED/UNKNOWN                                                                                                                                                                                                                                                                                                                                                               |
| `template_category_update`                                                                            | `{"message_template_id":123,"previous_category":"UTILITY","new_category":"MARKETING","correct_category":"MARKETING"}`                                                                                                                                                                                   | `templateCategoryUpdateHandler.js`. Reads `correct_category` and sets `category` and `inputValues.template_category`. Throws on an unknown category                                                                                                                                                                                                                                                                                                                       |
| `account_review_update`                                                                               | `{"decision":"APPROVED"}` or `REJECTED`                                                                                                                                                                                                                                                                 | `accountReviewUpdateHandler.js:7-47`. Sets `chatbot_misc_config.status` ("Approved"/"Rejected"); on REJECTED it deletes the Redis config key (the workspace loses its WhatsApp config)                                                                                                                                                                                                                                                                                    |
| `business_capability_update`                                                                          | `{"max_daily_conversation_per_phone":1000,"max_phone_numbers_per_business":25}`                                                                                                                                                                                                                         | `businessCapabilityUpdateHandler.js`. Sets limit and history                                                                                                                                                                                                                                                                                                                                                                                                              |
| `flows`                                                                                               | `{"event":"FLOW_STATUS_CHANGE","flow_id":"..","new_status":"PUBLISHED"}`                                                                                                                                                                                                                                | `flowsHandler.js`. Sets `whatsapp_flow.status` where `meta_id = flow_id` (enum DRAFT/PUBLISHED/DEPRECATED/BLOCKED/THROTTLED)                                                                                                                                                                                                                                                                                                                                              |
| `business_status_update`, `account_alerts`, `partner_solutions`, `campaign_status_update`, `security` | opaque                                                                                                                                                                                                                                                                                                  | only `saveCallback` to `meta_callbacks`                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `messaging_handovers`                                                                                 | opaque                                                                                                                                                                                                                                                                                                  | log only                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

---

## 4. Processing pipeline

### 4.1 Queueing / threading model

- There is NO inbound queue. Everything for a message happens synchronously in the Lambda request: Redis lookups, Mongo reads, media download from Meta/Interakt and S3 upload, HTTP calls to the conversational service, and the typing-indicator call back to Meta/Interakt.
- Queues only appear on the status path: a FIFO SQS push (see 4.4) and a Celery task via the core's HTTP "background-task/add" endpoint (`utils/sendTask.js:5-21`: `POST {CORE_API_ENDPOINT}/api/v1/task/background-task/add` with `{task_name,data_info,queue}`).

### 4.2 Idempotency / dedup

- Inbound messages: Redis `GET/SET <ws>:messages:<wamid>` = "true", TTL 1h (`messagesHandler.js:330-337`). A duplicate delivery returns silently.
- Weaknesses:
  - The key is set BEFORE processing. If the bot hand-off fails afterwards (the error is swallowed and the controller returns 200), the message is lost permanently, and Meta's retry would be deduped.
  - The TTL is only 1h.
  - It is not scoped by WABA or number.
  - It dedupes `messages[0]` only.
- Statuses: no dedupe. The updates are idempotent `$set`/`$min`. Credit revert is guarded by the Redis window flags and the `revert` field on the log doc (`handleCreditsRevert`, `:76-184`).
- FIFO queue: `MessageGroupId: "1"` for all messages (`utils/sqs.js:19`), so strict global ordering with a single consumer. `ContentBasedDeduplication: true` (`prod.secrets.yml:31`), so identical bodies within 5 min collapse.
- The `geta-notifier-service` legacy path dedupes via Redis `<clientid>:whatsapp_sid:<sid>` (TTL 3600).

### 4.3 Ordering

No sequence handling. Meta delivers statuses out of order. Mitigations: `read` sets `status.seen` and `$min` on `status.delivered` (`messagesHandler.js:228-239`); `sent` does not overwrite `delivered`. There is no ordering between inbound messages of the same user beyond arrival order.

### 4.4 Status to message update

`MessageDLRHandler.handleStatusUpdate` (`messagesHandler.js:186-290`), per status in `value.statuses[]`:

1. Branches by status: `sent` / `delivered` / `failed` call `handleCreditsRevert`; `read` calls `getTemplateId`.
2. Builds a Mongo update (see below).
3. `sendToLambda(workspaceId,"trigger","whatsapp",<sent|delivered|seen|replied|failed>,context{message_id,mobile,template_id,meta_template_id})` (`:261`). It finds published, unlocked automations whose trigger node matches `class:"whatsapp"` and `function` and `nodeObjectData.whatsappTemplateId`, then enqueues Celery `automation.trigger` on `automation_queue` for each node (`utils/sendToLambda.js:8-54`).
4. `pushToSqs({workspace_id, query:{message_id}, update}, WHATSAPP_CALLBACK_SQS_QUEUE_URL)` (`:275-281`).
5. The consumer (`geta-core/src/shared/scripts/whatsapp_callback_handler.py`, `callback_handler.py:33-53`) takes 10 messages per receive and groups them per workspace. It runs `UpdateOne(query, update)` with no upsert into `<workspace>.whatsapp_broadcasting_data` through `bulk_write`, up to 20000 messages per run. It is a cron-style script, not a push trigger. An unknown `message_id` is dropped silently.

Mongo updates by status (collection `whatsapp_broadcasting_data`, key `message_id`=wamid):

- `sent`: `{conversation_id, origin[, cost_description:"open_conversation_window"]}`
- `delivered`: also `status.delivered=<Date from timestamp*1000>` (`timestampToDate.js`)
- `read`: `status.seen`, `$min status.delivered`
- `replied` (synthetic): `status.replied`
- `failed`: `status.failed`, `error:"<code> : <message>"`, `cost_description:"error"`
- `revert:true` is added when credits were refunded.

"Replied" synthesis: an inbound message carrying `context.id` (a reply to one of our messages) calls `handleReadStatus` (`messagesHandler.js:372-411`), which triggers a `replied` automation event and the `status.replied` update for that original wamid. Despite the branch structure, both branches do the same thing.

Billing coupling you will need to replace: Redis `<ws>:whatsapp-windows:+<phone>_<category>` objects `{<wamid>:{status,template_id},cost}` (TTL 24h) are written at send time (`whatappService.js:575-700`). The status handler uses them to decide credit revert, find the template id, and detect FEP/service windows.

### 4.5 Contact creation from inbound

There is no direct creation in the webhook service. Chain:

1. `messagesHandler.js:414-425` loads the `geta_core.workspace` and `business` docs and builds an encrypted `geta-host` header (`utils/getaHost.js`). If the workspace has no `business_id` the handler returns silently (after the dedupe key is already set).
2. New session: `whatsapp.js:425-512`. Redis `<ws>:whatsapp_<from>` = session id (TTL 24h) and `<ws>:chat_sessions:<session_id>` (TTL 7d) with `user_data{user: profile.name, mobile: from, channel}`.
3. Agent branch (no bot enabled): `POST {CONVERSATION_API_ENDPOINT}/api/v1/conversation/live-chat` (`whatsapp.js:623,650`). In `conversational-service-node/src/controllers/livechat.ts:18-158`, `set_visitor_id` upserts `visitor_logs` and enqueues SQS `geta-chatbot-crm-sync` task `fetch_visitor_profile_matomo` (`models/chathistory.ts:737-790`). `setResponseContextSubmitContact` (`utils/context_manager.ts:242-335`) finds `contact_list` by `visitor_phone`/`visitor_email` (`getContactData` `:949-976`) and calls `leadtoContact` (`:676`). That enqueues Celery `leads.convert_lead_to_contact` on queue `chatbot_crm_sync`, which creates or updates the contact and keeps `mobile_phone_number` and `email`. The agent session context seeds `visitor_name`, `visitor_phone` and the referral keys (`whatsapp.js:640`).
4. Bot branch (a chatbot with `bot_enabled:true` exists): `POST /api/v1/conversation/query` (`whatsapp.js:421`), or `GET /conversation/query?session_id&query=<wamid>&channel=whatsapp` for the first message. The first-message payload is parked in Redis `<ws>:whatsapp_first_message:<wamid>` (TTL 10 min, `:491-495`, read at `conversational-service-node/src/controllers/conversation.ts:96`).

- The contact `whatsapp_subscription_status` field is also set here (see 4.7).

### 4.6 Conversation / 24h window tracking

- Service window: on every inbound message, Redis `<ws>:whatsapp-windows:+<from>_service_window` is set (TTL 24h) or refreshed. The value is `{messageID}` (`messagesHandler.js:360-370`). This is the only inbound-driven 24h tracker. It is used when sending (`whatsappController.js:196-271` for free-form sends, `whatappService.js:438-486` for pricing/free utility).
- FEP window: 72h, set from `referral.source_type` ad/post (`:339-352`).
- Conversation ids come from `statuses[].conversation.id` and are stored on the outbound log.
- There is no conversation entity created by the webhook.
- The Mongo `chathistory` and `visitor_logs` collections are written by the conversational service (not the webhook).

### 4.7 Opt-out keywords (STOP)

Not handled in the webhook service. Handled in the chatbot/live-chat layer, and only through flow nodes:

- Settings: `GET/POST` `UserConsent` (`geta-chatbot-service/src/Resource/whatsapp.py:13-250`). Defaults in `createOptOutSettings` (`:89-103`): `status:"inactive"`, keywords `["Stop","Unsubscribe"]`, static response "You have been opted-out of your future communications". When active, the service writes FAQ docs `OPT-OUT-FAQ-678-688` and a flow `OPT-OUT-678-688` (`:156-200`), whose context sets `whatsapp_subscription_status`.
- Live-chat path: `livechat_optin_optout` (`conversational-service-node/src/conversation/chatbot.ts:777-806`). `checkOptinOptout` (`:609-697`) matches `data.value` case-insensitively and exactly (`^query$`) against `journey` docs with those FAQ qids. On a hit it does `contact_list.update_many({mobile_phone_number:mobile},{whatsapp_subscription_status: <id>})`, writes chat history, and sends the configured reply via WhatsApp. The same applies for a button payload through `ccheckOptinOptoutNodeId` (`:699+`).
- Option ids in use: opt-in `BCr5atez2M5PA6st`, opt-out `T7poSSdtHqPTVEvL` (hardcoded in `whatsapp.js:385,400` and the chatbot service). These are option ids of the contact property `whatsapp_subscription_status`.
- Bot path: handled by the chatbot engine matching the same FAQ, or via a button reply `nodeId` of `OPT-IN-678-466` / `OPT-OUT-678-688`. Note `whatsapp.js:395-413` sets `journey.context.whatsapp_subscription_status` directly.
- Outbound sends do not appear to check opt-out in the paths I read. Not verified end to end; it was out of scope.

### 4.8 Auto-reply / flow trigger hand-off

- Bot enabled, in `messagesHandler.js:356-434`: Mongo `chatbots{channel:"whatsapp",bot_enabled:true}` then `InboxConversations.interact_with_bot(messageData)` then `WhatsappConversations.interactWithBot` (`whatsapp.js:215-520`): `POST /conversation/query` with headers `appid:{"botid":..}`, `geta-host`, `channel`. Flow nodes are chosen by `journey.nodeId` from button/list ids. Free text goes to the bot engine.
- No bot: `chatbots{channel:"whatsapp"}` (any) then `interact_with_bot(messageData,null,true)` then agent live chat.
- If a chat session already has `sessionObj.agent` set, the message goes straight to `interactWithAgent` (`whatsapp.js:349-352`), which loses the profile name (no `contacts` passed).
- Before the bot call, `sendTypingStatus` posts `{messaging_product:"whatsapp",status:"read",message_id,typing_indicator:{type:"text"}}` to `.../{phoneID}/messages` (`whatsapp.js:55-118`): direct to Graph for one hardcoded test phone id, `PINNACLE_URL/v3/{phoneID}/messages` with `apikey` header for pinnacle, otherwise Interakt `https://amped-express.interakt.ai/api/v17.0/{phoneID}/messages` with `x-access-token` + `x-waba-id`. This is the read-receipt plus typing indicator (failures are swallowed).
- Automation journeys with a WhatsApp trigger fire only on message status events (Sent / Delivered / Seen / Replied / Failed), not on arbitrary inbound messages.

### 4.9 Media download after inbound

`whatsapp.js:884-1013`: for image/video/document/audio/sticker (inline, inside the webhook request):

1. `GET {META_API_BASE_URL}/{media_id}` with `getMetaHeaders(config)` (`helpers/metaHeaders.js:22-37`): with `IS_INTERAKT_ENABLED=true` the headers are `x-access-token: auth_key` + `x-waba-id`, otherwise `Authorization: Bearer access_token`. The base URL is `https://amped-express.interakt.ai/api/<INTERAKT_API_VERSION, default v25.0>` or `https://graph.facebook.com/<META_API_VERSION, default v25.0>` (`enum.js:63-77`).
2. Stream-download the `response.data.url` with `Authorization: Bearer <config.access_token>` (this is always the Bearer token, even under Interakt; line 926-928).
3. Stream-upload to S3 `<workspace_id>/<filename>`, public URL `https://assets.getalabs.com/<key>`. Filename is the doc filename or `<8-hex>_Untitled.<ext>`.
4. If the workspace config has no `access_token`, the URL is `null` (no download).
5. Errors in step 1 throw, which is caught upstream, and the message is dropped. Errors in step 2-3 return `null` (message forwarded without a URL).

---

## 5. Interakt / Pinnacle differences

Interakt:

- The same handler and body shape are used (`/interakt/callback` just reuses `whatsAppCallback`, `routes.js:17`). Attribution still depends on `entry[].id` equalling the WABA id. No Interakt-only fields (envelope wrapper, signature, extra header) are read. Not found.
- The "Interakt" verify token is the same env var as Meta's (`WHATSAPP_VERIFY_TOKEN`). There is also an unused DB-based `INTERAKT_CONFIG.verify_token` in geta-webhook-service (1.3).
- The workspace `provider` value is `interakt` (`GlobalEnums.INTERAKT`) and onboarding stores `auth_key` = Geta's partner key, plus `waba_id` and `phoneID` (`onboarding.py:64-78`).
- Interakt affects the outbound side and the media-lookup side only: the proxy base URL and the `x-access-token` / `x-waba-id` headers, switched by the `IS_INTERAKT_ENABLED` env var (`enum.js:60-77`, `metaHeaders.js`). `migrate_waba.py` marks migrated workspaces with `META_WHATSAPP_CONFIG.migrated_to_interakt=true`.

Pinnacle:

- Callback registration: not found in any repo. `pinnacle_onboarding.py` only calls Pinnacle's `client-embedded-detail-receiver` (`PINNACLE_URL`) and `subscribeApp` against Meta. Pinnacle webhook URL setup is out of band.
- Inbound handling: nothing Pinnacle-specific exists. A Pinnacle payload must be Meta-format and hit `/whatsapp/webhook/callback` for it to work. The WABA mapping is written the same way (`pinnacle_onboarding.py:166-181`).
- Pinnacle-specific code is outbound only: base `PINNACLE_URL`, `/v3/{phoneID}/messages` (and `marketing_messages` for MM Lite), header `apikey: <config.auth_key>` (`whatappService.js:272,544,754`; `conversations/whatsapp.js:84-95`).
- Pinnacle extra inbound fields: not found.

---

## 6. Response contract (what the current code does vs what Meta needs)

Meta/Interakt only care about a 2xx quickly. Current behavior of `POST` (`whatsappCallbackController.js`):

- Blocked sender: `200 {"message":"Success"}` (line 20-22).
- `object !== "whatsapp_business_account"`: `200 {"status":200,"message":"Success"}`.
- Valid change with a known field: `200 {"message":"<field> handled successfully"}`, sent AFTER the handler finishes (so latency = full processing time).
- Handler throws: `500 {"error":"Error handling <field>: ..."}`. Most handlers swallow their own errors, except template/flow handlers that rethrow (`throw new Error('Failed to set template status')`), which gives a 500.
- Unknown `field`: `400 {"error":"Invalid or unsupported field type"}`.
- Outer exception: `200 {"status":200,"message":"Success"}`.
- Defects:
  - `response.status(...)` is called inside the `for` loops. With more than one change, or one entry containing several changes, the second call throws "headers already sent". It then falls into the catch/else branches and eventually into the outer catch.
  - An `entry` array with zero changes, or an empty `entry`, sends NO response at all (the request hangs until the 30s Lambda timeout).
  - A 4xx/5xx makes Meta retry (retry policy is Meta's documented behavior, not in this repo), which Geta only partly tolerates because of the 1h wamid dedupe.
- GET returns `200 text/plain` with the challenge on success (see 1.3).
- Timing: API Gateway + Lambda `timeout: 30` (`serverless.yml:78-82`). Real work includes media download, Mongo, Redis, and an HTTP call to the conversational service, all inside the request. Nothing in the repo documents an SLA. Meta wants a fast 2xx; the safe design is to ack immediately and process asynchronously.

---

## 7. Implications for the NestJS port (derived from the findings)

1. Expose one POST/GET pair per provider, and put a per-tenant or per-connection secret in the path or query, because Geta has no authenticity check. Validate `X-Hub-Signature-256` with the app secret for Meta direct. For Interakt, signature behavior is unknown from this repo, so make it configurable. Keep the GET handshake with a configurable per-connection verify token (Geta uses one global env token).
2. Attribute by `entry[].id` (WABA) and also accept `metadata.phone_number_id` for finer routing (Geta only uses the WABA, so multi-number WABAs are one tenant). Persist the mapping in Postgres instead of Redis only.
3. Ack with 200 immediately; enqueue each webhook body in a durable queue (BullMQ) and process in the worker. Iterate ALL `messages[]`, `contacts[]`, `statuses[]` and `changes[]`. Geta handles only `messages[0]`.
4. Dedupe on wamid persistently (for example a unique key on provider message id) and set it only after a successful commit. Geta sets a 1h key before processing, which can lose messages.
5. Map statuses to the outbound message by wamid. Store `conversation.id`, `origin.type`, `pricing.*` and the full `errors[]`. Apply `$min`-style monotonic status ordering (`sent < delivered < read`, `failed` terminal).
6. Handle the types Geta skips: `system`, `unsupported` (with `errors[]`), `calls`, `message_echoes`/`history`, and non-enum template events (`FLAGGED`, `REINSTATED`). Add a dead-letter instead of returning 400/500 for unknown fields.
7. Opt-out: implement keyword matching with a workspace-configurable keyword list in the inbound worker (Geta's defaults: "Stop", "Unsubscribe"; exact, case-insensitive; status set on the contact). Note that Geta's opt-out only runs inside chatbot/live-chat, never at the webhook edge.
8. Window tracking: refresh a 24h customer-service window per contact on every inbound message. Open a 72h free-entry window when `referral.source_type` is `ad` or `post`. Persist this on the conversation row, not in Redis TTL keys.
9. Media: download via the provider-specific URL/header (Interakt proxy `x-access-token` + `x-waba-id` for the media-id lookup, Bearer for the file download as Geta does; Pinnacle unverified) in a worker with retry, not inline.
10. Keep the provider adapter boundary: callback routes are provider-agnostic. Provider differences are base URL and auth headers (Meta Bearer; Interakt `x-access-token` + `x-waba-id`; Pinnacle `apikey`), per `IS_INTERAKT_ENABLED` / `provider` in the connection config.
