# WhatsApp onboarding on real Meta / Interakt APIs: handoff

Written 2026-10-02 for whoever continues this (a cloud Claude Code session, or a person). Read this file first. It is
self-contained; the four `geta-api-*.md` files next to it are the long-form evidence it summarises.

Owner of the request: Lakshya Tyagi. Source of requirements: four call transcripts with Shubham (2026-10-02), summarised in section 1.

---

## 0. State in one screen

| Item                                                                       | State                                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch / worktree                                                          | `lakshya/waba/meta-interakt`, worktree `/home/getaweblpubt24/Documents/threadwise-repo-waba` (repo root; code under `crm-platform/`), created from `origin/main` @ `daecde1`. **Nothing is committed or pushed.** |
| Real git remote                                                            | `https://github.com/lakshyatyagi241/threadwise.git` (the older `~/Documents/threadwise-port` checkout is stale; do not use it)                                                                                    |
| Provider layer (Meta Graph + Interakt)                                     | built, unit-tested                                                                                                                                                                                                |
| WABA module: connect / health / profile API, public webhook, ingest worker | built, e2e-tested                                                                                                                                                                                                 |
| Tests                                                                      | WABA unit 71/71, WABA e2e 27/27 (real Postgres + Redis containers), whole unit suite green after the health-spec fix, `tsc` clean, `pnpm arch` clean, eslint clean on new files                                   |
| Never run against real Meta / Interakt                                     | true. Every external call is asserted against a fake at the HTTP edge only. First real send is the next verification step                                                                                         |
| Web UI                                                                     | **not built**                                                                                                                                                                                                     |
| Templates (create / sync / edit / delete / media handle)                   | **not built** (only the inbound template-status webhook is)                                                                                                                                                       |
| Inbound message storage                                                    | **not built** (needs the inbox domain; a sink interface is ready)                                                                                                                                                 |
| `device_limit` plan gate                                                   | **not built** (plans domain has no equivalent yet)                                                                                                                                                                |
| Pinnacle BSP                                                               | **not built**                                                                                                                                                                                                     |

To move this to a cloud session you must first get the work into git:

```bash
cd /home/getaweblpubt24/Documents/threadwise-repo-waba
git add -A && git commit -m "feat(waba): Meta/Interakt provider layer, number connect API, webhook ingest"
git push -u origin lakshya/waba/meta-interakt
```

(The repo's commit-msg hook is commitlint; `feat(waba): ...` satisfies it. Husky is not active in the worktree because `.git` is a file there.)

---

## 1. What Shubham asked for (translated from the transcripts)

Make sure every item is respected. Quotes are paraphrased from Hindi.

1. **Use the real Meta / Interakt APIs, found in the Geta repos.** "Don't take Geta's API, take the direct Interakt one." So: call
   Interakt/Meta directly from this platform; learn the calls from Geta's code but never call Geta's own backend.
2. **WhatsApp onboarding first.** It blocks everything: templates, inbox, flow builder, send API. "Until you finish this, nothing after it can move." It may sit anywhere
   under Settings; the UI will be polished later.
3. **Same Meta app as Geta** (Interakt tech-provider app). No re-onboarding is needed; "we just put the IDs in temporarily". The Meta app needs this platform's
   staging/prod domain allow-listed. Webhook callback needs domain mapping, or a tunnel for local.
4. **Verification is by actually sending** ("check happens only by sending"). Integration is the pending part; UI for templates is cheap (15-20 min).
5. **Feature order:** core model, roles/permissions, CRM (almost done), then **broadcast, inbox, journey/flow builder**, then catalog/coexistence, then the other channels last.
   In the nearer term: broadcast, flow builder, chatbot builder first, **inbox after**.
6. **Do NOT build:** Meta Ads (no credit line available), the WhatsApp QR / Baileys flavour ("we won't give that at all"), and avoid the wallet/salary-style billing rabbit hole. Admin panel / plans come later
   once ~90% of features exist.
7. **Provider options:** Interakt, Pinnacle, or both ("or multiple"). Pinnacle is not built; the port is shaped so it is one more adapter.
8. **Ownership discipline:** pull before starting, raise PRs every few hours so others merge, and anyone taking a domain that is not theirs writes their name in the sheet. WABA/TPL/WADEV/broadcast/inbox are assigned to **Vedant** in `docs/threadwise-port/ownership.json`; team-chat (also Vedant) is already merged; inbox has no PR yet.
9. **Ingest / agents:** Shubham wants agent execution to go through Geta "ingest" later. Not in scope now.
10. Deployment question left open in the call: whether WhatsApp can run on localhost. Answer used here: Meta needs a public HTTPS callback, so use a tunnel locally (`WABA_WEBHOOK_PUBLIC_URL`).

---

## 2. What "Interakt" is, and how Geta really uses it (findings)

Evidence: `geta-api-onboarding.md`, `geta-api-messaging.md`. Geta repos live under `/home/getaweblpubt24/Documents/geta/` (geta-core, geta-whatsapp-service, geta-broadcast-service, geta-webhook-service, geta-auth-service, Voice/geta-async, bug/console-whatsapp-frontend).

- **Interakt** = a BSP. Its `amped-express` host is a Meta Graph proxy with identical paths: `https://amped-express.interakt.ai/api/<version>/...`. Auth headers: `x-access-token: <shared tech-partner key>` and `x-waba-id: <waba id>`. Meta direct: `Authorization: Bearer <business token>`.
- Switch in Geta: env `IS_INTERAKT_ENABLED` (+ `META_API_*`, `INTERAKT_API_*`). **But the switch is not honoured on sends**: Geta hard-codes `https://amped-express.interakt.ai/api/v17.0/{phoneID}/messages` for sends. The provider per workspace is `workspace.meta_provider` (`interakt` default | `pinnacle`).
- **Onboarding never touches the Interakt host for the Embedded Signup exchange.** All of it is Meta Graph with Geta's system user; then Interakt is told with one call to `POST https://api.interakt.ai/v1/organizations/tp-signup/` (`Authorization: <raw partner key>`, event `PARTNER_ADDED`). The same partner key is then stored per workspace as `auth_key`.
- Browser side (Geta): Facebook JS SDK `v20.0`; `FB.login({config_id, response_type:'code', override_default_response_type:true, extras:{setup:{solutionID}}})`. Geta never listens to the `WA_EMBEDDED_SIGNUP` postMessage; it only posts the OAuth `code` and rediscovers the WABA server-side from `debug_token` granular scopes. (This platform should read the postMessage too, but must still verify ids against the token. Done server-side already.)
- **Inbound:** Meta's webhooks reach Interakt, which forwards Meta-shaped payloads to a per-phone callback you register with `POST {interakt}/{phone_number_id}` body `{"webhook_configuration":{"override_callback_uri":"<url>"}}` (proven in Geta's `migrate_waba.py`). Geta's other attempt (`subscribed_apps` with override) was broken: it overwrote the payload with `{}`.
- Geta defects deliberately **not** ported: no webhook signature check, hard-coded `v17.0`, `expiration_time_ms` in seconds, template `type` capitalised `"Template"`, interactive Joi validation never awaited, process-global tenant config, inbound processed inline (30 s Lambda) with Redis dedupe set before processing, only `messages[0]` read, edit-template does not exist, template delete is by name only, `FLAGGED`/`REINSTATED` crash the template handler, `message_template_components_update` returns 400.
- Public Meta ids hard-coded in Geta's frontend (client-side values, not secrets; they identify Geta's Interakt app): config id `707200291383635`, solution id `951670443632073`. **The platform here needs its own values in env**; they are placeholders until the platform admin settings store (TW-SET) can hold them.

---

## 3. Design decisions taken (and why)

1. **Two routes per number, one port.** `provider` = `interakt` | `meta`. Same Cloud API paths, so `WabaHttp` only varies host, version and headers.
2. **Platform-wide Meta app / Interakt partner values live in env** (`config/domains/whatsapp-cloud-api-waba.env.ts`, token `WABA_ENV`) until a settings store exists. Every reader goes through `WABA_ENV`.
3. **Connections reuse `wa_provider_configs`** (provider `'waba'`); no new table. Credentials AES-GCM in `credentials_json` (`CryptoService`), ids and Meta health fields in `meta_json`. Because the broadcast sender directory already reads this table, a connected number is selectable in broadcasts immediately.
4. **One Meta number = one live workspace.** Partial unique index on `(meta_json->>'phone_number_id')` excluding `disconnected`. Reference allowed duplicates; that makes inbound routing ambiguous. Documented intended deviation.
5. **Webhook authentication.** Meta-signed (`X-Hub-Signature-256`, constant time, tried against platform secrets and the number's own app secret) **or** the platform secret in the registered callback URL `?k=` (Interakt documents no signature). `WABA_REQUIRE_INTERAKT_SIGNATURE=true` closes the URL-key door. Both absent/wrong = 401.
6. **Tenant routing of webhooks** by `phone_number_id` (fallback WABA id) through the `SECURITY DEFINER` function `waba_route_lookup()` (same pattern as `bcast_receipt_lookup`): no tenant exists yet and `privileged()` must not be reachable from HTTP handlers.
7. **Ack fast, process in a queue.** New queue `waba-ingest` (`QUEUES.WABA_INGEST`); HTTP answers 200 after enqueue; job id = sha256(raw body) so Meta retries collapse.
8. **Verify token** = `WHATSAPP_VERIFY_TOKEN` if set, else derived `HMAC(credentialsKey,'waba-webhook-verify-token')[:40]` (stable across instances, nothing to persist).
9. **Client ids are hints.** Embedded connect accepts `wabaId` / `phoneNumberId` from the popup but proves them against `debug_token` granular scopes and the WABA's phone list; a foreign id is `403 WABA_ID_MISMATCH`.
10. **Auto-register** (random PIN, stored) only on the direct `meta` route; on `interakt`, Embedded Signup registers the number itself (Geta's register call is commented out). Manual button available on both.
11. **Errors keep Meta's code** (`WabaApiError`), classified by `classifySendError` (131049 frequency cap, 130429/131056 rate limit, 131047 window closed, 131050 opted out, 131026 undeliverable, 132xxx template, 190 auth, 133010 not registered).

---

## 4. Environment variables (all new ones are optional with defaults)

Defined in `apps/api/src/config/domains/whatsapp-cloud-api-waba.env.ts`. An empty string means unset. Values below are NAMES only; no secrets are in the repo.

| Variable                                                                                                                       | Default                                               | Purpose                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `WABA_DEFAULT_PROVIDER`                                                                                                        | `interakt`                                            | route for Embedded Signup numbers: `interakt` or `meta`                                                   |
| `META_API_ENDPOINT`                                                                                                            | `https://graph.facebook.com`                          | Graph host                                                                                                |
| `META_API_VERSION`                                                                                                             | `v25.0`                                               | Graph version (`vNN.N` enforced)                                                                          |
| `INTERAKT_API_ENDPOINT`                                                                                                        | `https://amped-express.interakt.ai/api`               | Interakt Graph proxy                                                                                      |
| `INTERAKT_API_VERSION`                                                                                                         | `v25.0`                                               | Interakt version for normal calls                                                                         |
| `INTERAKT_MEDIA_API_VERSION`                                                                                                   | `v17.0`                                               | `/media_handle` exists only on the old Interakt version (declared, **not yet used**: templates not built) |
| `INTERAKT_TP_SIGNUP_URL`                                                                                                       | `https://api.interakt.ai/v1/organizations/tp-signup/` | partner registration                                                                                      |
| `META_APP_ID`                                                                                                                  | none                                                  | Meta app id (also sent to the browser SDK)                                                                |
| `META_APP_SECRET`                                                                                                              | none                                                  | code exchange, signature check, token renewal. Never returned by any API                                  |
| `META_EMBEDDED_CONFIG_ID`                                                                                                      | none                                                  | Embedded Signup configuration id. Empty = manual connect only                                             |
| `INTERAKT_SOLUTION_ID`                                                                                                         | none                                                  | `extras.setup.solutionID` and `tp-signup` body                                                            |
| `INTERAKT_PARTNER_AUTH_KEY`                                                                                                    | none                                                  | shared tech-partner key: `x-access-token` on Interakt calls                                               |
| `META_SYSTEM_USER_ID`                                                                                                          | none                                                  | assigned to each WABA with task `MANAGE`                                                                  |
| `META_SYSTEM_USER_TOKEN`                                                                                                       | none                                                  | inspects tokens (`debug_token`), assigns the system user                                                  |
| `META_BUSINESS_ID`                                                                                                             | none                                                  | fallback WABA discovery (`client_whatsapp_business_accounts`)                                             |
| `WABA_WEBHOOK_PUBLIC_URL`                                                                                                      | falls back to `APP_URL`                               | public HTTPS origin Meta/Interakt can reach. Needed for any inbound                                       |
| `WABA_REQUIRE_INTERAKT_SIGNATURE`                                                                                              | `false`                                               | require a valid body signature on every POST                                                              |
| `WABA_HTTP_TIMEOUT_MS`                                                                                                         | `15000`                                               | per-call ceiling (1000..120000)                                                                           |
| existing: `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`, `APP_URL`, `REDIS_URL`, `DATABASE_URL` |                                                       | reused from the kernel env schema                                                                         |

Embedded Signup is "ready" when `META_APP_ID`, `META_APP_SECRET`, `META_EMBEDDED_CONFIG_ID` are set and, for the Interakt route, `INTERAKT_PARTNER_AUTH_KEY` and `INTERAKT_SOLUTION_ID` too. `GET /v2/waba/readiness` lists exactly what is missing.

Meta app configuration out of band (Meta developer dashboard): Facebook Login > allow the platform web origin; WhatsApp > Configuration callback URL = the value of `readiness.webhookUrl` and the verify token (derived or `WHATSAPP_VERIFY_TOKEN`), subscribe `messages`. For the Interakt route Interakt owns the app-level webhook and forwards to the per-phone override that this code registers.

---

## 5. Endpoints this platform exposes (all under `/v2`, URI-versioned)

Auth: staff bearer JWT (`actorKinds('user')`). Mutations that are marked **Idem** require an `Idempotency-Key` header. Errors are problem+json: `{type,title,status,detail,code,requestId,errors?}`. **Branch on `code`, never on `detail`.**

Permissions (migration `20261014090000_waba_connections.sql`, granted to the locked Admin preset in every org): `waba.numbers.read`, `waba.numbers.connect`, `waba.numbers.manage`.

| Method + path                                           | Permission      | Idem | Body                                                                                                                             | Returns                                                                                                                 |
| ------------------------------------------------------- | --------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /v2/waba/readiness`                                | read or connect |      |                                                                                                                                  | `{embeddedSignupReady, appId, configId, solutionId, graphVersion, defaultProvider, missing[], webhookUrl}` (no secrets) |
| `GET /v2/waba/numbers`                                  | read            |      |                                                                                                                                  | `{items: WabaConnection[]}` primary first                                                                               |
| `POST /v2/waba/numbers/connect/embedded`                | connect         | yes  | `{code, wabaId?, phoneNumberId?, businessId?, coexistence?}` (ids numeric, max 40; `code` max 500)                               | `201 {connection, warnings[]}`                                                                                          |
| `POST /v2/waba/numbers/connect/manual`                  | connect         | yes  | `{phoneNumberId, wabaId, businessId?, accessToken, displayLabel?, appId?, appSecret?}`                                           | `201 {connection, warnings[]}`                                                                                          |
| `POST /v2/waba/numbers/verify-token`                    | connect         |      | `{accessToken, phoneNumberId?, wabaId?}`                                                                                         | `{ok, checks:[{key:token                                                                                                | phone   | waba                                                                                                 | management_scope | cloud_api, ok, title, detail}]}` |
| `GET /v2/waba/numbers/:id`                              | read            |      |                                                                                                                                  | `WabaConnection`                                                                                                        |
| `PATCH /v2/waba/numbers/:id`                            | manage          |      | `{displayLabel, rowVersion?}`                                                                                                    | `WabaConnection` (409 on stale `rowVersion`)                                                                            |
| `GET /v2/waba/numbers/:id/health`                       | read            |      |                                                                                                                                  | `{connection, overall: ok                                                                                               | warning | error, issues[{key,severity,title,solution}], tokenHint, checkedAt}`; reads the phone live from Meta |
| `POST /v2/waba/numbers/:id/primary`                     | manage          |      |                                                                                                                                  | `WabaConnection`                                                                                                        |
| `POST /v2/waba/numbers/:id/resubscribe` ("Fix inbound") | manage          |      |                                                                                                                                  | `{connection, warnings[]}`                                                                                              |
| `POST /v2/waba/numbers/:id/register`                    | manage          |      | `{pin?}` (6 digits)                                                                                                              | `WabaConnection`; PIN precedence typed, stored, generated; Meta "already" = success                                     |
| `PUT /v2/waba/numbers/:id/token`                        | manage          |      | `{accessToken}` (min 20)                                                                                                         | `WabaConnection` after Meta accepts it                                                                                  |
| `POST /v2/waba/numbers/:id/token/renew`                 | manage          |      |                                                                                                                                  | `WabaConnection`; 422 if Meta cannot renew                                                                              |
| `GET /v2/waba/numbers/:id/profile`                      | read            |      |                                                                                                                                  | `{about,address,description,email,profilePictureUrl,websites[],vertical}`                                               |
| `PUT /v2/waba/numbers/:id/profile`                      | manage          |      | partial: `about` 1-139, `description` <=512, `address` <=256, `email` <=128, `websites` <=2 (http/https, <=256), `vertical` enum | `WabaBusinessProfile`                                                                                                   |
| `POST /v2/waba/numbers/:id/disconnect`                  | manage          |      |                                                                                                                                  | `WabaConnection` (`status:'disconnected'`, creds wiped, best-effort unsubscribe)                                        |
| `DELETE /v2/waba/numbers/:id`                           | manage          |      |                                                                                                                                  | `204`; hard delete, promotes next primary                                                                               |

Webhook (public, no JWT, hidden from Swagger):

| Method + path                                                                              | Behaviour                                                                                                                                                              |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v2/public/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=..&hub.challenge=..` | echoes the challenge as `text/plain` when the verify token matches; `403` otherwise                                                                                    |
| `POST /v2/public/webhooks/whatsapp[?k=<platform key>]`                                     | authenticates (signature or `k`), splits the envelope per `changes[]`, queues handled fields, answers `200 {received:true}`; `401` on forgery, `422` on empty/non-JSON |

`WabaConnection` shape (contract `wabaConnectionSchema`, `packages/contracts/src/whatsapp-cloud-api-waba/connections.ts`): `id` (uuid), `provider`, `status` (`pending|connected|failed|disconnected`), `isPrimary`, `displayLabel`, `phoneNumber`, `verifiedName`, `wabaId`, `phoneNumberId`, `businessId`, `qualityRating`, `messagingLimitTier`, `platformType`, `nameStatus`, `codeVerificationStatus`, `coexistence`, `inboundWired` (true|false|null), `inboundCheckedAt`, `connectedVia` (`embedded|manual`), `hasToken`, `tokenExpiresAt`, `lastError`, `connectedAt`, `lastHealthAt`, `rowVersion`. **The token and the partner key never leave the server.**

Error codes added (`packages/contracts/src/whatsapp-cloud-api-waba/errors.ts`, spread into `ERROR_CODES`): `WABA_NOT_CONFIGURED` (409), `WABA_PROVIDER_REJECTED` (422), `WABA_PROVIDER_UNAVAILABLE` (503, retryable), `WABA_MISSING_PERMISSION` (422, subcode 1349174), `WABA_NO_WABA` (422), `WABA_NO_PHONE` (422), `WABA_ON_PREMISE` (422), `WABA_ID_MISMATCH` (403), `WABA_NUMBER_IN_USE` (409), `WABA_NO_CREDENTIALS` (409).

---

## 6. Exact calls this platform makes to Meta and Interakt

`G` = `https://graph.facebook.com/v25.0`; `I` = `https://amped-express.interakt.ai/api/v25.0`. Tokens always in headers, never in the query string. Source: `infra/providers/whatsapp-cloud-api-waba/waba-admin.client.ts`, `waba-http.ts`, `whatsapp/meta-cloud.provider.ts`.

### 6.1 Embedded Signup, Interakt route (`connectEmbedded`)

| #   | Call                                                                                                                                                                                                                                                                                              | Notes                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `GET G/oauth/access_token?client_id&client_secret&code` header `Authorization: Bearer <META_SYSTEM_USER_TOKEN>` if set                                                                                                                                                                            | **no `redirect_uri`** (popup codes are in-window; sending one switches Meta to classic OAuth, error 100/191). Response `access_token`, `expires_in` |
| 2   | `GET G/debug_token?input_token=<token>` header `Authorization: Bearer <system token>` (or `app_id\|app_secret`)                                                                                                                                                                                   | `granular_scopes[scope=whatsapp_business_management].target_ids` = granted WABAs; `scopes`, `user_id`, `expires_at`                                 |
| 2b  | fallback `GET G/<META_BUSINESS_ID>/client_whatsapp_business_accounts` Bearer business token                                                                                                                                                                                                       | first WABA                                                                                                                                          |
| 3   | `GET G/<waba>/phone_numbers?fields=id,verified_name,display_phone_number,quality_rating,messaging_limit_tier,code_verification_status,name_status,account_mode,throughput,platform_type,is_official_business_account,is_pin_enabled,last_onboarded_time,status` Bearer business token             | display number whitespace stripped                                                                                                                  |
| 4   | `GET G/<waba>?fields=owner_business_info{id,name}` then `GET G/<business>?fields=verification_status`                                                                                                                                                                                             | best effort                                                                                                                                         |
| 5   | `POST https://api.interakt.ai/v1/organizations/tp-signup/` header `Authorization: <INTERAKT_PARTNER_AUTH_KEY>` (raw, no Bearer), body `{"entry":[{"changes":[{"value":{"event":"PARTNER_ADDED","waba_info":{"waba_id":"..","solution_id":"..","phone_number":".."}}}]}],"object":"tech_partner"}` | failure only produces a warning                                                                                                                     |
| 6   | `POST G/<waba>/assigned_users?user=<META_SYSTEM_USER_ID>&tasks=['MANAGE']` Bearer system token                                                                                                                                                                                                    | best effort                                                                                                                                         |
| 7   | `POST G/<waba>/subscribed_apps` Bearer business token (empty body)                                                                                                                                                                                                                                | plain subscribe, Geta-proven. Subcode 1349174 aborts the connect                                                                                    |
| 8   | `POST I/<phone_number_id>` headers `x-access-token`, `x-waba-id`, `x-phone-number-id`; body `{"webhook_configuration":{"override_callback_uri":"<webhookUrl>","verify_token":"<token>"}}`; on 4xx repeats without `verify_token`                                                                  | if both refused: saved with a warning                                                                                                               |
| 9   | `GET G/<waba>/subscribed_apps`                                                                                                                                                                                                                                                                    | `inboundWired=true` when an entry's `override_callback_uri` equals ours (trailing slash trimmed)                                                    |

### 6.2 Embedded Signup / manual, direct Meta route

Same 1-4, then **subscribe with override (TW-WABA-011):** `POST G/<waba>/subscribed_apps` body `{override_callback_uri, verify_token}`; on failure plain `POST` (empty); then up to 3 retries of the override with 1 s sleep (Meta #100 propagation race); subcode `1349174` anywhere = hard stop; otherwise saved with `overrideApplied=false` and a warning telling the user to set the callback in their own Meta app. Then `POST G/<phone>/register {"messaging_product":"whatsapp","pin":"<6 digits>"}` (silent; coexistence numbers skipped).

Manual connect extras: `GET G/oauth/access_token?grant_type=fb_exchange_token&client_id&client_secret&fb_exchange_token=<pasted>` (typed app creds, else platform; any failure keeps the pasted token), probe `GET G/<phone>?fields=<same list>`, refuse `platform_type=ON_PREMISE` (retired by Meta 23 Oct 2025).

### 6.3 Runtime (sending)

All `POST {base}/{phone_number_id}/messages` (or `/marketing_messages` when the number is Marketing-Messages-Lite **and** the template category is marketing). Interakt: headers `x-access-token`+`x-waba-id`; Meta: `Bearer`.

- text: `{"messaging_product":"whatsapp","recipient_type":"individual","to":"<digits>","type":"text","text":{"preview_url":false,"body":".."}}` (+ `context:{message_id}` to quote)
- template: `{"messaging_product":"whatsapp","to":"..","type":"template","template":{"name","language":{"code"},"components":[..]}}` (components built by the existing broadcast `buildSend`, TW-BCAST-017)
- image / video / audio / document / sticker / location / contacts / interactive / reaction: object under the `type` key, passed through (`SendMessageParams`). Media goes by public `link`; Geta never uses media ids on send.
- mark read (+ typing): `{"messaging_product":"whatsapp","status":"read","message_id":"wamid..","typing_indicator":{"type":"text"}}`
- Success = `messages[0].id` (wamid); `message_status:"failed"` on a 200 is treated as failure.

### 6.4 Not yet called but specified (use these for the next work)

See `geta-api-templates-and-flows.md` sections 1, 2, 7 and `geta-api-messaging.md` sections 3 and 6. Short list:

- create `POST {B}/{waba}/message_templates {name,language,category,components}`; list/sync `GET {B}/{waba}/message_templates?fields=id,name,status,category,language,components,quality_score,rejected_reason&limit=100` (page by `paging.cursors.after`, **not** `paging.next`, which may point at Graph from Interakt); delete `DELETE {B}/{waba}/message_templates?name=<name>` (optionally `hsm_id`); edit `POST {B}/{template_id}` (not in Geta; unverified on Interakt, capability-flag it).
- header-example media handle: Meta direct = `POST G/<app_id>/uploads?file_name&file_length&file_type&access_token` then `POST G/upload:<id>` with `Authorization: OAuth <token>`, `file_offset: 0`, raw bytes, response `h`; **Interakt = one multipart `POST https://amped-express.interakt.ai/api/v17.0/<phone_id>/media_handle`** (`file`, `messaging_product=whatsapp`, `type=<mime>`), response `h`. Pinned to `INTERAKT_MEDIA_API_VERSION`.
- Flows: `POST {B}/{waba}/flows {name,categories}`; `POST {B}/{flow_id}/assets` multipart (`file`=flow.json, `name`, `asset_type=FLOW_JSON`; Interakt adds `x-phone-number-id`); `POST /{flow}/publish`, `/deprecate`; `DELETE /{flow}`; `GET /{waba}/flows`.
- Catalog: `GET {B}/{business_id}/owned_product_catalogs`, `/{catalog}/product_sets`, `/{catalog}/products`.
- Business compliance info (India): `GET/POST {B}/{phone}/business_compliance_info` (unconfirmed on Interakt; keep on Graph).
- Inbound media: `GET {B}/{media_id}` then `GET <url>` with **`Authorization: Bearer <Meta access_token>` even on the Interakt route** (the Interakt key is not accepted by the CDN).

---

## 7. Inbound webhook processing (what the worker does)

`WabaIngestService.process(changes[])`, one job per authenticated payload, in the worker (`WabaWorkerModule`, only imported by `workers.module.ts`).

| `change.field`                                                                                                                        | Action                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `messages` -> `statuses[]`                                                                                                            | normalised by `MetaCloudProvider.parseWebhook`; `BroadcastReceiptsService.handle()` (forward-only state machine, idempotent). Failure text = `errors[0].error_data.details ?? message ?? title`, code kept. Unclaimed reports go to `WABA_INBOUND_SINK.onStatus`                                                                                                                                                   |
| `messages` -> `messages[]`                                                                                                            | Redis `SET waba:inbound:<org>:<wamid> NX EX 86400` (released on failure so the retry completes); `WABA_INBOUND_SINK.onMessage(ctx, msg)`; first real inbound sets `meta_json.inbound_wired=true` (statuses alone never do)                                                                                                                                                                                         |
| `message_template_status_update`, `message_template_quality_update`, `template_category_update`, `message_template_components_update` | `WabaTemplateEvents` -> `wa_templates` scoped to `provider_config_id`; rules in `template-event-rules.ts` (APPROVED sets `approved_at` once; REJECTED stores `rejection_reason_code` or `NONE`; PAUSED and RED quality on non-authentication templates set `paused_until = now+24h`; FLAGGED/REINSTATED tolerated; components update only marks seen; name+language fallback with region tolerance `en` ~ `en_US`) |
| `phone_number_quality_update`                                                                                                         | `messaging_limit_tier` from `current_limit`; outbox `whatsapp.number.quality_changed`                                                                                                                                                                                                                                                                                                                              |
| `phone_number_name_update`                                                                                                            | `name_status`, and `verified_name` when APPROVED                                                                                                                                                                                                                                                                                                                                                                   |
| `account_update`                                                                                                                      | `meta_json.account_alert`; outbox `whatsapp.account.alert`                                                                                                                                                                                                                                                                                                                                                         |
| `account_review_update`                                                                                                               | `meta_json.account_review`                                                                                                                                                                                                                                                                                                                                                                                         |
| `flows`                                                                                                                               | outbox `whatsapp.flow.status_changed` (flow builder will consume)                                                                                                                                                                                                                                                                                                                                                  |
| anything else                                                                                                                         | acknowledged and dropped (Meta retries a 4xx/5xx for days)                                                                                                                                                                                                                                                                                                                                                         |

No workspace owns the number: logged and dropped, still `200`.

**Gap:** `WABA_INBOUND_SINK` defaults to `LoggingInboundSink` (logs a warning, stores nothing). The inbox domain must bind its own provider to `WABA_INBOUND_SINK` (contact + thread resolution, message store, realtime). Until then inbound messages are lost after the ack.

Outbox events emitted: `whatsapp.connection.connected|disconnected|removed|primary_changed`, `whatsapp.number.quality_changed`, `whatsapp.account.alert`, `whatsapp.flow.status_changed`. Audit rows use module `wa_provider_configs`.

---

## 8. Code map (everything is under `crm-platform/`)

New:

```
apps/api/src/config/domains/whatsapp-cloud-api-waba.env.ts          env schema + WABA_ENV
apps/api/src/infra/providers/whatsapp-cloud-api-waba/
  waba-http.ts            WabaHttp: base URL/version/headers/timeout/JSON/errors; fetchImpl is a public field (test seam)
  waba-errors.ts          WabaApiError, describeMetaError, translateConnectError, translateRegisterError, classifySendError
  waba-admin.port.ts      WabaAdminPort, WABA_ADMIN, WabaConnection, authOf()
  waba-admin.client.ts    WabaAdminClient (all section 6.1/6.2 calls); `sleep` is a public field (test seam)
  waba-providers.module.ts  @Global; provides WABA_ENV, WabaHttp, WABA_ADMIN
apps/api/src/modules/whatsapp-cloud-api-waba/
  waba-rules.ts           pure: webhookUrl, inboundUrlKey, verifyTokenFor, authenticateWebhook, deriveHealth, splitWebhook, HANDLED_FIELDS, PIN/tier/mask helpers
  template-event-rules.ts pure: template webhook rules
  waba-connections.repository.ts / .mapper.ts   raw SQL on wa_provider_configs
  waba-connect.service.ts  all connect/health/profile logic
  waba-connections.controller.ts   /v2/waba/*
  waba-webhook.controller.ts / .service.ts   public endpoint
  waba-ingest.service.ts / .processor.ts / waba-worker.module.ts
  waba-inbound-sink.ts    WABA_INBOUND_SINK + LoggingInboundSink
  waba-template-events.service.ts   shim until the templates domain exists
  waba.module.ts, index.ts
apps/api/test/unit/whatsapp-cloud-api-waba/        3 spec files, 71 tests
apps/api/test/e2e/whatsapp-cloud-api-waba/waba-connect.e2e.spec.ts   27 tests (testcontainers: Postgres + Redis)
packages/contracts/src/whatsapp-cloud-api-waba/{index,connections,errors}.ts
packages/db/migrations/20261014090000_waba_connections.sql
docs/threadwise-port/waba-interakt/   this file + 4 Geta API specs
```

Edited (shared files; call them out in the PR):

```
apps/api/src/infra/providers/whatsapp/whatsapp.port.ts      ChannelCredentials gains route/authKey/marketingLite; SendTemplateParams.category; new SendMessageParams, sendMessage, markRead
apps/api/src/infra/providers/whatsapp/meta-cloud.provider.ts  send path is real; ctor now (WabaHttp, OUTBOUND_SEND_GUARD)
apps/api/src/infra/providers/providers.module.ts            imports WabaProvidersModule
apps/api/src/modules/broadcasts/engine-senders.ts           WabaEngineSender reads meta_json.provider, auth_key, waba_id, is_mm_lite_onboarded; OutgoingMessage.category
apps/api/src/modules/broadcasts/broadcasts.module.ts        exports BroadcastReceiptsService
apps/api/src/infra/queue/queues.ts                          + WABA_INGEST
apps/api/src/app.module.ts, apps/api/src/workers/workers.module.ts   register WabaModule / WabaWorkerModule
packages/contracts/src/index.ts, packages/contracts/src/common/errors.ts   barrel + error codes
apps/api/test/unit/dashboards-analytics-charts/health.spec.ts   counts queues from QUEUES instead of a hard-coded 11 (was already stale on main; the new queue made it worse)
```

Note: the main checkout `~/Documents/threadwise-repo` (branch `lakshya/auth/parity-gaps`) has a `withFooter` call in `MetaCloudProvider.sendText` that origin/main does not. Whoever merges that branch will conflict in `meta-cloud.provider.ts`; keep both (`guard.withFooter` before posting the text body).

---

## 9. How to run it

```bash
cd crm-platform
corepack pnpm install --frozen-lockfile --prefer-offline        # pnpm 9.15.4 via corepack; the global pnpm on this machine is wrong
corepack pnpm --filter "@crm/api^..." build                      # builds @crm/tax, @crm/db, @crm/contracts (needed before tsc/tests)
cd apps/api
npx tsc --noEmit -p tsconfig.json
npx vitest run --dir test/unit test/unit/whatsapp-cloud-api-waba
npx vitest run --dir test/e2e  test/e2e/whatsapp-cloud-api-waba --testTimeout=120000   # needs Docker (testcontainers)
corepack pnpm arch                                               # dependency-cruiser boundaries
npx eslint src/modules/whatsapp-cloud-api-waba src/infra/providers test/unit/whatsapp-cloud-api-waba
```

Migrations: never test on the shared dev DB `crm` (`localhost:55432`, used by both checkouts). Use a scratch DB:
`psql "$DATABASE_URL" -c "CREATE DATABASE waba_scratch"` then `DATABASE_URL=...waba_scratch MIGRATION_DATABASE_URL=...waba_scratch corepack pnpm --filter @crm/db migrate` (142 migrations applied cleanly including this one). `waba_scratch` already exists on that server.

Local webhook testing: expose the API with a tunnel (ngrok/cloudflared), set `WABA_WEBHOOK_PUBLIC_URL=https://<tunnel>`, restart, then `GET /v2/waba/readiness` shows the exact URL to give Meta.

Repo rules to follow (root `CLAUDE.md`, `crm-platform/CLAUDE.md`, `docs/threadwise-port/PORTING_RULES.md`): contracts first, tenant-scoped transactions, audit + outbox in the same transaction, no vendor calls outside provider adapters, parity with Reference behaviour documented in `docs/threadwise-port/parity/<domain>.md`, every feature gets a Reference-vs-ours Playwright parity run (`threadwise-playwright-parity` skill; **not run for this work yet**), `pre-pr` gate (`.claude/skills/pre-pr/scripts/gate.sh`), `pnpm domains:check`, `pnpm db:lint`.

---

## 10. Backlog, in the order Shubham's priorities imply

Each item names the Reference inventory ids (in `docs/threadwise-port/inventory/`) and the Geta evidence.

1. **Commit, push, open the PR** (tell Vedant: WABA/TPL are his zone; update the sheet; ownership guard `python3 .claude/skills/threadwise-ownership-guard/scripts/ownership_check.py` will flag zone crossings; shared-file edits listed in section 8).
2. **Real-world verification (priority 4 of Shubham):** with real env values, run Embedded Signup from a browser against the Interakt/Meta app, then send one template via the broadcast sender and read the receipt. Things only a real run can settle and that are guessed in the code:
   - whether Interakt accepts `verify_token` inside `webhook_configuration` (code falls back without it on 4xx);
   - whether Interakt signs forwarded webhooks and with which secret (code accepts signature **or** URL key);
   - whether `GET {I}/{phone}?fields=...` works on Interakt for every field in the health call (Geta only uses a subset);
   - `business_compliance_info` and template edit/analytics on Interakt (unverified).
3. **Web: Embedded Signup + manual connect + numbers list + health page** (`TW-WABA-004`, `005`, `021`; screens in `apps/web/src/features/whatsapp-cloud-api-waba/`, routes `apps/web/src/app/(app)/(whatsapp-cloud-api-waba)/`; skill `threadwise-frontend-port`; nav item must replace the planned entry in `features/_registry/planned.ts`). Spec for the browser launch:
   - load `https://connect.facebook.net/en_US/sdk.js`, `FB.init({appId: readiness.appId, cookie:true, xfbml:true, version:'v20.0'+})` eagerly on page load (so `FB.login` runs synchronously inside the click; mobile popup blockers);
   - `FB.login(cb, {config_id: readiness.configId, response_type:'code', override_default_response_type:true, extras:{setup:{solutionID: readiness.solutionId}, sessionInfoVersion:'3'}})` (add `solutionID` only on the Interakt route; Reference uses `sessionInfoVersion:'3'` and `featureType:'whatsapp_business_app_onboarding'` for coexistence);
   - listen for `window.postMessage` events with `type==='WA_EMBEDDED_SIGNUP'` from origins ending in `facebook.com`: `FINISH` carries `waba_id`, `phone_number_id`, `business_id`; `FINISH_ONLY_WABA`; `CANCEL`; `ERROR`; submit once both the login `authResponse.code` and the session message are present (guard against double POST; if only the code arrives after 15 s, tell the user Meta returned no number);
   - `POST /v2/waba/numbers/connect/embedded` with `{code, wabaId, phoneNumberId, businessId}`, render `warnings[]`; manual modal with a "Verify token" button hitting `/verify-token`.
   - Where to put it: Shubham said any Settings location is fine for now; Reference's own place is the Devices page WABA section.
4. **Templates (TPL, needed by broadcast/flow/chatbot):** `TW-TPL-017..029`, `TW-TPL-024` (create-payload builder), `025` (submit + media), `026/027/028` (refresh, sweep, importer), `020` (delete). Add a `WabaTemplatePort` + adapter next to `waba-admin.client.ts` using section 6.4 calls; **one validator** (merge Geta's two plus Meta's: name `^[a-z0-9_]{1,512}$`, sequential positional variables, example presence; the full rule table is in `geta-api-templates-and-flows.md` section 3; do not port Geta's inverted OTP checks); forward `allow_category_change` and `parameter_format` (Geta drops them); sync by `meta_template_id`, never delete locally on a partial fetch; page by cursor; write `wa_templates` (columns incl. `meta_status`, `quality_score`, `paused_until`, `provider_config_id`). Replace `WabaTemplateEvents` shim and the broadcast `SqlTemplateDirectory` shim when the domain exists (`modules/broadcasts/_shims/README.md` lists the swap).
5. **Inbound -> inbox (TIB1) and contacts:** bind `WABA_INBOUND_SINK`; media download per section 6.4 (Bearer `access_token`); 24 h service window + 72 h free-entry-point window keys; opt-out keyword handling; contact creation through the contacts barrel. Read only `messages[0]` is a Geta bug: this code already handles every message in the batch.
6. **Flow builder / chatbot builder** need: Flow API calls (6.4), `flows` webhook consumer (outbox event already emitted), interactive message builders (shapes in `geta-api-messaging.md` section 2.6), `TW-FLB-*`, `TW-FLR-*`.
7. **Broadcast hardening on this adapter:** token bucket (Geta 44 msg/s cluster-wide Redis), 3 retries with 60-600 s backoff and jitter skipping already-sent rows, 131049 retry up to 7 days (Geta uses an external Lambda; here BullMQ), classify errors with `classifySendError` and pause the number (not the message) on `auth`/`not_registered`; pass `category` into `OutgoingMessage` so Marketing-Messages-Lite works (the field exists, the dispatcher does not fill it yet).
8. **Smaller Reference items not done:** `TW-WABA-001` admin settings screen (env until TW-SET store), `002/003` coexistence enablement, `010/028/044/045/046` coexistence, `015` webhook diagnostic panel, `022/023/024` health extras (free service allowance, verified badge, calling toggle), `025/026` business username, `027` message QR codes, `038` campaign retry on 131049, `053` template button-click analytics, token-expiry renewal job (renew around day 45, notify on failure; Reference only renews by hand), unsubscribing on remove, per-workspace `device_limit` plan gate (PLAN dependency), `TW-WABA-008` token endpoint (P2).
9. **Pinnacle** (Geta: three extra calls, base `PINNACLE_URL`, header `apikey`, credit-line step delayed 200 s, send path `{PINNACLE_URL}/v3/{phone}/messages`): details in `geta-api-onboarding.md` section 2.4. New adapter + `provider:'pinnacle'` in `WabaProviderKind`/`wabaProviderSchema`.
10. **Docs to write when the PR is real:** `docs/threadwise-port/parity/whatsapp-cloud-api-waba.md` (intended differences: unique number per workspace, URL-key webhook auth, derived verify token, Interakt-first routing, ids verified against the token), `docs/api/whatsapp-cloud-api-waba.md`, tracker rows for `TW-WABA-004..007, 009, 011..014, 016..021, 029..031, 037, 041, 049, 051` (tracker is Vedant-only; ask him or get the sheet updated), wiring-map rows.

---

## 11. Known gaps and risks (be honest in the PR)

- Nothing here has ever talked to real Meta or Interakt. Treat sections 6.1 step 8 and the signature question as hypotheses until a real run.
- Inbound messages are acknowledged but not stored (no inbox yet).
- The Interakt partner key is stored per number (encrypted), like Geta, so the route can flip without re-onboarding; rotating the key means re-saving numbers. Alternative if that is unwanted: resolve it from env at call time (needs `WabaEngineSender` to read env too).
- The unique-number index means a number disconnected in workspace A can be claimed by B; if A reconnects later it gets `WABA_NUMBER_IN_USE`.
- `inbound_wired` is only proven `true` by a matching override URI or a real inbound message; `false` is never written automatically (Reference parity).
- No `device_limit` enforcement (a workspace can connect unlimited numbers).
- The e2e spec stubs ids as numeric strings; production ids are numeric too, but the contract rejects non-numeric ids before any call.
- The shared dev DB and the other checkouts were not touched.

---

## 12. Update (cloud session, branch `claude/compassionate-bohr-52lcqm`)

Built on top of `lakshya/waba/meta-interakt` @ `30fcee0`.

**Web (staff app)**, domain `features/whatsapp-cloud-api-waba`, routes `/channels/whatsapp` and `/channels/whatsapp/:id/health`:
numbers list with per-number actions (TW-WABA-004, 014, 016, 017, 018, 012), Embedded Signup launcher with the buffered code + `WA_EMBEDDED_SIGNUP`
message flow, double-POST guard, 15 s no-session notice and a strict `facebook.com` origin check (TW-WABA-005, 009), manual connect with
"Verify token" (006, 007), health page with issues, token replace and renew (019, 020, 021, 022). Pure Embedded Signup logic is unit tested
(`lib/embedded-signup.test.ts`). Coexistence button shows when the platform setting is on (TW-WABA-010 launch only; the chat-history sync
TW-WABA-028 is not built).

**Platform admin page (TW-WABA-001)**, `/admin/settings/whatsapp`, laid out like Reference's Settings > Channels > WhatsApp: Meta App ID, App Secret,
Embedded Signup Config ID, Graph version, coexistence, default route, Interakt solution id / partner key, system user, business id, webhook verify
token, signature requirement, plus read-only Webhook URL and Verify token with copy buttons and the quick-guide panel.

- New SET group `whatsapp` (contracts `groups.ts`; secrets: `appSecret`, `verifyToken`, `partnerAuthKey`, `systemUserToken`, stored encrypted, never returned).
  This touches the platform-settings zone (`ownership.json`: not ours): tell its owner.
- `WabaConfigService` overlays saved values on `WABA_ENV` in place every 15 s in the API and the worker. Saved non-empty value wins, otherwise the
  environment; nothing saved leaves env untouched. Env remains the fallback, so nothing already configured breaks.
- `GET /v2/platform/waba/callback` (super admin) returns the effective webhook URL and verify token.
- `WabaReadiness` gained `coexistence`; `WabaHealth` contract added; `WABA_COEXISTENCE` and `WABA_VERIFY_TOKEN` env fallbacks added.

**Not done / differences from the Reference page**

- The engines card (Twilio, Unofficial/Baileys, Business API with a default radio) is not built: Baileys is out of scope per Shubham, Twilio is another channel.
  `allowed_send_methods` and `waba_dispatch_v2_enabled` (a dead flag in Reference) are therefore absent.
- "Connected WABAs" count on the admin page needs a cross-tenant privileged count: not built.
- The health page shows only what the existing `health` endpoint returns (phone node + derived issues). Reference's WABA node, `debug_token` scopes, free
  conversation allowance, template tally, webhook apps list, verified-badge, username and calling cards (TW-WABA-021/023/024/025) are not built.
- `readiness.missing` still names env variables; the numbers page tells workspace users to ask the platform admin.
- Business profile edit UI (endpoints exist) and message QR codes are not built.
- No per-screen permission payload exists yet, so buttons are not hidden by role; the server returns 403 and the screen shows it.

**Verification run here:** web typecheck/eslint clean, 55 web tests for the touched domains pass, full API unit suite 1652 pass, `arch:check` clean.
**Not run:** the WABA e2e suite (needs Docker, none in this container; one assertion was updated for `coexistence`), the browser parity run against
the running Reference, and anything against real Meta/Interakt.
