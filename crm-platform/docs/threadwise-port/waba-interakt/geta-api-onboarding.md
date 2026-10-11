# Geta WhatsApp onboarding (Embedded Signup) and connection: reverse-engineered spec

Survey date 2026-10-02. Read-only. All paths are relative to `/home/getaweblpubt24/Documents/geta` and written `path:line`.
No secret values are reproduced. Only variable NAMES and public constants (base URLs, API versions, public Meta ids hard-coded in source) appear.
"not found" means I grepped the listed repos and did not find it.

Repos that matter, and who runs what:

| Concern                                               | Repo / file                                                                                                                                                 | Notes                                                                                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend (live)                                       | `bug/console-whatsapp-frontend/src/Components/whatsapp-onboarding/*`                                                                                        | Wabo/Interakt-era console. `Voice/geta-chatbot-console-frontend` has an older near-identical copy. `geta-frontend` has none.                     |
| HTTP endpoint                                         | `geta-core/src/whatsapp/MetaOnboarding.py` (Flask)                                                                                                          | Only stores a Pending row and enqueues a Celery task. Does NOT call Meta. (`Voice/geta-core` is a duplicate checkout with shifted line numbers.) |
| The real onboarding work                              | `Voice/geta-async/src/whatsapp/onboarding.py` (Interakt), `pinnacle_onboarding.py` (Pinnacle), `onboarding_helpers.py`                                      | Celery tasks in `Voice/geta-async/app.py:1259` and `:1288`                                                                                       |
| Post-onboarding Meta/Interakt calls (profile, limits) | `geta-core/src/whatsapp/MetaAPI.py`, `geta-auth-service/src/Whatsapp/MetaApi.py`, switch helpers `geta-core/src/util/meta_api_helper.py`, `global_enums.py` | These are the only places `IS_INTERAKT_ENABLED` matters for admin calls                                                                          |
| Webhooks in                                           | `geta-whatsapp-service/src/routes/routes.js`, `controllers/whatsappController.js`, `whatsappCallbackController.js`                                          |                                                                                                                                                  |
| Workspace/provider selection, login gating            | `geta-auth-service/src/Business/WorkspaceClass.py`, `src/Resource/Signup/Login.py`                                                                          |                                                                                                                                                  |

## 0. Headline findings (things that differ from the brief's assumptions)

1. **Onboarding does not consult `IS_INTERAKT_ENABLED`.** `Voice/geta-async/src/whatsapp/onboarding_helpers.py` builds every URL from `META_API_ENDPOINT`/`META_API_VERSION` (graph.facebook.com) and uses `Authorization: Bearer`. The Interakt route is: do the whole Embedded Signup exchange against Meta Graph with Geta's own system user, then tell Interakt about the new WABA through `POST https://api.interakt.ai/v1/organizations/tp-signup/` (event `PARTNER_ADDED`), then persist Interakt's tech-partner key as `auth_key`. Interakt/amped-express (`x-access-token`, `x-waba-id`) is used only AFTER onboarding, for profile/limits/sends, and only when `IS_INTERAKT_ENABLED=true`.
2. **The provider is chosen per workspace, not by the env flag.** `workspace.meta_provider` in Mongo `geta_core.workspace` (`interakt` | `pinnacle`, default `interakt`: `geta-auth-service/src/Business/WorkspaceClass.py:41`). The frontend reads it from the token-verify payload as `userConfig.payload.provider` and picks the Pinnacle or the Interakt callback route (`bug/console-whatsapp-frontend/src/Components/whatsapp-onboarding/onboard-stepper-form.tsx:137`). It is changed by `PUT workspace/update-provider/<workspace_id>` (`geta-core/src/routers.py:1040`, `src/Resource/SubAccounts/sub_accounts.py:1552-1577`), refused when `whatsapp_onboard_status` is true.
3. **There is no `WA_EMBEDDED_SIGNUP` postMessage listener anywhere.** The frontend never captures `waba_id`, `phone_number_id`, `business_id`, `current_step` or errors from the Embedded Signup popup. It only sends the OAuth `code`. The backend rediscovers the WABA id from `debug_token` granular scopes (or the `client_whatsapp_business_accounts` edge) and the phone from `/{waba_id}/phone_numbers`. Only the FIRST WABA and FIRST phone number are used.
4. **No 2FA-pin phone registration is active.** `registerPhone` (pin literal in code) exists but its only call is commented out (`Voice/geta-async/src/whatsapp/onboarding.py:56`). Nothing in the repos calls `/{phone_id}/register` live. Embedded Signup registers the number itself.
5. **No disconnect/deregister flow, no display-name change flow, no Failed state.** grep for deregister, unsubscribe (WhatsApp), delete of `META_WHATSAPP_CONFIG`, `request_code`, `new_display_name`: not found. Display-name approval arrives only via the `phone_number_name_update` webhook.
6. **Interakt version defaults disagree between services**: geta-core/auth/whatsapp-service default `INTERAKT_API_VERSION` to `v25.0`; geta-async defaults to `v17.0` (`Voice/geta-async/src/helpers/global_enums.py:14`). Several send paths hard-code `https://amped-express.interakt.ai/api/v17.0/...` ignoring both env and flag (`geta-whatsapp-service/src/services/whasapp/whatappService.js:253`, `:524`, `:734`, `src/conversations/whatsapp.js:97`).

## 1. Frontend half

### 1.1 Facebook JS SDK init

- Loaded dynamically from `https://connect.facebook.net/en_US/sdk.js`, script id `facebook-jssdk` (`bug/console-whatsapp-frontend/src/Components/whatsapp-onboarding/useFacebookLoginButton.tsx:2-23`).
- `FB.init({ appId: process.env.REACT_APP_FACEBOOK_APP_ID, cookie: true, xfbml: true, version: "v20.0" })` (`useFacebookLoginButton.tsx:5-10`). SDK version is pinned `v20.0`, independent of the backend `META_API_VERSION` (default `v25.0`).
- Load on mount of the stepper, unload (removes script, deletes `window.FB`, `window.fbAsyncInit`) on unmount (`onboard-stepper-form.tsx:62-75`, `useFacebookLoginButton.tsx:26-36`).
- Identical init in `Voice/geta-chatbot-console-frontend/src/Components/whatsapp-onboarding/useFacebookLoginButton.tsx:5-10` and `.../Settings/Whatsapp/FacebookWhatsappLogin.tsx:18-23`.

### 1.2 FB.login options

Interakt provider (`useFacebookLoginButton.tsx:47-80`):

```
FB.login(cb, {
  config_id: "707200291383635",            // hard-coded
  response_type: "code",
  override_default_response_type: true,
  extras: { setup: { solutionID: "951670443632073" } }   // hard-coded Interakt solution id
})
```

Pinnacle provider (`useFacebookLoginButton.tsx:94-111`): same, but `config_id: process.env.REACT_APP_CONFIG_ID`, `solutionID: process.env.REACT_APP_FACEBOOK_PINNACLE_SOLUTION_ID`.

- Callback resolves when `response.authResponse` exists, else rejects "User cancelled login or did not fully authorize." (`:49-54`, `:96-100`). Code is read as `response.authResponse.code` (`onboard-stepper-form.tsx:171`, `:142`). The `status === "connected"` value is computed and ignored.
- Commented-out alternative with `extras.version: "v3"`, `featureType: "whatsapp_business_app_onboarding"`, `features:[{name:"marketing_messages_lite"}]` is dead code (`useFacebookLoginButton.tsx:61-73`). `sessionInfoVersion`, `featureType` in live code: not found.
- Settings-page variant (post-onboarding reconnect) uses `config_id: process.env.REACT_APP_CONFIG_ID` and hard-coded Interakt `solutionID` (`Voice/geta-chatbot-console-frontend/src/Components/Settings/Whatsapp/FacebookWhatsappLogin.tsx:76-85`, Pinnacle `:115-124`); posts `{ access_token: <code> }` too (`:58`, `:102`).

### 1.3 postMessage `WA_EMBEDDED_SIGNUP`

Not found in any frontend (`grep WA_EMBEDDED_SIGNUP|sessionInfoVersion|featureType` over bug/, Voice/geta-chatbot-console-frontend, geta-frontend, backends: only a commented `featureType`). Consequently no `FINISH`/`CANCEL`/`ERROR` event, no `current_step`, no client-side `waba_id`/`phone_number_id`/`business_id`. All of those are recovered server-side (section 2).

### 1.4 What the frontend POSTs

UX: 3-step stepper (`/onboarding/1..3`). Steps 1 and 2 are checklist screens with a confirmation checkbox; the `FB.login` runs on step 2 submit (`onboard-stepper-form.tsx:135-196`). Step 3 shows a finish screen and calls token-verify again to refresh config (`:198-204`).

- Base: `REACT_APP_CH_CONSOLE_API_BASE_URL` + `api/v1` (public value `https://api.bot-console.geta.ai/` in prod env) (`bug/console-whatsapp-frontend/src/Store/Slices/Onboarding/OnboardingNetworkService.ts:4-5`).
- Interakt: `POST {base}/api/v1/workspace/whatsapp/auth/callback`, body `{"access_token": "<authResponse.code>"}` (`OnboardingNetworkService.ts:21-25`, `:51`; call at `onboard-stepper-form.tsx:177-179`). Note the field is named `access_token` but holds the short-lived OAuth CODE.
- Pinnacle: `POST {base}/api/v1/workspace/whatsapp/pinnacle/auth/callback`, same body (`OnboardingNetworkService.ts:27-30`, `:52`; `onboard-stepper-form.tsx:148-150`).
- On HTTP success: `CoreService.tokenVerify()` to refresh `userConfig` (`:110-126`), navigate to step 3 with `?access=<code>`. Pinnacle additionally dispatches `onClickProviderRefresh(true)` (`:154`).
- Auth: workspace is derived from the JWT on the backend (`request.environ.get('geta_schema_name')`, `geta-core/src/whatsapp/MetaOnboarding.py:18`). Exact auth header name of the shared axios `http` instance: not examined (NetworkServices/http).
- The frontend does not poll for completion; it navigates immediately although the backend work is async (see 3.2).
- Gate: onboarding layout redirects to `/` when `userConfig.payload.whatsapp_enabled` (`.../whatsapp-onboarding/index.tsx:27-29`). For Pinnacle the topbar nags until `credit_line` is true (`onboard-topbar.tsx:89`).
- Other endpoints used by the settings screens: `GET {base}/workspace/whatsapp/config`, `POST .../update-business-info`, `POST .../update-business-compliance-info` (`OnboardingNetworkService.ts:8-19`, `:54-56`).

## 2. Backend half, step by step

### 2.0 Entry (geta-core, Flask)

`POST /workspace/whatsapp/auth/callback` (`geta-core/src/routers.py:776`, `WORKSPACE_CONSOLE_PATH = 'workspace'` at `:324`) in `geta-core/src/whatsapp/MetaOnboarding.py:9-54`:

1. Parse JSON body, require `access_token` (the code); missing body returns 500 "Invalid Request : Auth Code Missing" (`:13-17`; Pinnacle variant returns 400, `:64`).
2. Find the bot: `workspace_db.chatbots.find_one({"type":"whatsapp","bot_enabled":True})` (`:21`).
3. Upsert `chatbot_misc_config` where `config_key = "META_WHATSAPP_CONFIG"` with `{id: "MISC_CONFIG_<8 random>", config_key, is_json: true, config_value: {}, chatbot_id, workspace_id, is_active: false, status: "Pending", created_time, modified_time, deleted_time: null}` (`:25-39`). Note: this `$set` of `config_value: {}` wipes any existing config on re-onboarding.
4. `celery.send_task(name='conv.onboard_waba_account', args=[workspace_id, code], queue=ConversationQueues.CHATBOT_CRM_SYNC)` (`:44`); queue string is `chatbot_crm_sync` (`Voice/geta-async/src/queues.py:5`). Pinnacle: task `conv.pinnacle_onboard_waba_account` (`:92`). Returns 200 "Success" once enqueued; Celery enqueue failure returns 500.

### 2.1 Worker bootstrap (geta-async)

`Voice/geta-async/app.py:1259-1285` (Interakt), `:1288-1308` (Pinnacle). Retry policy for these tasks: `BaseTaskWithRetry` `autoretry_for=(Exception, KeyError)`, `max_retries=3`, `retry_backoff=True` (`app.py:229-232`). In practice the inner methods swallow exceptions and return False, so retries rarely trigger.

- Reads the platform-wide config from Mongo: DB `geta_core`, collection `app_configuration`, `config_key: "META_WHATSAPP_CONFIG"` (Interakt, `:1265`) or `"PINNACLE_WHATSAPP_CONFIG"` (Pinnacle, `:1293`). `config_value` fields used (NAMES ONLY; values are secrets and live in the DB): `geta_system_user`, `geta_business_id`, `solution_id`, `partner_auth_key`, `client_id`, `client_secret`, `geta_system_user_token`, plus `client_config_id` for Pinnacle (`onboarding.py:21-30`, `pinnacle_onboarding.py:14-23`). No `.env` equivalent for these (not found); they are DB-held app credentials.
- On success sets `geta_core.workspace.whatsapp_onboard_status = true` (`app.py:1277`, also inside the class `onboarding.py:125`).

### 2.2 Interakt route (provider = `interakt`), exact calls

`WhatsApp.onBoardWabaAccount` (`Voice/geta-async/src/whatsapp/onboarding.py:34-139`). Base = `META_API_ENDPOINT` (default `https://graph.facebook.com`) + `META_API_VERSION` (default `v25.0`), read via `os.environ.get` at call time (`onboarding_helpers.py:36` etc.), NOT the Interakt host. Let `G = {META_API_ENDPOINT}/{META_API_VERSION}`.

1. **Code-for-token exchange** (`onboarding_helpers.py:35-46`)
   `GET G/oauth/access_token?client_id=<client_id>&client_secret=<client_secret>&code=<code>`
   Header `Authorization: Bearer <geta_system_user_token>`. No `redirect_uri`. Uses `access_token` from a 200 response; any non-200 returns None and onboarding aborts with the row left `Pending` (`onboarding.py:42-43`). Result = "business integration system user token" (BISU token), later stored as `access_token`.
2. **Token validation / WABA discovery** (`onboarding_helpers.py:103-140`)
   `GET G/debug_token?input_token=<BISU token>`; header `Authorization: Bearer <geta_system_user_token>`.
   Uses `data.user_id`, `data.granular_scopes[]` (the entry with `scope == "whatsapp_business_management"`, first of `target_ids` = WABA id), `data.scopes`. Needs `userID` non-null to proceed (`onboarding.py:49`).
3. **Fallback WABA lookup** if not in granular scopes (`onboarding_helpers.py:81-101`)
   `GET G/{geta_business_id}/client_whatsapp_business_accounts?access_token=<BISU token>`; header `Authorization: Bearer <geta_system_user_token>`; takes `data[0].id`.
4. **List phone numbers** (`onboarding_helpers.py:142-169`)
   `GET G/{waba_id}/phone_numbers`; header `Authorization: Bearer <BISU token>`.
   Takes `data[0]` only: `verified_name`, `display_phone_number` (whitespace stripped, so `+91 91122 90122` becomes `+919112290122`), `id`, `quality_rating`. No data returns None and onboarding fails (the immediate `.get` at `onboarding.py:51` on a None would raise; swallowed by the outer except).
5. **Phone details** (`onboarding_helpers.py:254-265`)
   `GET G/{phone_id}?fields=status,is_official_business_account,id,name_status,code_verification_status,display_phone_number,platform_type,messaging_limit_tier,throughput`; `Authorization: Bearer <BISU token>`. Used: `messaging_limit_tier`, `status`, `name_status`. Returns `{}` on non-200.
6. **Tell Interakt about the WABA** (`onboarding_helpers.py:219-252`)
   `POST https://api.interakt.ai/v1/organizations/tp-signup/` (host hard-coded)
   Headers: `Authorization: <partner_auth_key>` (raw value, no `Bearer`), `content-type: application/json`.
   Body:
   ```
   {"entry":[{"changes":[{"value":{"event":"PARTNER_ADDED",
     "waba_info":{"waba_id":"<waba_id>","solution_id":"<solution_id>","phone_number":"<display_phone_number>"}}}]}],
    "object":"tech_partner"}
   ```
   Result ignored (only logged); failure does not stop onboarding (`onboarding.py:55`).
7. **Phone registration (2FA pin)**: `POST G/{phone_id}/register` body `{"messaging_product":"whatsapp","pin":"<fixed 6-digit literal in code>"}` with `Authorization: Bearer <BISU token>` exists (`onboarding_helpers.py:171-186`) but is **commented out** at `onboarding.py:56`. Not executed.
8. **Subscribe the app to the WABA** (`onboarding_helpers.py:188-203`)
   `POST G/{waba_id}/subscribed_apps` with empty body, `Authorization: Bearer <BISU token>`. This is plain Meta subscribe with no `override_callback_uri`; the app's webhook callback is the one configured on Geta's Meta app. Result ignored.
9. **Add Geta system user to the WABA** (`onboarding_helpers.py:205-217`)
   `POST G/{waba_id}/assigned_users?access_token=<geta_system_user_token>&user=<geta_system_user>&tasks=['MANAGE']` (the `tasks` list is sent as a literal Python-style string).
10. **Business owner** (`onboarding_helpers.py:49-64`) `GET G/{waba_id}?fields=owner_business_info&access_token=<BISU token>` gives `owner_business_info.id` (`business_id`) and `.name` (`meta_business_name`). An exception returns False and aborts persistence (`onboarding.py:91-94`); a non-200 yields `(None, None)`.
11. **Business verification** (`onboarding_helpers.py:66-79`) `GET G/{business_id}?fields=verification_status&access_token=<BISU token>`; `business_verified = (verification_status == "verified")` (`onboarding.py:99-103`).
12. **MM Lite flag**: `is_mm_lite_onboarded = true` if `["ads_read","whatsapp_business_management"]` (the list at `onboarding.py:11` has a duplicate entry; helper `onboarding_helpers.py:22-24` is the clean list) is a subset of `debug_token.data.scopes` (`onboarding.py:81-85`).
13. Persist (section 3), then fan out the Redis mappings used by webhook routing.

Interakt (amped-express) calls used later, only when `IS_INTERAKT_ENABLED=true` (geta-core `MetaAPI.py`, geta-auth `MetaApi.py`). Base `{INTERAKT_API_ENDPOINT}/{INTERAKT_API_VERSION}` = `https://amped-express.interakt.ai/api/v25.0` by default for geta-core/auth/whatsapp-service (`geta-core/src/util/global_enums.py:9-10,25-27`), `v17.0` default in geta-async (`Voice/geta-async/src/helpers/global_enums.py:13-14`). Headers (`geta-core/src/util/meta_api_helper.py:18-38`): `x-access-token: <config_value.auth_key>`, `x-waba-id: <config_value.waba_id>`, optional `Content-Type: application/json`. The Meta mode instead sends `Authorization: Bearer <config_value.access_token>`. Credential choice: `get_meta_credential` returns `auth_key` if Interakt else `access_token` (`:41-46`).

| Purpose                                | Method and path (under the base)                                                                                                                                                                                                 | Source                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| List phones of WABA                    | `GET /{waba_id}/phone_numbers`                                                                                                                                                                                                   | `geta-core/src/whatsapp/MetaAPI.py:78-105`                              |
| Phone details, quality, limit          | `GET /{phone_id}?fields=quality_rating,whatsapp_business_manager_messaging_limit,status,is_official_business_account,id,name_status,code_verification_status,display_phone_number,platform_type,messaging_limit_tier,throughput` | `MetaAPI.py:108-121`, `geta-auth-service/src/Whatsapp/MetaApi.py:30-42` |
| Read business profile                  | `GET /{phone_id}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical` (response uses `data[0]`)                                                                               | `MetaAPI.py:123-137`                                                    |
| Update business profile                | `POST /{phone_id}/whatsapp_business_profile`, JSON body keys `messaging_product:"whatsapp"` (required), `about`, `profile_picture_handle`, `description`, `vertical`, `address`, `email`, `websites`                             | `MetaAPI.py:728-751`                                                    |
| Read compliance info (India)           | `GET /{phone_id}/business_compliance_info` (TODO in code: not confirmed in the Interakt collection, keep flag off for this call)                                                                                                 | `MetaAPI.py:139-169`, comment `:149-151`                                |
| Update compliance info                 | `POST /{phone_id}/business_compliance_info`, body incl. `messaging_product:"whatsapp"`, `entity_name`, `entity_type`, `is_registered`, `customer_care_details`, `grievance_officer_details`                                      | `MetaAPI.py:753-774`, built `:367-720`                                  |
| Webhook override per phone (migration) | `POST /{phone_number_id}` body `{"webhook_configuration":{"override_callback_uri":"<url>"}}`, headers `x-access-token`, `x-waba-id`, `x-phone-number-id`, `Content-Type`                                                         | `geta-core/src/shared/scripts/migrate_waba.py:61-79`                    |

Interakt webhook override (the only place it is implemented properly) = `migrate_waba.py`: callback URI constant `https://api-whatsapp.geta.ai/api/v1/whatsapp/webhook/interakt/callback` (`:13`), marks `config.migrated_to_interakt = true` on 200 else stores `migration_error` (`:157-167`). It is a one-off script for pre-existing Meta-direct WABAs, not part of the live onboarding path. Geta's verify-token side: `GET /whatsapp/webhook/interakt/callback` echoes `hub.challenge` if `hub.mode=="subscribe"` and `hub.verify_token == process.env.WHATSAPP_VERIFY_TOKEN` (`geta-whatsapp-service/src/controllers/whatsappController.js:96-114`, route `src/routes/routes.js:16`); `POST` of the same path goes to `whatsAppCallback` (`routes.js:17`).

- A second, legacy customer-facing endpoint `POST /workspace/whatsapp/setup/webhook` (`geta-core/src/whatsapp/MetaOnboarding.py:122-180`, route `routers.py:786`) accepts `{callback_url, verify_token}` and POSTs to `https://interakt-amped-express.azurewebsites.net/api/v17.0/{phoneID}/subscribed_apps` with headers `x-access-token`, `x-waba-id`, `Content-Type`, but **overwrites the payload with `{}` (`:154`)** so `override_callback_uri`/`verify_token` are never sent, and its Mongo upsert call is malformed (`update_one(filter, doc, {...})` at `:173`). Treat it as broken legacy; do not port the semantics. Frontend for it: `Store/Slices/Webhook/webhookNetworkService.ts:20-21`.

### 2.3 Facebook-native route (`IS_INTERAKT_ENABLED=false`)

Onboarding calls are IDENTICAL to 2.2 steps 1-5, 8-12 (they are always Meta Graph). The differences are in what is stored and used after:

- Step 6 (Interakt tp-signup) is skipped only if the code is changed; there is NO flag check in `onboarding.py`, so it always runs for provider `interakt`. (A pure-Meta direct onboarding without Interakt: not found as a separate code path.)
- Runtime calls (table above) use base `{META_API_ENDPOINT}/{META_API_VERSION}` and header `Authorization: Bearer <config_value.access_token>` with no `x-waba-id` (`geta-core/src/util/meta_api_helper.py:13-15,32-35`; `geta-whatsapp-service/src/helpers/metaHeaders.js:20-35`).
- `debugTokenCall` in `geta-core/src/whatsapp/MetaAPI.py:52-76` references `self.geta_system_user_token` that is never set (dead code); the live implementation is the async one.
- Direct-Meta messaging-limit field: `whatsapp_business_manager_messaging_limit` in the fields list (core/auth), while onboarding reads `messaging_limit_tier`. Tier map in core: `TIER_UNLIMITED, 100000, 10000, 1000, 250, 2000(TIER_2K)` (`MetaAPI.py:30-37`); async maps `TIER_250:250, TIER_1K:1000, TIER_10K:10000, TIER_100K:100000, UNLIMITED:1000000` (`onboarding.py:12-18`); whatsapp-service also has `TIER_50` (`geta-whatsapp-service/src/utils/enum.js:110-122`). Defaults to 250 on unknown.
- Additional Meta-only call: MM Lite opt-in `POST {META base}/{business_id}/onboard_partners_to_mm_lite` with `Authorization: Bearer <access_token>`; "Client has already onboarded." in the error message is treated as success (`geta-core/src/whatsapp/MMLiteOnboarding.py:45-91`, route `routers.py:1099` `.../mm-lite/onboarding`). Business id lookup via `GET {base}/{waba_id}?fields=owner_business_info&access_token=...` (`:15-43`).
- Meta webhook verification (non-Interakt): `GET /whatsapp/webhook/callback`, same `WHATSAPP_VERIFY_TOKEN` check (`whatsappController.js:57-94`, `routes.js:13`).

### 2.4 Pinnacle route (provider = `pinnacle`): differences only

`PinnacleWhatsApp.pinnacleOnBoardWabaAccount` (`Voice/geta-async/src/whatsapp/pinnacle_onboarding.py:25-189`).

- Same Meta steps as 2.2 steps 1-5, 8-12 (token exchange, debug_token, phone list/details, `subscribed_apps`, assigned_users, business owner/verification, MM Lite scopes). No Interakt tp-signup; no register-phone call.
- Extra Meta call: `GET {G}/{waba_id}?fields=message_template_namespace` with `Authorization: Bearer <geta_system_user_token>` (`onboarding_helpers.py:281-295`), required to proceed with Pinnacle account creation.
- Pinnacle calls (base `PINNACLE_URL`, platform env, value not recorded):
  1. `POST {PINNACLE_URL}/create-user-account`, header `apikey: <partner_auth_key>`, JSON body `{template_namespace, waba_id, mobileno, firstname, lastname, billingname, waba_number:[<display_phone_number>], email}` (workspace user's own phone, names and email from workspace `user` doc) (`onboarding_helpers.py:297-305`, `pinnacle_onboarding.py:61-72`). Success when `code == 200` or `status` lowercased `== "success"`; response `data.apikey`, `data.username`, `data.password` are stored (`:75-86`).
  2. `POST {PINNACLE_URL}/client-embedded-detail-receiver`, header `apikey: <partner_auth_key>`, body `{waba_id, phone_numberid, config_id: <client_config_id>, access_token: <BISU token>, mmlite: 1, solution_id, business_id}` (`:89-108`). Result only logged.
  3. Credit line, deferred 200 s via a scheduled Celery periodic task `pinnacle_onboard_credit_line.trigger` (`pinnacle_onboarding.py:109-111`, `onboard_credit_line_delay_action.py:13-52`): `POST {PINNACLE_URL}/share-creditline-api`, header `apikey: <partner_auth_key>`, body `{"business_id":..., "waba_currency":"INR", "waba_id":...}`; on `code == 200` sets `geta_core.pinnacle_users.credit_line_assigned = true` and `config_value.credit_line_assigned = true` (`Voice/geta-async/app.py:1230-1255`).
- Pinnacle account record (`geta_core.pinnacle_users`): `workspace_id, waba_id, business_id, auth_key, username, password, credit_line_assigned:false, created_at` (`pinnacle_onboarding.py:76-86`). Credentials are stored in cleartext; note for the port.
- Sends use `apikey: <config_value.auth_key>` at `{PINNACLE_URL}/v3/{phone_id}/messages` (or `/marketing_messages` for MM Lite) (`geta-whatsapp-service/src/services/whasapp/whatappService.js:272-281,545`). Pinnacle has no `x-waba-id`.
- Login gating: for pinnacle workspaces `whatsapp_enabled` is forced false and `credit_line:false` until `pinnacle_users.credit_line_assigned` is true (`geta-auth-service/src/Resource/Signup/Login.py:849-856`).
- Bug to avoid: `response_data` (used for `auth_key`/`username`) is undefined if the `if(template_namespace and get_user_details)` block is skipped (`pinnacle_onboarding.py:60,129`); NameError is caught by the outer `except` and the row is stuck `Pending`.

## 3. What is persisted

### 3.1 Per workspace: Mongo `<workspace_db>.chatbot_misc_config`, doc with `config_key = "META_WHATSAPP_CONFIG"`

Document-level fields: `id`, `config_key`, `is_json`, `chatbot_id`, `workspace_id`, `is_active`, `status`, `created_time`, `modified_time`, `deleted_time` (`geta-core/src/whatsapp/MetaOnboarding.py:25-37`).
`config_value` after success (`Voice/geta-async/src/whatsapp/onboarding.py:64-78,82,89-90,101-103`):

| Field                                                    | Source                                                                                                                                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `access_token`                                           | BISU token from oauth/access_token (Meta Bearer token)                                                                                                                                         |
| `display_name`                                           | `phone_numbers[0].verified_name`                                                                                                                                                               |
| `quality_rating`                                         | `phone_numbers[0].quality_rating`                                                                                                                                                              |
| `phoneID`                                                | `phone_numbers[0].id`                                                                                                                                                                          |
| `display_number`, `whatsapp_no`                          | `display_phone_number` with spaces removed                                                                                                                                                     |
| `auth_key`                                               | Interakt route: `partner_auth_key` (the SAME platform-wide Interakt tech-partner key for every workspace, `onboarding.py:70`). Pinnacle route: per-user `data.apikey` from create-user-account |
| `waba_id`                                                | WABA id                                                                                                                                                                                        |
| `limit`                                                  | raw tier string, e.g. `TIER_250` (default `TIER_250`)                                                                                                                                          |
| `messaging_limit`                                        | integer from tier map                                                                                                                                                                          |
| `status`                                                 | phone `status` from Meta (e.g. `CONNECTED`, `PENDING`)                                                                                                                                         |
| `display_name_status`                                    | phone `name_status`                                                                                                                                                                            |
| `provider`                                               | `"interakt"` or `"pinnacle"`                                                                                                                                                                   |
| `is_mm_lite_onboarded`                                   | only set `true` when scopes match                                                                                                                                                              |
| `business_id`, `meta_business_name`, `business_verified` | owner business info and verification                                                                                                                                                           |
| Pinnacle only                                            | `partner_auth_key`, `username`, `user_password`, later `credit_line_assigned`                                                                                                                  |
| Later via `GET /workspace/whatsapp/config` refresh       | `business_info{about,address,description,email,profile_picture_url,websites,vertical}`, `business_compliance_info`, `status_history[]`                                                         |

Other stores:

- `geta_core.workspace`: `whatsapp_onboard_status` (bool, default false), `meta_provider` (default `interakt`), `whatsapp_no` (null at create) (`geta-auth-service/src/Business/WorkspaceClass.py:36,41-42`).
- Redis (via RedisManager): `<workspace_id>:chatbot_misc_config:META_WHATSAPP_CONFIG` = the `config_value` JSON; `meta_account_mapping:account_waba_ids:<waba_id>` = `{waba_id, phone_number, phoneId, workspace_id, limit}` (`onboarding.py:108-127`). Inbound webhooks resolve the workspace from this key (`geta-whatsapp-service/src/controllers/whatsappCallbackController.js:30-35`). Inconsistency: onboarding also writes `account_phone_numbers` keyed by WABA id (`onboarding.py:127`) while core updates keyed by phone id (`MetaAPI.py:814-822`).
- Mongo `geta_core.pinnacle_users` (Pinnacle only).

### 3.2 Status transitions

Document-level `status` (what the console checks):

- `Pending`: set synchronously by the HTTP callback (`MetaOnboarding.py:36`, `is_active:false`). Also written by the worker when WABA id or user id could not be resolved, in which case `config_value` holds only `{access_token, auth_key}` and `is_active:true` (`onboarding.py:130-135`, `pinnacle_onboarding.py:184-189`).
- `Approved` with `is_active:true`: written by the worker at the end of a successful run (`onboarding.py:106`, `pinnacle_onboarding.py:160`). This is the only success state, and it is written even if the phone `status` is `PENDING`.
- `Failed`: not found. Failures (token exchange non-200, no phone, owner lookup exception, scope exception) just `return False` and leave the row `Pending`/`config_value {}` with only server logs. A port should add an explicit failed state and error capture.
- Login/token-verify gating: `whatsapp_enabled = true` only if `is_active == True and status == "Approved"` and `config_value` non-empty (`geta-auth-service/src/Resource/Signup/Login.py:671-675`); `"DISABLED"` is reported otherwise (`:708`). `provider` and `credit_line` are added at `:832`, `:849-856`.
- Phone-level status at login: `WhatsAppAPIClass.updatePhoneDetails` refreshes `config_value.quality_rating`, `quality`, `display_name_status`, and sets `config_value.status` to the `name_status` value (`geta-auth-service/src/Whatsapp/MetaApi.py:77-85`; invoked in login at `Login.py:250`). Treat as an upstream quirk.
- `GET /workspace/whatsapp/config` re-pulls phones, details, business profile and compliance info and writes `config_value.limit`, `.messaging_limit`, `.status`, `.display_name_status`, `.business_info`, `.business_compliance_info` (`geta-core/src/whatsapp/MetaAPI.py:835-908`; response shape `MetaOnboarding.py:400-439`).
- Webhook-driven updates after onboarding: `phone_number_name_update` (APPROVED sets `config_value.display_name`; `geta-whatsapp-service/src/services/whatsappCallback/handlers/phoneNumberNameUpdateHandler.js`), `phone_number_quality_update` (sets `limit`, `messaging_limit`, appends `status_history`; `phoneNumberQualityUpdateHandler.js:32-60`), `account_update` (ban, restriction, verification alerts; `accountUpdateHandler.js`).

## 4. Environment variables / config names (NAMES ONLY)

Switch and API routing (geta-core, geta-auth-service, geta-async, geta-whatsapp-service, geta-broadcast-service):

- `IS_INTERAKT_ENABLED` ("true" case-insensitive means Interakt; re-evaluated per call in Python helpers and Node helper)
- `META_API_ENDPOINT` (default `https://graph.facebook.com`), `META_API_VERSION` (default `v25.0`)
- `INTERAKT_API_ENDPOINT` (default `https://amped-express.interakt.ai/api`), `INTERAKT_API_VERSION` (default `v25.0`; geta-async default `v17.0`). Frozen at import in the Python services and in `MetaApiEnum` (restart to change).
- `PINNACLE_URL` (referenced in code, absent from `.env.example` files; value not recorded)
- `WHATSAPP_VERIFY_TOKEN` (webhook GET verification; whatsapp-service and notifier). `FACEBOOK_VERIFY_TOKEN`, `WHATSAPP_GRAPH_API`, `FACEBOOK_GRAPH_API` appear in `geta-auth-service/env.example` (use unverified).
- `REDIS_BASE_URL` (onboarding Redis writes), Mongo URI vars (`MONGODB_URI` seen in `onboard_credit_line_delay_action.py:10`).
- Not env: platform app credentials live in Mongo `geta_core.app_configuration` documents `META_WHATSAPP_CONFIG` / `PINNACLE_WHATSAPP_CONFIG` with fields `geta_system_user`, `geta_business_id`, `solution_id`, `partner_auth_key`, `client_id`, `client_secret`, `geta_system_user_token`, `client_config_id` (names only).
- Hard-coded in code: Interakt tp-signup URL `https://api.interakt.ai/v1/organizations/tp-signup/` (`onboarding_helpers.py:221`), legacy `https://interakt-amped-express.azurewebsites.net` (`MetaOnboarding.py:153`), webhook callback `https://api-whatsapp.geta.ai/api/v1/whatsapp/webhook/interakt/callback` (`migrate_waba.py:13`), Interakt send URLs `https://amped-express.interakt.ai/api/v17.0` (whatsapp-service).

Frontend (`bug/console-whatsapp-frontend/.env.*`):

- `REACT_APP_FACEBOOK_APP_ID`, `REACT_APP_CONFIG_ID` (Pinnacle and settings-page flows), `REACT_APP_FACEBOOK_PINNACLE_SOLUTION_ID`, `REACT_APP_FACEBOOK_DOMAIN`, `REACT_APP_CH_CONSOLE_API_BASE_URL`.
- Hard-coded in source: Interakt Embedded Signup `config_id` `707200291383635` and `solutionID` `951670443632073` (`useFacebookLoginButton.tsx:58,76`).

Note: `FACEBOOK_CONFIG` env is for Messenger/Instagram pages, unrelated to WhatsApp onboarding (`geta-core/src/Resource/Integrations/ChatbotFacebookIntegrations.py:36`).

## 5. Gotchas

Versions

- SDK `v20.0` (frontend), backend `v25.0` default, Interakt `v25.0` or `v17.0` depending on service. Hard-coded `v17.0` Interakt send URLs ignore env. In a port, pin one `META_API_VERSION` and one `INTERAKT_API_VERSION` and use them everywhere.
- Python `os.environ` vs frozen enum: changing `INTERAKT_*` requires restart; `IS_INTERAKT_ENABLED` does not.

Error handling and retries

- HTTP callback returns 200 as soon as the Celery job is queued; actual success/failure is invisible to the user (no polling, no failure event). Celery autoretry (3, backoff) only catches raised exceptions; helper functions swallow them and return None/False.
- Every helper checks only `status_code == 200`; Meta error codes and bodies are not parsed during onboarding (not found). Profile update does parse `error.error_user_msg`, `error.message`, `error_user_title` and returns them (`MetaAPI.py:745-751`).
- The BISU token and the system user token are logged in plaintext in places (`onboarding_helpers.py:46`, MetaOnboarding prints the code at `:19`). Do not port that.
- Only first WABA and first phone number are onboarded. Multi-number WABAs silently lose the rest.
- Code is single-use and short-lived; re-driving after failure needs a fresh `FB.login`. The re-onboard path resets `config_value` to `{}`.
- `UpdateProvider` refuses when `whatsapp_onboard_status` true, so switching provider after onboarding is not supported.

Input validation on profile update (geta-core `MetaAPI.py:181-363`)

- `about` 1-139 chars, `description` <= 512, `address` <= 256, `email` <= 128 + regex, `websites` list of <= 2, each <= 256 chars and starting `http://` or `https://`, `vertical` from `ALCOHOL, APPAREL, AUTO, BEAUTY, EDU, ENTERTAIN, EVENT_PLAN, FINANCE, GOVT, GROCERY, HEALTH, HOTEL, NONPROFIT, ONLINE_GAMBLING, OTC_DRUGS, OTHER, PHYSICAL_GAMBLING, PROF_SERVICES, RESTAURANT, RETAIL, TRAVEL`. Profile picture is a pre-obtained upload `header_handle` sent as `profile_picture_handle`; how that handle is produced (resumable upload): not found in these repos.

Interakt-specific vs plain Meta

- Credential model: Interakt calls use the shared partner key as `x-access-token` plus per-WABA `x-waba-id`; plain Meta uses the per-workspace BISU Bearer token. Both are stored on the same row (`auth_key`, `access_token`) so the flag can flip without re-onboarding.
- The tp-signup call authenticates with `Authorization: <raw partner key>` (no `Bearer`) and is the real "onboard to Interakt" step. Webhook delivery for Interakt WABAs goes to `.../whatsapp/webhook/interakt/callback` (set via per-phone `webhook_configuration.override_callback_uri`, header `x-phone-number-id`), whereas direct Meta uses `.../whatsapp/webhook/callback` configured on the Meta app. Inbound routing in both cases keys off `entry[].id` (WABA id) to Redis `meta_account_mapping:account_waba_ids:<waba_id>`.
- `business_compliance_info` endpoint unverified on Interakt (TODO at `MetaAPI.py:149-151`).
- Geta-core `MetaOnboarding.py:153` points at a stale azurewebsites host for subscribed_apps; prefer `INTERAKT_API_ENDPOINT`.
- `x-phone-number-id` header appears only in the migration script, not in `get_meta_headers`.

Messaging-limit mapping drift: three different tier tables (core, async, whatsapp-service) with different keys (`UNLIMITED` vs `TIER_UNLIMITED`, `TIER_2K`, `TIER_50`).

## 6. Suggested shape for the NestJS port (judgement, not from code)

1. Frontend: FB SDK `v20.0`+ with `config_id`, `response_type:"code"`, `override_default_response_type:true`, `extras.setup.solutionID`; additionally add a `window.addEventListener("message")` for `WA_EMBEDDED_SIGNUP` (origin `https://www.facebook.com` / `https://web.facebook.com`) to capture `waba_id`, `phone_number_id`, `business_id` and `current_step` for errors, so the backend need not guess from granular scopes. POST `{code, waba_id?, phone_number_id?}`.
2. Backend: one `WhatsAppProviderPort` with adapters `MetaDirect`, `Interakt`, `Pinnacle`; onboarding job = steps 2.2.1-12; persist a state machine `pending -> connecting -> active | failed(reason)` rather than only Pending/Approved.
3. Keep both `access_token` (Meta) and `auth_key` (Interakt partner key or Pinnacle user key) per number, as Geta does, and route by `meta_provider` per workspace and `IS_INTERAKT_ENABLED` for runtime header selection.
4. Index inbound webhooks by `waba_id` (and `phone_number_id`) to a tenant.
