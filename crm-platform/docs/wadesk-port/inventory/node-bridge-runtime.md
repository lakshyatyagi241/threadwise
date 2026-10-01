---
domain: node-bridge-runtime
code: NODE
title: Node Bridge Runtime and Laravel-Node Internal Contract
wadesk_version: '1.7.0'
sources_read: 92
---

# Node Bridge Runtime and Laravel-Node Internal Contract

## Overview

**What it is.** WaDesk is two processes and a database. The Laravel 12 app is the product (UI, workspaces, plans, inbox, campaigns, flows, admin). The Node bridge in `node/` (Express 5, ESM, a Baileys fork) is a long-running service that (1) holds one live WhatsApp Web socket per paired number for the "Unofficial API" engine, (2) sends for the official engines too (Cloud API and Twilio sends are made by Node using credentials it fetches from Laravel), (3) fires every time-based send with in-process timers, (4) runs the WhatsApp flow runtime, provider flow engines for Messenger/IG/TikTok/Telegram/LINE/WeChat/Viber/Email, the AI voice-call bridge and Telegram MTProto login, and (5) acts as the only clock the platform has: Laravel has NO scheduler and no queue worker, so the bridge heartbeat and a campaign drain loop drive every periodic job. The two processes talk over HTTP with one shared secret header (`X-Node-Token`) and no shared login.

**Who uses it.** No end user ever sees it. Operators and installers run it (pm2, cPanel Node App, LiteSpeed). Super-admins configure its URL, token and pacing in Admin → Channel Settings. Every workspace member's send, schedule, broadcast, flow, pairing and call goes through it. Customers' messages arrive through it.

**Main flow end to end.**

1. Installer writes `PORT`, `DOMAIN_NAME`, `APP_DOMAIN_NAME`, `NODE_WEBHOOK_TOKEN` into `node/.env` and the same token plus `SERVER_URL` into the Laravel `.env` (WD-NODE-001/002/052).
2. Boot: the bridge pulls global settings from Laravel, restores healthy saved sessions from `baileys_auth/`, re-registers active schedules, then starts the settings-refresh, heartbeat and campaign-drain loops (WD-NODE-005/007).
3. A workspace member adds a device: Laravel calls `initialize-client` or `get-pairing-code`; the bridge builds a socket, returns QR or code, and pushes status strings to `update-status` until `Ready` (WD-NODE-008..012). Optional per-number proxy is enforced fail-closed (WD-NODE-013).
4. Inbound: every customer message is normalized and posted to `inbound-message`; the bridge then runs keyword auto-reply or flow logic; phone-typed and bot-sent messages are mirrored back; receipts feed ticks (WD-NODE-016..020).
5. Outbound: Laravel dispatchers call the send endpoints; the bridge picks the engine from the payload's `provider`, applies footers, pacing and per-socket serialization, and sends (WD-NODE-022..029).
6. Time-based work: schedules, recurring runs, broadcasts are registered in memory as cron tasks and executed with jittered pacing and per-recipient callbacks; campaigns are driven by Laravel and drained by the bridge loop (WD-NODE-030..040).
7. Flows: Laravel starts/resumes/ends sessions and the runtime calls back for tags, assignments, AI, Google, commerce, booking, ordering and calls (WD-NODE-041..050).
8. Every 30 s the heartbeat marks device liveness and triggers the platform's sweeps (WD-NODE-014).

**How plan tiers change it.** The bridge itself is not plan-gated. The gates live on the Laravel side and shape what reaches it: `device_limit` at connect, `monthly_messages_limit` with wallet overflow billing on schedule callbacks and dispatchers, branding footer removal per plan (`BrandingFooterService`), `access_sales_pipeline` for the flow deal node, `access_appointment_booking` and `appointments_limit` for booking, Google integration toggles, per-workspace or admin AI keys for AI nodes. Platform admins bypass plan limits (RBAC).

**Connections to other domains.** WADEV (devices, proxy, pairing UI), NODE owns the runtime behind it; WABA/BSP (Cloud API creds, Meta errors, call webhooks); SCHED, BCAST, CAMP (the three time-based engines and their sweepers); CHAT, TIB1, TIB2 (inbound ingestion, dispatchers, receipts, AI hand-off); AR, FLB, FLR (keyword rules, flow definitions, runtime services); WALLET (billing settle on receipts); INST and SET/ASHELL (env writing, admin panel, health card); channel domains FB, IG, TG, TT, LINE, WECH, VIB, MAIL (flow bridges and callbacks); INTG, APPT, CHK, CAT, ECOM, WFL, CALL, AIAG, AIADM (services behind the flow-node endpoints); API/MOB (mobile app calls the same Node endpoints through Laravel).

**What the port should do with it.** The Express bridge, its 90 endpoints, the shared-secret handshake, the heartbeat-as-scheduler and all in-memory state are implementation artifacts of a PHP host that cannot hold sockets or run timers. The behaviors to keep are: the socket lifecycle and close-code policy, pairing and QR/proxy rules, inbound normalization and stale-replay protection, engine routing, footer/button/media formatting, send safety (jitter, serialization, daily cap applied uniformly, liveness gates), receipt monotonicity and idempotent dedup keys, scheduler semantics with timezones, and the fail-closed security defaults. Target shape: a NestJS `whatsapp-worker` app owning Baileys sockets (one lease per device in Redis, auth state in encrypted Postgres rows), BullMQ queues for send/schedule/broadcast/campaign jobs (delayed and repeatable jobs replace node-cron, the heartbeat sweeps and the boot sync), inbound and receipt events published to the API through the outbox, and provider adapters (Baileys, Cloud API, Twilio) behind one interface. Where a Laravel-to-Node HTTP hop remains, use authenticated internal transport with per-request idempotency keys.

**Effort/size note.** 54 features: the runtime core (lifecycle, inbound, send, safety) is the risky XL work; the callback contracts collapse into module-internal calls in the new stack.

## Feature index

| Id          | Feature                                                                                                                        | Status      | Priority | Effort | Depends on                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------- | -------- | ------ | -------------------------------------------------- |
| WD-NODE-001 | Bridge process, entrypoints and configuration                                                                                  | implemented | P0       | M      | —                                                  |
| WD-NODE-002 | Shared-secret authentication between Laravel and the bridge                                                                    | implemented | P0       | M      | WD-NODE-001                                        |
| WD-NODE-003 | CORS policy and request body limits                                                                                            | implemented | P2       | S      | WD-NODE-001                                        |
| WD-NODE-004 | Health, root status and diagnostic endpoints                                                                                   | implemented | P1       | S      | WD-NODE-002                                        |
| WD-NODE-005 | Startup sequence, timers and in-memory state registry                                                                          | implemented | P0       | L      | WD-NODE-001, WD-NODE-002                           |
| WD-NODE-006 | Graceful shutdown and process error handling                                                                                   | implemented | P1       | S      | WD-NODE-005                                        |
| WD-NODE-007 | Restore paired devices from disk at boot                                                                                       | implemented | P0       | M      | WD-NODE-005, WD-NODE-011                           |
| WD-NODE-008 | Start a device connection and obtain a QR (`initialize-client`)                                                                | implemented | P0       | M      | WD-NODE-011, WD-NODE-002                           |
| WD-NODE-009 | Request a phone-number pairing code (`get-pairing-code`)                                                                       | implemented | P1       | M      | WD-NODE-008                                        |
| WD-NODE-010 | Client status, terminate, connectivity check and contact export                                                                | implemented | P0       | M      | WD-NODE-008                                        |
| WD-NODE-011 | Baileys socket lifecycle: configuration, reconnect policy and watchdogs                                                        | implemented | P0       | XL     | WD-NODE-001                                        |
| WD-NODE-012 | Connection status reporting and Laravel status ingestion (`update-status`)                                                     | implemented | P0       | M      | WD-NODE-011, WD-NODE-002                           |
| WD-NODE-013 | Per-number proxy / IP isolation                                                                                                | implemented | P1       | M      | WD-NODE-011                                        |
| WD-NODE-014 | Node heartbeat: device liveness and the platform's only scheduler tick                                                         | implemented | P0       | L      | WD-NODE-005, WD-NODE-002                           |
| WD-NODE-015 | Campaign drain loop (`campaigns/drain`)                                                                                        | implemented | P1       | M      | WD-NODE-014                                        |
| WD-NODE-016 | Inbound message capture and forwarding (Baileys to Laravel)                                                                    | implemented | P0       | XL     | WD-NODE-011, WD-NODE-017                           |
| WD-NODE-017 | `inbound-message` endpoint contract (Laravel side)                                                                             | implemented | P0       | L      | WD-NODE-016, WD-NODE-002                           |
| WD-NODE-018 | Outbound echo sync, group inbound storage and bot-reply mirroring                                                              | implemented | P0       | M      | WD-NODE-016, WD-NODE-017                           |
| WD-NODE-019 | Keyword auto-reply and flow triggering inside the bridge                                                                       | implemented | P0       | L      | WD-NODE-016                                        |
| WD-NODE-020 | Delivery and read receipts to Laravel                                                                                          | implemented | P0       | M      | WD-NODE-011, WD-NODE-037                           |
| WD-NODE-021 | WhatsApp group directory sync and group management API                                                                         | implemented | P1       | L      | WD-NODE-011, WD-NODE-002                           |
| WD-NODE-022 | Outbound text send and engine routing (`send-message`)                                                                         | implemented | P0       | L      | WD-NODE-011, WD-NODE-024, WD-NODE-026, WD-NODE-027 |
| WD-NODE-023 | Outbound media sends (`send-media-only`, `send-media-message`)                                                                 | implemented | P0       | L      | WD-NODE-022, WD-NODE-028                           |
| WD-NODE-024 | Location, contact card, group message and product catalog sends                                                                | implemented | P1       | M      | WD-NODE-022                                        |
| WD-NODE-025 | Message actions: react, pin, star, edit, delete                                                                                | implemented | P1       | M      | WD-NODE-022                                        |
| WD-NODE-026 | Per-number settings cache, `whatsapp-settings` endpoint and cache busting                                                      | implemented | P0       | L      | WD-NODE-002                                        |
| WD-NODE-027 | Cloud API and Twilio direct senders inside the bridge                                                                          | implemented | P1       | M      | WD-NODE-026                                        |
| WD-NODE-028 | Media fetch safety: SSRF guard, local-path containment, MIME detection, HTTPS rule                                             | implemented | P0       | M      | WD-NODE-023                                        |
| WD-NODE-029 | Send safety and pacing: jitter, per-socket serialization, daily cap, batching, admin pacing                                    | implemented | P0       | L      | WD-NODE-011                                        |
| WD-NODE-030 | Node scheduler core: in-memory queue, cron construction and firing rules                                                       | implemented | P0       | L      | WD-NODE-005                                        |
| WD-NODE-031 | One-off bulk scheduled send and immediate bulk send                                                                            | implemented | P0       | L      | WD-NODE-030, WD-NODE-029                           |
| WD-NODE-032 | Recurring scheduled sends                                                                                                      | implemented | P1       | M      | WD-NODE-031                                        |
| WD-NODE-033 | Single scheduled message (`schedule-message`) and its execution                                                                | partial     | P1       | S      | WD-NODE-030                                        |
| WD-NODE-034 | Schedule lifecycle endpoints and the `NodeSchedulerClient`                                                                     | partial     | P1       | S      | WD-NODE-030                                        |
| WD-NODE-035 | Schedule status callbacks (`update-schedule-status`, `update-scheduled-contact-status`)                                        | implemented | P0       | M      | WD-NODE-031                                        |
| WD-NODE-036 | Active-schedule sync at boot (`scheduled/active`)                                                                              | implemented | P0       | M      | WD-NODE-030                                        |
| WD-NODE-037 | Broadcast execution engine and lifecycle endpoints                                                                             | implemented | P0       | L      | WD-NODE-029, WD-NODE-030                           |
| WD-NODE-038 | Broadcast status callbacks (`update-message-status`, `update-broadcast-status`)                                                | implemented | P0       | M      | WD-NODE-037                                        |
| WD-NODE-039 | Node-side campaign engine and its routes                                                                                       | dead-code   | P2       | S      | WD-NODE-030                                        |
| WD-NODE-040 | Campaign callbacks and receipt hooks that are live (`campaigns/*`)                                                             | implemented | P1       | M      | WD-NODE-020, WD-NODE-015                           |
| WD-NODE-041 | Flow start, resume and end endpoints on the bridge                                                                             | implemented | P0       | L      | WD-NODE-002, WD-NODE-043                           |
| WD-NODE-042 | WABA and Twilio inbound handoff to the flow engine (`flow/provider-inbound`)                                                   | implemented | P0       | M      | WD-NODE-041                                        |
| WD-NODE-043 | Flow definition, workspace attributes, template data and media-store endpoints                                                 | implemented | P0       | M      | WD-NODE-002                                        |
| WD-NODE-044 | Flow-node action endpoints (tag, assign, deal, AI, web search, MySQL, Meet, WhatsApp form)                                     | implemented | P1       | L      | WD-NODE-002, WD-NODE-041                           |
| WD-NODE-045 | Natural-language ordering endpoints (`order-parse`, `order-shipping`, `order-confirm`, `order-cancel`, `order-reply`)          | implemented | P2       | L      | WD-NODE-044                                        |
| WD-NODE-046 | Google Sheets, Docs and Forms bridge for flows                                                                                 | implemented | P1       | L      | WD-NODE-041                                        |
| WD-NODE-047 | Commerce endpoints for flows (`checkout-link`, `waba-send-products`, `check-inventory`)                                        | implemented | P1       | M      | WD-NODE-041                                        |
| WD-NODE-048 | Booking and appointment endpoints for flows                                                                                    | implemented | P1       | L      | WD-NODE-041                                        |
| WD-NODE-049 | WhatsApp calling bridge (AI voice pickup) contract                                                                             | implemented | P2       | XL     | WD-NODE-002                                        |
| WD-NODE-050 | Channel flow engines: Node inbound handoff and Laravel callbacks (IG, Messenger, TikTok, Telegram, LINE, WeChat, Viber, Email) | implemented | P1       | XL     | WD-NODE-041, WD-NODE-002                           |
| WD-NODE-051 | Telegram user-account (MTProto) bridge                                                                                         | implemented | P2       | M      | WD-NODE-002                                        |
| WD-NODE-052 | Admin Node-bridge settings and connection test                                                                                 | implemented | P0       | S      | WD-NODE-002, WD-NODE-004                           |
| WD-NODE-053 | Developer file-sync endpoint (`wd-sync`)                                                                                       | dead-code   | P2       | S      | —                                                  |
| WD-NODE-054 | Node smoke and regression test scripts                                                                                         | implemented | P2       | S      | —                                                  |

## Features

### WD-NODE-001 — Bridge process, entrypoints and configuration

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** —
- **Summary:** The bridge is a standalone long-running Node service (Express 5, ESM, Baileys fork) that lives in `node/` inside the Laravel tree. It holds every WhatsApp Web socket, runs all time-based sends, and is the only place that talks to Baileys. It is configured by a tiny `.env` and started through one of four entrypoints depending on the host.
- **Actors & access:** Operator / installer (process manager: pm2, cPanel "Setup Node.js App", LiteSpeed/Passenger, Hostinger). No end-user screen. The installer (`InstallController::writeNodeEnv`, owned by INST) writes `PORT`, `DOMAIN_NAME`, `APP_DOMAIN_NAME`, `NODE_WEBHOOK_TOKEN` to `node/.env` by read-merge-write (default port 8888 when blank).
- **UX & screens:** None. Console only. `log-gate.js` is imported first and would silence `console.log/info/debug` unless `WADESK_LOGS=on`, but the silencer block is commented out in v1.7.0, so all logs print (campaign-send debugging left on); `console.error/warn` always print and are what ops grep in the process manager log.
- **Endpoints:** none of its own; see WD-NODE-004 for `/` and `/health`.
- **Data:** No database. State is (a) in-memory maps on `app.locals` (WD-NODE-005) and (b) on disk under `node/baileys_auth/session_<digits>/` (Baileys multi-file auth: `creds.json`, signal key files, app-state files, plus bridge files `baileys_store.json` and `proxy.json`; WD-NODE-011/013). `node/baileys_auth` ships empty. `node/.env` in the reference tree carries only the four installer keys.
- **Rules & edge cases:**
  1. Entrypoints: `node index.js` (direct / pm2); `server.cjs` and `app.cjs` are identical CommonJS shims that `import('./index.js')` (needed because hosts that `require()` the start file choke on the ESM graph with top-level await, ERR_REQUIRE_ASYNC_MODULE / ERR_REQUIRE_ESM); on import failure they log and `process.exit(1)`. `index-cpanel.js` is a byte-for-byte copy of `index.js` plus one middleware that strips a leading `/node` from `req.url` (`/node` and `/node/` become `/`) so the app can sit under a `/node` sub-path behind cPanel/Passenger.
  2. Listening port = `PORT` env, default 3000 (docs and installer default to 8888). `config/config.js` exposes `PORT`, `DOMAIN_NAME` (the bridge's own public URL; only informational) and `APP_DOMAIN_NAME` (Laravel base URL every callback goes to, default `localhost` in index.js).
  3. Environment keys the runtime reads (node side): `PORT`, `DOMAIN_NAME`, `APP_DOMAIN_NAME`, `APP_URL` (fallback when a channel-flow request omits `appDomain`), `NODE_WEBHOOK_TOKEN`, `NODE_API_AUTH` (`loopback` default | `token` | `off`), `ALLOWED_ORIGINS`, `MEDIA_READ_BASES`, `BAILEYS_LOG_LEVEL` (pino level, default `warn`), `FACEBOOK_API_VERSION`, `WADESK_LOGS`, `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`, and the WABA-call keys `WABA_CALL_TURN_URL/USER/PASS`, `WABA_CALL_MAX_MIN`, `WABA_CALL_REC_MAX_MIN`, `WABA_CALL_REC_STALE_HOURS` (CALL domain).
  4. Laravel finds the bridge through `wd_node_url()`: system setting `baileys_server_url` first, `.env SERVER_URL` second, trailing slash stripped. A per-connection `server_url` stored in `wa_provider_configs` credentials is used by the connect wizard (WD-NODE-008).
  5. `package.json` is `type: module` with no scripts. Runtime deps: `baileys` (WhiskeySockets git) and `@itsukichan/baileys` (fork; the code imports only the fork), express 5, cors, axios, node-cron 4, moment-timezone, pino 8, https-proxy-agent + socks-proxy-agent, teleproto (MTProto), `@roamhq/wrtc` (voice calls), ws, sharp, unfurl.js, `@distube/ytdl-core`, fs-extra, qrcode-terminal, dotenv. `@hapi/boom` is imported but only present transitively. `sharp`, `unfurl.js`, `ytdl-core` have no direct use in the files read.
  6. `node/utils/helpers.js` begins with about 265 lines of the previous version left commented out; `classes/BaileysClientManager.backup.js` is a stale copy (excluded from the manifest).
- **Async & events:** none (see WD-NODE-005 for timers).
- **External systems:** GitHub-hosted Baileys forks (build-time), WhatsApp Web (runtime), Laravel (`APP_DOMAIN_NAME`).
- **Settings:** env keys above; Laravel `system_settings.baileys_server_url`, `.env SERVER_URL`, `NODE_WEBHOOK_TOKEN` (WD-NODE-002, WD-NODE-052).
- **Acceptance criteria:**
  - Given `node/.env` with PORT, APP_DOMAIN_NAME and NODE_WEBHOOK_TOKEN set, when `node index.js` (or `server.cjs`) is started, then the service listens on PORT and `GET /` returns the status JSON of WD-NODE-004.
  - Given the cPanel entrypoint `index-cpanel.js`, when a request arrives for `/node/health`, then it is served as `/health`.
  - Given `PORT` unset, when the process starts, then it listens on 3000.
  - Given `import('./index.js')` rejects at boot, when using `server.cjs`, then the process exits non-zero with a bootstrap error line.
- **Source refs:** node/index.js, node/index-cpanel.js, node/server.cjs, node/app.cjs, node/log-gate.js, node/config/config.js, node/.env, node/package.json, node/package-lock.json, app/Support/fc_helpers.php (`wd_node_url`), app/Http/Controllers/InstallController.php (`writeNodeEnv`), Documentation/pages/developer-guide/node-bridge.html
- **Port notes:** Do not port the Express process as-is. Target: a NestJS worker app (`apps/worker` or `apps/whatsapp-bridge`) owning Baileys sockets, fed by BullMQ queues and Redis; expose only the small internal control surface that is still needed (start/stop/pair/status/send) over an authenticated internal transport. Keep entrypoint shims, `/node` prefix stripping and `index-cpanel.js` out of scope (cPanel hosting is not a target). Auth state must not live on local disk in multi-instance deployments (WD-NODE-011). Check the worker/outbox design before designing.

### WD-NODE-002 — Shared-secret authentication between Laravel and the bridge

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-NODE-001
- **Summary:** One shared secret, header `X-Node-Token`, authenticates both directions. Laravel resolves it through `node_token()`, the bridge reads `NODE_WEBHOOK_TOKEN` from its own env. Node guards its whole `/api/*` surface with an app-level middleware (default mode also trusts loopback peers) and Laravel guards every Node-facing route with a constant-time compare that fails closed on an empty secret.
- **Actors & access:** Super-admin sets/rotates the token in Admin → Channel Settings (WD-NODE-052); installer generates it (64 hex chars). No workspace-level access.
- **UX & screens:** Admin Channel Settings node panel only (WD-NODE-052). Token field is masked and blank on load; blank submit keeps the stored value.
- **Endpoints:** applies to every route in this file. Laravel side statuses on a bad or missing token: `api/update-status`, `node-heartbeat`, `devices/proxy-*`, `whatsapp-settings`, `whatsapp-message-settings`, `update-message-status`, `update-broadcast-status`, `chat/message-status`, `campaigns/*` respond 403 `{ok:false,message:forbidden}`; `scheduled/active`, `update-schedule-status`, `update-scheduled-contact-status` `abort(403)`; `inbound-message`, `flows/{id}` (`{success:false}`), `flow-node/*`, `commerce/*`, `booking/*`, `appointments/book`, `groups/sync`, `campaigns/sync`, `templates-camp`, `workspace-attributes`, `flow/store-media` respond 401; `keyword-replies` responds 401 with a one-element array body. Node side: 401 `{ok:false,error:"unauthorized"}`.
- **Data:** `system_settings.node_webhook_token` (encrypted at rest, listed in `SystemSetting::ENCRYPTED_KEYS`), legacy `system_settings.baileys_callback_token`, `.env NODE_WEBHOOK_TOKEN`, node `.env NODE_WEBHOOK_TOKEN`.
- **Rules & edge cases:**
  1. Laravel `node_token()` resolution order: DB `node_webhook_token`, then DB `baileys_callback_token`, then env `NODE_WEBHOOK_TOKEN`; DB read errors fall through to env. The Node side reads only its own env, so a DB-only change on Laravel without editing `node/.env` breaks every callback (401/403) and stops all scheduled campaigns (heartbeat dies). Saving in the admin panel also mirrors the value into the Laravel `.env` through `EnvWriter::set` (best-effort, silent on failure); it never writes `node/.env`.
  2. Laravel guards use `hash_equals`; an empty configured secret rejects everyone (fail closed). Exception: `WaGroupController::authed` reads `env('NODE_WEBHOOK_TOKEN')` directly (not `node_token()`), so `groups/sync` ignores a DB-set token and, with `config:cache`, sees an empty env (QUIRK; sync then 401s).
  3. Node `apiTokenGuard` on `/api` (registered before every `/api` route, including the ones declared in `index.js`): OPTIONS passes; mode `off` passes everything; otherwise the token is read from header `x-node-token` OR body field `node_token` (so header-stripping proxies cannot lock the bridge out) and compared with `timingSafeEqualStr` (length-checked `crypto.timingSafeEqual`; empty on either side never matches); if that fails and mode is not `token`, a loopback peer (`::1`, `127.*`, IPv4-mapped) is trusted; else 401. Default mode `loopback`; set `NODE_API_AUTH=token` when Node runs off-host.
  4. QUIRK (security): in `loopback` mode a reverse proxy on the same host (Passenger/nginx in front of Node) makes every request look like `127.0.0.1`, so the guard is bypassed for the public. Anything exposing Node through a same-host proxy must use `NODE_API_AUTH=token`.
  5. Several handlers re-check the token themselves with a plain `!==` compare on the header only (`flow/resume-port`, `resume-by-phone`, `resume-form`, `flow-resume`, `flow-end`, `flow/provider-inbound`, all `*-flow/inbound`, `telegram-account/*`); in loopback mode these still require the header even though the guard would let loopback through. `/api/groups/*` uses a third guard (`nodeTokenGuard`, header only, timing-safe). `cache-bust` checks header only.
  6. Laravel attaches the token to outbound calls in two ways: explicit `withHeaders(['X-Node-Token' => node_token()])` at most call sites, plus a global `Http::globalRequestMiddleware` (AppServiceProvider) that adds the header to ANY outbound request whose host and port equal the configured bridge URL when it is not already set. The host/port is resolved once per process (static cache), so a URL change needs a worker restart under long-running servers.
  7. The WABA-call routes also carry `node_token` in the JSON body (Laravel sends both; Node `authed()` accepts either).
  8. If the token is unset on the Node side, `laravelHeaders()` sends no header; Laravel then rejects (403) because it fails closed. The docs claim "dev fallback: unset means accept any caller"; that is false for every route read in v1.7.0.
  9. Failure diagnostics: `logLaravelError` prints URL, whether a token was sent, its length and first/last characters, HTTP status and body, and a hint that a DB-stored `node_webhook_token` overrides `.env`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `system_settings.node_webhook_token`, `.env NODE_WEBHOOK_TOKEN`, node `NODE_WEBHOOK_TOKEN`, `NODE_API_AUTH`.
- **Acceptance criteria:**
  - Given Laravel and Node hold the same secret, when Node POSTs `/api/update-status` with the header, then Laravel returns 200 JSON.
  - Given Laravel's resolved secret is empty, when any Node-facing route is called (even with an empty header), then it is rejected.
  - Given `NODE_API_AUTH=token`, when a loopback caller omits the token, then Node returns 401; given the default mode and a loopback caller without token, then the request passes the guard.
  - Given the token is sent only in body field `node_token` on `/api/waba-call/answer`, then Node accepts it.
  - Given an OPTIONS preflight to any `/api` path, then it passes without a token.
- **Source refs:** node/routes/index.js, node/utils/helpers.js (`laravelHeaders`, `timingSafeEqualStr`, `logLaravelError`), app/Support/fc_helpers.php (`node_token`), app/Support/EnvWriter.php, app/Providers/AppServiceProvider.php, app/Models/SystemSetting.php, app/Http/Controllers/WaGroupController.php, app/Http/Controllers/AdminPagesController.php (`settingsNodeBridgeUpdate`), bootstrap/app.php, Documentation/pages/developer-guide/node-bridge.html
- **Port notes:** Replace the shared secret with service-to-service auth suited to the new stack (mTLS or signed JWT with rotation) if a network hop remains; if the bridge becomes an in-process module or queue consumer, this feature disappears. Never store the secret in a mutable admin setting that the receiver does not see. Keep one resolver (no env vs DB split). Add a startup self-check that fails loudly when the two sides disagree.

### WD-NODE-003 — CORS policy and request body limits

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-NODE-001
- **Summary:** The bridge answers browser cross-origin calls (the browser extension and local dev pages) with a dynamic allow-list and accepts very large JSON bodies for base64 media.
- **Actors & access:** Browser origins; security boundary is the token, not CORS.
- **UX & screens:** none.
- **Endpoints:** applies to all.
- **Data:** none.
- **Rules & edge cases:**
  1. Body parsers: JSON and urlencoded, limit `50mb` each.
  2. `cors` methods GET/POST/PUT/DELETE; allowed headers `Content-Type`, `Authorization`, `X-Node-Token`, `X-Requested-With`.
  3. Origin check order: no `Origin` header passes; `chrome-extension://` and `moz-extension://` always pass; if `ALLOWED_ORIGINS` is empty or contains `*`, every origin passes (default); otherwise localhost/127.0.0.1 on any port pass, then the set `{APP_DOMAIN_NAME, ...ALLOWED_ORIGINS}` (trailing slashes stripped) passes; a blocked origin logs a warning and gets no CORS headers.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `ALLOWED_ORIGINS` (comma list), `APP_DOMAIN_NAME`.
- **Acceptance criteria:**
  - Given default env, when any origin sends a request, then CORS headers allow it.
  - Given `ALLOWED_ORIGINS=https://a.com`, when `https://b.com` calls, then no allow-origin header is returned and a warning is logged.
  - Given a 40 MB base64 media POST, then the body is accepted.
- **Source refs:** node/index.js, node/index-cpanel.js
- **Port notes:** Not needed if the bridge is internal-only. If any browser client talks to it (the extension does not; it talks to Laravel `ext.*`), route through the API gateway.

### WD-NODE-004 — Health, root status and diagnostic endpoints

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-NODE-002
- **Summary:** Small read-only endpoints let operators and Laravel confirm the bridge is alive, see connected devices and cached settings, and force a settings re-pull.
- **Actors & access:** `/` and `/health` are outside `/api` and therefore unauthenticated; the `/api/*` ones sit behind the guard of WD-NODE-002. Laravel's admin health page (`Admin/HealthController::checkNode`, ASHELL) pings `GET {node}/` with the token and treats any HTTP response as "up", showing status and latency; connection refusal is "down".
- **UX & screens:** Admin health card "Node bridge" (owned by ASHELL); no bridge UI.
- **Endpoints:**

| Method uri                          | Auth  | Response                                                                                                                                                                                                             |
| ----------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                             | none  | `{message:"Server Working Fine with Baileys", status:200, version:"@itsukichan/baileys", activeClients, activeSessions, connectionLocks, whatsappApi:"Facebook"                                                      | "Baileys", messageSettings:{msg_gap:"3s", batch_enabled, messages_per_batch, batch_gap:"5min"}}` |
| `GET /health`                       | none  | `{status:"healthy", uptime, timestamp, activeDevices, readyDevices, activeFlowSessions, activeCooldowns, connectionLocks, scheduledMessages, memoryUsage, whatsappSettings:{api,lastFetched}, messageSettings{...}}` |
| `GET /api/current-settings`         | guard | `{success, settings:{use_facebook_api, has_facebook_credentials, last_fetched}}` (boot-time global cache, not per phone)                                                                                             |
| `GET /api/current-message-settings` | guard | `{success, settings:{msg_gap, enable_batches, batches_gap, bw_msg_gap, bw_msg_gap_ms, last_fetched}}`                                                                                                                |
| `GET /api/refresh-settings`         | guard | re-pulls both global settings synchronously; `{success:true,message,whatsappSettings,messageSettings}` or 500 `{success:false,message,error}`                                                                        |

- **Data:** in-memory only.
- **Rules & edge cases:**
  1. `whatsappApi` in `/` and `/health` reflects the boot-time GLOBAL WABA toggle (`use_facebook_api` from a phone-less `/api/whatsapp-settings` call = admin `default_send_method === 'waba'`), not any per-number state.
  2. `refresh-settings` calls `fetchWhatsAppSettings` (timeout 50 s) and `fetchMessageSettings` (5 s) in parallel; each failure is swallowed (logged, defaults kept) so the endpoint still answers `success:true` even when Laravel was unreachable. Laravel's "Update timing" and "Test connection" buttons use it (`NodeCacheBuster::refreshNodeSettings` returns the echoed `messageSettings` so the admin sees what value landed; timeout 4 s).
  3. `/` is also what the admin "Test connection" uses indirectly: `testNodeBridge` calls `/api/refresh-settings` with the typed URL/token; 401/403 is reported as "token rejected".
- **Async & events:** none.
- **External systems:** Laravel `/api/whatsapp-settings`, `/api/whatsapp-message-settings`.
- **Settings:** msg_gap, batches_gap, bw_msg_gap, enable_batches (WD-NODE-029).
- **Acceptance criteria:**
  - Given the bridge is up, when `GET /health` is called without a token, then it returns `status:"healthy"` with device and flow counts.
  - Given Laravel is down, when `GET /api/refresh-settings` runs, then it still returns `success:true` with the previously cached values.
  - Given a paired and ready device, when `/health` is read, then `readyDevices` counts only entries with `client_ready === true`.
- **Source refs:** node/index.js, app/Http/Controllers/Admin/HealthController.php, app/Services/NodeCacheBuster.php, app/Http/Controllers/AdminPagesController.php (`testNodeBridge`)
- **Port notes:** Expose `/healthz` (liveness) and `/readyz` (Redis + DB + Baileys manager) on the worker; per-device state should come from the `devices` table plus a Redis presence key, not process memory.

### WD-NODE-005 — Startup sequence, timers and in-memory state registry

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-NODE-001, WD-NODE-002
- **Summary:** On boot the bridge loads platform settings, restores paired devices, restores schedules, then starts the background loops that keep Laravel's view fresh and drive every time-based feature. All bridge state lives in `app.locals` and is lost on restart unless re-hydrated from Laravel.
- **Actors & access:** none (system).
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** `app.locals` maps: `clients{phone:sock}`, `client_ready{phone:bool}`, `clientManagers{phone:BaileysClientManager}`, `connectionLocks{phone:epochMs}`, `activeFlowSessions{"<device>_<customer>":session}`, `userCooldowns{"<device>_<customer>":{endTime,cooldownSeconds}}`, `scheduledMessages[]` (rows of type bulk, recurring, single, broadcast, campaign), `scheduledJobs{id:cronTask}`, `whatsappSettings`, `messageSettings`, `appDomainName`; also `global.appLocals` for helpers and the `_dailyTally{phone:{YYYY-MM-DD:n}}` counter. Module-level maps: per-phone settings cache (`__settingsCache`), workspace-attribute cache (60 s), group "recently left" ledger (30 s), MTProto login maps.
- **Rules & edge cases:**
  1. Boot order inside `app.listen` callback: fetch global WhatsApp settings; fetch message pacing settings; `restoreSessions()` (WD-NODE-007); `syncCampaignSchedules` (GET `api/campaigns/sync`, which returns an empty list, see WD-NODE-039); `syncScheduledMessages` (GET `api/scheduled/active`, WD-NODE-036); then start `startSettingsRefreshLoop`, `startDeviceHeartbeat`, `startCampaignDrainLoop`. The HTTP port is already listening before this finishes, so early requests see empty state.
  2. Timers: connection locks swept every 5 min (locks older than 5 min removed); flow sessions swept every 30 min (removed when older than 60 min, or completed for more than 5 min, or status `timeout`; their timeout timers cleared); cooldowns swept every 10 min; global settings auto-refresh hourly; per-phone settings warm loop every 5 min for every connected phone (errors swallowed, stale served); heartbeat every 30 s (WD-NODE-014); campaign drain every 30 s calm / 4 s fast (WD-NODE-015); per-manager health watchdog 60 s and store save 10 s (WD-NODE-011); group recently-left sweep 60 s (unref'd).
  3. Fetch timeouts: global WhatsApp settings 50 s (a value chosen for slow shared hosts), message settings 5 s. Both fall back to defaults on any error (`use_facebook_api:false`, gap 3 s, batches off, 50 per batch, 5 min between batches).
  4. Session key format: `<devicePhoneDigits>_<customerDigits>`; Baileys path uses the digits from the JID (may be a LID), provider path digit-normalizes both halves, flow-start path digit-normalizes both.
  5. QUIRK: `performClientCleanup` (used at shutdown) removes scheduled messages with `msg.phoneNumber` and jobs at `scheduledJobs[phone]`, but scheduled rows use `senderPhoneNumber` and job maps are keyed by schedule id, so nothing is actually cancelled; harmless only because the process is exiting.
  6. `utils/cleanup.js` also exports `getSessionStats`, `cleanupExpiredSessions` and a response-writing `deleteSessionFiles`; none are referenced (dead code).
- **Async & events:** the timers above; outbound HTTP to Laravel.
- **External systems:** Laravel (all callbacks).
- **Settings:** see WD-NODE-029.
- **Acceptance criteria:**
  - Given a fresh start with Laravel reachable, when the ready log line prints, then settings, sessions and schedules have been loaded in that order.
  - Given Laravel is unreachable at boot, then the bridge still starts with default settings and retries on the hourly/5-minute loops.
  - Given a flow session older than 60 minutes, when the 30-minute sweep runs, then it is deleted and its timer cleared.
  - Given no device is connected, when the heartbeat interval fires, then no heartbeat is sent (WD-NODE-014).
- **Source refs:** node/index.js, node/utils/cleanup.js, node/utils/helpers.js (`getWhatsAppSettings`), node/controllers/groupController.js
- **Port notes:** Every in-memory map has a durable equivalent in the target: device presence and connection locks in Redis (`SET NX PX`), schedules as BullMQ delayed/repeatable jobs (persisted, no rehydrate step), flow sessions in Postgres `flow_sessions` with TTL (owned by FLR), cooldowns in Redis. Nothing here should need a "boot sync".

### WD-NODE-006 — Graceful shutdown and process error handling

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-NODE-005
- **Summary:** SIGINT and SIGTERM close every Baileys socket without logging the phone out, so pairings survive a restart; unhandled errors are logged and never crash the process.
- **Actors & access:** process manager.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** session folders stay on disk.
- **Rules & edge cases:**
  1. `gracefulShutdown` is single-shot (`__shuttingDown`), soft-disconnects each client through `performClientCleanup` (calls `softDisconnect()`: sets `shuttingDown`, stops timers, writes the store file, closes the websocket; falls back to `logout()` only if `softDisconnect` is missing), clears flow-session timers, then `process.exit(0)`. Old code used `logout()` here, which sent the "unlink device" RPC and wiped sessions on every restart.
  2. The manager's close handler returns early when `shuttingDown` is set (no file wipe, no reconnect).
  3. `uncaughtException` and `unhandledRejection` are only logged. Express error middleware returns 500 `{error:"Internal Server Error", message}` (leaks the error message).
  4. In-flight sends, flow sessions and cooldowns are lost at exit (memory only); pending cron jobs are lost until the next boot sync.
- **Async & events:** none.
- **External systems:** WhatsApp Web (socket close).
- **Settings:** none.
- **Acceptance criteria:**
  - Given three connected devices, when SIGTERM arrives, then each socket closes, session folders remain, and on restart all three restore without a QR.
  - Given an uncaught exception in a handler, then the process keeps running and the error is logged.
- **Source refs:** node/index.js, node/utils/cleanup.js, node/classes/BaileysClientManager.js (`softDisconnect`)
- **Port notes:** In NestJS use `enableShutdownHooks` and a `OnApplicationShutdown` that releases device leases in Redis so another worker can adopt the sockets; do not close sessions with a logout.

### WD-NODE-007 — Restore paired devices from disk at boot

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-NODE-005, WD-NODE-011
- **Summary:** After a restart the bridge reconnects every healthy saved session automatically, marks broken ones Disconnected in Laravel, and warms the settings cache so first sends do not wait on Laravel.
- **Actors & access:** system.
- **UX & screens:** Devices screen (WADEV) shows the resulting status.
- **Endpoints:** calls `POST api/update-status` for dead sessions.
- **Data:** `node/baileys_auth/session_<phone>/` folders.
- **Rules & edge cases:**
  1. Every directory whose name starts with `session_` is a candidate; phone = the suffix.
  2. A folder is healthy when it holds at least 3 entries (creds plus keys). Fewer means the phone logged the device out or pairing never finished: the folder is NOT restored and Laravel is told `Disconnected` (progress 0). Unreadable folders are skipped with a log.
  3. Healthy sessions get a new `BaileysClientManager` and `start()`, staggered by 2 s to avoid CPU spikes; failures are logged per phone and do not stop the loop. Already-present clients are skipped.
  4. QUIRK: restored managers are NOT registered in `app.locals.clientManagers` by `restoreSessions` (only `clients`/`client_ready` are set inside `start()`), so `client-status` shows no QR/code for them, `terminate-client` reports `not_found` (no logout, folder kept), `get-contacts` answers 400 "Store not available", and the shutdown cleanup (which walks `clientManagers`) skips them. Worse, if such a device is not ready and someone calls initialize-client, a SECOND manager and socket are built while the first manager's health watchdog is still alive (duplicate sockets). Only devices paired since the last boot are registered.
  5. After restoration, `getWhatsAppSettings({phone})` is called for each restored phone to pre-warm the 5-minute cache.
  6. A missing `baileys_auth` directory skips restore silently.
- **Async & events:** stagger delays; status posts.
- **External systems:** Laravel `/api/update-status`, `/api/whatsapp-settings`; proxy fetch per device (WD-NODE-013).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a folder with `creds.json` only, when the bridge boots, then it is not restored and Laravel receives status `Disconnected` for that phone.
  - Given two healthy folders, when the bridge boots, then both sockets start about 2 s apart and reach `open` without a QR.
  - Given the auth directory is absent, then boot continues and logs the skip.
- **Source refs:** node/index.js, node/classes/BaileysClientManager.js
- **Port notes:** Store Baileys auth state per device as encrypted rows/blobs (Postgres or object storage) with a `devices.auth_state_version`; restore = "load all devices with status connected/pairing and a lease-free claim". Use a lease so only one worker owns a device.

### WD-NODE-008 — Start a device connection and obtain a QR (`initialize-client`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-NODE-011, WD-NODE-002
- **Summary:** Laravel asks the bridge to (re)start a device socket for a phone number and returns the current QR image string, or "already connected". The operator scans it in the Devices/Connect wizard.
- **Actors & access:** workspace member with device rights via the Devices/Connect screens (WADEV); Laravel calls Node server-side with the token. Plan `device_limit` is enforced on the Laravel side before this call (`PlanLimitGuard::check` in `WaConnectController::saveBaileys`).
- **UX & screens:** QR modal (WADEV): polls Laravel every ~2 s; Laravel proxies to Node.
- **Endpoints:**

| Method uri                          | Caller                                                                                                            | Request     | Response                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------- |
| `GET /api/initialize-client/:phone` | `DevicesController::qrCode` (timeout 15 s), `WaConnectController::saveBaileys` (15 s), `Api/App/DeviceController` | path digits | `{qr, message, status:"qr_ready" | "connected"}`; 429 `{error:"Connection in progress. Please wait."}`; 500 `{error:"Failed to initialize client", details}` |

- **Data:** `app.locals.connectionLocks`, `clientManagers`; Laravel `wa_provider_configs` (`qr_data` in encrypted creds, status), `devices`.
- **Rules & edge cases:**
  1. Already connected and ready returns `{message:"Client already ready", qr:null, status:"connected"}` without touching the socket.
  2. Connection lock: a lock younger than 60 s returns 429; an older lock is discarded; the lock is set per call and removed on error (and swept every 5 min).
  3. Reconnect must behave like "Add device": if a manager exists but is not ready, it is reset (`resetForFreshAuth`), its health/reconnect timers cleared, and removed from the maps, then a new manager is built. Laravel additionally calls `terminate-client` first when the device row is not `connected` (best effort) so no stale in-memory session survives.
  4. `start()` resolves the device's proxy first (fail-closed, WD-NODE-013), then the handler polls `clientManager.qrCode` every 500 ms for up to 30 s, returning early with "connected" if the device becomes ready meanwhile. No QR in 30 s throws (500).
  5. QUIRK: Laravel's HTTP timeout is 15 s while Node waits up to 30 s, so a slow first QR surfaces as a Laravel 502/timeout even though Node later produces it; the UI recovers by polling `client-status`.
  6. `WaConnectController::saveBaileys` validates `phone_number` required string 6..32, `country_code` nullable max 8, `device_name` nullable max 64, `server_url` nullable url max 191; phone is normalized to country code + local digits; writes the provider row (`provider=baileys`, status pending, primary), demotes other providers for the workspace, busts the Node cache, then calls this endpoint; if Node is unreachable it answers 200 `{ok:false,message:"Could not reach Node bridge: ..."}`.
- **Async & events:** status callbacks `Qr generated`, `Connecting`, `Ready` (WD-NODE-012); `DeviceStatusChanged` broadcast (WD-NODE-012).
- **External systems:** WhatsApp Web (pairing), optional proxy.
- **Settings:** `baileys_server_url` / `SERVER_URL`.
- **Acceptance criteria:**
  - Given an unpaired phone, when initialize-client is called, then within 30 s the response contains a QR string with status `qr_ready` and Laravel receives status `Qr generated`.
  - Given a second call 10 s later while the first is still in progress, then the second returns 429.
  - Given the device is already connected, then the response is `connected` and no new socket is created.
  - Given the QR is not scanned for 90 s, then the pair attempt is aborted, session files removed and Laravel told `Pair failed: QR timeout` (WD-NODE-011).
- **Source refs:** node/controllers/clientController.js, node/classes/BaileysClientManager.js, app/Http/Controllers/DevicesController.php, app/Http/Controllers/WaConnectController.php, app/Http/Controllers/Api/App/DeviceController.php
- **Port notes:** In the target, "start pairing" is a command to the WhatsApp worker returning a pairing session id; the QR/status arrives over the realtime channel (server-sent events or websocket) instead of Laravel polling a Node GET that blocks for 30 s. Use a per-device Redis lock with TTL 60 s.

### WD-NODE-009 — Request a phone-number pairing code (`get-pairing-code`)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-NODE-008
- **Summary:** Alternative to QR: the bridge asks WhatsApp for an 8-character pairing code the operator types on the phone.
- **Actors & access:** as WD-NODE-008.
- **UX & screens:** Pairing-code tab of the connect modal (WADEV).
- **Endpoints:**

| Method uri                         | Caller                                                                      | Response                                                                                                                                                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/get-pairing-code/:phone` | `DevicesController::pairingCode` (timeout 50 s), `Api/App/DeviceController` | `{success:true, code, message, expires_in:180}`; already connected `{success:false, message:"Client already ready", already_connected:true}`; 429 `{success:false,error}`; 408 `{success:false,error:"Pairing code generation timeout",details}`; 500 |

- **Data:** `clientManager.pairingCode`, `pairingCodeAt`.
- **Rules & edge cases:**
  1. Idempotent within 120 s: if the manager has a socket, a code stamped less than 120 s ago and the device is not ready, the SAME code is returned (regenerating mid-entry makes WhatsApp reject with 401 "couldn't link device"). The response still says `expires_in:180`.
  2. Otherwise a stale socket is torn down (`resetForFreshAuth`) so the one-shot `requestPairingCode` can run again; `startWithPairingCode` builds a socket (proxy resolved fail-closed) and, on the first `connecting` event of an unregistered creds state, waits 2 s and requests the code for the digits-only phone (must be at least 8 digits and include the country code).
  3. The fork hard-codes the default code `SUK1CH4N`; the bridge generates its own random 8-char Crockford base32 code (5 random bytes) and passes it in.
  4. Polls every 300 ms up to 45 s; on timeout the socket is ended and 408 returned; the lock is always released.
  5. On success Laravel is told status `Code generated`; on failure `Pairing failed: <message>` (truncated to 32 chars by `shortStatus`, otherwise Laravel's validation `status max:64` would 422).
  6. `handleConnectionUpdateWithPairing` differs from the QR handler: QR events are ignored; on close it does NOT distinguish first-time pair failures, and it reconnects via the plain `start()` (QR mode), retrying up to `maxRetries` (50) with a flat 3 s delay (515 uses 2 s).
  7. The pairing-mode socket uses `keepAliveIntervalMs 30000`, `fireInitQueries:true`, `getMessage` returning a placeholder text (unlike the QR socket: 15 s keepalive, `fireInitQueries:false`, `getMessage` null, `shouldSyncHistoryMessage:false`). QUIRK: the two configurations drift.
- **Async & events:** status callbacks.
- **External systems:** WhatsApp Web.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an unpaired phone, when requested, then an 8-character code is returned within 45 s and Laravel sees `Code generated`.
  - Given a code was issued 30 s ago and the device is still unpaired, when requested again, then the same code is returned.
  - Given a phone shorter than 8 digits, then no code is generated and Laravel receives `Pairing failed: ...`.
- **Source refs:** node/controllers/clientController.js, node/classes/BaileysClientManager.js (`startWithPairingCode`, `randomPairingCode`), app/Http/Controllers/DevicesController.php
- **Port notes:** Baileys `requestPairingCode` custom-code support depends on the library version; verify in the chosen Baileys build and generate the code server-side only if required.

### WD-NODE-010 — Client status, terminate, connectivity check and contact export

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-NODE-008
- **Summary:** Four read/control endpoints on a device: live status (used for QR modal polling and admin re-sync), terminate (operator "Disconnect"), a destructive connectivity probe, and a dump of the in-memory contact store.
- **Actors & access:** Laravel server-side. Called from `DevicesController` (connect status, kill session), `WaConnectController::pollQr/disconnect`, `AdminPagesController` (`deviceDisconnect`, `deviceDestroy`, bulk re-sync), `Api/App/DeviceController`, `Api/App/CampaignController` (status probe).
- **UX & screens:** Devices list, QR modal, admin Devices (WADEV/ASHELL).
- **Endpoints:**

| Method uri                         | Response                                                                                                                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/client-status/:phone`    | connected: `{status:"connected", phoneNumber, isReady:true, user}`; QR: `{status:"qr_ready", ..., qr}`; code: `{status:"code_ready", ..., code}`; else `{status:"disconnected", phoneNumber, isReady:false}`; 500 on error                                |
| `GET /api/terminate-client/:phone` | `{message, phoneNumber, status:"terminated"}` after `clientManager.logout()` (unlink RPC + wipe session folder + drop flow sessions/cooldowns for `<phone>_*`), or `status:"not_found"` when no manager exists (restored sessions, see WD-NODE-007 quirk) |
| `GET /api/check-connection/:phone` | connected: `{status:"CONNECTED", user}`; not connected: performs full cleanup then `{status:"NOT_CONNECTED", message:"Device is not connected. Session cleaned up.", cleaned:true}`                                                                       |
| `GET /api/get-contacts/:phone`     | 400 unless connected and the manager has a store; else `{message, phoneNumber, contacts:<baileys store contacts map>}`                                                                                                                                    |

- **Data:** in-memory maps; disk session folder.
- **Rules & edge cases:**
  1. QUIRK (destructive GET): `check-connection` on any device that is not ready sets `shouldStayConnected=false`, logs out the socket, DELETES the session folder, drops manager/lock/flow sessions/cooldowns and posts `Disconnected` to Laravel. With no manager it deletes the folder directly. Nothing in Laravel calls it, but any caller (or an accidental health probe) unpairs a device that is merely mid-reconnect.
  2. `terminate-client` and `check-connection` are GET (side-effecting GETs). The docs describe terminate as "soft-disconnect (session preserved)"; the code performs a full logout and wipe (docs are wrong).
  3. Laravel maps the Node status onto `Device.status` only when it is in `Device::STATUSES`; `connected` also sets `last_seen_at`.
  4. `client-status` is the source for the modal's progress bar in Laravel (100 when `isReady`, 30 on `qr_ready`, else 50).
  5. `get-contacts` returns the in-memory store contacts (may be empty because history sync is disabled); consumed by `Api/App/DeviceController` for the mobile app.
- **Async & events:** none besides status post in check-connection.
- **External systems:** WhatsApp Web (logout RPC).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a ready device, when `client-status` is polled, then it returns `connected` with the WhatsApp user object.
  - Given a ready device, when terminate is called, then the phone shows the device unlinked and the session folder is gone.
  - Given a device mid-reconnect (not ready), when `check-connection` is called, then its session is deleted (parity behavior; target should not replicate).
  - Given a not-ready device, when `get-contacts` is called, then 400 `Client not connected`.
- **Source refs:** node/controllers/clientController.js, app/Http/Controllers/DevicesController.php, app/Http/Controllers/AdminPagesController.php, app/Http/Controllers/Api/App/DeviceController.php, Documentation/pages/developer-guide/node-bridge.html
- **Port notes:** Split status (GET, pure) from terminate (DELETE/command) and drop `check-connection` entirely. "Disconnect" in the product = logout RPC + revoke stored auth; "Pause" (soft close) is a separate action.

### WD-NODE-011 — Baileys socket lifecycle: configuration, reconnect policy and watchdogs

- **Status:** implemented
- **Priority:** P0
- **Effort:** XL
- **Depends on:** WD-NODE-001
- **Summary:** `BaileysClientManager` owns one WhatsApp Web socket per phone: builds it, saves credentials, decodes close reasons, reconnects forever unless logged out, aborts failed first-time pairings, and keeps a store and watchdogs alive. This is the core of the Unofficial API engine.
- **Actors & access:** system; driven by WD-NODE-007/008/009/010.
- **UX & screens:** none directly; outcomes surface as Devices status (WADEV).
- **Endpoints:** none (status posts in WD-NODE-012).
- **Data:** per-manager state: `sock`, `qrCode`, `pairingCode(+At)`, `connectionRetries` (max 50, shapes backoff only), `isConnecting/isConnected/isReconnecting/hasEverConnected/shouldStayConnected/shuttingDown`, `reconnectTimer`, `healthTimer`, `qrStallTimer`, `storeInterval`, `nextConnectStatus`, `proxy/proxyAgent`, in-memory `store` (`makeInMemoryStore`, persisted to `baileys_store.json` every 10 s and reloaded on start). Disk: `baileys_auth/session_<phone>/` via `useMultiFileAuthState`, saved on every `creds.update` (never debounced; the post-open save repeats after 2 s).
- **Rules & edge cases:**
  1. Version: `getWaVersion()` tries `fetchLatestWaWebVersion`, then `fetchLatestBaileysVersion`, cached 1 h; null lets the library default.
  2. Socket options (QR/restore socket): browser `Browsers.macOS("Desktop")`, `connectTimeoutMs 60000`, `defaultQueryTimeoutMs 120000` (deliberately raised; comment warns Laravel's send HTTP timeout must be at least this or slow sends false-fail into duplicates), `keepAliveIntervalMs 15000`, `retryRequestDelayMs 3000`, `maxMsgRetryCount 5`, `qrTimeout 60000`, `emitOwnEvents false`, `fireInitQueries false`, `syncFullHistory false`, `markOnlineOnConnect false`, `shouldSyncHistoryMessage` returns false, `transactionOpts {maxCommitRetries 10, delayBetweenTriesMs 3000}`, `getMessage` returns null (a placeholder text made WhatsApp re-decrypt loop), no link previews, agent + fetchAgent = the proxy agent when configured. Pino level from `BAILEYS_LOG_LEVEL` (default `warn`).
  3. Every socket is wrapped by `serializeSocketSends` (WD-NODE-029) so one send runs at a time per device, and `sock.phoneNumber` is stamped.
  4. Listeners: `messages.update` (receipts, WD-NODE-020, plus campaign receipt hook WD-NODE-040), `creds.update`, `connection.update`, `messages.upsert` (WD-NODE-016), `group-participants.update` and `groups.upsert` (debounced group sync, WD-NODE-021).
  5. QR handling: QR events within 5 s of the previous are ignored; the first QR of an attempt starts a 90-second stall clock (`qrFirstShownAt`, not reset by the ~20 s rotations). A watchdog every 5 s aborts the attempt when 90 s pass without a scan and the device never connected: `shouldStayConnected=false`, socket ended, session files deleted, manager and lock removed, Laravel told `Pair failed: QR timeout`. The first `creds.update` (scan succeeded) stops the stall watchdog so the post-scan 515 restart cycle is not killed.
  6. On `open`: verify the linked WhatsApp id (digits before `:`/`@`) equals the phone the manager was created for; on mismatch log, post `Mismatch`, logout, delete session files, drop manager/client and stop (guards "scanned with the wrong phone"). Otherwise set ready, `hasEverConnected`, retries 0, clear QR, cancel any pending reconnect timer, wait 2 s, `saveCreds`, log the auth-folder file count (warns when empty), post `Ready` 100, schedule the first group sync 7 s later.
  7. On `close` (decoded via `decodeCloseReason`: 401 unauthorized/unlinked, 403 forbidden, 408 timeout, 428 replaced, 440 conflict, 500 internal, 515 restart-required, loggedOut, badSession, connectionClosed/Lost, multideviceMismatch; message hints for "couldn't link" meaning 4-device limit, "qr ref", "timed out"): mark not ready and drop the socket from `clients`. If `shuttingDown` return (keep files). If never opened and the code is not 515/500: abort as a failed first pair (stop retries, delete files, drop manager/lock, post `Pair failed: <label>` truncated to 32 chars, e.g. `Pair failed: connection replaced...`). 401: stop, logout attempt, delete files, post `Logged Out`. loggedOut or 403: stop reconnecting, logout, delete files, post `Logged Out`. `badSession`: delete files then continue to reconnect (new QR flow). Everything else retries FOREVER (`maxRetries` no longer terminal in the QR handler).
  8. Backoff: base 2 s (515), 4 s (500 and 428), 6 s (408, 440), else 3 s; factor `min(1.5^retries, 10)`; jitter 0..1500 ms; delay capped at 30 s. 515 (post-pair stream restart) saves creds and posts `Syncing data` 75 on the next `connecting`; other non-500/408/440/428 codes queue `Reconnecting` 50. A pending reconnect timer is cleared before arming a new one (WhatsApp may fire two closes back to back); if `start()` itself throws the manager retries 15 s later and posts `Reconnecting` 30. `connecting` posts the queued status or `Connecting` 25.
  9. Health watchdog (created once per manager, every 60 s): when meant to stay connected, not connecting/connected/reconnecting, no reconnect timer, and not mid first-time pairing (QR showing, never connected), it calls `start()` again ("stay connected until logout").
  10. `logout()` (user intent): stop reconnecting, `sock.logout()` (unlink RPC), drop client/ready entries, clear timers and delete flow sessions and cooldowns for `<phone>_*`, delete session files. `softDisconnect()` (shutdown intent): no unlink, keep files, write the store, close the websocket. `resetForFreshAuth()`: remove listeners, end socket, clear QR/pairing/timers, used before regenerating QR or code.
  11. `start()` failure path (proxy unreachable etc.): if still meant to connect and retries below 50, retry after 5 s; no status is posted for it.
  12. Only one status string is capped: `shortStatus` truncates to 32 chars (29 + `...`) for the pair-failure labels.
  13. QUIRK: the pairing-mode close handler (WD-NODE-009) still uses the finite `maxRetries` cap and treats any close as reconnectable; after a successful pairing the socket is the QR-mode socket created by `start()`.
- **Async & events:** timers above; Laravel status posts; group sync; receipts.
- **External systems:** WhatsApp Web servers; optional proxy; optional `api.ipify.org` probe (WD-NODE-013).
- **Settings:** `BAILEYS_LOG_LEVEL`; Laravel `devices.proxy_*`.
- **Acceptance criteria:**
  - Given a paired device, when the network drops for 10 minutes, then the bridge keeps retrying with delays capped near 30 s and the device returns to `Ready` without operator action.
  - Given the operator unlinks the device on the phone (401), then the session folder is deleted, no reconnect is attempted and Laravel shows `Logged Out`.
  - Given a QR scanned with a different WhatsApp account, then Laravel gets `Mismatch`, the socket is logged out and files removed.
  - Given a QR that is never scanned, then after 90 s Laravel gets `Pair failed: QR timeout`.
  - Given SIGTERM, then no unlink RPC is sent.
- **Source refs:** node/classes/BaileysClientManager.js, node/classes/BaileysClientManager.backup.js (stale copy), node/utils/cleanup.js
- **Port notes:** Keep the behavior matrix (close code to action) as a table in code and unit-test it. Run each socket inside a device actor with a Redis lease; persist auth via a custom Baileys auth-state adapter (Postgres + encryption key per tenant). Treat 401/403/loggedOut as terminal, everything else as retry with jitter. Avoid per-device `setInterval` in the API process.

### WD-NODE-012 — Connection status reporting and Laravel status ingestion (`update-status`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-NODE-011, WD-NODE-002
- **Summary:** Every state change of a socket is pushed to Laravel as a free-text status plus progress percent; Laravel buckets it into connected / disconnected / pending, updates the provider config and mirrors the state onto matching `devices` rows and a realtime event.
- **Actors & access:** Node to Laravel, token required (403 on mismatch).
- **UX & screens:** Devices list dot and team-inbox header badge (WADEV, TIB1) update live through `DeviceStatusChanged`.
- **Endpoints:**

| Method uri               | Route name              | Controller                               | Middleware         | Request                                                                                                | Response                                                                                                                     |
| ------------------------ | ----------------------- | ---------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `POST api/update-status` | `baileys.node.callback` | `WaConnectController@nodeStatusCallback` | `api`, CSRF-exempt | `wid` string req max 32; `status` string req max 64; `qr` nullable string; `progress` nullable numeric | `{ok:true, derived_status}`; `{ok:false,message:"no matching config for <phone>"}` (200) when no baileys config matches; 403 |

- **Data:** `wa_provider_configs` (provider baileys; encrypted creds JSON keys `qr_data`, `last_status_msg`, `last_status_at`; column `status` pending|connected|disconnected, `connected_at`, `last_health_at`), `devices` (`status`, `last_seen_at`, `active`, `workspace_id`).
- **Rules & edge cases:**
  1. Config lookup: provider `baileys` and `phone_number` equal to the digits of `wid` or `+`digits. Qr in the payload replaces `qr_data`; otherwise the previous value is kept.
  2. Bucketing (lower-cased substring tests): connected when the status is exactly `ready`, `connected`, `paired` or `open`; disconnected when it contains `logged out`, `logged_out`, `disconnected`, `connection failed`, `connection_failed`, `pair failed` or `mismatch`; everything else pending. QUIRK: `Pairing failed: ...` (sent when code generation fails) contains neither `pair failed` nor any other disconnected marker, so it buckets as pending.
  3. Strings the bridge emits: `Qr generated`, `Code generated`, `Connecting` (25), `Syncing data` (75), `Reconnecting` (30/50), `Ready` (100), `Logged Out`, `Connection Failed`, `Mismatch`, `Pair failed: <reason>`, `Pairing failed: <msg>`, `Disconnected`.
  4. Device mirror: encrypted `phone_number` prevents SQL matching, so Laravel loads devices of the config's workspace plus workspace-less rows, compares digits of `country_code + phone_number` in PHP, patches `status` (`connected`/`disconnected`/`needs_pair`) and `last_seen_at`; sets `active=true` on connect; backfills `workspace_id` on legacy rows. Performance grows with device count (no indexed digits column).
  5. Broadcast `DeviceStatusChanged(workspace, phone, status, raw)` to others on channel `device-status.workspace.{id}`; failure is logged and ignored.
  6. The Node helper `updateStatusInLaravel` posts with the token header, no timeout, and swallows all errors (a lost status is never retried; the heartbeat repairs "connected" drift only).
  7. `Device` model events fire the outbound `device_status_updated` webhook (INTG) on each status flip.
- **Async & events:** websocket broadcast; webhook via model hook.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a baileys config for 919876543210, when Node posts `{wid:"919876543210", status:"Ready", progress:100}`, then config status becomes connected, matching devices become `connected`/active and a `DeviceStatusChanged` event fires.
  - Given status `Pair failed: connection replaced`, then config and device become disconnected.
  - Given an unknown phone, then the response is 200 with `ok:false`.
  - Given a wrong token, then 403.
- **Source refs:** app/Http/Controllers/WaConnectController.php (`nodeStatusCallback`), app/Events/DeviceStatusChanged.php, node/utils/helpers.js (`updateStatusInLaravel`), routes/api.php
- **Port notes:** Replace free-text statuses with an enum (`pairing_qr`, `pairing_code`, `connecting`, `syncing`, `open`, `logged_out`, `failed`, `mismatch`) plus a reason; emit a device-status domain event through the outbox; add an indexed `devices.phone_e164` column.

### WD-NODE-013 — Per-number proxy / IP isolation

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-NODE-011
- **Summary:** Each Baileys number can egress through its own HTTP or SOCKS5 proxy so accounts on one server do not share an IP. Node fetches the config from Laravel at every (re)connect, verifies the proxy, and refuses to connect directly if a proxy is enabled but broken.
- **Actors & access:** configured by workspace admins on the Devices screen (WADEV, plan-gated there); bridge fetches with the token.
- **UX & screens:** Devices proxy fields and status/egress-IP display (WADEV). Docs page getting-started/proxy-isolation.html.
- **Endpoints:**

| Method uri                             | Route name                  | Controller                        | Request                                                                                                                         | Response                                                                                                                  |
| -------------------------------------- | --------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET api/devices/proxy-config/{phone}` | `baileys.node.proxy-config` | `WaConnectController@proxyConfig` | phone digits                                                                                                                    | `{ok:true, proxy:{enabled:false}}` or `{ok:true, proxy:{enabled:true,type,host,port,username,password}}` (decrypted); 403 |
| `POST api/devices/proxy-result`        | `baileys.node.proxy-result` | `WaConnectController@proxyResult` | `phone_number` string req max 32; `proxy_status` string req max 16; `proxy_egress_ip` nullable max 64; `error` nullable max 255 | `{ok:true}` or `{ok:false,message:"no device"}`; 403                                                                      |

- **Data:** `devices.proxy_enabled`, `proxy_type` (`http` default | `socks5`), `proxy_host`, `proxy_port`, `proxy_username`, `proxy_password` (encrypted casts), `proxy_status`, `proxy_egress_ip`, `proxy_checked_at`; Node file `session_<phone>/proxy.json` (cache).
- **Rules & edge cases:**
  1. `loadProxy()` at every `start()`: GET config (timeout 10 s); result cached to `proxy.json` (or the file removed when disabled). If Laravel is unreachable the last cached `proxy.json` applies.
  2. `applyProxyAgent()`: builds `SocksProxyAgent` for `socks5` else `HttpsProxyAgent` with URL-encoded credentials; probes `https://api.ipify.org?format=json` THROUGH the proxy (15 s) to confirm reachability and learn the egress IP; reports `proxy_status` `ok` (with IP) or `unreachable` (with error); any failure throws and the socket is NOT started (fail-closed, never links through the server IP). No proxy configured means direct connection.
  3. The agent is passed as both websocket `agent` and media `fetchAgent`. It is not applied to Node's own HTTP calls (Laravel, Meta Graph, Twilio).
  4. Device lookup by digits scans every device in PHP (encrypted phone).
- **Async & events:** result post is best-effort (failure only logged).
- **External systems:** proxy provider, `api.ipify.org` (third-party dependency at every connect).
- **Settings:** per device.
- **Acceptance criteria:**
  - Given a device with an enabled working proxy, when it connects, then `proxy_status=ok` and `proxy_egress_ip` is stored.
  - Given a dead proxy, when it connects, then no socket is created, Laravel records `unreachable` with the error, and the connect fails (start retries every 5 s while retries remain).
  - Given Laravel is down but `proxy.json` exists, then the cached proxy is used.
- **Source refs:** node/classes/BaileysClientManager.js (`loadProxy`, `applyProxyAgent`, `buildProxyAgent`, `reportProxyResult`), app/Http/Controllers/WaConnectController.php, Documentation/pages/getting-started/proxy-isolation.html
- **Port notes:** Store proxy credentials encrypted (KMS-backed); the worker fetches them from the repository rather than an HTTP hop. Make the ipify probe configurable or use a self-hosted echo endpoint.

### WD-NODE-014 — Node heartbeat: device liveness and the platform's only scheduler tick

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-NODE-005, WD-NODE-002
- **Summary:** Every 30 seconds the bridge tells Laravel which sockets are alive. Laravel uses the same request to mark stale devices and to run every periodic job of the product, because WaDesk deploys no Laravel scheduler or queue worker (`schedule:list` is empty).
- **Actors & access:** Node to Laravel, token required.
- **UX & screens:** none; effects appear as device offline badges and as scheduled/retry work happening.
- **Endpoints:**

| Method uri                | Route name               | Controller                          | Request                                                                                    | Response                                                                                                                                           |
| ------------------------- | ------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST api/node-heartbeat` | `baileys.node.heartbeat` | `WaConnectController@nodeHeartbeat` | `devices` array req; `devices.*.wid` string req max 32; `devices.*.status` nullable max 64 | `{ok, touched, marked_stale, campaigns_fired, campaigns_active, scheduled_retried, broadcasts_retried, deal_tasks_reminded, stock_holds_released}` |

- **Data:** `devices.last_seen_at/status/active`, cache keys `device-idle-logout-lock`, `campaign-drain-loop-alive`, `scheduled-sweep-throttle`, `broadcast-sweep-throttle`, `wipe-expired-daily-lock`, `deal-reminder-sweep-lock`, `stock-hold-sweep-lock`.
- **Rules & edge cases:**
  1. Node builds the list from `clients` filtered by `client_ready`, each `{wid, status:"connected"}`. It SKIPS the request when no client is registered or none is ready. QUIRK: a deployment with only WABA/Twilio numbers (no Baileys socket) never heartbeats, so none of the sweeps below run from here; only the drain loop (WD-NODE-015) keeps campaigns moving.
  2. Timeout 90 s (sweeps run inline). 404 is ignored (old Laravel); other failures log status and body, with a 401/403 hint that scheduled campaigns will not fire until the token matches. QUIRK: each heartbeat logs a `warn` line containing the first 4 characters and length of the token.
  3. Laravel: an empty `devices` digit list returns `{ok:true,touched:0}` and runs nothing. Otherwise: touch `last_seen_at` for listed devices; mark stale: every device with status `connected` and `last_seen_at` older than 90 s becomes `disconnected` (per-instance save so the webhook hook fires; note this is platform-wide, so a second bridge instance serving other devices would flap them); long-inactivity logout when `security.device_logout_on_inactive_days` > 0 (at most hourly).
  4. Sweeps in order, each in try/catch so one failure never blocks the rest: `CampaignScheduleSweeper::sweep` (skipped while the drain loop marker `campaign-drain-loop-alive` exists), `ScheduledMessageSweeper::sweep` (throttled to 120 s), `BroadcastSweeper::sweep` (120 s), `AppointmentLifecycleSweeper::sweep` (releases expired slot locks, flags/completes past bookings), `InvoiceSweeper::maybeRun` (own 5-minute gate), daily `workspaces:wipe-expired --force` (cache lock 1 day), `DealReminderService::sweep` (120 s, cap 500), `InventoryService::sweepExpired` (stock-hold release, 60 s, cap 1000). `campaigns_active` = a campaign fired this tick or any `running` one exists.
  5. Owners of the sweeps: CAMP, SCHED, BCAST, APPT, INV, WSP/PLAN (wipe), DEAL, CHK/CAT. This entry owns only the trigger contract.
- **Async & events:** the sweeps enqueue nothing; they run inline, so a slow sweep delays the response (up to Node's 90 s timeout).
- **External systems:** none.
- **Settings:** `security.device_logout_on_inactive_days` (0 = off).
- **Acceptance criteria:**
  - Given one ready device, when 30 s pass, then Laravel updates `last_seen_at` and runs the due sweeps.
  - Given a device that crashed silently, when no heartbeat lists it for 90 s, then its row flips to `disconnected`.
  - Given no ready device, then no heartbeat is sent and no sweep runs from this path.
  - Given two heartbeats within 120 s, then the scheduled/broadcast retry sweeps run only once.
- **Source refs:** node/index.js (`startDeviceHeartbeat`), app/Http/Controllers/WaConnectController.php (`nodeHeartbeat`), app/Services/CampaignScheduleSweeper.php, app/Services/ScheduledMessageSweeper.php, app/Services/BroadcastSweeper.php, app/Services/Appointments/AppointmentLifecycleSweeper.php, app/Services/Invoice/InvoiceSweeper.php, routes/api.php
- **Port notes:** Delete this coupling. Use BullMQ repeatable jobs (`device-liveness`, `scheduled-retry`, `broadcast-retry`, `appointment-lifecycle`, `invoice-run`, `deal-reminders`, `stock-hold-release`, daily `retention-wipe`) owned by the respective modules; device liveness = socket events plus a Redis TTL key per device. Each job must be idempotent and lock-guarded (`Cache::lock` becomes Redis lock or BullMQ job ids).

### WD-NODE-015 — Campaign drain loop (`campaigns/drain`)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-NODE-014
- **Summary:** A dedicated Node loop asks Laravel to run only the campaign sweep, back-to-back while a campaign is draining, so a multi-thousand campaign completes server-side without a browser, cron or Baileys device.
- **Actors & access:** Node to Laravel, token required.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                 | Route name                | Controller                                | Response                                            |
| -------------------------- | ------------------------- | ----------------------------------------- | --------------------------------------------------- |
| `POST api/campaigns/drain` | `wa-campaigns.node.drain` | `WaCampaignsController@nodeCampaignDrain` | `{ok:true, campaigns_fired, campaigns_active}`; 403 |

- **Data:** cache key `campaign-drain-loop-alive` (90 s TTL, refreshed on each call).
- **Rules & edge cases:**
  1. Node: `setInterval(tick, 30 s)` (calm); after each call, if `campaigns_active` it re-arms a single 4-second timer (`clearTimeout` keeps one fast chain) so ticks chain until inactive. Timeout 90 s because a paced chunk (about 20 s) runs inside the request. Runs regardless of device connectivity (WABA and scheduled campaigns). 404 or errors return "not active".
  2. Laravel: refreshes the alive marker so the heartbeat skips its own campaign sweep; runs `CampaignScheduleSweeper::sweep()` (cache lock `campaign-schedule-sweep` 25 s prevents double-firing); active = fired this pass OR any `wpcampaigns.status='running'`. If the loop dies the marker expires after 90 s and the heartbeat resumes sweeping.
  3. The sweep itself (owned by CAMP) rescues stalled `running` campaigns, fires due `scheduled`/`recurring` ones (per-campaign timezone), and drains the next paced chunk.
- **Async & events:** as above.
- **External systems:** none.
- **Settings:** none here (pacing in WD-NODE-029; campaign expiry settings belong to CAMP).
- **Acceptance criteria:**
  - Given a running campaign with queued recipients, when the loop ticks, then Laravel reports `campaigns_active:true` and Node re-ticks after about 4 s until it turns false.
  - Given no campaigns, then Node ticks every 30 s and each response is `campaigns_active:false`.
  - Given the drain endpoint is unreachable for more than 90 s, then the heartbeat sweep takes over.
- **Source refs:** node/index.js (`startCampaignDrainLoop`), app/Http/Controllers/WaCampaignsController.php (`nodeCampaignDrain`), app/Services/CampaignScheduleSweeper.php
- **Port notes:** Replace with a BullMQ worker consuming per-campaign chunk jobs (concurrency 1 per campaign, delayed re-enqueue for pacing). No loop, no alive marker.

### WD-NODE-016 — Inbound message capture and forwarding (Baileys to Laravel)

- **Status:** implemented
- **Priority:** P0
- **Effort:** XL
- **Depends on:** WD-NODE-011, WD-NODE-017
- **Summary:** Every message event on a socket is normalized (text, interactive replies, media, location, contact, reaction, forwarded flag, LID/phone resolution) and posted to Laravel's inbound endpoint, after which the bridge runs keyword auto-reply or flow logic on the same message.
- **Actors & access:** system; customers are the actors.
- **UX & screens:** team inbox thread and /chat (TIB1/CHAT).
- **Endpoints:** outbound `POST {APP_DOMAIN_NAME}/api/inbound-message` (WD-NODE-017).
- **Data:** none stored in Node.
- **Rules & edge cases:**
  1. Only `messages.upsert` types `notify` and `append` are processed. `append` is used ONLY for the from-me sync (WD-NODE-018); the customer pipeline runs for `notify`.
  2. Stale guard: a `notify` older than 600 s (by `messageTimestamp`) is dropped, so reconnect replays cannot re-trigger flows or auto-replies.
  3. JID filters: empty jid, `status@broadcast`, `@newsletter`, `@broadcast` are skipped. `@g.us` groups take the storage-only path (WD-NODE-018) and never enter the pipeline below.
  4. Sender resolution: real phone from `key.senderPn`, else `participantPn`, else `remoteJidAlt` when it ends `@s.whatsapp.net`, else a `@s.whatsapp.net` remote jid; otherwise the chat is LID-only (`is_lid:true`, digits of the LID used as identifier). `raw_jid` sent = phone-based jid when a phone is known, else the raw jid; `lid_jid` is sent whenever the raw jid is a `@lid` so Laravel can merge threads.
  5. Visible text priority: `conversation`, `extendedTextMessage.text`, legacy buttons response (display text, then id), legacy list response (title, then row id), template button reply, then the modern `interactiveResponseMessage.nativeFlowResponseMessage.paramsJson` (`display_text`, else `id`). Empty text with no media and no contact is dropped.
  6. Media types recognised for inbound: image, video, audio, document, location. Media bytes are downloaded with `downloadMediaMessage` (with `reuploadRequest` so the sender's device re-uploads evicted blobs) and posted as base64 only when at most 16 MB; oversize or failed downloads are posted without bytes (text-only row). Fields: `media_type`, `media_mime`, `media_filename` (document `fileName` or `title`), `media_base64`.
  7. Location: `location_latitude/longitude/name/address`. Contact card: first contact of `contactMessage`/`contactsArrayMessage`, `contact_name`, `contact_phone` (first TEL in the vCard, digits and `+`), `contact_vcard` (FN fallback for the name). Forwarded: `is_forwarded`, `forward_score` from `contextInfo`.
  8. Reaction: a `reactionMessage` with a target key id is posted alone (`reaction_emoji`, `reaction_target`, timeout 8 s) and the handler stops for that message.
  9. The main post has timeout 30 s, body/content cap 32 MB. It is fire-and-forget: keyword/flow logic (WD-NODE-019) does not wait for it, except that a `routing_actions.flow_id` in the response starts that flow (WD-NODE-017).
  10. Per-message try/catch keeps one bad message from dropping the rest of the batch.
- **Async & events:** unawaited HTTP post; `.then` triggers routing flow.
- **External systems:** WhatsApp media CDN.
- **Settings:** none (16 MB and 600 s are constants).
- **Acceptance criteria:**
  - Given a customer text, when it arrives, then Laravel receives `device_phone`, `sender_phone` (digits), `body`, `wa_message_id`, `timestamp` within one request.
  - Given a 20 MB video, then the row is created without bytes and the bridge logs "file too large".
  - Given a button tap, then `body` is the button's visible text (or id when no text).
  - Given a message timestamped 11 minutes ago delivered after reconnect, then it is not forwarded.
  - Given a status update or newsletter message, then nothing is forwarded.
- **Source refs:** node/classes/BaileysClientManager.js (`handleMessages`), Documentation/pages/developer-guide/node-bridge.html (docs say groups are filtered out; code now stores them)
- **Port notes:** Model the inbound payload as a versioned DTO shared with the API (`packages/contracts`). Drop the 16 MB cap in favor of streaming upload to object storage with a presigned URL and post only the key. Keep the stale-replay guard as an idempotent `wa_message_id` unique constraint plus age check.

### WD-NODE-017 — `inbound-message` endpoint contract (Laravel side)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-NODE-016, WD-NODE-002
- **Summary:** The single ingestion endpoint for messages seen by Baileys sockets (and used by the bridge to mirror its own sends). It resolves the device and workspace, finds or creates the one thread for that number, stores the message and media, then runs opt-out, AI agent, voice assistant, outside-hours reply and tells the bridge whether a routing rule wants a flow started.
- **Actors & access:** Node only (token, 401). Storage and conversation rules belong to TIB1/CHAT; AI to AIAG; this entry owns the wire contract.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                 | Route name        | Controller                    | Request (validation)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Response        |
| -------------------------- | ----------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `POST api/inbound-message` | `baileys.inbound` | `WaInboundController@baileys` | `device_phone` req max 32; `sender_phone` req max 32; `sender_name` nullable max 191; `body` nullable max 8192; `media_url` nullable max 1024; `media_type` nullable max 32; `media_mime` nullable max 191; `media_filename` nullable max 255; `media_base64` nullable; `wa_message_id` nullable max 191; `buttons` array; `header`,`footer` max 191; `is_lid` bool; `raw_jid`,`lid_jid`,`group_subject` max 191; `timestamp` int; `contact_vcard` max 8192, `contact_name` max 191, `contact_phone` max 64; `is_forwarded` bool; `forward_score` int 0..1000; `reaction_emoji` max 32; `reaction_target` max 191; `location_latitude` -90..90, `location_longitude` -180..180, `location_name` max 191, `location_address` max 255; `direction` in in,out | see kinds below |

- **Data:** `conversations`, `inbox_messages`, `messages`, `contacts`, storage `chat-media/<random>__<original>` (media disk).
- **Rules & edge cases:**
  1. Response kinds: reaction only (`{ok,kind:"reaction",message_id|null}`; reaction target matched on `inbox_messages.meta->wa_message_id` within the device's workspace; not found still 200); dedup (`kind:"dedup"`, same `wa_message_id` already stored in either table for that conversation and direction, so mirrors and phone-echo collapse to one bubble); `outbound_sync` (direction out); `opt_out` (STOP/START handled by `OptOutService` after storing the message and before AI); `ai_crm_copilot`; normal `{ok:true, conversation_id, routing_actions:{flow_id?}}`.
  2. Device resolution scans `devices` in PHP by digits of `country_code + phone_number`; if none, `wa_provider_configs` of provider waba/twilio (so flows/auto-replies on official numbers can mirror); else 404 `{ok:false,error:"device_not_found"}` and the message is dropped. The engine is carried as `provider` on the conversation (`baileys` default) to avoid forking a twin thread against the WABA webhook thread.
  3. LID detection uses explicit signals only (`is_lid`, `@lid` suffix on either jid, or no phone digits). Thread lookup goes through `ConversationResolver::find(workspace, jid, deviceId)` matching on digits across stored shapes (one thread per number, separate per receiving device); LID-only falls back to `lid_jid`. Title `<Name> · +<phone>`, `+<phone>`, LID-only name, or the group subject for `@g.us`.
  4. `routing_actions.flow_id` comes from a `pending_flow_id` slot set by a `trigger_flow` routing rule; the slot is consumed (unset) in the same request so a Node crash cannot replay it. A media-only (image or audio) inbound with no text and no pending order in progress may set `flow_id` to the workspace's order flow (a flow containing an order-parse step).
  5. Media base64 is decoded and written to the media disk; failures only log.
  6. The endpoint is CSRF-exempt and lives in the stateless `api` group so Node never contends for the browser session lock (the reason the routes moved out of web.php).
- **Async & events:** AI reply, voice reply (deferred via `terminating`), outside-hours reply, realtime `MessageReceived`/conversation events (TIB1), webhooks (INTG).
- **External systems:** AI providers (AIAG).
- **Settings:** workspace routing rules, agent assignment (owned elsewhere).
- **Acceptance criteria:**
  - Given a known device and a new customer number, when a text arrives, then a conversation is created once and the message stored; a second post with the same `wa_message_id` returns `kind:"dedup"`.
  - Given a routing rule with `trigger_flow`, then the first response contains `routing_actions.flow_id` and the second inbound does not.
  - Given an unknown `device_phone`, then 404 `device_not_found`.
  - Given `direction:"out"` with a `wa_message_id` already stored by the dispatcher, then no second bubble is created.
- **Source refs:** app/Http/Controllers/WaInboundController.php, routes/api.php, bootstrap/app.php, app/Services/Inbox/ConversationResolver.php
- **Port notes:** Implement as `POST /internal/whatsapp/inbound` (or, better, a BullMQ job `inbound.message` produced by the worker; no HTTP). Enforce `unique(workspace_id, wa_message_id, direction)` for dedup; resolve device by an indexed E.164 column; run AI/opt-out/routing as separate consumers of the stored-message event via the outbox instead of inline.

### WD-NODE-018 — Outbound echo sync, group inbound storage and bot-reply mirroring

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-NODE-016, WD-NODE-017
- **Summary:** Messages the account sends that Laravel did not initiate (phone typing, another linked device, flow and auto-reply sends) are mirrored into the team inbox as outbound, and group chat messages are stored read-only (no automation).
- **Actors & access:** system.
- **UX & screens:** team inbox thread shows both sides; group threads are readable and repliable.
- **Endpoints:** posts to `api/inbound-message` with `direction:"out"` or `@g.us` raw_jid.
- **Data:** as WD-NODE-017.
- **Rules & edge cases:**
  1. `syncOutboundFromPhone` (from-me events of type notify or append): skips groups, newsletters, broadcasts, status; skips events with no text and no media; skips anything older than 600 s (history replay); recipient = digits of `remoteJidAlt` or `remoteJid`; media (image, video, audio, document, sticker) downloaded with one retry after 1.5 s, at most 16 MB, base64 in body; location (static or live) and contact cards mapped like inbound; timeout 30 s with media, 10 s otherwise.
  2. `mirrorOwnAutoReply` and `mirrorOwnMediaReply` explicitly post the bridge's own keyword/auto-reply sends (Baileys does not reliably re-emit a socket's own send, and `emitOwnEvents` is false), keyed by the sent message id so the server-side dedup collapses them with any echo; media over 16 MB falls back to a text row (caption or `[type]`).
  3. Groups: `forwardGroupInbound` posts group messages (text, image, video, audio, document, sticker) with `raw_jid=<group jid>@g.us`, `sender_phone` = the participant's phone (`participantPn` else `participant`, digits), `sender_name`, `group_subject` fetched with `groupMetadata` (best-effort), `direction` in/out by `fromMe`, timeout 15 s (60 s with media). No flow, keyword or AI runs for group messages. QUIRK: when the participant phone cannot be resolved (LID-only participant) `sender_phone` is empty and Laravel's `required` rule rejects the row (422), silently losing that group message.
  4. Group directory sync is separate (WD-NODE-021).
  5. Status/protocol/edit events carry no body or media and are dropped.
- **Async & events:** unawaited posts.
- **External systems:** WhatsApp CDN.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the operator replies from their phone, when the event arrives, then the reply appears once in the team-inbox thread as outbound.
  - Given a keyword auto-reply sent by the bridge, then exactly one outbound bubble exists.
  - Given a group message from a member, then it is stored in the group thread and no flow starts.
  - Given a from-me event 15 minutes old (history sync), then it is ignored.
- **Source refs:** node/classes/BaileysClientManager.js (`syncOutboundFromPhone`, `mirrorOwnAutoReply`, `mirrorOwnMediaReply`, `forwardGroupInbound`), app/Http/Controllers/WaInboundController.php
- **Port notes:** Emit `message.echo` events from the worker; the API dedups on `wa_message_id`. Store `participant_lid` when phone unknown instead of rejecting.

### WD-NODE-019 — Keyword auto-reply and flow triggering inside the bridge

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-NODE-016
- **Summary:** For each 1-on-1 customer message the bridge decides whether it continues an active flow, restarts a flow on a re-typed trigger keyword, or matches a keyword rule fetched from Laravel (custom reply, shared contact, catalog link, location request, or a flow), applying per-rule cooldown and reply delay.
- **Actors & access:** system; rules are configured in AR/FLB.
- **UX & screens:** none in the bridge.
- **Endpoints:** Node calls `GET api/keyword-replies` and `GET api/flows/{id}`.

| Method uri                | Route name               | Controller                   | Auth                                                                                    | Request                                                                                                                              | Response                                                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------ | ---------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET api/keyword-replies` | `keyword-replies.lookup` | `AutoReplyController@lookup` | token (401 with `[{response:"401",reply:"unauthorized",reply_type:null,flow_id:null}]`) | query `keyword` (lowercased trimmed), `mobile` (`<digits>@s.whatsapp.net`), `phone` (device), optional `media_type` (image or audio) | JSON array; first element used: `reply_type` (custom, flow, share_contact, send_catalog, request_location), `flow_id`, `reply`, `timeout`, `cooldown`, `reply_delay`, `contact{name,phone,email}`, `catalog{catalog_id,provider,mode}`; `reply` of `notallow` or `default` means no match |

- **Data:** `auto_reply_lookups` (analytics row per lookup with latency, AR), `keyword_replies`.
- **Rules & edge cases:**
  1. Order per inbound: (a) active session waiting for input: a typed (not button/list/native tap) message equal to the session's `triggerKeyword` restarts the same flow immediately; otherwise the typed text is looked up and a flow match restarts (any waiting node); a persistent template menu ignores stray typed text and only refreshes its timeout; taps and everything else go to `handleFlowResponse`, then the timeout timer is reset. (b) No session: check cooldown, look up the keyword; flow keywords ALWAYS restart even during cooldown; non-flow replies respect the cooldown.
  2. Media-order exception: empty text is not matched unless the message is image or audio, in which case Laravel may return the order flow.
  3. Flow launch (`handleFlowAutoReply`): clears the old session's timer, GETs `/api/flows/{id}` (token), requires `success` and at least one node, fetches workspace attributes (60 s cache) and merges them UNDER seed variables `user_message`, `name`, `first_name`, `pushName`, `phone`; stores the session (`sessionId`, `flowId`, `triggerKeyword`, `flowData`, history, `timeoutSeconds` default 600, `cooldownSeconds`), executes the FIRST node of `flowNodes`, then arms the idle timeout (default 600 s; on expiry the session is deleted and the cooldown set).
  4. Custom reply: cooldown armed BEFORE sending; `reply_delay` clamped 0..300 s; placeholders `{{name}}`, `{{first_name}}`, `{{phone}}` (case and space tolerant) substituted; a reply that is JSON `{type:image|video|document, url, caption, filename, mimetype}` sends media (relative urls absolutised against APP_DOMAIN_NAME, fetch 30 s, caption double-wrapped JSON unwrapped up to 3 times, caption fallback text on failure); otherwise plain text, mirrored to the inbox.
  5. share_contact builds a vCard (`waid` phone); send_catalog sends the text `https://wa.me/c/<catalog_id>` (a true product-list message is a TODO); request_location sends the native request-location message with body "Please share your location". Each sets the cooldown.
  6. QUIRK: the lookup call has no timeout and any error returns null, so a Laravel outage silently disables all automation.
- **Async & events:** timers per session; unawaited inbound post.
- **External systems:** none.
- **Settings:** per-rule timeout (default 600 s), cooldown (default 0), reply_delay (default 0).
- **Acceptance criteria:**
  - Given a flow keyword rule, when a customer sends the keyword, then the first node runs and a session exists for `<device>_<customer>`.
  - Given an active flow waiting on a question and the customer re-types the trigger keyword, then the flow restarts instead of the keyword being taken as the answer.
  - Given a rule with cooldown 60 and reply_type custom, then a second matching message within 60 s gets no reply.
  - Given an image auto-reply JSON with a caption `Hi {{first_name}}`, then the customer receives the image with the first name substituted.
- **Source refs:** node/classes/BaileysClientManager.js (`checkKeywordReply`, `handleFlowAutoReply`, `handleCustomAutoReply`, `sendMediaReply`, cooldown and timeout helpers), app/Http/Controllers/AutoReplyController.php (`lookup`)
- **Port notes:** Move keyword matching into the API (`POST /internal/inbound` result includes an action list) so the worker never polls Laravel per message; persist sessions and cooldowns (Redis, TTL). Owner domains: AR for rule semantics, FLR for the session model.

### WD-NODE-020 — Delivery and read receipts to Laravel

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-NODE-011, WD-NODE-037
- **Summary:** Baileys receipt events are turned into `delivered` and `read` updates: broadcast messages go to the broadcast pivot, all other sends (Quick Send, /chat, team inbox) go to a chat-message endpoint that advances ticks without ever downgrading.
- **Actors & access:** Node to Laravel, token.
- **UX & screens:** double/blue ticks in /chat and team inbox; broadcast delivered/read counters.
- **Endpoints:**

| Method uri                       | Route name                       | Controller                               | Request                                                                                                       | Response                  |
| -------------------------------- | -------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `POST api/chat/message-status`   | `chat.node.message-status`       | `ChatController@nodeChatMessageStatus`   | `whatsapp_message_id` string req max 191; `status` in delivered,read; `delivered_at`,`read_at` nullable dates | `{ok:true, updated}`; 403 |
| `POST api/update-message-status` | `broadcasts.node.message-status` | `BroadcastsController@nodeMessageStatus` | see WD-NODE-038                                                                                               | `{ok:true}`               |

- **Data:** `messages.status/delivered_at/read_at` (matched by `meta->wa_message_id`, direction out), `inbox_messages` (same), `broadcast_contacts`.
- **Rules & edge cases:**
  1. Baileys status enum: 1 pending, 2 server ack, 3 delivery ack, 4 read, 5 played. Only 3 map to `delivered`; 4 and 5 map to `read` (played counts as read); 1 and 2 are ignored. Timestamps are the bridge's `now` (ISO), not WhatsApp's.
  2. A receipt whose message id is found in any in-memory `scheduledMessages[].sentMessages` is treated as a broadcast receipt and posted to `update-message-status` with `broadcast_id`, `contact_id`; everything else goes to `chat/message-status`.
  3. Laravel never downgrades (rank pending/scheduled 0, sent 1, delivered 2, read 3); a `read` backfills `delivered_at`; the same update is mirrored to the matching `inbox_messages` row; billing `settleDelivered` runs once per wamid when a real outbound `messages` row matched (flows/auto-replies with synthetic ids do not match).
  4. Campaign receipts also flow through `handleCampaignMessageUpdate` (WD-NODE-040) on the same event.
  5. QUIRK: broadcast receipts depend on Node memory: after a restart in-flight broadcasts lose `sentMessages`, so their late receipts are posted as chat receipts and match nothing.
- **Async & events:** none besides posts; errors logged.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a /chat message with a stored `wa_message_id`, when WhatsApp reports read, then the row shows read with `delivered_at` backfilled.
  - Given a `read` update arrives before `delivered`, then the status stays `read`.
  - Given a broadcast recipient's delivery ack, then the broadcast pivot status becomes `delivered`.
- **Source refs:** node/classes/BaileysClientManager.js (`handleMessageStatusUpdate`), app/Http/Controllers/ChatController.php (`nodeChatMessageStatus`), app/Services/MessageBillingService.php
- **Port notes:** Persist a `wa_message_id` on every outbound row at send time and update status by that key; do not rely on process memory to classify receipts. Status ordering enum enforced in SQL (`WHERE rank(new) > rank(status)`).

### WD-NODE-021 — WhatsApp group directory sync and group management API

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** WD-NODE-011, WD-NODE-002
- **Summary:** The bridge mirrors the groups each device belongs to (with participants) into Laravel and exposes a passthrough API to create groups, list/read them, change participants, subject, description and settings, leave, and manage invite links. Baileys only.
- **Actors & access:** Laravel server-side (`Api/App/GroupController` for the mobile app; ordering flow uses the directory). Node group routes require the token strictly (`nodeTokenGuard`, header only, no loopback bypass).
- **UX & screens:** mobile app groups (MOB); ordering group directory `/store/groups` (WFL/CHK).
- **Endpoints:**

| Method uri                                                                                                                                                                                                                                                                                           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST api/groups/sync` (Laravel, `api.groups.sync`, `WaGroupController@sync`)                                                                                                                                                                                                                        | body `device_phone` req max 24, `workspace_id` nullable int, `groups[]` req (`jid` req max 64, `subject` max 191, `size` int, `participants[]{phone max 24, admin bool}`); workspace resolved from the device digits when not sent (422 `no workspace for device`); per group `wa_groups` upsert on (workspace, jid) and REPLACE of `wa_group_members` in a transaction; 401 unauthorized (uses env token, see WD-NODE-002) |
| Node `POST /api/groups/create/:phone`                                                                                                                                                                                                                                                                | `subject` (or `name`) and `participants[]` required (422); numbers or jids; returns `{ok,jid,subject,participants_count,meta}` after up to 3 metadata retries x 300 ms; 502 when no jid                                                                                                                                                                                                                                     |
| Node `GET /api/groups/all/:phone?workspace_id=`                                                                                                                                                                                                                                                      | `{ok,groups:[{jid,subject,owner,creation,description,participants_count,announce_only,restrict,ephemeral_duration}],total}`; hides groups left in the last 30 s for that workspace                                                                                                                                                                                                                                          |
| Node `GET /api/groups/meta/:phone?jid=`                                                                                                                                                                                                                                                              | full metadata; jid must match digits(-digits)?@g.us else 422                                                                                                                                                                                                                                                                                                                                                                |
| Node `POST /api/groups/participants/:phone`                                                                                                                                                                                                                                                          | `jid`, `action` add/remove/promote/demote, `participants[]`; per-participant status "200" = ok; returns `{ok(!allFailed), action, result, meta, partial, ok_count, fail_count, total_count}`                                                                                                                                                                                                                                |
| Node `POST /api/groups/subject/:phone` `{jid,subject}` ; `.../description` `{jid,description}` ; `.../settings` `{jid,setting}` with setting in announcement, not_announcement, locked, unlocked ; `.../leave` `{jid, workspace_id}` ; `GET .../invite-code?jid=` ; `POST .../revoke-invite` `{jid}` | invite links returned as `https://chat.whatsapp.com/<code>`                                                                                                                                                                                                                                                                                                                                                                 |

- **Data:** `wa_groups` (workspace, group_jid, device_phone, subject, size, synced_at, group_code), `wa_group_members` (workspace, group_jid, phone, is_admin).
- **Rules & edge cases:**
  1. Sender must be connected and ready (else 503 `Sender device is not connected.`); the sock is resolved by digits from `client_ready` + `clients`.
  2. Directory sync is debounced 5 s after `group-participants.update` and `groups.upsert`, and scheduled 7 s after each open; it posts only when at least one group exists (timeout 20 s, header token).
  3. The recently-left ledger is keyed by `<workspaceId>::<jid>`, uses a monotonic clock (`process.hrtime`), TTL 30 s, swept every 60 s (unref'd) and every 32nd write.
  4. All group calls are Baileys-only (Cloud API and Twilio have no group concept).
- **Async & events:** debounced timers; sync post.
- **External systems:** WhatsApp Web.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a connected device, when a participant is added on the phone, then within about 5 s `wa_group_members` reflects it.
  - Given jid `abc@g.us`, when meta is requested, then 422 with the format message.
  - Given add of 3 numbers with 1 failure, then `ok:true, partial:true, ok_count:2, fail_count:1`.
  - Given a group just left, when listed within 30 s, then it is absent.
- **Source refs:** node/controllers/groupController.js, node/classes/BaileysClientManager.js (`syncGroups`, `scheduleGroupSync`), app/Http/Controllers/WaGroupController.php, app/Http/Controllers/Api/App/GroupController.php
- **Port notes:** Group operations are worker commands (queue RPC or internal HTTP); sync becomes an event `group.snapshot` upserted with the same replace-in-transaction rule. Tables belong to WFL (`wa_groups`, `wa_group_members`).

### WD-NODE-022 — Outbound text send and engine routing (`send-message`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-NODE-011, WD-NODE-024, WD-NODE-026, WD-NODE-027
- **Summary:** The bridge's main send endpoint. Laravel's dispatchers post a text message (optionally with buttons, title/subtitle/footer, a carousel template or a location pin) and the bridge delivers it through the sender's engine: the Baileys socket, WhatsApp Cloud API, or Twilio.
- **Actors & access:** Laravel server-side only (`WhatsAppDispatcher` for chat, campaigns, broadcasts fallback and scheduled; `InboxDispatcher` for the team inbox; `BaileysCatalogService`; `Api/App/ChatController`). Token guard applies (WD-NODE-002). Monthly quota, emergency halt and wallet billing are enforced in Laravel BEFORE the call (WALLET/BSP); the bridge does not meter.
- **UX & screens:** none in the bridge.
- **Endpoints:**

| Method uri                      | Request                                                                                                                                                                                                                                                                                                                             | Response                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/send-message/:phone` | JSON, optionally wrapped in a `json` key: `targetPhoneNumber`, `targetJid` (full jid for LID and group chats), `message`, `buttons[]`, `footer`, `title`, `subtitle`, `template_type`, `carousel_data`, `location{latitude,longitude,name,address}`, plus `provider` (baileys, waba, twilio; may sit at body root or inside `json`) | 200 `{message:"MESSAGE SENT SUCCESSFULLY", id, jid}`; 503 `{error:"CLIENT NOT READY", details}`; 500 `{error:"ERROR SENDING MESSAGE" | "SEND THREW" | "BUTTON SEND THREW" | "CAROUSEL SEND FAILED", details}`; WABA path returns `{success,messageId}`or`{success:false,error}` (200/500) |

- **Data:** none; `id` is the WhatsApp/Meta/Twilio message id which Laravel stores in `meta.wa_message_id` for receipts (WD-NODE-020).
- **Rules & edge cases:**
  1. Engine routing (identical in all send controllers and the bulk services): the payload's `provider` is AUTHORITATIVE. `baileys` forces Baileys. `waba` uses Cloud API only if settings have `use_facebook_api` AND both `facebook_phone_id` and `facebook_api_token`. `twilio` uses Twilio only if `isTwilioSettings` (toggle plus sid, token, from). Missing or unknown provider falls back to the legacy heuristic: `use_facebook_api` means WABA (no credential check), else Twilio when configured, else Baileys. If `provider=waba` but credentials are absent the code silently falls through to Baileys.
  2. Footers: a caller `footer` wins and is appended as `\n\n<footer>` on WABA/Twilio text. Otherwise the plan-gated branding footer from settings is appended as `\n\n_<footer>_` (idempotent if already the suffix). Interactive messages carry the footer in the interactive footer field (caller first, then the branding footer cut to 60 chars). QUIRK: on the Baileys plain-text branch the caller footer is ignored and only the branding footer applies.
  3. WABA: text `{preview_url:false}`; with buttons it becomes an interactive `button` message (at most 3 buttons, id = `button.value` or `btn_<i>`, title cut to 20 chars, body = message); title, subtitle, carousel and location pin are not sent on WABA.
  4. Twilio: plain text only; buttons are dropped with a warning; returns `{message,id}` on success.
  5. Baileys: waits up to 8 s (250 ms polling) for the socket to be ready, else 503 (guards the post-pair 515 restart race). Target jid = `targetJid` when it contains `@lid`, `@s.whatsapp.net` or `@g.us`; otherwise `formatPhoneNumber` (all digits, `@s.whatsapp.net`; the earlier "last 12 digits" truncation misrouted Argentina/Brazil numbers and was removed).
  6. Baileys carousel (`template_type` carousel with `carousel_data` array or JSON string): cards `{title, body, footer?, image (image_path, else `<APP>/uploads/templates/carousel/<image_filename>`), buttons}` are sent through `sendCarouselMessage` before the buttons branch.
  7. Baileys buttons: `formatInteractiveButtonsForBaileys` (WD-NODE-029 helper) caps at 3, normalizes aliases (`url`, `website`, `link`, `cta_url` to visit_website; `call`, `phone` to call_phone; `copy`, `coupon` to copy_code; `reply` to quick_reply), drops buttons with empty url/phone/code, prefixes `https://` on bare URLs, and is sent as `interactiveButtons` with optional bold `title` and muted `subtitle`.
  8. Location pin: after any successful branch (Baileys only) a separate location message is sent when `location` has valid coordinates (-90..90, -180..180); failures are logged and ignored.
  9. Tracked link rewriting is done in Laravel; the bridge only rewrites button URLs when `trackingId` and `appDomainName` are passed to the formatter (used by campaign code; not by this endpoint).
  10. Timeout interplay: the socket's `defaultQueryTimeoutMs` is 120 s but Laravel waits 40 s (dispatcher text), 90 s (dispatcher media), 20 s (inbox text), 60 s (inbox media). QUIRK: a slow send can be reported failed by Laravel while WhatsApp later delivers it, so an operator retry produces a duplicate.
- **Async & events:** none (synchronous). Sends on one socket are serialized (WD-NODE-029).
- **External systems:** WhatsApp Web; Meta Graph API (WD-NODE-027); Twilio REST.
- **Settings:** per-number settings (WD-NODE-026), pacing not applied to single sends.
- **Acceptance criteria:**
  - Given a ready Baileys device and `provider:"baileys"`, when text is posted, then one message is sent and `id` is returned.
  - Given `provider:"waba"` and valid credentials, then the Graph call is made and the WABA message id returned.
  - Given a workspace with a branding footer and no caller footer, then the delivered text ends with `\n\n_<footer>_` exactly once.
  - Given four buttons, then only three reach WhatsApp.
  - Given the socket is not ready after 8 s, then 503 `CLIENT NOT READY`.
- **Source refs:** node/controllers/messageController.js (`sendMessage`), node/utils/helpers.js (`formatPhoneNumber`, `formatInteractiveButtonsForBaileys`), node/utils/campaignHelpers.js (`sendCarouselMessage`), app/Services/WhatsAppDispatcher.php, app/Services/InboxDispatcher.php, Documentation/pages/developer-guide/engines.html
- **Port notes:** In the target the API picks the engine (provider adapter interface: `sendText`, `sendMedia`, `sendInteractive`, `sendTemplate`) and only the Baileys adapter lives in the worker; Cloud API and Twilio adapters run in the API/worker without a Node hop. Enforce idempotency keys on send commands to remove the duplicate-on-timeout hazard. Footer rule (append italic branding footer unless suppressed) belongs in one shared formatter.

### WD-NODE-023 — Outbound media sends (`send-media-only`, `send-media-message`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-NODE-022, WD-NODE-028
- **Summary:** Send an image, video, audio (voice note), or document, with or without caption, and optionally with interactive buttons and footer.
- **Actors & access:** Laravel dispatchers (media is sent inline as `file_base64` with real `filetype` and original file name to avoid a PHP dev-server deadlock and keep extensions correct).
- **UX & screens:** none in the bridge (chat/inbox composers, campaigns, broadcasts).
- **Endpoints:**

| Method uri                            | Request                                                                                                                                   | Response                                                                                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/send-media-only/:phone`    | `targetPhoneNumber`, `targetJid`, `file` (URL or path), `file_base64`, `filetype` (mime), `fileName`, `ptt` or legacy `voice`, `provider` | 200 `{message:"MEDIA SENT SUCCESSFULLY", id}`; 404 `{error:"CLIENT NOT FOUND"}`; 500 `{error:"ERROR SENDING MEDIA", details}`; WABA `{success,messageId}`                      |
| `POST /api/send-media-message/:phone` | same plus `caption` (default ""), `buttons[]`, `footer`; `filetype` defaults `image/png`                                                  | 200 `{success:true, message:"Media Sent Successfully!"}` or `{success:true,message:"Media + Buttons Sent!",id}`; 404 `{error:"CLIENT NOT FOUND"}`; 500 `{success:false,error}` |

- **Data:** none.
- **Rules & edge cases:**
  1. Provider gate: `baileys` or `twilio` provider forces the Baileys branch; `waba` needs full credentials; unset uses `use_facebook_api`. QUIRK: there is no Twilio branch in either media endpoint (a Twilio workspace falls into the Baileys path and answers 404 because no socket exists), unlike `send-message`.
  2. WABA branch: media kind from `filetype` substrings (mp4/3gp video; mp3/ogg/aac/opus audio; jpg/jpeg/png/gif/webp image; media-message uses `video`/`audio`/`image` substrings), then from the URL extension (`mediaTypeFromUrl`, needed because templates store `application/octet-stream`), else document; the media is passed by public `link`. Documents carry `filename` = last URL segment. With buttons on a media message the message becomes an interactive `button` message whose header is the media (audio headers are downgraded to document); max 3 reply buttons, titles 20 chars.
  3. Baileys branch: socket must exist (not checked for ready, unlike text); jid resolution as in WD-NODE-022. Media bytes come from `file_base64` when present, else `downloadAndPrepareMediaBaileys(file)` (WD-NODE-028). Mimetype precedence: caller `filetype` unless empty or `application/octet-stream`, then the downloaded response type, then URL extension. The message key is chosen by mime prefix (image, video, audio, else document with `fileName` default = URL basename or `file`).
  4. Voice notes: audio with `ptt` (or `voice`) true/`'true'` is marked push-to-talk so WhatsApp shows the round voice-note bubble.
  5. Buttons with media on Baileys: one message with `image`/`video`/`document` key, `caption`, `footer`, `interactiveButtons`, `hasMediaAttachment:true`; audio buttons fall back to a document header. The media-message endpoint does NOT append the branding footer (only the caller footer).
  6. Upload timeout for Baileys media is 180 s (`mediaUploadTimeoutMs`).
- **Async & events:** none.
- **External systems:** WhatsApp CDN upload; Meta Graph (fetches the `link` itself, so it must be public HTTPS).
- **Settings:** none.
- **Acceptance criteria:**
  - Given `file_base64` of a PNG and `filetype:"application/octet-stream"`, when sent via media-message with a caption, then WhatsApp shows an image with the caption (not a `.bin` document).
  - Given `ptt:true` and an ogg audio, then the recipient sees a voice note.
  - Given a Baileys device that is not paired, then 404 `CLIENT NOT FOUND`.
  - Given two buttons on a video, then one interactive message with the video header is delivered.
- **Source refs:** node/controllers/messageController.js (`sendMediaOnly`, `sendMediaMessage`), node/utils/helpers.js (`downloadAndPrepareMediaBaileys`)
- **Port notes:** Upload media once to object storage; pass a signed URL to Cloud API and let the Baileys adapter stream from storage. Model `MediaSendCommand{kind, url|storageKey, mime, fileName, caption, ptt, buttons}`.

### WD-NODE-024 — Location, contact card, group message and product catalog sends

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-NODE-022
- **Summary:** Four specialised send endpoints: a location pin, a shared contact card, a text into a WhatsApp group with @mentions, and a product catalog (native Cloud API product messages or a Baileys carousel).
- **Actors & access:** Laravel (`WhatsAppDispatcher`, `InboxDispatcher`, `BaileysCatalogService`, ordering `GroupNotifier`, `Api/App/ChatController`).
- **UX & screens:** inbox composer location/contact actions (TIB1/CHAT); catalog send from Store (CAT); order group notify (CHK).
- **Endpoints:**

| Method uri                              | Request                                                                                                                                                                                                                                                      | Response                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/send-location/:phone`        | `targetPhoneNumber`, `targetJid`, `message` (name/address), `latitude`, `longitude`, `provider`                                                                                                                                                              | `{message:"LOCATION SENT SUCCESSFULLY", id}`; 503 not ready; WABA `{success,...}`                                                     |
| `POST /api/send-contact/:phone`         | `targetPhoneNumber`, `targetJid`, `displayName`, `name`, `phone`, `vcard`                                                                                                                                                                                    | `{ok:true,id}`; 503 `CLIENT NOT READY`; 500 `CONTACT SEND FAILED`                                                                     |
| `POST /api/send-group-message/:phone`   | `group_jid`, `text`, `mentions[]` (numbers)                                                                                                                                                                                                                  | `{message:"GROUP MESSAGE SENT", id}`; 503 when no socket; 400 `group_jid required`                                                    |
| `POST /api/send-product-catalog/:phone` | `targetPhoneNumber`, `targetJid`, `products[]`, `type` single/multi/catalog (default multi), `header_text`, `body_text`, `footer_text`, `catalog_id`, `retailer_id`, `thumbnail_retailer_id`, `section_title` (default "Products"), `product_retailer_ids[]` | 200 `{success:true,message:"Product catalog sent!",messageId}` or WABA result; 400 `No products provided for carousel`; 404 no client |

- **Data:** none.
- **Rules & edge cases:**
  1. Location: WABA message name and address both equal `message` or "Location"; Baileys sends `degreesLatitude/Longitude` (floats) plus `name` and `address` only when the trimmed text is non-empty (cut to 200 chars). Provider gate as WD-NODE-023 (no Twilio branch).
  2. Contact: when no `vcard` is given a minimal vCard 3.0 is built from name and phone (`TEL;type=CELL;type=VOICE;waid=<digits>`); Baileys only, no engine routing.
  3. Group message: Baileys only; a `group_jid` without `@g.us` is normalized by keeping digits and hyphens; each mention number becomes a `<digits>@s.whatsapp.net` jid; the text must already contain the matching `@<number>` tokens. The check is `if (!sock)` only (no ready check).
  4. Catalog: uses WABA native messages when `use_facebook_api` and `catalog_id` are present (single product message; multi `product_list` with one section, header default "Our Products", body default "Browse our collection"; or `catalog_message` with optional thumbnail); otherwise a Baileys carousel: each product a card (title cut to 100, body = `<currency> <price:.2f>` plus ` (Out of Stock)` plus description cut to 200, footer = `footer_text` or category, image = `image_url`) with buttons `Order Now` (quick reply `order_<retailer_id|id|index>`) and, when `url` exists, `View Details` (URL). Carousel defaults: title "Product Catalog", body "Browse our products and order directly!", footer "Reply with product name to order". No Twilio handling and no provider override here (`provider` field is ignored).
- **Async & events:** none.
- **External systems:** Meta Graph, WhatsApp.
- **Settings:** none.
- **Acceptance criteria:**
  - Given lat 12.97 and lng 77.59 on a Baileys device, then a location pin is delivered.
  - Given `group_jid` of a group the bot belongs to and two mentions, then the group message renders two mentions.
  - Given a WABA workspace with `catalog_id` and type multi with three retailer ids, then one product-list message is sent.
  - Given no products on the Baileys path, then 400.
- **Source refs:** node/controllers/messageController.js, node/utils/campaignHelpers.js, app/Services/WhatsAppCatalog/BaileysCatalogService.php, app/Services/Ordering/GroupNotifier.php
- **Port notes:** Add `provider` handling and Twilio degrade paths symmetrically in the target adapters; keep group send as a Baileys-only capability flag on the device.

### WD-NODE-025 — Message actions: react, pin, star, edit, delete

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-NODE-022
- **Summary:** Unofficial-API-only message actions initiated from the team inbox or chat: emoji reaction, pin/unpin, star/unstar, edit a sent text, delete for everyone. Cloud API and Twilio silently skip them (Laravel side).
- **Actors & access:** operators with reply rights in TIB1 (RBAC); Laravel calls Node with timeout 10 s (`messageAction`).
- **UX & screens:** message context menu in inbox/chat.
- **Endpoints:**

| Method uri                        | Request                                                                            | Response                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `POST /api/send-reaction/:phone`  | `targetPhoneNumber`, `targetJid`, `targetMessageId`, `fromMe`, `emoji` ("" clears) | `{ok:true,id}`; 503; 404 `No target message to react to` |
| `POST /api/pin-message/:phone`    | plus `pin` (false/'false' = unpin), `duration`                                     | `{ok:true,id}`; 400 `targetMessageId required`; 503      |
| `POST /api/star-message/:phone`   | plus `star`                                                                        | `{ok:true}`                                              |
| `POST /api/edit-message/:phone`   | plus `newText` (non-empty string)                                                  | `{ok:true,id}`; 400 `newText required`                   |
| `POST /api/delete-message/:phone` | `targetMessageId`, `fromMe`, `targetJid`                                           | `{ok:true,id}` (tombstone id)                            |

- **Data:** none; Laravel resolves `targetMessageId` from `meta.wa_message_id` of the stored row.
- **Rules & edge cases:**
  1. All need a ready socket (503 otherwise) and the target's stored WhatsApp id; jid from `targetJid` when it contains `@`, else formatted phone. `fromMe` accepts boolean or the string `'true'`.
  2. Reaction without a `targetMessageId` falls back to the newest from-me message in the in-memory store for that chat (legacy).
  3. Pin uses a hand-built `pinInChatMessage` relay with attribute `edit=2` because the fork lacks the `pin` convenience branch. `duration` is parsed (default 86400 s) but does not change the send (the proto has no duration): QUIRK, the UI's 24h/7d/30d choice has no effect.
  4. Star uses `chatModify` and only changes the operator's own WhatsApp client (not pushed to the recipient).
  5. Edit relies on WhatsApp's own 15-minute window; Laravel validates the window before calling (`messageEdit`); the bridge does not.
- **Async & events:** none.
- **External systems:** WhatsApp Web.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a stored outbound message with a wa id, when the operator reacts with a thumbs-up, then the customer sees the reaction and sending "" clears it.
  - Given a message without a stored wa id, when pinned, then 400 and Laravel shows an error.
  - Given delete for everyone, then the customer sees "This message was deleted".
- **Source refs:** node/controllers/messageController.js, app/Services/InboxDispatcher.php, app/Services/WhatsAppDispatcher.php, app/Http/Controllers/TeamInboxController.php
- **Port notes:** Expose as worker commands `message.react|pin|star|edit|delete`; validate the 15-minute edit rule in the API; hide the pin duration selector or implement via the newer Baileys pin API when it supports duration.

### WD-NODE-026 — Per-number settings cache, `whatsapp-settings` endpoint and cache busting

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-NODE-002
- **Summary:** For every send the bridge needs to know the number's engine, credentials and branding footer. It fetches them from Laravel per phone, caches for 5 minutes, refreshes warm entries in the background, and Laravel can flush the cache when configuration changes.
- **Actors & access:** Node to Laravel (token, 403). Cache flush: Laravel to Node (`POST /api/cache-bust`, token, 401).
- **UX & screens:** none; effects: WABA connection, branding footer changes apply to the next send.
- **Endpoints:**

| Method uri                  | Route name | Controller                         | Request                                  | Response                                                                                                                                                                                                                                                            |
| --------------------------- | ---------- | ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET api/whatsapp-settings` | (none)     | `WaConnectController@nodeSettings` | query `phone` or `phone_number` (digits) | `{whatsapp_business_api:0/1, use_facebook_api, facebook_token, facebook_api_token, facebook_phone_id, facebook_phone_number_id, facebook_app_version, use_twilio, twilio_account_sid, twilio_auth_token, twilio_from_number, twilio_sandbox, branding_footer}`; 403 |
| Node `POST /api/cache-bust` |            |                                    | `{phone?}` digits                        | `{ok:true, flushed:n, phone                                                                                                                                                                                                                                         | "(all)"}` |

- **Data:** `wa_provider_configs` (provider waba/twilio, status connected, encrypted creds `access_token`, `phone_number_id`, `account_sid`, `auth_token`, `from_number`, `sandbox`, meta_json), `devices`, `system_settings` (`default_send_method`, `waba_graph_api_version` default v23.0), `BrandingFooterService`.
- **Rules & edge cases:**
  1. Laravel matching: WABA config chosen only among CONNECTED configs whose phone (or `meta_json.display_phone_number`) equals the query digits, allowing an up-to-4-digit country-code difference in either direction; Twilio the same. WABA and Twilio are mutually exclusive (WABA wins). Phone supplied but unmatched: return Baileys defaults, never platform credentials (prevents cross-tenant leakage). No phone: engine flag from `default_send_method === 'waba'` with empty credentials.
  2. Branding footer: workspace resolved from the WABA config, else from the active Baileys `devices` row (digit compare), else null, then `BrandingFooterService::resolve` (plan and override gated; null for plans that remove branding).
  3. Cache key `<workspaceId>:<phone>` (workspace part only when the caller passes `workspace_id`/`ws_id`, otherwise `*` or phone). TTL 5 min. Fetch timeout 8 s. Success stores `{...data,last_success:true}`. On failure: return the stale-but-real entry if any; else return `{use_facebook_api:false, facebook_phone_id:null, facebook_api_token:null, branding_footer:null}` WITHOUT caching, so the next send retries. The fallback footer is deliberately null (a boot-time global footer used to leak the platform footer onto Premium workspaces).
  4. Background: warm at boot for restored phones and every 5 minutes for all connected phones (`startSettingsRefreshLoop`), so chat sends rarely wait.
  5. `cache-bust` flushes one phone (digits) or all entries. It computes the key from the phone only, so entries stored with a workspace prefix would not be found (callers of `getWhatsAppSettings` normally pass only `phone`, so this works in practice; broadcasts additionally pass `broadcast_id` which is ignored by Laravel).
  6. `NodeCacheBuster` (Laravel): `bustWorkspace(wsId)` posts one cache-bust per device phone of the workspace (digits of `country_code + phone_number`), or one global flush when the workspace has no devices; `bustAll()` posts a global flush; timeout 2 s, best effort, failures logged at info. `refreshNodeSettings()` GETs `/api/refresh-settings` (WD-NODE-004). Callers: Twilio and Baileys connect saves (`WaConnectController::saveTwilio/saveBaileys`), mobile device connect/disconnect (`Api/App/DeviceController`), workspace branding footer save (`AccountController`), admin provider settings save and platform footer change (`bustAll`).
  7. Security: this endpoint returns decrypted access tokens; the token guard is the only protection.
- **Async & events:** background warm loop; cache-bust HTTP.
- **External systems:** none.
- **Settings:** `waba_graph_api_version`, `default_send_method`, branding footer settings (SET/PLAN).
- **Acceptance criteria:**
  - Given a workspace with a connected WABA number, when Node requests settings for that phone, then `use_facebook_api:true` with token and phone-number id is returned; for a different workspace's phone the first workspace's token is never returned.
  - Given the admin changes the branding footer, then the next send from that workspace's devices uses it without waiting 5 minutes.
  - Given Laravel times out and a previous successful entry exists, then the stale entry is used; with no entry the null-footer defaults are used and not cached.
- **Source refs:** node/utils/helpers.js (`getWhatsAppSettings`, `flushSettingsCache`), node/routes/index.js (`cache-bust`), node/index.js (`startSettingsRefreshLoop`), app/Http/Controllers/WaConnectController.php (`nodeSettings`), app/Services/NodeCacheBuster.php, app/Services/BrandingFooterService.php
- **Port notes:** Engine and credentials should be resolved by the API from the device record (single source of truth) and passed in the send command; no settings HTTP hop or cache is needed inside the worker. If a cache remains, invalidate by event (`provider_config.updated`).

### WD-NODE-027 — Cloud API and Twilio direct senders inside the bridge

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-NODE-026
- **Summary:** For WABA and Twilio numbers the bridge makes the provider HTTP call itself using the credentials fetched from Laravel; flows, broadcasts, scheduled sends and single sends share these two helpers.
- **Actors & access:** system.
- **UX & screens:** none.
- **Endpoints:** outbound from Node: `POST https://graph.facebook.com/{version}/{phone_number_id}/messages` (Bearer token, timeout 30 s); `POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json` (basic auth sid:token, form body, timeout 20 s).
- **Data:** none.
- **Rules & edge cases:**
  1. Graph version resolution: settings `facebook_app_version` (from `waba_graph_api_version`), else env `FACEBOOK_API_VERSION`, else `v23.0`. Recipient digits only (no `+`). Payload = `{messaging_product:"whatsapp", recipient_type:"individual", to, ...messageData}`. Success returns `{success:true, messageId: messages[0].id or "fb_<ts>"}`; failure `{success:false, error}` where `formatMetaError` builds Meta's own human message (`error_user_title — error_user_msg` or `error_data.details` or `message`) plus `(code N/subcode, trace T)`, mirroring PHP `MetaError::describe`.
  2. Twilio: needs sid, token and from; `To`/`From` as `whatsapp:+<digits>`; `StatusCallback` = `<APP_DOMAIN_NAME or settings.app_domain>/api/twilio/status` when a domain exists (Twilio then reports delivered/read/failed; the route is owned by the WhatsApp provider domain); types text (`Body`), media (`MediaUrl` + optional `Body`), location (`PersistentAction geo:lat,lng`, body default "Location"), template (`ContentSid` required; `ContentVariables` JSON with string keys and scalar values). Interactive buttons without a ContentSid are intentionally unsupported. Errors return `{success:false,error,errorCode}`.
  3. `sendTwilioBulkMessage` (in sendSafety) chooses ContentSid template send (positional variables built by `buildTwilioContentVariables` from `variable_map.body`, aliases name/first_name, phone/mobile/number, email, company, custom attributes, otp override for position 1), else media when the template has an attachment (URL fallback `<APP_DOMAIN_NAME>/storage/wa-templates/<file>`), else text.
  4. 24-hour customer-service-window errors (Meta 131047 "needs a template") are surfaced to the UI by Laravel hints (BSP/WABA domains).
- **Async & events:** Twilio status callback to Laravel (external route).
- **External systems:** Meta Graph API, Twilio REST.
- **Settings:** `waba_graph_api_version`, `FACEBOOK_API_VERSION`, `APP_DOMAIN_NAME`.
- **Acceptance criteria:**
  - Given a Meta error 131047, when a text send fails, then the returned `error` contains Meta's user message and `(code 131047, trace ...)`.
  - Given a Twilio template send with `contentVariables {1:"Ann"}`, then the request carries `ContentSid` and `ContentVariables={"1":"Ann"}`.
  - Given no Graph version anywhere, then `v23.0` is used.
- **Source refs:** node/utils/helpers.js (`sendMessageViaFacebookApi`, `formatMetaError`, `sendMessageViaTwilioApi`), node/utils/sendSafety.js (`isTwilioSettings`, `buildTwilioContentVariables`, `sendTwilioBulkMessage`)
- **Port notes:** These become the Cloud API and Twilio provider adapters in the API/worker (`provider-adapter` skill); reuse the Meta error describer across UI hints.

### WD-NODE-028 — Media fetch safety: SSRF guard, local-path containment, MIME detection, HTTPS rule

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-NODE-023
- **Summary:** Before the bridge downloads media for Baileys it blocks internal targets and path traversal, and it works out a correct MIME type so images do not arrive as `.bin` documents.
- **Actors & access:** system.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** temporary file `utils/tempMedia_<ts>.jpg<ext>` deleted after read.
- **Rules & edge cases:**
  1. Remote URLs must be `http(s)`, host not an IP in a blocked range (10/8, 127/8, 0/8, 169.254/16 incl. cloud metadata, 172.16/12, 192.168/16, 100.64/10 CGNAT, 224+ multicast/reserved, IPv6 loopback/unspecified, fe80::/link-local, fc/fd unique-local, IPv4-mapped forms), and every resolved DNS address is checked too (all A/AAAA). DNS failure is left to axios (no hole opened). Redirects limited to 3. QUIRK: redirect targets are not re-validated, so an allowed host can redirect to an internal one (SSRF bypass).
  2. Non-http values are treated as local file paths and must resolve inside the allow-list: `<project>/public`, `<project>/storage`, `node/utils`, plus `MEDIA_READ_BASES` (comma separated absolute paths). Containment uses a separator-aware relative-path test and then the real path (symlink escape rejected); missing files fail with "File not found" after the lexical check. Errors: "Local media path is outside the allowed media directory".
  3. MIME: response `content-type` for remote files, else extension map (images jpg/jpeg/png/gif/webp/bmp/svg; video mp4/avi/mov/wmv/flv/mkv/3gp; audio mp3/wav/ogg/aac/m4a/opus; docs pdf/doc/docx/xls/xlsx/ppt/pptx/txt/csv/zip/rar), default `application/octet-stream`; extension default `.jpg`.
  4. `assertHttpsMedia` (broadcast pipeline only): `http://` rejected ("Media URL must be HTTPS (Meta rejects http://)"), other non-https schemes rejected except `data:`.
  5. Bulk services can carry an inline `attachment_base64` (Laravel `WaTemplate::inlineAttachment`) so recipients do not each trigger a download.
- **Async & events:** none.
- **External systems:** arbitrary media hosts.
- **Settings:** `MEDIA_READ_BASES`.
- **Acceptance criteria:**
  - Given `mediaUrl=http://169.254.169.254/latest/meta-data`, then the send fails with "Blocked internal media host".
  - Given `../../.env` as a local path, then it is rejected.
  - Given a `.pdf` URL served without content-type, then the send is a document with `application/pdf`.
- **Source refs:** node/utils/helpers.js, node/utils/sendSafety.js (`assertHttpsMedia`)
- **Port notes:** Centralize in a `SafeFetch` service used by every module that fetches user-supplied URLs (media, webhooks, MySQL/HTTP nodes): resolve once, pin the IP, validate each redirect hop. Never read local paths for user input; media comes from object storage keys.

### WD-NODE-029 — Send safety and pacing: jitter, per-socket serialization, daily cap, batching, admin pacing

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-NODE-011
- **Summary:** Anti-ban primitives shared by the Node bulk pipelines, plus the admin-tunable pacing settings the bridge pulls from Laravel.
- **Actors & access:** super-admin edits pacing in Admin → Channel Settings; Node reads via token.
- **UX & screens:** Channel Settings pacing card with "Update timing" quick-save (owned by SET/ASHELL; route `admin/settings/channel-setting/pacing`).
- **Endpoints:**

| Method uri                                   | Route name                     | Controller                                  | Request                                                                                                       | Response                                                                                                            |
| -------------------------------------------- | ------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET api/whatsapp-message-settings`          | (none)                         | `WaConnectController@nodeMessageSettings`   | none                                                                                                          | `{success:true, msg_gap, batches_gap, bw_msg_gap, enable_batches (0/1)}`; 403                                       |
| `POST admin/settings/channel-setting/pacing` | `admin.settings.pacing.update` | `AdminPagesController@settingsPacingUpdate` | `msg_gap` int 1..600 req; `batches_gap` int 1..10000 req; `bw_msg_gap` int 1..1440 req; `enable_batches` bool | JSON `{ok, message, values, bridge}` (what the bridge now holds, null if unreachable); pushes `refreshNodeSettings` |

- **Data:** `system_settings` keys `msg_gap` (default 3 s), `batches_gap` (50), `bw_msg_gap` (5 min), `enable_batches` (false); `baileys_daily_cap` is read by Node from the same payload but Laravel never returns it, so the 4000 default always applies.
- **Rules & edge cases:**
  1. Delay per message: base `msg_gap` seconds (default 3) with uniform jitter of plus or minus 20%, min 1 ms; a WhatsApp Warmer `warmerGap {min,max}` seconds (broadcast payload) overrides with a uniform pick in the range (SCHED owns the warmer). Batch gap: `bw_msg_gap` minutes plus or minus 20%. Batch settings tolerate `1`, `'1'`, `true`, `'true'`; a batch loop only splits when enabled and recipients exceed `batches_gap`.
  2. Fresh pull before every bulk run (`refreshMessageSettings`, timeout 5 s, keeps the cache on failure) so an admin value is authoritative even if the boot/hourly refresh missed it ("set 120 s but it sent instantly" report).
  3. Per-socket send serialization: `sock.sendMessage` is wrapped once (idempotent flag) into a promise chain so concurrent flow/keyword replies never race Baileys' Signal handshake for new recipients; a failed send never blocks the next; only the high-level public method is wrapped.
  4. Daily Baileys cap: default 4000 per device per UTC day, counted in memory per phone (`_dailyTally[phone][YYYY-MM-DD]`, entries older than 2 days pruned). Checked and bumped ONLY by the Node broadcast, scheduled (bulk and recurring), campaign and flow executors; single sends from `messageController` and Laravel-driven campaigns do not count or check. QUIRK: the counter resets on restart, is per process, and pauses (broadcast/bulk set status paused with error "Daily Baileys send cap (N) reached. Resume after midnight."; recurring runs are silently skipped; flows pause the session) with no automatic resume. WABA and Twilio are exempt.
  5. Socket liveness (`isSockUsable`): socket present, `client_ready[phone]` not false, websocket `readyState === 1`, and `sock.user` set; bulk loops check it before each recipient and pause the entity with the sentinel error `__SOCK_DROPPED__` rather than failing the remaining recipients. `pauseOnSockDrop` and `canSendUnderCap` helpers exist but are unused.
  6. Auth templates (`template_type` auth or category authentication) are refused by the broadcast pipeline (status failed) as defense in depth to the PHP gate.
  7. Status values Node reports for these pauses (`paused`) are rejected by Laravel's validators (`update-schedule-status` allows sent, failed, running, completed, scheduled; `update-broadcast-status` allows scheduled, processing, completed, completed_with_errors, failed), so the pause never reaches the database (QUIRK).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `msg_gap`, `batches_gap`, `bw_msg_gap`, `enable_batches` (admin), `baileys_daily_cap` (never supplied).
- **Acceptance criteria:**
  - Given `msg_gap=10`, when a 5-recipient broadcast runs on Baileys, then gaps between sends fall between 8 and 12 s.
  - Given `enable_batches=1`, `batches_gap=100`, `bw_msg_gap=5`, when 250 recipients are sent, then two batch gaps of about 5 minutes (4 to 6) occur.
  - Given 3 concurrent flow replies to new contacts on one device, then the three `sendMessage` calls execute strictly one after another.
  - Given the device reaches 4000 broadcast/flow sends in a UTC day, then the next broadcast is paused with the cap message.
  - Given the socket drops mid-run, then remaining recipients are not marked failed.
- **Source refs:** node/utils/sendSafety.js, node/utils/helpers.js (`refreshMessageSettings`), node/index.js (`fetchMessageSettings`), app/Http/Controllers/WaConnectController.php (`nodeMessageSettings`), app/Http/Controllers/AdminPagesController.php (`settingsPacingUpdate`, `settingsProvidersUpdate`)
- **Port notes:** Implement as a `SendPacer` per device using BullMQ rate limiter (`limiter: {max, duration}`) plus jittered delayed jobs; the daily cap must be a Redis counter keyed by device and UTC date, applied to ALL Baileys sends, with an explicit resume scheduled at the next UTC midnight; store `baileys_daily_cap` in settings and actually deliver it to the worker.

### WD-NODE-030 — Node scheduler core: in-memory queue, cron construction and firing rules

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-NODE-005
- **Summary:** All time-based sends (single, one-off bulk, recurring, broadcast, campaign) are registered with the bridge, which keeps them in memory and turns each into a `node-cron` task in the schedule's timezone. Laravel stores the durable row; Node only executes.
- **Actors & access:** Laravel server-side (token). Owners of the user-facing features: SCHED (scheduled queue), BCAST, CAMP, APPT (reminders).
- **UX & screens:** none in the bridge.
- **Endpoints:** see WD-NODE-031..034, 037.
- **Data:** `app.locals.scheduledMessages[]` rows `{id (node id), scheduleId (Laravel id), provider, senderPhoneNumber, status, type, ...payload}` and `app.locals.scheduledJobs{nodeId: cronTask}`. Node ids: `bulk_<ms>_<rand9>`, `recurring_...`, `single_...`, `immediate_...`, `broadcast_immediate_...`, `broadcast_scheduled_...`, `campaign_<campaignId>_<ms>_<rand9>`.
- **Rules & edge cases:**
  1. Time parsing: `moment.tz(scheduleDateTime, timezone || "UTC")`. Laravel sends ISO-8601 WITH offset for bulk/recurring/broadcast (a naive string would be read as already-local and shift sends by the UTC offset; a documented past bug) and a wall-clock `Y-m-d H:i:s` in the row timezone for single sends.
  2. One-off cron expression is `minute hour day month *` (five fields, no year), created with `{timezone}`. Because it has no year, a task that never fires would fire a year later; tasks stop themselves in the executor's `finally` (bulk, broadcast) so one-off semantics hold after they run.
  3. Fire-now rule: for bulk and single schedules a target time within 5 seconds of now or already past executes immediately via `setImmediate` and no cron is created (a cron for the current minute only matches second :00 and would otherwise wait until next year). Broadcast and campaign scheduling have no such rule (QUIRK: a past `scheduleDateTime` there registers a cron that will not fire until the same minute next year).
  4. Dedup by caller id: registering a bulk schedule whose `scheduleId` already exists stops and removes the earlier rows (re-arms appointment reminders); cancelling by `scheduleId` cancels every row with that id.
  5. QUIRK: the array is never pruned for bulk, recurring, broadcast and campaign rows (completed rows stay for the process lifetime; only single sends are removed 60 s after firing), so memory grows and `GET scheduled-messages/:phone` returns history.
  6. Everything is lost on restart except what Laravel re-supplies (WD-NODE-036): scheduled broadcasts and single scheduled chat messages are NOT restored (no Laravel sync for them; `api/campaigns/sync` returns an empty list) and their Laravel rows stay `scheduled` forever.
  7. Paused/failed/cancelled rows are skipped by executors; `resume` calls `task.start()`.
  8. `node-cron` runs in-process: it cannot survive multiple bridge instances (each would fire) and drifts with the event loop.
- **Async & events:** cron callbacks; HTTP callbacks to Laravel.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a bulk schedule 2 hours ahead in Asia/Kolkata, when the local time matches, then the executor runs once in that timezone and the task is stopped afterwards.
  - Given a bulk schedule for a time 3 seconds ahead or in the past, then it runs immediately and no cron is stored.
  - Given a second registration with the same Laravel `scheduleId`, then only the newer row remains.
  - Given a Node restart, then bulk one-offs and recurring schedules return only through the boot sync.
- **Source refs:** node/controllers/scheduleController.js, node/controllers/broadcastController.js, node/controllers/campaignController.js, node/services/scheduleService.js, app/Services/NodeSchedulerClient.php, Documentation/pages/developer-guide/node-bridge.html
- **Port notes:** Replace with BullMQ: one-off = delayed job with `jobId=schedule:<id>` (dedupe by id), recurring = job scheduler / repeatable job with a cron pattern and `tz`, end date as `endDate`; jobs persist in Redis so no boot sync is needed and multiple workers are safe. Use IANA time zones and store the schedule in UTC plus tz.

### WD-NODE-031 — One-off bulk scheduled send and immediate bulk send

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-NODE-030, WD-NODE-029
- **Summary:** Laravel registers a list of phone numbers with a message (text, media with or without caption, location or template) for a future time, or asks for an immediate blast; the bridge sends to each recipient with pacing, per-recipient callbacks and a final status.
- **Actors & access:** Laravel (`NodeSchedulerClient::registerOneOff`, timeout 10 s; appointment reminders use it directly).
- **UX & screens:** /scheduled screens (SCHED).
- **Endpoints:**

| Method uri                               | Request                                                                                                                                                                                                                                                                                                                                                     | Response                                                                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/schedule-message-bulk/:phone` | `scheduleId` (Laravel id), `provider`, `targetPhoneNumbers[]`, `message`, `scheduleDateTime`, `timezone`, `messageType` (text, media, media_with_caption, location, template), `mediaUrl`, `latitude`, `longitude`, `isTemplate`, `templateData`, `recipientAttributes{phone:{name,first_name,last_name,mobile,email,address,title,country_code,language}}` | `{success:true, message, scheduleId:<nodeId>, scheduledFor, timezone}` (or "Sending now" when fired immediately); 500 `Failed to schedule bulk message` |
| `POST /api/send-bulk-immediate/:phone`   | same without time fields                                                                                                                                                                                                                                                                                                                                    | `{success:true,message:"Messages are being sent",scheduleId:<nodeId>}`                                                                                  |

- **Data:** in-memory row; callbacks described in WD-NODE-035.
- **Rules & edge cases:**
  1. Engine per row via `provider` (authoritative; WD-NODE-022 rules, `waba` requires full credentials); Baileys needs a socket; a row with no engine available fails with `Client not found` and no recipients fails with `No recipients`, each posting status `failed`.
  2. Preflight: `refreshMessageSettings`; Baileys daily-cap pre-check (paused with error when exhausted, WD-NODE-029); status becomes `sending`.
  3. Per recipient: liveness gate (paused on drop), phone via `formatPhoneNumber`, attributes for placeholder substitution (`{{name}}`, `{{1}}` through `variable_map`, unresolved placeholders stay literal). WABA: uses the pre-built Meta payload `templateData.meta_payloads_by_phone[phone]` (built by Laravel for APPROVED templates when `waba_templates_v2_enabled`), else plain text within the 24-hour window with the branding footer, else refuses with an explanatory error (never falls through to Baileys). Twilio: template via ContentSid, media or text. Baileys: text, media (by mimetype: image, video, audio, else document with file name), location (name placeholders replaced), template payload via the shared template sender (buttons, carousel, header media).
  4. Every recipient posts a per-recipient status to Laravel (sent or failed with error and message id). A fresh jittered delay follows every recipient (`finally`), and jittered batch gaps apply when batching is enabled and recipients exceed the batch size.
  5. Final status: all failed gives `failed`, else `completed`; posted with `totalSent` and QUIRK `totalDelivered:0` (delivered is only real from receipts, which bulk sends never receive: `sentMessages` is only populated for broadcasts, so scheduled sends never show "delivered/read" on Baileys). The fourth argument passed as failed count is actually the sent count in the final call (`updateBulkScheduleStatus(..., sentCount, sentCount, ...)`), and `totalFailed` is never sent.
  6. Sock drop mid-run: row set `paused`, exit without marking the rest failed; the `paused` status POST is rejected by Laravel (WD-NODE-029 rule 7), so Laravel keeps `scheduled`/`running`; no auto-resume.
  7. `finally` stops and deletes the cron task.
  8. Body fields the bridge never reads for bulk: `targetJid` (single schedule too, so group-targeted scheduled sends are addressed to formatted digits).
- **Async & events:** paced loop inside the process (minutes to hours for large audiences; killed by restarts).
- **External systems:** WhatsApp, Meta, Twilio.
- **Settings:** pacing settings.
- **Acceptance criteria:**
  - Given 3 recipients and a text on Baileys, when the time arrives, then three messages go out with jittered gaps and Laravel receives three per-recipient callbacks and one final `completed`.
  - Given a WABA template schedule with pre-built payloads, then Meta receives the template per recipient and a missing payload for one phone fails only that recipient with the explanatory error.
  - Given all recipients fail, then the final status is `failed`.
- **Source refs:** node/controllers/scheduleController.js (`scheduleBulkMessage`, `sendBulkImmediate`), node/services/scheduleService.js (`executeBulkScheduledMessage`), node/utils/helpers.js (`updateBulkScheduleStatus`), app/Services/NodeSchedulerClient.php (`registerOneOff`, `resolveRecipients`, `resolveTemplateData`, `maybePrebuildMetaPayloads`)
- **Port notes:** One BullMQ job per recipient (rate limited per device) instead of a long in-process loop; results written to `scheduled_message_recipients` by the job itself. Preserve resume-safe recipient filtering (already-sent rows are excluded when re-registering).

### WD-NODE-032 — Recurring scheduled sends

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-NODE-031
- **Summary:** Daily, weekly (chosen weekdays) or monthly repeats of a message to a fixed snapshot of recipients until an end date.
- **Actors & access:** Laravel (`registerRecurring`).
- **UX & screens:** /scheduled create form (SCHED).
- **Endpoints:**

| Method uri                            | Request                                                                                                                                                      | Response                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `POST /api/schedule-recurring/:phone` | as bulk plus `repeatInterval` (daily, weekly, monthly), `repeatEvery`, `daysOfWeek[]` (0=Sunday), `endDate`, `targetQueues`, `targetGroups`, `targetNumbers` | `{success, message, scheduleId, cronExpression, scheduledFor, timezone}`; 500 `Failed to schedule recurring message` |

- **Data:** in-memory row with `totalRuns`, `lastRunAt`.
- **Rules & edge cases:**
  1. Cron: daily `m h * * *`; weekly `m h * * d1,d2` (all days when empty); monthly `m h <day> * *` from the start date's day (a start on the 29th to 31st skips shorter months). Any other interval leaves the expression undefined and registration fails with 500.
  2. QUIRK: `repeatEvery` is stored but never used to build the cron (Laravel's own `advanceRecurring` honours it for `next_run_at`), so "every 2 days/weeks/months" fires every day/week/month in Node.
  3. End date: the cron callback compares `now` with `moment.tz(endDate, tz)` (00:00 of the end date) and stops, marking the in-memory row completed WITHOUT calling Laravel; so the run on the end date itself never happens (Laravel treats the end date as inclusive to end of day). The executor's own check (only reached from a direct call) uses server-timezone parsing and does post `completed`.
  4. Recipients: the `targetPhoneNumbers` snapshot taken at registration; falls back to `fetchQueueRecipients(targetQueues)` (POST `api/get-queue-recipients`; no such route exists in Laravel v1.7.0, so the call fails and returns []) only when the snapshot is empty. Groups/tags are therefore NOT re-resolved at fire time inside Node (the PHP comment says otherwise); they refresh only when the bridge re-syncs (WD-NODE-036).
  5. Executor: same engine routing, cap, liveness and per-recipient logic as bulk; a run skipped for no socket, no recipients or an exhausted daily cap returns silently (no status). After a run: `totalRuns++`, posts `{status:"running", totalSent:<this run>, totalDelivered:0, lastRunAt, phoneNumber}`. Laravel's idempotency check treats a run whose counters do not exceed the stored totals as a duplicate, so later runs of a stable audience are ignored (no `last_run_at` update, no delta billing) and per-recipient pivot updates are no-ops after the first run (QUIRK; SCHED/WALLET port must define per-run accounting).
  6. Sock drop mid-run exits silently.
- **Async & events:** cron.
- **External systems:** WhatsApp/Meta/Twilio.
- **Settings:** pacing.
- **Acceptance criteria:**
  - Given weekly on Monday and Thursday at 09:00 Asia/Kolkata, then the cron is `0 9 * * 1,4` in that timezone.
  - Given `repeatInterval:"yearly"`, then registration returns 500.
  - Given an `endDate` of tomorrow, then the run tomorrow at 09:00 does not happen (parity quirk; target should include the end date).
- **Source refs:** node/controllers/scheduleController.js (`scheduleRecurring`, `registerRecurringInternal`), node/services/scheduleService.js (`executeRecurringSchedule`), app/Services/NodeSchedulerClient.php (`registerRecurring`), app/Models/ScheduledMessage.php (`advanceRecurring`)
- **Port notes:** Use the BullMQ repeatable-job pattern with `every` and cron and end date inclusive; re-resolve the audience (tags/groups) at fire time inside the job so late-tagged contacts are included; write one `scheduled_message_runs` row per run.

### WD-NODE-033 — Single scheduled message (`schedule-message`) and its execution

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-NODE-030
- **Summary:** Laravel schedules one queued chat message (for the /chat "send later" and team-inbox scheduling) on the bridge; the bridge sends it at the chosen local time.
- **Actors & access:** `WhatsAppDispatcher::buildNodeRequest` for messages with `scheduled_at`.
- **UX & screens:** chat scheduled sends (CHAT/TIB1).
- **Endpoints:**

| Method uri                          | Request                                                                                                                                                                                                                                      | Response                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `POST /api/schedule-message/:phone` | `targetPhoneNumber`, `provider`, `message`, `scheduleDateTime` (wall clock in tz), `timezone`, `messageType` (text, media_with_caption, media_only, location), `mediaUrl`, `latitude`, `longitude`; Laravel also sends `targetJid` (ignored) | `{success:true,message:"Message scheduled" | "Message sending now", scheduleId:<nodeId>, scheduledFor}`; 500 |

- **Data:** in-memory only; removed 60 s after send.
- **Rules & edge cases:**
  1. Controller-local executor (the exported `executeScheduledMessage` in scheduleService is dead and references an undefined `settings`): provider `waba` or `twilio` sends text only (media or location single schedules fail with "single scheduled <type> not supported on <provider> — send it as a campaign/broadcast"); Baileys requires a ready socket, formats the number, then sends text, media (extension based: jpg/jpeg/png/gif image, mp4/avi/mov video, pdf/doc/docx/xls/xlsx document else "Unsupported media type"), or location (`name`/`address` = message).
  2. Status is kept only in memory (sent/failed with `error`); NO callback to Laravel. Laravel's dispatcher records `provider_id` = the returned `scheduleId`, and the outcome of the eventual send is not reflected on the message row (QUIRK; see Open questions).
  3. Fire-now rule (5 s) applies; otherwise cron with the one-off expression; on success or failure the task is stopped and the row removed after 60 s.
  4. `targetJid` is ignored, so group-targeted scheduled sends go to `<digits>@s.whatsapp.net`.
  5. Not restored on restart.
- **Async & events:** cron.
- **External systems:** WhatsApp.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a text scheduled 10 minutes ahead, then it is sent on time and the in-memory row becomes `sent`.
  - Given a media single schedule on WABA, then it fails with the "not supported" error (in memory only).
  - Given a Node restart before the time, then the message is never sent by the bridge.
- **Source refs:** node/controllers/scheduleController.js (`scheduleMessage`, local `executeScheduledMessage`), app/Services/WhatsAppDispatcher.php (`buildNodeRequest`)
- **Port notes:** Model as a delayed send job written from the message row (`messages.scheduled_at`); job updates the message status itself. Drop this endpoint.

### WD-NODE-034 — Schedule lifecycle endpoints and the `NodeSchedulerClient`

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-NODE-030
- **Summary:** Pause, resume, cancel, update and list schedules held by the bridge, plus the Laravel client that registers and controls them.
- **Actors & access:** Laravel (`NodeSchedulerClient`, `AppointmentReminderScheduler`, `ScheduledController`). All calls carry `X-Node-Token` explicitly (and via the global middleware).
- **UX & screens:** /scheduled actions Pause, Resume, Cancel, Delete (SCHED).
- **Endpoints:**

| Method uri                                         | Caller                                | Behavior                                                                                                                     |
| -------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/pause-schedule/:scheduleId`             | `NodeSchedulerClient::pause`          | row status `paused`, task `stop()`; 404 `Schedule not found`                                                                 |
| `POST /api/resume-schedule/:scheduleId`            | `resume`                              | status `running` (even for a one-off that was `scheduled`), task `start()`                                                   |
| `DELETE /api/cancel-scheduled-message/:scheduleId` | `cancel`, appointment reminder cancel | matches node id OR caller `scheduleId`; stops and deletes every matching task; removes rows; `{success,message,cancelled:n}` |
| `PUT /api/update-schedule/:scheduleId`             | (no caller in v1.7.0)                 | re-times a schedule by node id; dead                                                                                         |
| `GET /api/scheduled-messages/:phone`               | (debug only)                          | `{success,count,messages}` of in-memory rows for the sender                                                                  |

- **Data:** `scheduled_messages.node_schedule_id` (Laravel, from register response).
- **Rules & edge cases:**
  1. `NodeSchedulerClient` is a no-op when the bridge URL is empty (`isConfigured`); register returns the Node id or null (non-2xx and exceptions are logged and swallowed, the row is kept locally). Lifecycle calls require a stored `node_schedule_id` and return false otherwise. `resolveRecipients` snapshots tag, group, queue (past broadcasts of the workspace) or number audiences, drops recipients already `sent` for this schedule (resume safe), builds per-number attribute maps.
  2. A registration failure leaves `node_schedule_id` empty; the boot sync later registers it under a random id that Laravel never learns, so cancel/pause from the UI no longer reaches the task (QUIRK).
  3. Node `updateSchedule` and `getScheduledMessages` are unused by Laravel; the cron built in `updateSchedule` ignores immediate fire.
  4. Timeouts: 10 s (register, lifecycle), reminders 10 s/6 s.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** bridge URL.
- **Acceptance criteria:**
  - Given a registered schedule, when Laravel pauses it, then the bridge task is stopped and the row `paused`; resume restarts it.
  - Given an appointment reminder registered with a synthetic scheduleId, when the appointment is cancelled, then `DELETE cancel-scheduled-message/<scheduleId>` removes it although Laravel never knew the Node id.
  - Given an unreachable bridge, then registration returns null and the local UI still updates.
- **Source refs:** node/controllers/scheduleController.js, app/Services/NodeSchedulerClient.php, app/Services/Appointments/AppointmentReminderScheduler.php, app/Http/Controllers/ScheduledController.php
- **Port notes:** Job ids replace node ids; pause = remove the delayed job and keep the row; resume = re-add; cancel = remove.

### WD-NODE-035 — Schedule status callbacks (`update-schedule-status`, `update-scheduled-contact-status`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-NODE-031
- **Summary:** The bridge reports aggregate and per-recipient outcomes of scheduled sends; Laravel updates counters, per-recipient pivot rows, plan-first billing and recurring state.
- **Actors & access:** Node to Laravel, token (403 via abort).
- **UX & screens:** /scheduled detail tabs sent/delivered/failed (SCHED).
- **Endpoints:**

| Method uri                                 | Route name                        | Controller                                | Request                                                                                                                                                                                                                                   | Response                                                          |
| ------------------------------------------ | --------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `POST api/update-schedule-status`          | `scheduled.update-status`         | `ScheduledController@updateStatus`        | `scheduleId` required (Laravel id or node id); `status` in sent,failed,running,completed,scheduled; `totalSent`,`totalDelivered`,`totalFailed` nullable int >= 0; `phoneNumber` max 64; `timestamp`,`lastRunAt` max 64; `reason` max 1000 | `{ok:true}`, `{ok:true,duplicate:true}`, 404 `Schedule not found` |
| `POST api/update-scheduled-contact-status` | `scheduled.update-contact-status` | `ScheduledController@updateContactStatus` | `scheduleId` integer required; `phone` string max 32; `status` in sent,delivered,read,failed; `error` max 512; `messageId` max 128; `timestamp`                                                                                           | `{ok:true,status}` or `{ok:true,noop:true}`; 404                  |

- **Data:** `scheduled_messages` (`status`, `total_sent/delivered/failed`, `charged_sent`, `last_run_at`, `completed_at`, `failed_at`, `failure_reason`, `next_run_at`), `scheduled_message_contacts` (`status`, timestamps, `wa_message_id`, `error_message`).
- **Rules & edge cases:**
  1. Row match: numeric `scheduleId` matches `id`, OR `node_schedule_id` equals the value (the query uses `orWhere`, so a numeric id can also match a node id string collision; QUIRK).
  2. `sent` maps to local `completed`. Duplicate guard: skip when the new status equals the stored one and every supplied counter is <= the stored counter.
  3. Patch: `total_sent` (also `last_run_at`), `total_delivered`, `total_failed`; `completed_at` on completed; `failed_at`/`failure_reason` on failed.
  4. Plan-first billing on `totalSent` delta vs `charged_sent`: for each message `OverflowBilling::consumeOne(workspace, usedThisMonth + metered)`; free while under `monthly_messages_limit`, else one wallet credit; stops at the first `PlanLimitReachedException` and records only what was metered (retryable on a later callback after a top-up); rows without workspace advance `charged_sent` unmetered. Usage counts outbound `inbox_messages` and `messages` this month.
  5. Backstop `backfillPivotFromAggregates`: fills failed then sent then delivered counts from aggregates onto pending pivot rows in id order, when per-recipient callbacks were lost.
  6. Recurring rows: when the status is `completed` and `advanceRecurring()` yields a next run, the row returns to `running`.
  7. Per-recipient: unknown phones get a new pending pivot (contact matched by digits within the workspace); billing settle (`MessageBillingService::settleDelivered`/`settleFailed`) only when `messageId` present, on the RESOLVED template category; rank pending 0, failed 1, sent 2, delivered 3, read 4: only upward transitions apply, `failed` only from `pending`; aggregates recomputed from the pivot (single source of truth).
  8. Node side: `updateBulkScheduleStatus` retries up to 3 times (1.5 s, 3 s backoff) and never throws; the recurring post and the end-date post are bare (no retry).
- **Async & events:** none; webhooks fire from model hooks (INTG).
- **External systems:** none.
- **Settings:** plan `monthly_messages_limit`, wallet credits.
- **Acceptance criteria:**
  - Given a bulk schedule finishing with 10 sent, then the row is `completed`, `total_sent=10`, and 10 message credits are metered (free under quota).
  - Given the same callback twice, then the second returns `duplicate:true` and bills nothing.
  - Given a `read` callback arriving after `sent`, then the pivot becomes `read`; a later `sent` is a no-op.
  - Given a wrong token, then 403.
- **Source refs:** app/Http/Controllers/ScheduledController.php (`updateStatus`, `updateContactStatus`, `backfillPivotFromAggregates`), node/utils/helpers.js, node/services/scheduleService.js (`postRecipientStatus`), app/Services/OverflowBilling.php, app/Services/MessageBillingService.php
- **Port notes:** In the target the job writes recipient rows directly and emits `scheduled_message.progress` events; billing metering happens per delivered message (not per aggregate delta). Keep the rank-based monotonic status update.

### WD-NODE-036 — Active-schedule sync at boot (`scheduled/active`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-NODE-030
- **Summary:** After a restart the bridge asks Laravel for every active schedule and re-registers cron tasks, because timers live only in memory.
- **Actors & access:** Node to Laravel, token (403 abort).
- **UX & screens:** none.
- **Endpoints:**

| Method uri                 | Route name                 | Controller                         | Request                 | Response                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | -------------------------- | ---------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET api/scheduled/active` | `scheduled.active-for-bot` | `ScheduledController@activeForBot` | optional `phone_number` | `{ok:true, schedules:[{id, schedule_type, scheduleId, node_schedule_id, from_number, provider, message, messageType, isTemplate, templateData, mediaUrl, latitude, longitude, scheduleDateTime (ISO+offset), nextRunAt, timezone, targetPhoneNumbers, recipientAttributes, repeatInterval, repeatEvery, daysOfWeek, endDate}]}` |

- **Data:** `scheduled_messages` where status in scheduled or running, ordered by `next_run_at`, limit 1000.
- **Rules & edge cases:**
  1. Eligibility gate (read-only mirror of plan-first billing): drop a schedule only when the workspace has a finite `monthly_messages_limit`, has already used it this month AND the owner has fewer than 1 wallet credit. Legacy rows (no user or workspace) pass.
  2. Recipients and attributes are re-resolved at fetch time (tag/group membership changes are picked up here), template data resolved with workspace attributes, media URL `uploads/scheduled/<file>`.
  3. Node: `registerBulkInternal` SKIPS a one-off whose time is already past (double-send guard, because a completed row whose "completed" callback failed would otherwise re-send; operators re-run manually); `registerRecurringInternal` builds the cron by interval (no catch-up of missed runs); unknown recurring interval skipped. Node id = `node_schedule_id` when present, else a new random id (Laravel is not told).
  4. Timeout 15 s; failures logged with the diagnostic helper; nothing else retried.
- **Async & events:** boot only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given two future one-off schedules and one recurring schedule in the database, when the bridge boots, then three tasks exist.
  - Given a one-off scheduled for one hour ago, then it is skipped and stays `scheduled` in Laravel.
  - Given an over-quota workspace with an empty wallet, then its schedules are not returned.
- **Source refs:** app/Http/Controllers/ScheduledController.php (`activeForBot`), node/controllers/scheduleController.js (`syncScheduledMessages`)
- **Port notes:** Not needed with persisted BullMQ jobs; keep a reconciliation job that detects DB rows whose job is missing and re-enqueues them (with the same past-due policy made explicit and configurable).

### WD-NODE-037 — Broadcast execution engine and lifecycle endpoints

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-NODE-029, WD-NODE-030
- **Summary:** Laravel hands a broadcast (contacts with attributes, template data and pre-built per-recipient payloads) to the bridge for immediate or scheduled delivery; the bridge paces the sends, reports each recipient and the final status, and can be paused, resumed or cancelled.
- **Actors & access:** Laravel (`BroadcastsController::dispatchToNode` path around line 2040-2200, `Api/V1/BroadcastController`, `Api/App/QueueController`); token.
- **UX & screens:** /broadcasts (BCAST).
- **Endpoints:**

| Method uri                                                                | Request                                                                                                                                                                                                                                                                                                            | Response                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/broadcast/send-immediate/:phone`                               | `broadcastId`, `targetContacts[{id,phone,name,first_name,last_name,email,title,middle_name,address,language,contact_group,country_code,mobile,custom_attributes}]` (or legacy `targetPhoneNumbers[]`), `templateData`, `isTemplate`, `message`, `provider`, `warmerGap{min,max}`, `tracked_bodies{contactId:body}` | `{success, message:"Broadcast is being sent", scheduleId, recipientCount}`; 400 `No contacts provided`                                                                                                                                                                                                 |
| `POST /api/broadcast/schedule/:phone`                                     | plus `scheduleDateTime` (ISO+offset), `timezone`                                                                                                                                                                                                                                                                   | `{success,message,scheduleId,scheduledFor,recipientCount}`                                                                                                                                                                                                                                             |
| `POST /api/broadcast/pause/:scheduleId`, `resume/:scheduleId`             |                                                                                                                                                                                                                                                                                                                    | `{success,message}`; 404                                                                                                                                                                                                                                                                               |
| `DELETE /api/broadcast/cancel/:scheduleId`                                |                                                                                                                                                                                                                                                                                                                    | removes row and task                                                                                                                                                                                                                                                                                   |
| `DELETE /api/broadcast/cancel-by-broadcast/:broadcastId`                  |                                                                                                                                                                                                                                                                                                                    | cancels EVERY node row and task whose `broadcastId` matches: `{success,broadcastId,cancelled}`; called by the mobile queue controller (`Api/App/QueueController`) before each re-dispatch to kill orphans that caused "fires 2-3 times"; the web `BroadcastsController` only cancels by stored node id |
| `GET /api/broadcast/list/:phone`, `GET /api/broadcast/status/:scheduleId` |                                                                                                                                                                                                                                                                                                                    | in-memory rows                                                                                                                                                                                                                                                                                         |

- **Data:** in-memory row `{id, broadcastId, senderPhoneNumber, provider, warmerGap, targetContacts, message, templateData, status (sending|scheduled|paused|cancelled|completed|...), type:"broadcast", sentMessages{waId:{contactId,...}}}`.
- **Rules & edge cases:**
  1. Sender phone resolution happens in Laravel: Baileys uses `Broadcast.device_id` (devices), else the workspace's newest connected device, else legacy user device; WABA/Twilio slices resolve the phone from `wa_provider_configs` (`device_id` holds a config id in that case); unresolved sender marks the broadcast `failed`. Laravel posts with timeout 15 s; non-2xx or exceptions mark it `failed`; success stores `node_schedule_id` and status `processing`/`scheduled`; immediate sends also mirror the message into existing open inbox threads.
  2. Node performs NO readiness check at accept time (a not-ready device still accepts and then fails every recipient in the loop, logging the cause).
  3. `executeBroadcastSchedule`: refresh pacing; fetch settings with `phone` and `broadcast_id`; engine routing as WD-NODE-022; refuse auth templates (status `failed`); Baileys daily-cap check (paused); require a socket for Baileys (missing socket: `failed`); mark `processing` to Laravel; loop recipients with batching and liveness gate (sock drop pauses); per recipient: no phone gives `failed` "No phone number"; WABA uses `templateData.meta_payloads[contactId]` (pre-built in PHP for APPROVED templates; forced for media header, buttons or carousel templates even when the v2 flag is off, because Node's fallback only builds text params and Meta rejects with 132012), else the Node fallback builder; Twilio via ContentSid/text; Baileys via the shared template sender (variable map, `tracked_bodies`, buttons, carousel, header media, location pin, https-only media rule) and the Baileys daily tally; each result posts a per-recipient status (WD-NODE-038) and, when a message id exists, is registered in `sentMessages` for receipt routing.
  4. Final status: all failed `failed`; some failed `completed_with_errors`; else `completed`; posted with `success_count` and `fail_count`. On crash: `failed`.
  5. The cron task is stopped after the run, so the schedule is one-shot.
  6. QUIRK: scheduled broadcasts are memory-only (lost on restart, Laravel row stays `scheduled`; `BroadcastSweeper` explicitly skips `scheduled` rows).
  7. Pause/resume: pause sets status `paused` and stops the task (does not interrupt a run already looping); resume sets `scheduled` and restarts the task.
- **Async & events:** paced in-process loop.
- **External systems:** WhatsApp, Meta, Twilio.
- **Settings:** pacing; warmer gaps.
- **Acceptance criteria:**
  - Given 100 contacts on a connected Baileys device, when sent immediately, then Laravel receives 100 per-recipient callbacks and a final `completed`.
  - Given a rapid re-dispatch from the mobile app queue, then Laravel first calls cancel-by-broadcast so only one run remains.
  - Given a media-header WABA template, then Meta receives the pre-built payload with the header parameter.
  - Given a device with no socket, then the run ends `failed` with a log naming the missing device.
- **Source refs:** node/controllers/broadcastController.js, node/services/broadcastService.js, app/Http/Controllers/BroadcastsController.php, app/Http/Controllers/Api/App/QueueController.php, app/Http/Controllers/Api/V1/BroadcastController.php, app/Services/BroadcastSweeper.php
- **Port notes:** Broadcast = a campaign-like job graph in BullMQ (one job per recipient batch, per-device limiter). Move payload building (PHP `TemplatePayloadBuilder`) into a shared template renderer used by every send path. Owner: BCAST.

### WD-NODE-038 — Broadcast status callbacks (`update-message-status`, `update-broadcast-status`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-NODE-037
- **Summary:** Per-recipient and final broadcast results flow back so the index and detail pages track progress, billing settles, the inbox mirrors sent templates and outbound webhooks fire.
- **Actors & access:** Node to Laravel, token (403).
- **UX & screens:** /broadcasts KPI tiles and detail tabs (BCAST).
- **Endpoints:**

| Method uri                         | Route name                         | Controller                                 | Request                                                                                                                                                                                         | Response                               |
| ---------------------------------- | ---------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `POST api/update-message-status`   | `broadcasts.node.message-status`   | `BroadcastsController@nodeMessageStatus`   | `broadcast_id` int req; `contact_id` int req; `status` in pending,sent,delivered,read,failed; `error_message` max 1024; `whatsapp_message_id` max 191; `sent_at`,`delivered_at`,`read_at` dates | `{ok:true}`; 404 `broadcast not found` |
| `POST api/update-broadcast-status` | `broadcasts.node.broadcast-status` | `BroadcastsController@nodeBroadcastStatus` | `broadcast_id` int req; `status` in scheduled,processing,completed,completed_with_errors,failed; `success_count`,`fail_count` int >= 0                                                          | `{ok:true}`                            |

- **Data:** `broadcast_contacts` pivot (`status`, `error_message`, `whatsapp_message_id`, `sent_at`, `delivered_at`, `read_at`), `broadcasts` aggregates via `recomputeAggregates()`, `completed_at`.
- **Rules & edge cases:**
  1. Message status: updates the pivot for the contact (timestamps parsed through Carbon because MySQL rejects ISO `Z`), then recomputes parent counters by counting the pivot (idempotent under duplicate callbacks; earlier code left Unofficial/Twilio broadcasts at Delivered 0 because only success/fail were written).
  2. Billing: with a message id, `sent|delivered|read` calls `settleDelivered(workspace, wamid, phone, resolved category, provider, 'broadcast')`, `failed` calls `settleFailed`; idempotent per wamid (Twilio also reports through its own status webhook).
  3. Inbox mirror: on any of sent/delivered/read (not only `sent`, so a dropped first callback self-heals) the rendered template body (placeholders resolved for that contact, blank name becomes "there") is appended to an OPEN conversation only, keyed `broadcast:<id>:contact:<contactId>` and de-duplicated by wamid; empty bodies are skipped.
  4. Outbound webhooks `message_sent`, `message_delivered`, `message_read`, `message_failed` dispatched with an aggregate block (sent, delivered, read, failed, clicked, total).
  5. Final status: sets status and counts (keeps previous counts when absent) and `completed_at` (first time) for terminal statuses. Node reports `processing` at start and the terminal status at the end; QUIRK: `paused` is not an allowed value (422), so pauses never reach Laravel.
  6. No retries or queue on the Node side beyond axios; failures are logged.
- **Async & events:** webhooks; inbox mirror.
- **External systems:** customers' webhook endpoints.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a recipient sent then delivered then read, then the pivot shows read with all three timestamps and the parent counters match.
  - Given the same `sent` callback twice, then counters are unchanged and billing is settled once.
  - Given a template send, then an existing open conversation gets one bubble with resolved variables.
- **Source refs:** app/Http/Controllers/BroadcastsController.php (`nodeMessageStatus`, `nodeBroadcastStatus`), node/services/broadcastService.js (`updateMessageStatus`, `updateBroadcastStatus`)
- **Port notes:** Convert to event handlers on `broadcast.recipient.updated`; counters as materialized aggregates updated transactionally.

### WD-NODE-039 — Node-side campaign engine and its routes

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-NODE-030
- **Summary:** The bridge still ships a full campaign engine (A/B split, recurring daily runs, detail analytics, pause/resume/cancel) behind `/api/wa/...`, but Laravel v1.7.0 drives campaigns itself (paced afterResponse chunks fired by the drain/heartbeat sweeps) and never calls these routes.
- **Actors & access:** none in practice.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                                                                                              | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/wa/:phone/campaign/send`                                                                     | builds a campaign row (`id campaign_<id>_<ts>_<rand>`), splits contacts for A/B (`abSplit` percent of the list to variant A when `isABTest` and both template ids present), replaces any live instance of the same `campaignId`, then runs `executeCampaignSchedule` (or, for `isRecurring` with `recurringTime` HH:mm, arms a daily cron). QUIRK: the handler reads an undeclared `timezone` variable, so the recurring branch and the final JSON response throw ReferenceError; after the campaign has already started the caller receives 500 `{success:false,message:"timezone is not defined"}` |
| `POST /api/wa/:phone/campaign/schedule`                                                                 | one-off cron campaign; `{success, scheduleId, scheduledFor, recipientCount, abTestEnabled}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `GET /api/wa/campaign/:campaignId/details`                                                              | contact status list, engagement rates, A/B winner (weights delivered 0.2, read 0.3, clicked 0.3, responded 0.2; tie handling)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `POST /api/wa/campaign/:scheduleId/pause                                                                | resume                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | cancel` | status and cron control |
| (exported, unrouted) `getCampaigns`, `getCampaignStatus`, `stopRecurringCampaign`, `getRecurringStatus` | dead                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

- **Data:** in-memory campaign row with `sentMessages`, `deliveryStatus`, `readStatus`, `clickTracking`, `responseTracking`, `stats` (+variant stats).
- **Rules & edge cases:**
  1. `GET api/campaigns/sync` (called at boot by `syncCampaignSchedules`) is a Laravel closure that only validates the token and returns `{success:true,campaigns:[]}`; the restore code in Node therefore never restores anything.
  2. `campaignService.executeCampaignSchedule` mirrors the broadcast pipeline (A/B variant templates, flow campaigns via `/api/flows/{id}`, tracking rewrite, per-contact and aggregate callbacks to `api/campaigns/*`), refuses auth templates, honours the daily cap and pacing.
  3. Only helpers of `campaignService.js` are live: `handleCampaignMessageUpdate`, `trackCampaignResponse` (WD-NODE-040), `seedFlowUserVariables`, `fetchWorkspaceAttributes`, `mergeFlowVariables` (WD-NODE-041/043).
  4. Docs advertise `POST /api/wa/:phone/campaign/...` as part of the scheduler; that is stale.
- **Async & events:** none reachable.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the port targets parity, then this engine is NOT rebuilt; campaigns must run through the new campaign module (CAMP).
  - Given any request to these routes in the reference build, then the token guard applies and results follow the quirk above.
- **Source refs:** node/controllers/campaignController.js, node/services/campaignService.js, node/utils/campaignHelpers.js, node/routes/index.js, app/Services/CampaignScheduleSweeper.php, app/Http/Controllers/WaCampaignsController.php, Documentation/pages/developer-guide/node-bridge.html
- **Port notes:** Skip. Keep only analytics logic worth reusing: A/B winner scoring belongs in CAMP.

### WD-NODE-040 — Campaign callbacks and receipt hooks that are live (`campaigns/*`)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-NODE-020, WD-NODE-015
- **Summary:** Even though Laravel sends campaigns itself, delivery/read receipts from the Baileys socket and campaign-related callbacks still route through the bridge and five Laravel endpoints update per-recipient and aggregate campaign state.
- **Actors & access:** Node to Laravel, token (403). Owner of campaign semantics: CAMP.
- **UX & screens:** /campaigns detail and analytics (CAMP).
- **Endpoints:**

| Method uri                                 | Route name                         | Controller                                    | Request                                                                                                                                                                                                                       | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | ---------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST api/campaigns/update-status-by-id`   | `wa-campaigns.node.status-by-id`   | `WaCampaignsController@nodeStatusByMessageId` | `message_id` string req max 191; `status` in queued,pending,sent,delivered,read,failed; `timestamp` nullable date                                                                                                             | live path for Baileys campaign receipts (the in-memory lookup misses, so the fallback fires): finds the `wp_campaign_contacts` row by `whatsapp_message_id`; unknown id returns `{ok:true,matched:false}` (broadcast or chat message); only ratchets forward (rank queued 0, pending 1, sent 2, delivered 3, read 4, failed 9; older status returns `skipped:older`); stamps `sent_at/delivered_at/read_at` once, recounts aggregates, emits webhook `campaign_contact_status_updated` |
| `POST api/campaigns/update-contact-status` | `wa-campaigns.node.contact-status` | `nodeContactStatus`                           | `campaign_id` int req; `contact_id` int req; `status` in queued,pending,sent,delivered,read,failed,unsubscribed; `error_message` max 1024; `whatsapp_message_id` max 191; `variant` max 8; `sent_at`,`delivered_at`,`read_at` | per-recipient update (used by the dead engine)                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `POST api/campaigns/update-status`         | `wa-campaigns.node.status`         | `nodeCampaignStatus`                          | `campaign_id` int req; status and count fields                                                                                                                                                                                | recounts the aggregates from the `wp_campaign_contacts` pivot (trusts the pivot, not Node's numbers) and sets status when supplied                                                                                                                                                                                                                                                                                                                                                     |
| `POST api/campaigns/track-response`        | `wa-campaigns.node.track-response` | `nodeTrackResponse`                           | `campaign_id` int req, `contact_id` int req, `response` max 4096, `responded_at` date                                                                                                                                         | writes `response` and `responded_at` on the pivot, emits webhook `campaign_contact_replied`, recounts (called only by the dead in-memory tracker)                                                                                                                                                                                                                                                                                                                                      |
| `POST api/campaigns/unsubscribe`           | `wa-campaigns.node.unsubscribe`    | `nodeUnsubscribe`                             | `campaign_id` int req, `phone` string req max 32                                                                                                                                                                              | resolves the workspace contact by digits (exact or last 10 digits) and the pivot row, sets pivot `status=unsubscribed`, flags `contacts.is_unsubscribed=true` so later campaigns and broadcasts skip the number, and emits the opt-in/out webhook (called only by the dead in-memory tracker)                                                                                                                                                                                          |
| `GET api/campaigns/sync`                   | (closure)                          |                                               | header only                                                                                                                                                                                                                   | empty list (WD-NODE-039)                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `POST api/campaigns/drain`                 |                                    |                                               |                                                                                                                                                                                                                               | WD-NODE-015                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

- **Data:** `wpcampaigns`, `wp_campaign_contacts`.
- **Rules & edge cases:**
  1. Baileys `messages.update` runs `handleCampaignMessageUpdate` for every receipt: status 3 becomes delivered, 4 and 5 become read (an old off-by-one bug marked recipients read on delivery). It first looks in memory campaigns (never populated in v1.7.0) and otherwise posts `update-status-by-id`, so every non-broadcast receipt on a device also triggers this extra request (in addition to `chat/message-status`).
  2. QUIRK: `trackCampaignResponse` and unsubscribe detection iterate only in-memory campaign rows, so replies to Laravel-driven campaigns are NOT tracked through Node (response tracking and the text `unsubscribe` keyword depend on Laravel-side inbound handling instead).
  3. Timestamps from Node are ISO `Z`; Laravel parses through Carbon (`parseNodeTs`).
  4. Aggregates are recomputed with CASE-WHEN counts so duplicate callbacks are harmless.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a Baileys campaign message id, when WhatsApp reports delivery ack then read, then the recipient row becomes delivered then read and aggregates recount.
  - Given a duplicate callback, then counts do not change.
- **Source refs:** node/services/campaignService.js (`handleCampaignMessageUpdate`, `trackCampaignResponse`), app/Http/Controllers/WaCampaignsController.php (`nodeAuthOk`, `nodeCampaignStatus`, `nodeContactStatus`, `nodeStatusByMessageId`, `nodeTrackResponse`, `nodeUnsubscribe`, `recountCampaign`)
- **Port notes:** Receipts should reach the campaign module through the same `wa_message_id` correlation as chat receipts; drop the memory-based paths entirely.

### WD-NODE-041 — Flow start, resume and end endpoints on the bridge

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-NODE-002, WD-NODE-043
- **Summary:** Laravel drives the in-memory flow runtime through six endpoints: start a flow for a contact (campaigns, order events, API enrolment), resume a session paused on a commerce node, a WhatsApp Form or a Google Form, and end all sessions for a phone when an operator hands the chat to an AI agent.
- **Actors & access:** Laravel server-side; token required (handlers re-check the header themselves, WD-NODE-002 rule 5). Session model and node semantics: FLR.
- **UX & screens:** none in the bridge.
- **Endpoints:**

| Method uri                                                   | Caller                                                                                                                                           | Request                                                                                                                                                                                                    | Response                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/flow/start/:phone`                                | `WaCampaignsController` flow campaigns (per recipient, timeout 15 s), `Api/App/ChatController`, `Flow/FlowEnrollmentService` (API/CRM enrolment) | `flowId`, `targetPhoneNumber` (both required), optional `contact{name,first_name,last_name,email,phone,custom_attributes}` or the same fields at root, `variables{}`, `campaignId`, `contactId`, `variant` | 202 `{message:"FLOW START ACCEPTED", flowId, target}` immediately; 400 `{error:"flowId and targetPhoneNumber are required"}`                                                                                                                                                                                                      |
| `POST /api/flow/resume-port/:sessionKey`                     | `Commerce/FlowSessionResolver` on Shopify, WooCommerce and WABA order webhooks (also Telegram payment)                                           | `port` (1 purchased, 2 abandoned; default 1), `orderMeta{id,total,currency}`                                                                                                                               | `{ok:true,port,nodeId}`; 404 `session_not_found`; 200 noop `not_waiting_on_commerce`; 500 `advance_failed`                                                                                                                                                                                                                        |
| `POST /api/flow/resume-by-phone/:workspaceId/:customerPhone` | WABA inbound order message (no callback data)                                                                                                    | as resume-port                                                                                                                                                                                             | finds the session waiting on a CommerceShop node whose `flowData.workspace_id` matches and whose customer half of the key equals the digits; 200 noop `no_matching_session`                                                                                                                                                       |
| `POST /api/flow/resume-form/:sessionKey`                     | `Forms/WaFormSubmissionService`                                                                                                                  | `form_answers{}`                                                                                                                                                                                           | stamps each answer into `userVariables` under `<field>` and `form_<field>` (arrays and objects flattened to readable text: title, name, label, value, text or id), clears the wait and advances through port 1 of the WaForm node; 200 noop `session_not_found` / `not_waiting_on_form`; `{ok:true,ended:true}` when no next edge |
| `POST /api/flow-resume`                                      | `GoogleFlowNodeController::formResponse`                                                                                                         | `session_id` (session key), `workspace_id`, `resume_port`, `save_variable` (default `google_form`), `answers{}`, `response_id`, `respondent`                                                               | `resumeGoogleForm`; `{ok:true}`; 400 `missing_session_id`; 200 noop `session_not_found`                                                                                                                                                                                                                                           |
| `POST /api/flow-end`                                         | `TeamInboxController` and `Api/App/ChatController` when an operator attaches an AI agent/assistant                                               | `customer_phone` (also accepts `node_token` in body)                                                                                                                                                       | `{ok:true, ended:n}`                                                                                                                                                                                                                                                                                                              |

- **Data:** `activeFlowSessions`, `userCooldowns`; Laravel tables of FLR.
- **Rules & edge cases:**
  1. Start acknowledges BEFORE doing work because the flow needs to call back into Laravel (`/api/flows/{id}`, workspace attributes); a PHP caller running an afterResponse loop on a single-worker server would deadlock its own callback and time out (curl 28). All `*-flow/inbound` and provider-inbound endpoints also answer first for the same reason.
  2. Start without a Baileys socket runs with `sock=null`, meaning "use the workspace's official provider engine"; there is no rejection any more (a bug once made every WABA/Twilio flow launch answer "CLIENT NOT FOUND").
  3. Session key for start: `<deviceDigits>_<targetDigits>`; the seed variables = contact fields (`seedFlowUserVariables`: name, first_name, last_name, mobile, phone, email, address, title, language, plus string-cast custom attributes without overriding those) merged OVER workspace attributes (blank contact values never clobber a workspace default) and finally OVER by the caller's `variables` (order/event data such as `invoice_url`, `order_number`).
  4. QUIRK: a session created by `flow/start` carries no `timeoutSeconds`/`timeoutTimer`; it lives until the 30-minute sweeper (older than 60 minutes) unless the flow ends.
  5. Resume-port: idempotent; copies order meta into `order_id`, `order_total`, `order_currency` on both `userVariables` and `vars`; if the socket is gone it still advances (sends will fail).
  6. `flow-end` matches EITHER half of every session key with suffix tolerance (`endsWith` in both directions), so it can end sessions of other customers with overlapping digits or sessions where the phone equals the device half (QUIRK); ends each with the normal completion path (cooldown set, deleted after 5 s).
  7. Provider-inbound (WD-NODE-042) and Baileys inbound (WD-NODE-019) create sessions with `timeoutSeconds` and timers.
- **Async & events:** the flow runs detached after the 202.
- **External systems:** Laravel callbacks.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a published flow and a target, when start is called, then the response is 202 within one round trip and the first node message is sent shortly after.
  - Given a session paused on a CommerceShop node, when resume-port with port 1 arrives twice, then the second call is a no-op.
  - Given a WaForm submission with a date-picker answer object, then the variable holds readable text, not `[object Object]`.
  - Given `flow-end` for a customer with an active flow, then `ended:1` and the customer receives no further flow messages.
- **Source refs:** node/controllers/flowController.js, node/routes/index.js, node/services/flowService.js (`endFlowSessionsForPhone`, `advanceFlowToPort`, `resumeGoogleForm`), node/services/campaignService.js (`seedFlowUserVariables`, `mergeFlowVariables`), app/Http/Controllers/WaCampaignsController.php, app/Http/Controllers/TeamInboxController.php, app/Http/Controllers/GoogleFlowNodeController.php
- **Port notes:** Flow runs are durable executions (FLR) started by a job; `resume-*` become event signals to the waiting run (`signalRun(runId, event)`). No process-memory sessions.

### WD-NODE-042 — WABA and Twilio inbound handoff to the flow engine (`flow/provider-inbound`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-NODE-041
- **Summary:** Official-number messages arrive at Laravel via Meta/Twilio webhooks and never touch the Baileys handler; Laravel forwards each to this endpoint so keyword-triggered flows start and waiting flows resume exactly as on Baileys. The answer tells Laravel whether a flow consumed the message so it skips keyword auto-reply and AI.
- **Actors & access:** Laravel `WaWebhookController` (timeout ~ per call; token).
- **UX & screens:** none.
- **Endpoints:**

| Method uri                        | Request                                                                                                                                                                                                                      | Response                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `POST /api/flow/provider-inbound` | `deviceNumber` and `customerPhone` (digits, required), `text`, `replyId` (tapped button/list id), `pushName`, `flowId` (routing-rule forced), `workspaceId`, `provider` (waba default, twilio), `mediaUrl` (Ask-node upload) | 202 `{ok:true, consumed:boolean}`; 400 `deviceNumber and customerPhone required`; 401 |

- **Data:** `activeFlowSessions["<device>_<customer>"]` with `provider`.
- **Rules & edge cases:**
  1. Decision is synchronous and made before the 202: resume when an active session is waiting and the message has content (non-empty text or a `replyId`); empty payloads (reactions, read states, system events) never resume, otherwise a parked AI node would re-fire with empty input. Start when a forced `flowId` exists or when a typed (non-tap) text resolves a flow through `GET api/keyword-replies?keyword=&mobile=&phone=` (timeout 15 s; array response, first element used). A typed re-typed trigger keyword restarts even mid-flow (fast path when it equals the session's stored `triggerKeyword`).
  2. `consumed = resume || flowId`. Not consumed returns immediately and Laravel continues its own pipeline.
  3. Resume builds a Baileys-shaped message (`buttonsResponseMessage` with `selectedButtonId=replyId` for taps, else `conversation`), attaches `__mediaUrl`, and calls `handleFlowResponse(..., sock=null, ...)`; afterwards an idle timer (`min(max(timeout,30),3600)` seconds, default 600) deletes a parked session only if it is still the same session and not waiting.
  4. Start fetches `GET api/flows/{id}` (timeout 20 s), requires nodes, merges workspace attributes under `user_message`, `name`, `first_name`, `pushName`, `phone`, stores the session with `provider`, runs the first node with `sock=null` (flowService resolves waba/twilio from settings) and arms the idle timer.
  5. A warning is logged when `deviceNumber === customerPhone` (testing from a connected number).
- **Async & events:** detached execution.
- **External systems:** none.
- **Settings:** per-rule flow timeout and cooldown.
- **Acceptance criteria:**
  - Given a WABA customer typing a flow keyword, when Laravel forwards it, then the response is `consumed:true` and the flow's first message is sent through Cloud API.
  - Given an empty text with no replyId while a session waits, then `consumed:false`.
  - Given a button tap with `replyId`, then the waiting node receives the tapped id and advances.
- **Source refs:** node/controllers/providerFlowController.js, app/Http/Controllers/WaWebhookController.php (around line 1855)
- **Port notes:** Merge with the Baileys inbound path: a single `InboundMessageHandled` pipeline in the API decides flow/keyword/AI for every provider; providers differ only in the adapter that produced the normalized message.

### WD-NODE-043 — Flow definition, workspace attributes, template data and media-store endpoints

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-NODE-002
- **Summary:** Read-only lookups and one upload endpoint that the Node flow and campaign runtime call while executing: the normalized flow graph, workspace-level attribute defaults, approved template content, and a way to persist customer-uploaded media from Baileys.
- **Actors & access:** Node to Laravel, token (401 or 403 variants per route; see WD-NODE-002).
- **UX & screens:** none.
- **Endpoints:**

| Method uri                                   | Route name                       | Handler                    | Response                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------- | -------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET api/flows/{id}`                         | `api.flows.show` (`whereNumber`) | `FlowsController@nodeShow` | `{success:true, data:{flow:{id,flow_name,user_id,is_published}, flow_data:<normalized graph> + workspace_id}}`; 404 `{success:false,message:"Flow not found"}`; 401 `{success:false,message:"unauthorized"}`                                                                                                                                                     |
| `GET api/workspace-attributes/{workspaceId}` | `api.workspace-attributes`       | closure                    | `{ok:true, attributes:{key:value}}` from `attributes` (workspace scope), strings only; 401 `{ok:false,error:"unauthorized"}`                                                                                                                                                                                                                                     |
| `GET api/templates-camp/{id}`                | `templates-camp.show`            | closure                    | `{success:true, template:{id, template_name, template_type, category, meta_category, language, header, title_text, template_body, footer, buttons[], attachment_type, attachment_file, attachment_url, attachment_base64, attachment_mime, carousel_data, variable_map, meta_template_id, meta_status, twilio_content_sid}}`; 404 `{ok:false,error:"not_found"}` |
| `POST api/flow/store-media`                  | `flow.store-media`               | closure                    | in: `data` (data URI or bare base64), `mime` (default `application/octet-stream`); out `{ok:true, path:"chat-media/<random24>.<ext>", url:<absolute>}`; 422 `no_data` / `bad_base64`; 413 `too_large` (over 25 MB)                                                                                                                                               |

- **Data:** `flows.flow_data` (encrypted, decoded), `attributes`, `wa_templates`, media disk `chat-media/`.
- **Rules & edge cases:**
  1. `nodeShow` normalizes the builder JSON into the PascalCase graph the Node executors expect via `FlowNormalizer`, stamps `workspace_id` (from the flow, else the owner user's current workspace). QUIRK: no `is_published`/`is_active` filter and no workspace scoping beyond the shared token, so any flow id is returned.
  2. Workspace attributes are merged UNDER contact variables at every flow start (60-second per-workspace cache on Node; failures cache an empty object briefly, so a flapping Laravel does not stall flow starts).
  3. `templates-camp` inlines the attachment as base64 (read once server-side) so Node never downloads per recipient; QUIRK: no workspace scoping (any template id).
  4. `store-media` returns an ABSOLUTE URL (a relative `/storage` path would break Meta header fetches) and extension from `WabaMediaFetcher::extFor(mime)`. Node's `captureAskMedia` posts base64 with timeout 25 s for Ask nodes flagged to accept uploads on the Baileys path; on WABA/Twilio the webhook has already stored the media and forwards `mediaUrl`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a flow id, when Node fetches it with a valid token, then the response contains nodes and edges in the normalized shape and the owning workspace id.
  - Given a 30 MB upload, then 413.
  - Given `attributes` rows `promo_key=SAVE10`, then the endpoint returns them and the flow renders `{{promo_key}}`.
- **Source refs:** app/Http/Controllers/FlowsController.php (`nodeShow`), app/Services/Flows/FlowNormalizer.php, routes/api.php, node/services/campaignService.js (`fetchWorkspaceAttributes`), node/services/flowService.js (`captureAskMedia`)
- **Port notes:** Runtime reads flow definitions and attributes straight from Postgres with RLS bound to the run's tenant; store-media becomes a direct upload to object storage with a size and MIME allow-list.

### WD-NODE-044 — Flow-node action endpoints (tag, assign, deal, AI, web search, MySQL, Meet, WhatsApp form)

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** WD-NODE-002, WD-NODE-041
- **Summary:** Flow nodes that need Laravel data or secrets call these token-guarded endpoints; each resolves a workspace and a conversation, performs the side effect and returns JSON the node uses as variables.
- **Actors & access:** Node flow runtime only (`FlowNodeActionsController`, `authed()`: 401 `{ok:false,error:"unauthorized"}`).
- **UX & screens:** none (the builder nodes are FLB).
- **Endpoints:**

| Method uri                          | Route name                     | Request (validation)                                                                                                                                                                                                     | Response and effects                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST api/flow-node/tag`            | `api.flow-node.tag`            | `workspace_id` int req; `customer_phone` max 32 req; `action` in add,remove; `tag_id` int or `tag_name` max 64                                                                                                           | resolves conversation (404 `conversation_not_found`), tag by id else create-on-the-fly by name (slug unique per workspace, color `#075E54`); 422 `tag_unresolved`; attaches/detaches and records a `ConversationEvent` `tag_added`/`tag_removed` with source flow; `{ok,tag_id,action}`                                                                                                                                                     |
| `POST api/flow-node/assign`         | `api.flow-node.assign`         | `workspace_id`, `customer_phone`, `team_id` (exists in workspace teams, not deleted), `user_id` (exists in workspace_user), `note` max 1024                                                                              | strategy `manual` when user given, else the team's own `assignment_strategy` (round_robin default); `AssignmentService::assign` with actor null; note stored as `note_added` event; 422 `assignment_target_invalid` for foreign member/team; `{ok,conversation_id,assignee_user_id}`                                                                                                                                                        |
| `POST api/flow-node/deal-action`    | `api.flow-node.deal-action`    | `workspace_id`, `action` create or move, `stage_id` int, `deal_name` max 191, `value` numeric 0..99999999, `owner_user_id`, `contact_phone`, `deal_id`                                                                   | plan flag `access_sales_pipeline` (422 `plan_not_allowed`); stage must belong to the workspace (422 `stage_not_found`); move re-stages the given deal or the contact's newest open deal and CREATES one if none; created deals use the pipeline currency, `value*100` minor units, source `flow`; `{ok,deal_id,status,created}`                                                                                                             |
| `POST api/flow-node/ai-agent-reply` | `api.flow-node.ai-agent-reply` | `workspace_id`, `agent_id`, `customer_phone`                                                                                                                                                                             | agent must be active and in the workspace (404 `agent_not_found`); assigns the agent to the conversation and triggers the first reply via `AiAgentService::respondIfAssigned`; `{ok,agent,assigned,replied}`                                                                                                                                                                                                                                |
| `POST api/flow-node/ai-call`        | `api.flow-node.ai-call`        | `workspace_id` nullable, `model` req max 120, `assistant_id`, `call_assistant_id`, `system_prompt`/`user_prompt` max 6000, `max_tokens` 1..4000 (default 350), `temperature` 0..2 (default 0.7), `json` bool, `fields[]` | provider inferred from the model prefix (claude to Anthropic, gemini to Gemini, mistral/ministral/open-mistral/open-mixtral to Mistral, else OpenAI); call-assistant persona and model override; AI-training knowledge base appended to the system prompt; JSON mode forces a single object or `{rows:[...]}`; keys resolved server-side (workspace key when the plan allows, else admin key); 502 `provider_failed`; `{ok,reply,provider}` |
| `POST api/flow-node/web-search`     | `api.flow-node.web-search`     | `query` req max 500, `max_results` 1..10                                                                                                                                                                                 | provider setting `web_search_provider` (tavily default, serpapi, brave) with `web_search_key`; timeout 8 s; ALWAYS returns `{ok:true,text}` (empty on any failure) truncated to 3000 chars                                                                                                                                                                                                                                                  |
| `POST api/flow-node/mysql-query`    | `api.flow-node.mysql-query`    | `host` req max 255, `port` 1..65535 (3306), `database` req, `username`, `password`, `sql` req max 8000                                                                                                                   | read-only: single statement, must start with SELECT or WITH, no INTO OUTFILE/DUMPFILE/LOAD_FILE (422); PDO timeout 8 s; at most 100 rows; 502 `Query failed: ...`; `{ok,rows,count}`. QUIRK (security): connects to ANY host the flow author enters (no SSRF filter), returning the driver error text                                                                                                                                       |
| `POST api/flow-node/google-meet`    | `api.flow-node.google-meet`    | `workspace_id`, `title` req max 200, `start_at`, `end_at` (ISO), `description` max 1500, `attendee_emails[]`, `time_zone`, `send_invites`, `calendar_id`                                                                 | 422 `bad_datetime` / `end_before_start` / `not_connected`; 503 `integration_disabled` when the platform Google toggle is off; 502 `meet_create_failed`; `{ok,meet_url,event_id,start,end,time_zone}`                                                                                                                                                                                                                                        |
| `POST api/flow-node/wa-form-send`   | `api.flow-node.wa-form-send`   | `workspace_id`, `form_id`, `session_key` max 120, `target_phone`, `body_text` max 1024, `cta_label` max 30                                                                                                               | form must be live (published to Meta); WABA config with token and phone id; sends a Meta interactive `flow` message with `flow_token = form-<formId>-<sessionKey>` (`flow_action navigate`, first screen `SCREEN_0`), Graph version env `META_GRAPH_VERSION` default v21.0; errors `form_not_found`, `form_not_published`, `no_waba_config`, `waba_creds_missing`, `meta_send_failed` 502; `{ok,flow_token,meta}`                           |

- **Data:** conversations, tags, `conversation_events`, deals, `pipeline_stages`, AI agents, forms; see owner domains.
- **Rules & edge cases:**
  1. Conversation lookup by workspace and customer digits via `ConversationResolver::find` (one thread per number; handles `@lid`, `@c.us`).
  2. Every endpoint is workspace-scoped by an id the flow JSON supplies, which is authored and importable, so all foreign-key inputs are re-validated against the workspace (assignment target rules were added for that reason).
  3. The same Meet minting is exposed to the inbox composer at a session-authenticated route (TIB1).
- **Async & events:** conversation events, realtime assignment events (TIB2).
- **External systems:** OpenAI/Anthropic/Gemini/Mistral, Tavily/SerpAPI/Brave, Google Calendar, Meta Graph, arbitrary MySQL.
- **Settings:** `web_search_provider`, `web_search_key` (encrypted), admin AI keys (AIADM), `META_GRAPH_VERSION`.
- **Acceptance criteria:**
  - Given a tag node with a new tag name, then the tag is created once and attached and a `tag_added` event is recorded with source flow.
  - Given an assign node pointing at a user of another workspace, then 422 `assignment_target_invalid` and the conversation is unchanged.
  - Given `sql=DROP TABLE x`, then 422 `Only SELECT queries are allowed.`
  - Given a deal move for a contact with no open deal, then a deal is created (`created:true`).
- **Source refs:** app/Http/Controllers/FlowNodeActionsController.php, routes/api.php
- **Port notes:** These are internal actions of the flow module (call services in-process, no HTTP). Fix the MySQL node with a destination allow-list or drop it. Keep the AI provider inference in the AI gateway.

### WD-NODE-045 — Natural-language ordering endpoints (`order-parse`, `order-shipping`, `order-confirm`, `order-cancel`, `order-reply`)

- **Status:** implemented
- **Priority:** P2
- **Effort:** L
- **Depends on:** WD-NODE-044
- **Summary:** Five flow-node endpoints power the WhatsApp free-text ordering feature: parse a message (text, voice or photo) into cart items and hold stock, capture the shipping address, confirm or cancel, and interpret the customer's reply in any language, always answering in the customer's language.
- **Actors & access:** Node flow runtime; token.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                          | Request                                                                                                 | Response                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST api/flow-node/order-parse`    | `workspace_id`, `customer_phone`, `text` (nullable), `group_code` max 48, `model` (default gpt-4o-mini) | `{ok:true, has_items, summary, items, unavailable, total_minor, currency, order_ok...}` from `OrderingService::parseAndHold` (matches products, holds stock)                                                                                                                                                                               |
| `POST api/flow-node/order-shipping` | `workspace_id`, `customer_phone`, `text`, `use_saved`, `model`                                          | `{ok,shipping}`; 422 `no_saved_address` / `empty_address`                                                                                                                                                                                                                                                                                  |
| `POST api/flow-node/order-confirm`  | `workspace_id`, `customer_phone`, `ship_text`, `notify_group` (default true), `model`                   | saves the address from `ship_text` (AI interprets "same" vs new), finalizes the held cart, commits stock; failure returns 200 `{ok:false,error,summary:<localized apology>}`; success `{ok,order_id,total_minor,currency,summary}`; then, deferred after the response, posts the order into the customer's WhatsApp group with an @mention |
| `POST api/flow-node/order-cancel`   | `workspace_id`, `customer_phone`, `text`                                                                | drops the cart and releases held stock; always returns a localized `summary`                                                                                                                                                                                                                                                               |
| `POST api/flow-node/order-reply`    | `workspace_id`, `customer_phone`, `text`, `notify_group`                                                | one call: translate, decide intent confirm/cancel/unclear (never cancels on unclear; re-asks), execute, return localized `summary` and `intent`                                                                                                                                                                                            |

- **Data:** `wa_pending_orders`, orders, stock holds, `wa_groups` (owner domains CHK/CAT/WFL).
- **Rules & edge cases:**
  1. Group notification resolves the customer's group via `GroupDirectory::resolveForCustomer` and posts through `GroupNotifier` (Node `send-group-message`, WD-NODE-024): `order-confirm` posts for reasons `code`, `single` and (deliberately) `ambiguous` (freshest shared group); `order-reply` posts only for `code` and `single` (QUIRK: the two endpoints disagree).
  2. Media-only messages (voice, photo) start this flow through `routing_actions.flow_id` (WD-NODE-017); stock holds expire and are released by the heartbeat sweep (WD-NODE-014).
  3. All responses localize into the language of the customer's text, using an AI call (no word lists).
- **Async & events:** `terminating` callbacks for the group post.
- **External systems:** AI providers, WhatsApp groups via the bridge.
- **Settings:** ordering flow selection (any flow containing an order-parse step), group codes.
- **Acceptance criteria:**
  - Given "2 red shirts", when order-parse runs, then items are matched, stock held and a summary returned.
  - Given an unclear reply, then order-reply returns intent `unclear` and the cart is untouched.
  - Given confirm with notify_group default, then a message with an @mention appears in the customer's group after the response.
- **Source refs:** app/Http/Controllers/FlowNodeActionsController.php (order* methods), app/Services/Ordering/*, app/Services/Ordering/GroupNotifier.php
- **Port notes:** Owned by CHK/CAT; port as flow actions calling the ordering module directly.

### WD-NODE-046 — Google Sheets, Docs and Forms bridge for flows

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** WD-NODE-041
- **Summary:** Flow nodes append or read spreadsheet rows, generate documents from a template and send a Google Form then resume when it is submitted, all through Laravel because the Google OAuth tokens live there.
- **Actors & access:** Node to Laravel (token, 401; 503 `integration_disabled` when the platform Google toggle is off); form submissions arrive from an Apps Script webhook (workspace token).
- **UX & screens:** Apps Script download at `google-account/forms/{formId}/apps-script.gs` (INTG).
- **Endpoints:**

| Method uri                               | Route name                    | Request                                                                                                                                                                                  | Response                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST api/flow-node/google/sheet-write`  | `api.flow-node.gsheet-write`  | `workspace_id`, `sheet_id` max 128, `tab_name` max 64, `values[]` (cast to strings), `column_headers[]`, `match_by_header`                                                               | header-matched placement (case-insensitive, unmatched labels appended after the last sheet column, positional when the sheet has no header row); `res.ok ? 200 : 422`                                                                                                                                                                                                                                                                 |
| `POST api/flow-node/google/sheet-read`   | `api.flow-node.gsheet-read`   | `sheet_id`, `tab_name`, `match_column`, `match_value`, `limit` 1..200 (default 1)                                                                                                        | rows JSON; 422 on error                                                                                                                                                                                                                                                                                                                                                                                                               |
| `POST api/flow-node/google/doc-generate` | `api.flow-node.gdoc-generate` | `template_id`, `new_title` max 240, `vars{}`, `shareable` (default true)                                                                                                                 | copies the template doc and fills variables                                                                                                                                                                                                                                                                                                                                                                                           |
| `POST api/flow-node/google/form-send`    | `api.flow-node.gform-send`    | `google_form_id`, `flow_session_id` max 64, `contact_phone`, `save_variable` (default `form_response`), `resume_port` (default `submitted`), `expires_in_sec` 60..604800 (default 86400) | deletes stale unsubmitted rows for the same session and form, creates a `google_form_sessions` row with a 40-char `webhook_token`, returns `{ok,form_url,webhook_token,webhook_url,apps_script_url,session_row_id}`; 422 `form_unreachable`/`no_responder_uri`                                                                                                                                                                        |
| `POST api/google/form-response`          | `api.google.form-response`    | header `X-Workspace-Token`; `form_id`, `response_id`, `respondent`, `submitted_at`, `answers{}` (required)                                                                               | matches the newest unsubmitted session by token and form (fallback: any unsubmitted for the form when the token equals the node token); none: 200 `{ok:true,matched:false}` (no retries from Apps Script); expired: marks consumed, `matched:false,reason:expired`; otherwise stores `answers_json`, sets `submitted_at`, then POSTs `{node}/api/flow-resume` (timeout 10 s, failure logged and ignored); `{ok,matched:true,session}` |

- **Data:** `google_form_sessions` (`workspace_id`, `flow_session_id`, `google_form_id`, `contact_phone`, `save_variable`, `resume_port`, `webhook_token`, `expires_at`, `submitted_at`, `answers_json`).
- **Rules & edge cases:**
  1. QUIRK: the form-response webhook is public (CSRF-exempt, no throttle); its only protection is possession of the per-session webhook token or the shared node token embedded in the generated Apps Script (the script generator bakes the NODE token into a file the form owner can read).
  2. If the flow cannot resume (Node down) the row is still marked submitted; the flow stays parked until the customer writes again.
  3. Node URL for the resume call: `baileys_server_url`, else `SERVER_URL`.
- **Async & events:** Node resume call.
- **External systems:** Google Sheets, Docs, Drive, Forms APIs (OAuth per workspace).
- **Settings:** platform toggle `google_calendar_enabled` (master toggle for all Google features), workspace OAuth connection (INTG).
- **Acceptance criteria:**
  - Given `match_by_header` true and the sheet headers `Name, Phone`, when values labelled Phone and Name are sent, then they land under the right columns.
  - Given a form-send then a submission with the row's token, then the flow resumes with the answers under `save_variable`.
  - Given the master Google toggle is off, then all four node endpoints answer 503.
- **Source refs:** app/Http/Controllers/GoogleFlowNodeController.php, app/Services/Google/GoogleApiService.php, node/services/flowService.js (`executeGoogleSheetsNode`, `executeGoogleDocsNode`, `executeGoogleFormNode`), node/controllers/flowController.js (`resumeGoogleFormEndpoint`)
- **Port notes:** In-process integration service (INTG); use signed, single-use, short-lived form callback URLs instead of embedding the platform secret in the script.

### WD-NODE-047 — Commerce endpoints for flows (`checkout-link`, `waba-send-products`, `check-inventory`)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-NODE-041
- **Summary:** The CommerceShop node mints a pay link for picked products, sends native Cloud API product messages, and filters items to those in stock at send time, for Shopify, WooCommerce and WhatsApp Shop catalogs.
- **Actors & access:** Node flow runtime; token (401).
- **UX & screens:** flow builder store pickers use session routes `flows/api/commerce/*` (FLB, not here).
- **Endpoints:**

| Method uri                             | Route name                   | Request                                                                                                                                                               | Response                                                                                                                                                                                  |
| -------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST api/commerce/checkout-link`      | `api.commerce.checkout-link` | `provider` in shopify, woocommerce, whatsapp_shop; `store_id` int; `workspace_id` int; `items[1..30]{retailer_id, qty 1..99}`; `session_id` max 120; `customer_phone` | `{ok:true, url, ...}` via the provider's checkout link builder (session id round-trips through the order webhook to resume the flow); 403 `store_workspace_mismatch`; 502 `mint_failed`   |
| `POST api/commerce/waba-send-products` | `api.commerce.waba-send`     | `session_id`, `target_phone`, `items[1..30]{retailer_id}`, `workspace_id`, `header` max 60, `body` max 1024, `footer` max 60                                          | builds a single product message (1 item) or a product list with one section; 422 `no_waba_config` / `no_catalog`; 502 `send_exception`; posts to Graph                                    |
| `POST api/commerce/check-inventory`    | `api.commerce.inventory`     | `provider`, `store_id`, `workspace_id`, `retailer_ids[1..50]`                                                                                                         | `{ok:true, in_stock:[...]}`; matches `wa_products` by `meta_retailer_id` or `sku`; Woo/Shopify fetch up to 50 live products; exceptions FAIL OPEN (`in_stock` = all ids, `fallback:true`) |

- **Data:** `shopify_integrations`, `woocommerce_integrations`, `wa_catalogs`, `wa_products`, `wa_provider_configs`.
- **Rules & edge cases:**
  1. The store must belong to the workspace sent by Node (blocks minting carts on another tenant's store).
  2. Empty configured token rejects all (fail closed) but the WooCommerce/Shopify inventory checks trust a live API that may be slow; no caching.
- **Async & events:** order webhooks later call `flow/resume-port` (WD-NODE-041).
- **External systems:** Shopify, WooCommerce, Meta Graph.
- **Settings:** per integration.
- **Acceptance criteria:**
  - Given a store of another workspace, then 403.
  - Given the live inventory call throws, then all requested ids are treated as in stock.
  - Given two items on WhatsApp Shop, then a product-list message is sent.
- **Source refs:** app/Http/Controllers/FlowsCommerceController.php, app/Services/Commerce/*, node/services/flowService.js (`executeCommerceShopNode`)
- **Port notes:** ECOM/CHK provider adapters called in-process by the flow engine.

### WD-NODE-048 — Booking and appointment endpoints for flows

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** WD-NODE-041
- **Summary:** The Book Appointment node offers days and times, soft-reserves a slot, collects answers and commits a booking; two API families exist: the legacy Google-Calendar single-config pair and the multi-service booking-type API.
- **Actors & access:** Node flow runtime; token (401). `api/appointments/slots` also accepts a signed-in session user for the builder preview.
- **UX & screens:** none (APPT owns the setup UI).
- **Endpoints:**

| Method uri                   | Route name               | Request                                                                                                                                                                      | Response                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET api/appointments/slots` | `api.appointments.slots` | `workspace_id` (Node), `limit` 1..10 (default 5)                                                                                                                             | `{ok,slots}` via `computeFreeSlots`; 503 `integration_disabled` only when the workspace uses a Google calendar and the platform toggle is off                                                                                                                                                                                                                                                                                                                              |
| `POST api/appointments/book` | `api.appointments.book`  | `workspace_id`, `starts_at`, `ends_at`, `title` max 191, `description` max 2000, `contact_id`, `conversation_id`, `customer_name`, `customer_phone` max 32, `customer_email` | idempotent on (conversation, start); monthly `appointments_limit` enforced; the booking feature flag is deliberately NOT enforced at this step; writes Google Calendar when linked                                                                                                                                                                                                                                                                                         |
| `GET api/booking/types`      | `api.booking.types`      | `workspace_id`                                                                                                                                                               | `{ok,available,types[{id,name,duration,description,location_type,intro_message,due_now,currency,has_gateway,questions[]}]}`; offer-time plan gate returns a block object                                                                                                                                                                                                                                                                                                   |
| `GET api/booking/slots`      | `api.booking.slots`      | `workspace_id`, `type_id`, `day` (YYYY-MM-DD, optional), `offset`                                                                                                            | without `day`: next available days grouped with counts (page of 9, `has_more`, `next_offset`); with `day`: open times `{start,end,label "g:i A"}` (page of 9); 404 `no_type`                                                                                                                                                                                                                                                                                               |
| `POST api/booking/reserve`   | `api.booking.reserve`    | `type_id`, `starts_at`, `session_ref` max 191, `channel` max 32                                                                                                              | creates a 10-minute `slot_reservations` soft lock; `{ok:false,error:"slot_taken"}` when reserved plus booked seats reach capacity                                                                                                                                                                                                                                                                                                                                          |
| `POST api/booking/book`      | `api.booking.book`       | `type_id`, `starts_at`, `contact_id`, `conversation_id`, `customer_name`, `customer_phone`, `customer_email`, `answers[]`, `reservation_id`                                  | commits a `confirmed` appointment with source `chat`; hard double-book guard through UNIQUE `active_slot_key` (seat ordinal under a 10-second cache lock when capacity > 1); duplicate tap returns `duplicate:true`; errors `slot_taken`, `plan_limit`, `commit_failed`; `{ok,appointment_id,status,manage_token}`; after the response (terminating): Google Calendar or Meet event, Sheets append, per-offset reminders on the Node scheduler (WD-NODE-034 synthetic ids) |

- **Data:** `appointments`, `booking_types`, `slot_reservations`, `appointment_settings` (workspace JSON).
- **Rules & edge cases:**
  1. All pagination is capped at 9 rows so no WhatsApp list exceeds its 10-row limit.
  2. Starts are normalized to UTC before persisting; display in the type's effective timezone.
  3. Reminders are registered through `AppointmentReminderScheduler` on the bridge (synthetic negative Laravel ids, deduped by the scheduler), whose status callbacks then return 404 because no `scheduled_messages` row exists (harmless noise after 3 retries).
- **Async & events:** terminating callbacks (Calendar, Sheets, reminders, confirmation template).
- **External systems:** Google Calendar and Sheets.
- **Settings:** booking type config, plan gates `access_appointment_booking`, `appointments_limit`.
- **Acceptance criteria:**
  - Given two customers booking the same last seat at once, then one succeeds and the other gets `slot_taken`.
  - Given no day, then at most 9 days are listed with `has_more` when more exist.
  - Given a double tap from the same conversation, then `duplicate:true` with the same appointment id.
- **Source refs:** app/Http/Controllers/BookingApiController.php, app/Http/Controllers/AppointmentController.php (`slotsApi`, `bookApi`), app/Services/Appointments/*, node/services/flowService.js (`startBookingFlow`, `executeBookAppointmentNode`)
- **Port notes:** Owned by APPT; use a Postgres exclusion constraint or unique seat key for the hard guard and a `slot_reservations` TTL row (pg_cron or a BullMQ sweeper).

### WD-NODE-049 — WhatsApp calling bridge (AI voice pickup) contract

- **Status:** implemented
- **Priority:** P2
- **Effort:** XL
- **Depends on:** WD-NODE-002
- **Summary:** For Cloud API numbers Laravel hands inbound (and flow-placed outbound) WhatsApp voice calls to the bridge, which negotiates WebRTC with Meta and runs speech-to-text, an LLM and text-to-speech in real time, reporting transcript turns, acceptance and errors back to Laravel.
- **Actors & access:** Laravel webhook handler and flow node to Node; Node to Laravel; token in header or body (`node_token`).
- **UX & screens:** call popup with Record and hangup (CALL domain).
- **Endpoints:**

| Method uri                                                           | Direction                                                                     | Request                                                                                                                                                                                         | Response                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/waba-call/answer`                                         | Laravel to Node (`WaCallingWebhookController` on Meta `connect`, timeout 8 s) | `wa_call_id`, `meta_call_id`, `workspace_id`, `assistant_id` (required), `caller_phone`, `callee_phone`, `sdp_offer`, `meta_token`, `phone_number_id`, `graph_version`, `node_token`            | 202 `{ok:true,status:"bridging"}`; 400 `missing_<field>`; idempotent per `meta_call_id`                                                                                                                                                                                             |
| `POST /api/waba-call/place-outbound`                                 | Laravel to Node (`placeAiCall`, timeout 15 s)                                 | `wa_call_id`, `workspace_id`, `assistant_id`, `to`, `from`, credentials, `node_token`                                                                                                           | 202 `{ok,status:"dialing"}`                                                                                                                                                                                                                                                         |
| `POST /api/waba-call/link-meta`, `/connect`, `/terminate`, `/record` | Laravel to Node                                                               | `{wa_call_id, meta_call_id}`; `{meta_call_id, sdp_answer}`; `{meta_call_id}`; `{meta_call_id                                                                                                    | call_id}`                                                                                                                                                                                                                                                                           | `{ok}` (404 when unknown/not active); terminate is idempotent; record starts PCM capture only from that moment (422 `meta_call_id required`) |
| `GET api/waba-creds?workspace_id=`                                   | Node to Laravel (`api.waba-creds`)                                            |                                                                                                                                                                                                 | picks the workspace's best WABA config (connected first, primary, most recent, first with both token and phone id): `{ok,access_token,phone_number_id,waba_id,graph_version (env META_GRAPH_VERSION or v21.0)}`; 404 `no_waba_config`                                               |
| `GET api/waba-call/assistant/{id}?workspace_id=`                     | Node to Laravel                                                               |                                                                                                                                                                                                 | assistant config incl. system prompt, model, voice ids, exit keywords, greeting, `record_agent/record_user` and tools (function name, trigger keywords, HTTP method/url/headers/params); 400 `workspace_required`, 404                                                              |
| `GET api/waba-call/voice-keys?workspace_id=`                         | Node to Laravel                                                               |                                                                                                                                                                                                 | `{ok,deepgram,openai,elevenlabs}` resolved BYOK, admin key, then env, key values in the response (never logged unmasked)                                                                                                                                                            |
| `POST api/waba-call/bridge-accepted`                                 | Node to Laravel                                                               | `wa_call_id`, `meta_call_id`, `assistant_id`                                                                                                                                                    | flips `wa_calls.status` ringing to active under `lockForUpdate` (idempotent, loses to an operator accept), `handler_type=ai_agent`; adds `wa_call_events` row; `{ok,claimed}`                                                                                                       |
| `POST api/waba-call/bridge-error`                                    | Node to Laravel                                                               | `wa_call_id`, `meta_call_id`, `reason` max 500                                                                                                                                                  | ringing/connecting to failed with `end_reason BRIDGE_ERROR`                                                                                                                                                                                                                         |
| `POST api/waba-call/transcript-turn`                                 | Node to Laravel                                                               | `wa_call_id`, `role` agent or user, `text` max 6000, `t_ms`                                                                                                                                     | appends a `transcript_turn` event                                                                                                                                                                                                                                                   |
| `POST api/waba-call/bridge-offer`                                    | Node to Laravel                                                               | `wa_call_id`, `sdp_offer`, `to`, `assistant_id`                                                                                                                                                 | dials via `WaCallingService::dialExisting`, then calls Node `link-meta`; `{ok,meta_call_id}`; 404/422/502                                                                                                                                                                           |
| `POST api/flow-node/place-ai-call`                                   | Node flow (AI call node) to Laravel                                           | `workspace_id`, `to` (digits, at least 8 else 422 `bad_number`), `assistant_id` (default: first active `live` call assistant, else 422 `no_voice_assistant`), `conversation_id`, `device_phone` | needs the workspace's primary CONNECTED Cloud API sender (422 `no_waba_sender`); creates a `wa_calls` row (BUSINESS_INITIATED, ringing, `meta_payload.assistant_id`, `source flow_ai_call`), POSTs Node `place-outbound` (timeout 15 s, failure logged and ignored); `{ok,call_id}` |
| `POST api/call-flow/active`                                          | Node to Laravel                                                               | `workspace_id`                                                                                                                                                                                  | newest published+active `call` flow's decoded JSON and `flow_id`, or null (bridge then falls back to the single assistant)                                                                                                                                                          |

- **Data:** `wa_calls`, `wa_call_events`, `ai_call_assistants` (+tools), call flows.
- **Rules & edge cases:**
  1. Session lifecycle in Node (`wabaCallBridge`): open, negotiate, pre_accept then accept at Graph `/calls`, audio loop (48 kHz frames, STT at 16 kHz), PCM recordings under `public/uploads/call-recordings/{callId}_(agent|user).pcm`, hourly stale-recording sweep, terminate posting the final transcript; `@roamhq/wrtc` is optional and its absence disables AI pickup (decline plus voicemail fallback).
  2. Laravel arms an AI fallback timer (`auto_pickup_delay_sec`, default 15 s) after `connect` for inbound calls only; outbound BUSINESS_INITIATED calls never route to AI pickup.
  3. Recording flags are now always allowed (plan gate removed) and combined only with the assistant's own toggles.
- **Async & events:** call events, `terminating` fallback timer.
- **External systems:** Meta calls API, Deepgram, ElevenLabs, OpenAI/LLM providers.
- **Settings:** `WABA_CALL_*` env keys; admin AI keys.
- **Acceptance criteria:**
  - Given an inbound call with a live assistant, when Laravel calls `/answer`, then Node responds 202, accepts at Meta and Laravel flips the call to active via `bridge-accepted`.
  - Given the operator answers first, then `bridge-accepted` returns `claimed:false`.
  - Given Meta terminate, then Laravel calls `/terminate` and the recording stops.
- **Source refs:** node/controllers/wabaCallController.js, node/services/wabaCallBridge.js, node/services/callFlowRuntime.js, app/Http/Controllers/FlowNodeActionsController.php, app/Http/Controllers/WaCallingWebhookController.php
- **Port notes:** Owned by CALL; treat the media server as a separate service (or LiveKit/SIP gateway) with its own scaling; keep provider keys out of response bodies by minting short-lived tokens.

### WD-NODE-050 — Channel flow engines: Node inbound handoff and Laravel callbacks (IG, Messenger, TikTok, Telegram, LINE, WeChat, Viber, Email)

- **Status:** implemented
- **Priority:** P1
- **Effort:** XL
- **Depends on:** WD-NODE-041, WD-NODE-002
- **Summary:** Non-WhatsApp channels run their flows on separate ported Node runtimes so delays and waits are real awaits. Laravel receives the channel webhook, decides whether a flow exists, and hands the event to Node; Node answers synchronously whether a flow consumed it and runs the flow detached, calling back into Laravel to log messages and resolve smart nodes.
- **Actors & access:** Laravel bridges (`FbFlowBridge`, `TgFlowBridge`, `LineFlowBridge`, `ViberFlowBridge`, `WeChatFlowBridge`, `EmailFlowBridge`, `TtFlowBridge`; the Instagram bridge ships with the Instagram addon) and Node; token both ways (Node handlers 401, Laravel 401).
- **UX & screens:** none.
- **Endpoints:** Node routes registered in `index.js`, guarded by the `/api` guard AND a header check:

| Method uri                                               | Body                                                                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/instagram-flow/inbound`                       | `accountId`, `workspaceId`, `igsid`, `text`, `commentId`, `auth{base,ig,token}`, `flow`, `flowId`, `vars`, `appDomain`                 |
| `POST /api/facebook-flow/inbound`                        | `pageId`, `workspaceId`, `psid`, `text`, `auth{base,pageId,token}`, `flow`, `flowId`, `vars`, `appDomain` (400 unless pageId and psid) |
| `POST /api/tiktok-flow/inbound`                          | `accountId`, `workspaceId`, `convId`, `text`, `auth`, ...                                                                              |
| `POST /api/telegram-flow/inbound`                        | `botId`, `workspaceId`, `chatId`, `text`, `auth`, ...                                                                                  |
| `POST /api/line-flow/inbound`, `/api/viber-flow/inbound` | `channelId`, `workspaceId`, `userId`, `text`, `auth`, ...                                                                              |
| `POST /api/wechat-flow/inbound`                          | `channelId`, `workspaceId`, `openid`, `text`, `flow`, `flowId`, `vars`, `appDomain` (sends delegate back to PHP)                       |
| `POST /api/email-flow/inbound`                           | `accountId` (or `mirrorId`), `conversationId` (or `mtxConvId`), `workspaceId`, `text`, `auth{base,token}`, ...                         |
| `GET /api/<channel>-flow/health`                         | `{ok:true, service:"<channel>-flow"}`; token required                                                                                  |

Response of every inbound: `{ok, consumed, mode}` with mode `start`, `resume` or `none`; 202 when consumed, 200 with `consumed:false` when neither a resumable session nor a `flow` payload exists.

Laravel callbacks (all token-guarded, 401; routes claimed here): `POST api/facebook/flow-log`, `flow-node`; `api/telegram/flow-log`, `flow-node`; `api/tiktok/flow-log`, `flow-node`; `api/line/flow-log`, `flow-node`; `api/viber/flow-log`, `flow-node`; `api/wechat/flow-send`, `flow-node`; `api/email/flow-send`, `flow-node`, `flow-log`.

- **Data:** in-memory sessions per channel (keys: page+psid, bot+chat, channel+user, account+conversation), pruned on demand (Facebook drops sessions past Meta's 24 h window); channel conversations and inbox messages mirrored by the callbacks (raw jid shapes such as `fb:<pageId>:<psid>`).
- **Rules & edge cases:**
  1. Resume needs an existing session and non-empty text (empty events never resume); Email additionally checks `canResume` so a reply the parked node cannot take returns `consumed:false` (otherwise the customer would get nothing). Start needs a `flow` payload with `flowNodes` or `nodes`.
  2. Laravel sets its own timeout 15 s on the handoff and treats any failure as "not consumed" (falls back to keyword replies or AI); the docs mention an in-process PHP fallback runner for some channels.
  3. `flow-log` mirrors each outbound flow message into the channel's inbox thread (buttons, media, `source` flow, message id) creating the conversation on first use (Facebook resolves the sender's real name once, cached 6 h); `flow-node` resolves smart nodes (action `ai` or `webhook`; Messenger also gallery and lead capture) using workspace AI keys so provider secrets stay server-side; WeChat and Email `flow-send` perform the send in PHP (managed token / MailTrixy credentials) and mirror it.
  4. Channel credentials travel in the request body (`auth.token`); they must not be logged.
  5. QUIRK: `appDomain` defaults to `APP_URL` env, which the installer does not write to `node/.env`; Laravel always sends `appDomain`.
- **Async & events:** detached flow runs; `pruneSessions`.
- **External systems:** Meta Graph (IG/Messenger), TikTok, Telegram, LINE, Viber, WeChat, MailTrixy.
- **Settings:** channel accounts (channel domains).
- **Acceptance criteria:**
  - Given a Messenger DM matching a flow, when Laravel hands it off, then the response is `consumed:true, mode:"start"` and the flow's first message is sent via Graph.
  - Given a parked session and a reply, then `mode:"resume"`.
  - Given no session and no flow payload, then `consumed:false, mode:"none"` and Laravel runs its own auto-reply.
  - Given the node call fails, then Laravel proceeds as not consumed.
- **Source refs:** node/controllers/{instagram,facebook,tiktok,telegram,line,wechat,viber,email}FlowController.js, node/services/{instagram,facebook,tiktok,telegram,line,wechat,viber,email}FlowService.js, app/Services/{Facebook/FbFlowBridge,Telegram/TgFlowBridge,Line/LineFlowBridge,Viber/ViberFlowBridge,WeChat/WeChatFlowBridge,Mailtrixy/EmailFlowBridge,Tiktok/TtFlowBridge}.php, app/Http/Controllers/{Facebook/FacebookFlowNodeController,Telegram/TelegramFlowNodeController,Tiktok/TiktokFlowNodeController,Line/LineFlowNodeController,Viber/ViberFlowNodeController,WeChat/WeChatFlowNodeController,Mailtrixy/EmailFlowNodeController}.php
- **Port notes:** One flow engine (FLR) with per-channel provider adapters; delays are BullMQ delayed steps. Do not build eight copies.

### WD-NODE-051 — Telegram user-account (MTProto) bridge

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-NODE-002
- **Summary:** Telegram offers no API to create bots, so the bridge logs in as a real Telegram user over MTProto to drive @BotFather: send a login code, sign in (with optional 2FA), QR login, check status, log out, check a username and create a bot.
- **Actors & access:** workspace admins via Laravel `TelegramAccountBridge` (timeout 45 s; create-bot 90 s); token header only (401 `{ok:false,error:"unauthorized"}`).
- **UX & screens:** Telegram channel setup (TG).
- **Endpoints:** `POST /api/telegram-account/send-code` `{phone}`, `sign-in` `{loginId, code, password}`, `qr-start` `{loginId}`, `qr-poll` `{loginId, password}`, `status` `{accountId, session}`, `log-out` `{accountId, session}`, `create-bot` `{accountId, session, name, username}`, `check-username` `{accountId, session, username}`. Each request may carry `apiId` and `apiHash`. Response 200 when the handler returns `ok`, 422 when not, 500 `{ok:false,error:"Telegram account request failed."}`.
- **Data:** in-memory `pending` logins (TTL 10 minutes, opaque login id) and `live` clients by account id; the session string is handed to Laravel to store encrypted and never written to disk by Node.
- **Rules & edge cases:**
  1. `api_id`/`api_hash` come from admin settings (`telegram_api_id`, `telegram_api_hash`) on every request and are remembered as the last good pair; fallback to `TELEGRAM_API_ID/HASH` env; missing gives code `no_api_credentials`.
  2. Deliberately slow and small (one login at a time, human-scale pauses, connection retries 1, dial timeout 30 s) to avoid Telegram limiting the account.
  3. Exceptions are never logged with messages (MTProto errors can echo credentials): only the error code.
  4. A session string equals full account access; treat as a secret at rest.
- **Async & events:** none.
- **External systems:** Telegram MTProto.
- **Settings:** `telegram_api_id`, `telegram_api_hash`.
- **Acceptance criteria:**
  - Given a valid phone, when send-code is called, then a login id is returned and a Telegram code is delivered.
  - Given a wrong token, then 401.
  - Given the pending login is older than 10 minutes, then sign-in fails.
- **Source refs:** node/index.js, node/services/telegramAccountService.js, node/services/telegramBotFatherService.js, app/Services/Telegram/TelegramAccountBridge.php
- **Port notes:** Needs a long-lived process (worker) holding the MTProto client between requests; store session strings encrypted; consider dropping the feature (ToS risk) in favor of a manual token paste.

### WD-NODE-052 — Admin Node-bridge settings and connection test

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-NODE-002, WD-NODE-004
- **Summary:** A super-admin panel in Channel Settings stores the bridge URL and shared token, mirrors them into the Laravel `.env`, pushes a settings refresh to the bridge, tests connectivity, and edits the send pacing.
- **Actors & access:** platform admins (`Authenticate`, `EnsureUserIsAdmin`, `IPAllowlist`).
- **UX & screens:** `resources/views/admin/settings/channel-setting.blade.php` node panel (SET/ASHELL own the view): Server URL, masked Token, "Test connection" and pacing "Update timing".
- **Endpoints:**

| Method uri                                      | Route name                     | Controller                                      | Request                                                                                 | Response                                                                                                                                                                                                                              |
| ----------------------------------------------- | ------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST admin/settings/channel-setting/node`      | `admin.settings.node.update`   | `AdminPagesController@settingsNodeBridgeUpdate` | `baileys_server_url` nullable url max 191; `node_webhook_token` nullable string max 191 | stores `baileys_server_url` (empty allowed), mirrors `SERVER_URL` into `.env`, stores the token only when filled (encrypted setting plus `.env NODE_WEBHOOK_TOKEN`), calls `refreshNodeSettings`, redirects with "Node bridge saved." |
| `POST admin/settings/channel-setting/node/test` | `admin.settings.node.test`     | `testNodeBridge`                                | `baileys_server_url`, `node_webhook_token` (blank = stored)                             | JSON `{ok, message}`: 422 for a non-http URL; GET `{url}/api/refresh-settings` timeout 5 s; 401/403 "token was rejected"; 200 "Connected"; other status or exception with an explanatory message (HTTP 200 for all but the URL error) |
| `POST admin/settings/channel-setting/pacing`    | `admin.settings.pacing.update` | `settingsPacingUpdate`                          | see WD-NODE-029                                                                         | JSON                                                                                                                                                                                                                                  |

- **Data:** `system_settings` (`baileys_server_url`, `node_webhook_token`, `msg_gap`, `batches_gap`, `bw_msg_gap`, `enable_batches`).
- **Rules & edge cases:**
  1. The full providers form (`admin/settings/providers`, owned by SET) also saves the URL, token and pacing; it persists `enable_batches` from the checkbox (unchecked = false) and calls both `refreshNodeSettings` and `bustAll`.
  2. Changing the token here does not change `node/.env`; the admin must edit the bridge env and restart it, otherwise every callback fails.
  3. The install wizard step 6 (INST) generates a 64-hex token and default port 8888 and writes both env files.
- **Async & events:** none.
- **External systems:** the bridge.
- **Settings:** as listed.
- **Acceptance criteria:**
  - Given a reachable bridge and matching token, when Test connection is pressed, then "Connected — bridge reachable and token accepted."
  - Given a blank token field on save, then the stored token is unchanged.
  - Given the URL is not http(s), then 422 with the URL message.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (`settingsNodeBridgeUpdate`, `testNodeBridge`, `settingsPacingUpdate`, `settingsProvidersUpdate`), resources/views/admin/settings/channel-setting.blade.php, app/Support/EnvWriter.php, resources/views/install/node.blade.php
- **Port notes:** Settings live in the platform settings module; the worker reads them from the database or a config event, so no push/refresh dance.

### WD-NODE-053 — Developer file-sync endpoint (`wd-sync`)

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** —
- **Summary:** A private remote-deploy endpoint that lets the vendor push changed files to a test server, run migrations, clear caches and optionally run a named seeder. Disabled unless `WD_SYNC_KEY` is set.
- **Actors & access:** the vendor's machine only; header `X-Sync-Key` compared with `hash_equals`; throttle 30/min; CSRF-exempt.
- **UX & screens:** none.
- **Endpoints:**

| Method uri     | Route name | Controller              | Request                                                                                                                                                   | Response                                                                                                                                                                            |
| -------------- | ---------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST wd-sync` | `wd.sync`  | `WdSyncController@push` | header `X-Sync-Key`; `files[]{path, contents_b64}`; `allow_env`, `migrate` (default true), `clear` (default true), `seed`, `seed_env{UPPER_SNAKE: value}` | 404 when no key configured or key wrong (indistinguishable from a missing route); 422 `no files in payload`; `{ok, written[], skipped[{path,reason}], migrate, cache, seed, count}` |

- **Data:** writes files under the app root.
- **Rules & edge cases:**
  1. Rejected paths: empty, NUL, absolute (`/`, `C:`), any `..`, `.env` (unless `allow_env` and exactly the root file), `.env.*`, `.git/`, `storage/framework/down`; target must normalize inside `base_path()`; write is temp file plus rename.
  2. After writes: `migrate --force`, `optimize:clear`; `seed` class name restricted to `Database\Seeders\` word characters; `seed_env` keys restricted to UPPER_SNAKE.
  3. Logged with IP and counts. Whoever holds the key can overwrite any PHP file (remote code execution by design).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `config/wdsync.php` key `WD_SYNC_KEY` (empty disables).
- **Acceptance criteria:**
  - Given no `WD_SYNC_KEY`, then the route answers 404.
  - Given a valid key and a path with `..`, then the file is skipped with reason "parent traversal".
- **Source refs:** app/Http/Controllers/WdSyncController.php, config/wdsync.php, routes/web.php, bootstrap/app.php
- **Port notes:** DO NOT PORT. Deployment goes through CI/CD; a remote file-write endpoint has no place in the target.

### WD-NODE-054 — Node smoke and regression test scripts

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** —
- **Summary:** Five stand-alone `.mjs` scripts exercise the flow runtime and the Instagram flow port with mock Laravel/Graph servers and stubbed sockets. They print PASS/FAIL and are the only automated tests shipped with the bridge.
- **Actors & access:** developers (`node node/test/<file>.mjs`); no test runner and no `npm test` script.
- **UX & screens:** console output.
- **Endpoints:** none (local mock HTTP servers on ephemeral ports).
- **Data:** none.
- **Rules & edge cases:**
  1. `flow-smoke.mjs`: walks every normalized node type through `executeFlowNode` with a stub socket and a mock Laravel answering every callback (commerce inventory, appointment, sub-flow, AI, tag, assign), reporting whether each node sends, advances or dies silently.
  2. `booking-smoke.mjs`: drives the multi-service booking state machine (day list, time list, questions, confirmation, copy-to-number alert) asserting every step sends a message.
  3. `flow-condition.mjs` and `flow-condition-messy.mjs`: lock operators (`exists`, `gt`, `lt`, equals, contains, starts/ends with, is empty...) and adversarial inputs (braces in variable names, wrong casing, junk operators) so conditions never throw.
  4. `flow-sheets-write.mjs`: a blank/null column mapping must not write `[object Object]`.
  5. `ig-flow-smoke.mjs`: runs the real Instagram flow walker against a mock Graph and mock Laravel callbacks.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `node node/test/flow-condition.mjs`, then all assertions pass with exit code 0.
  - Given a regression in the `exists` operator, then the script reports FAIL.
- **Source refs:** node/test/flow-smoke.mjs, node/test/booking-smoke.mjs, node/test/flow-condition.mjs, node/test/flow-condition-messy.mjs, node/test/flow-sheets-write.mjs, node/test/ig-flow-smoke.mjs
- **Port notes:** Convert to Vitest/Jest suites in the flow module (FLR) reusing the same cases as fixtures; add contract tests for the bridge/worker command interface.

## Data model

The bridge owns no database tables. Its persistent state is a folder tree, and everything else is process memory that is lost on restart. Tables it reads and writes through the Laravel contract belong to other domains; the columns that matter to bridge behavior are listed so the rebuild can index them correctly.

### Bridge-owned state

**Disk: `node/baileys_auth/session_<digits>/`** (one folder per device phone, digits only, created by `useMultiFileAuthState`). Contents: `creds.json` and many signal key/app-state files (at least 3 entries means "healthy", WD-NODE-007), `baileys_store.json` (in-memory store snapshot, rewritten every 10 s and on soft disconnect), `proxy.json` (cached proxy config, absent when no proxy). Deleted on logout, 401, 403, badSession, failed first pair, QR timeout, wrong-account mismatch and the destructive `check-connection` probe. Written by WD-NODE-011/013; read at boot by WD-NODE-007. Volume: one folder per paired device, each 10s to 100s of small files. Target replacement: encrypted auth-state rows/blobs per device.

**Memory (`app.locals` and module maps):**

| Structure                             | Key                       | Value shape                                                                                                                                                                                                                                                                                                                   | Lifetime                                                                            | Feature             |
| ------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------- |
| `clients`                             | device digits             | Baileys socket (wrapped by send serialization)                                                                                                                                                                                                                                                                                | until close/terminate                                                               | WD-NODE-011         |
| `client_ready`                        | device digits             | boolean                                                                                                                                                                                                                                                                                                                       |                                                                                     | WD-NODE-011         |
| `clientManagers`                      | device digits             | `BaileysClientManager` (see WD-NODE-011 fields)                                                                                                                                                                                                                                                                               | until logout or failed pair; NOT set for boot-restored sessions                     | WD-NODE-007/008     |
| `connectionLocks`                     | device digits             | epoch ms                                                                                                                                                                                                                                                                                                                      | swept at 5 min                                                                      | WD-NODE-008         |
| `activeFlowSessions`                  | `<device>_<customer>`     | `{sessionId, flowId, triggerKeyword, flowData, currentNodeId, userVariables, messageHistory[], status (active, completed, timeout), startedAt, phoneNumber, timeoutSeconds, cooldownSeconds, timeoutTimer, waitingForInput, provider, __nodeVisits, __senderPhone, __appDomainName, __sockPaused, __capPaused, lastMenuWait}` | idle timer (default 600 s), 30-minute sweeper, completed sessions removed after 5 s | WD-NODE-019/041/042 |
| `userCooldowns`                       | `<device>_<customer>`     | `{endTime, cooldownSeconds}`                                                                                                                                                                                                                                                                                                  | until expiry (swept 10 min)                                                         | WD-NODE-019         |
| `scheduledMessages`                   | array                     | bulk, recurring, single, broadcast, campaign rows (WD-NODE-030)                                                                                                                                                                                                                                                               | process                                                                             | WD-NODE-030..040    |
| `scheduledJobs`                       | node id                   | node-cron task                                                                                                                                                                                                                                                                                                                | until run or cancel                                                                 | WD-NODE-030         |
| `whatsappSettings`, `messageSettings` | global                    | `{use_facebook_api, facebook_phone_id, facebook_api_token, branding_footer, last_fetched}`; `{msg_gap 3, enable_batches 0, batches_gap 50, bw_msg_gap 5, last_fetched}`                                                                                                                                                       | hourly refresh                                                                      | WD-NODE-004/029     |
| `__settingsCache`                     | `[<wsId>:]<phone>` or `*` | Laravel `whatsapp-settings` JSON plus `last_success`                                                                                                                                                                                                                                                                          | 5 min TTL, flushed by cache-bust                                                    | WD-NODE-026         |
| `_dailyTally`                         | phone then UTC date       | count                                                                                                                                                                                                                                                                                                                         | pruned after 2 days                                                                 | WD-NODE-029         |
| workspace attribute cache             | workspace id              | `{at, attrs}`                                                                                                                                                                                                                                                                                                                 | 60 s                                                                                | WD-NODE-043         |
| `_recentlyLeft`                       | `<workspaceId>::<jid>`    | monotonic ns                                                                                                                                                                                                                                                                                                                  | 30 s                                                                                | WD-NODE-021         |
| MTProto `pending` / `live`            | login id / account id     | client objects                                                                                                                                                                                                                                                                                                                | 10 min / process                                                                    | WD-NODE-051         |
| Channel flow sessions                 | per channel key           | in-memory session objects                                                                                                                                                                                                                                                                                                     | per service                                                                         | WD-NODE-050         |
| WABA call sessions                    | `meta_call_id`            | WebRTC/STT/TTS session                                                                                                                                                                                                                                                                                                        | call                                                                                | WD-NODE-049         |

### Laravel tables touched through the contract (owned elsewhere)

| Table                                                | Bridge-relevant columns and rules                                                                                                                                                                                                                                                                                                                                                                                                                                   | Written or read by                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `devices`                                            | `phone_number` and `country_code` are ENCRYPTED text (no SQL match; every lookup scans in PHP), `status` (connected, disconnected, needs_pair, ...), `active`, `last_seen_at`, `workspace_id`, `proxy_enabled`, `proxy_type` (http default, socks5), `proxy_host`, `proxy_port`, `proxy_username`/`proxy_password` (encrypted), `proxy_status`, `proxy_egress_ip`, `proxy_checked_at`, `sent_24h`, `failed_24h`, `warmer_config` JSON, `warm_day`, `warm_day_count` | WD-NODE-012/013/014/017 (WADEV owns) |
| `wa_provider_configs`                                | `provider` (baileys, waba, twilio), `phone_number`, `status` (pending, connected, disconnected), `credentials_json` encrypted (`access_token`, `phone_number_id`, `waba_id`, `account_sid`, `auth_token`, `from_number`, `sandbox`, `server_url`, `qr_data`, `last_status_msg`, `last_status_at`), `meta_json`, `is_primary`, `connected_at`, `last_health_at`                                                                                                      | WD-NODE-008/012/026/049              |
| `system_settings`                                    | `baileys_server_url`, `node_webhook_token` (encrypted), `baileys_callback_token` (legacy), `msg_gap`, `batches_gap`, `bw_msg_gap`, `enable_batches`, `waba_graph_api_version`, `default_send_method`, `web_search_provider`, `web_search_key`, `telegram_api_id`, `telegram_api_hash`, `waba_templates_v2_enabled`, `waba_template_quality_floor`                                                                                                                   | WD-NODE-002/026/029/044/052          |
| `scheduled_messages`, `scheduled_message_contacts`   | `node_schedule_id`, `status`, `total_sent/delivered/failed`, `charged_sent`, `provider`, `next_run_at`; pivot `status` (pending, failed, sent, delivered, read), `wa_message_id`                                                                                                                                                                                                                                                                                    | WD-NODE-034..036 (SCHED owns)        |
| `broadcasts`, `broadcast_contacts`                   | `node_schedule_id`, `provider`, `device_id` (a config id for waba/twilio), counters, pivot `status`, `whatsapp_message_id`                                                                                                                                                                                                                                                                                                                                          | WD-NODE-037/038 (BCAST)              |
| `wpcampaigns`, `wp_campaign_contacts`                | `status` (scheduled, running, ...), counters, `whatsapp_message_id`, `variant`, unsubscribe flags                                                                                                                                                                                                                                                                                                                                                                   | WD-NODE-015/040 (CAMP)               |
| `messages`, `inbox_messages`, `conversations`        | `meta.wa_message_id` (JSON path lookup), `status`, `delivered_at`, `read_at`, `raw_jid`, `alt_jid`                                                                                                                                                                                                                                                                                                                                                                  | WD-NODE-017/020 (CHAT/TIB1)          |
| `google_form_sessions`                               | `workspace_id`, `flow_session_id`, `google_form_id`, `contact_phone`, `save_variable`, `resume_port`, `webhook_token`, `expires_at`, `submitted_at`, `answers_json`                                                                                                                                                                                                                                                                                                 | WD-NODE-046                          |
| `wa_groups`, `wa_group_members`                      | `(workspace_id, group_jid)` upsert; members replaced per sync; `group_code` unique per workspace                                                                                                                                                                                                                                                                                                                                                                    | WD-NODE-021 (WFL/CHK)                |
| `wa_calls`, `wa_call_events`                         | call status ringing, connecting, active, failed, ended; event types bridge_accepted, bridge_error, transcript_turn                                                                                                                                                                                                                                                                                                                                                  | WD-NODE-049 (CALL)                   |
| `appointments`, `booking_types`, `slot_reservations` | `active_slot_key` UNIQUE hard guard; reservation TTL 10 min                                                                                                                                                                                                                                                                                                                                                                                                         | WD-NODE-048 (APPT)                   |
| `attributes`, `wa_templates`, `flows`                | workspace attributes; template render data; encrypted flow JSON                                                                                                                                                                                                                                                                                                                                                                                                     | WD-NODE-043                          |

## Cross-domain contracts

**Consumes**

- WADEV: the `devices` and `wa_provider_configs` rows, device limit gate (`PlanLimitGuard device_limit`), proxy configuration UI, connect wizard, QR/pairing modals that call WD-NODE-008..010.
- SET / ASHELL: platform settings screens for bridge URL, token, pacing, Graph version, branding footer; admin health page pinging `GET /` (WD-NODE-004); install wizard step 6 (INST) writing `.env` and `node/.env`.
- SCHED: `scheduled_messages` semantics, retries (`ScheduledMessageSweeper`), warmer (`WarmerService`, `warmerGap`).
- BCAST: broadcast payload building (`BroadcastsController` dispatch, `TemplatePayloadBuilder`, `LinkTracker`), `BroadcastSweeper`.
- CAMP: campaign engine (`CampaignScheduleSweeper`, drain), campaign tables and analytics.
- CHAT / TIB1 / TIB2: inbound ingestion rules behind `api/inbound-message`, `ConversationResolver`, receipts, AI agent auto-reply, routing rules (`trigger_flow`), opt-out (`OptOutService`), the dispatchers (`WhatsAppDispatcher`, `InboxDispatcher`) that call every Node send endpoint.
- AR / FLB / FLR: keyword rules (`AutoReplyController::lookup`), flow definitions, normalizer, the flow runtime services in `node/services/flowService.js` and the flow-node actions.
- WALLET / BSP / PLAN: overflow billing (`OverflowBilling`, `MessageBillingService`), `monthly_messages_limit`, wallet credits, plan gates on the flow-node endpoints.
- INTG / APPT / CHK / CAT / ECOM / WFL / CALL / AIAG / AIADM: the services called by the flow-node endpoints (Google, calendar/booking, ordering, commerce providers, forms, group directory, calling, AI keys and agents).
- Channel domains FB, IG, TG, TT, LINE, WECH, VIB, MAIL: their inbound webhooks, flow bridges and callbacks (WD-NODE-050).

**Exposes**

- To Laravel domains: a command surface of about 90 HTTP endpoints on the bridge (table below) and the callback contract (81 routes claimed in this file).
- `node_token()` / `wd_node_url()` helpers (fc_helpers) consumed by every module that calls the bridge.
- `NodeCacheBuster` (`bustWorkspace`, `bustAll`, `refreshNodeSettings`) and `NodeSchedulerClient` (`registerOneOff`, `registerRecurring`, `pause`, `resume`, `cancel`, `resolveRecipients`, `resolveTemplateData`, `resolveFreeformMessage`).
- Events: `DeviceStatusChanged` (workspace channel `device-status.workspace.{id}`).
- Suggested target contract (for the rebuild): `packages/contracts` types `InboundWhatsAppMessage`, `SendCommand` (text, media, location, contact, interactive, template, reaction, pin, star, edit, delete), `DeviceStatusEvent`, `DeliveryReceipt`, `GroupSnapshot`, `ScheduleFired`.

**Bridge HTTP surface (all guarded by WD-NODE-002 unless noted)**

| Group            | Endpoints                                                                                                                                                                                            | Features                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Status           | `GET /`, `GET /health` (open); `GET /api/refresh-settings`, `/api/current-settings`, `/api/current-message-settings`                                                                                 | 004                                                                             |
| Cache            | `POST /api/cache-bust`                                                                                                                                                                               | 026                                                                             |
| Device lifecycle | `GET /api/initialize-client                                                                                                                                                                          | client-status                                                                   | terminate-client                                                                                                                 | check-connection                                                                             | get-contacts                                                                                     | get-pairing-code/:phone` | 008, 009, 010 |
| Send             | `POST /api/send-message                                                                                                                                                                              | send-group-message                                                              | send-media-only                                                                                                                  | send-media-message                                                                           | send-location                                                                                    | send-product-catalog     | send-reaction | pin-message     | star-message | send-contact | delete-message        | edit-message/:phone` | 022..025 |
| Scheduling       | `POST /api/schedule-message                                                                                                                                                                          | schedule-message-bulk                                                           | schedule-recurring                                                                                                               | send-bulk-immediate/:phone`, `GET /api/scheduled-messages/:phone`, `POST /api/pause-schedule | resume-schedule/:id`, `DELETE /api/cancel-scheduled-message/:id`, `PUT /api/update-schedule/:id` | 031..034                 |
| Broadcast        | `POST /api/broadcast/send-immediate                                                                                                                                                                  | schedule/:phone`, `POST .../pause                                               | resume/:id`, `DELETE .../cancel/:id`, `DELETE .../cancel-by-broadcast/:broadcastId`, `GET .../list/:phone`, `GET .../status/:id` | 037                                                                                          |
| Groups           | `POST                                                                                                                                                                                                | GET /api/groups/create                                                          | all                                                                                                                              | meta                                                                                         | participants                                                                                     | subject                  | description   | settings        | leave        | invite-code  | revoke-invite/:phone` | 021                  |
| Campaign (dead)  | `POST /api/wa/:phone/campaign/send                                                                                                                                                                   | schedule`, `GET /api/wa/campaign/:id/details`, `POST /api/wa/campaign/:id/pause | resume                                                                                                                           | cancel`                                                                                      | 039                                                                                              |
| Flow             | `POST /api/flow/start/:phone`, `/api/flow/resume-port/:key`, `/api/flow/resume-by-phone/:ws/:phone`, `/api/flow/resume-form/:key`, `/api/flow-resume`, `/api/flow-end`, `/api/flow/provider-inbound` | 041, 042                                                                        |
| Calls            | `POST /api/waba-call/answer                                                                                                                                                                          | terminate                                                                       | place-outbound                                                                                                                   | link-meta                                                                                    | connect                                                                                          | record`                  | 049           |
| Channel flows    | `POST /api/{instagram,facebook,tiktok,telegram,line,wechat,viber,email}-flow/inbound`, `GET .../health`                                                                                              | 050                                                                             |
| Telegram account | `POST /api/telegram-account/send-code                                                                                                                                                                | sign-in                                                                         | qr-start                                                                                                                         | qr-poll                                                                                      | status                                                                                           | log-out                  | create-bot    | check-username` | 051          |

## Open questions & quirks

Consolidated list; the detailed context is in the feature entries.

1. **No scheduler in Laravel.** `php artisan schedule:list` is empty, sweeps run inline and background work uses `afterResponse`/`terminating` callbacks (the docs mention a database queue worker, but none of the paths read depends on it); the bridge heartbeat and the drain loop are the only clocks (WD-NODE-014/015). A deployment with no Baileys device never heartbeats. The target must move every sweep to BullMQ repeatable jobs.
2. **Loopback trust.** In the default `NODE_API_AUTH=loopback` mode a same-host reverse proxy bypasses authentication (WD-NODE-002). Several handlers also insist on the header even in loopback mode; the group routes never trust loopback.
3. **Token drift.** Laravel resolves the secret DB-first, the bridge env-only. The admin panel cannot update `node/.env`. `WaGroupController` reads env directly. The docs' "dev fallback accepts any caller" is not true in code.
4. **Restored sessions are not registered as managers** (WD-NODE-007): terminate, contacts, status QR/code and shutdown cleanup skip them; a later initialize call can create a duplicate socket.
5. **Destructive GET probes.** `check-connection` deletes the session of any non-ready device; `terminate-client` is a GET that unlinks. Docs describe terminate as "soft-disconnect, session preserved", which is wrong.
6. **Status values rejected by Laravel.** Node reports `paused` for broadcasts and schedules; Laravel validators reject it (WD-NODE-029/031/038), so pauses (daily cap, socket drop) are invisible in the UI, and there is no auto-resume.
7. **Daily cap** default 4000/UTC day is in memory, per process, only applied to Node-run bulk/flow sends; `baileys_daily_cap` is never delivered by Laravel; Laravel-driven campaign sends and single sends bypass it.
8. **Recurring schedules:** `repeatEvery` ignored in Node; end date exclusive in Node but inclusive in Laravel; later runs treated as duplicate callbacks so they are not billed or recorded (WD-NODE-032/035); audience frozen at registration; nothing tells Laravel about ids created at boot-sync.
9. **Lost timers on restart** for single scheduled messages and scheduled broadcasts; Laravel rows stay `scheduled` forever (WD-NODE-030/033/037). Single scheduled sends never report an outcome.
10. **Campaign engine in Node is dead code** and has a ReferenceError (`timezone`) that returns HTTP 500 after the campaign has started (WD-NODE-039). Campaign response and unsubscribe tracking through Node only work for in-memory campaigns, i.e. never (WD-NODE-040).
11. **Timeout mismatch** between Laravel (20 s to 90 s) and Baileys `defaultQueryTimeoutMs` (120 s): a slow but successful send is reported failed, inviting duplicate retries. Comments in `WhatsAppDispatcher` still refer to a 30 s ceiling.
12. **Media endpoints lack a Twilio branch** (`send-media-only`, `send-media-message`, `send-location`, `send-product-catalog`); Twilio numbers reach the Baileys path and get 404. `send-contact`, `send-group-message`, reactions and pins are Baileys-only with no provider routing.
13. **Pin duration** parameter has no effect; `pin`, `star` targets need a stored `wa_message_id`.
14. **Group inbound** rows with an unresolved participant phone are rejected by Laravel validation; docs claim groups are filtered out (they are stored).
15. **SSRF and injection surface:** redirects are not re-validated in media fetch; `flow-node/mysql-query` connects to any host; the Google form webhook is public with a shared secret embedded in a downloadable script; `flows/{id}` and `templates-camp/{id}` are not tenant scoped; `flow-end` suffix matching can touch other customers' sessions.
16. **Ambiguous docs claims:** the node-bridge doc lists `/api/wa/:phone/campaign/...` as live and names the auth folder `auth/` (real: `baileys_auth`); `index.js` comments say the Instagram scheduler and the `instagram-flow` routes belong to an addon, yet `index.js` imports the Instagram controller statically and the Instagram flow service ships in core `node/services`; Laravel core has no Instagram bridge class in the files read (it is presumably in the addon).
17. **Dead code inventory:** `PUT update-schedule`, `GET scheduled-messages/:phone` (debug), `getCampaigns`/`getCampaignStatus`/`stopRecurringCampaign`/`getRecurringStatus`, `scheduleService.executeScheduledMessage` (references an undefined `settings`), `helpers.updateScheduleStatusInLaravel` (references an undefined `appDomainName`), `cleanup.js` `getSessionStats`/`cleanupExpiredSessions`/`deleteSessionFiles`, `sendSafety.canSendUnderCap`/`pauseOnSockDrop`, `BaileysClientManager.backup.js`, about 265 commented lines at the top of `helpers.js`.
18. **Not claimed here, left to other domains:** `POST api/twilio/status` (Twilio WhatsApp delivery webhook, signature-verified; a WhatsApp-provider domain should own it), provider inbound webhooks (`api/instaflow/inbound`, `api/mailtrixy/inbound`, `api/line|telegram|viber|wechat/inbound`, `api/sms/*`), the browser-extension API (`ext.*`, EXT), `api/upload-media` and `api/google/picker/{kind}` (session-authenticated builder helpers, FLB/INTG), `api/baileys/qr|status/{configId}` and all device screens (WADEV), the install wizard node step (`install.node*`, INST), `admin/settings/providers` (SET), the behavior of `node/services/flowService.js` and `codeSandbox*.js` (FLR; listed in this file's coverage only as shared runtime files because the bridge's flow endpoints and safety gates call into them), and the channel flow services if the channel writers claim them too.
19. **Unknown:** how Laravel reconciles a single scheduled chat message after Node executes it (no callback; a separate sweeper may cover failed rows only); whether any deployment sets `NODE_API_AUTH=token` by default; whether the Instagram addon registers its own routes on the shared Express `app`.
20. **Security hygiene in logs:** heartbeat logs a token prefix and length; phone numbers and message previews are logged in cleartext at info level by the bridge; `formatMetaError` and Graph error bodies are logged in full.

## Coverage

```json wadesk-coverage
{
  "routes": [
    "GET api/appointments/slots",
    "GET api/booking/slots",
    "GET api/booking/types",
    "GET api/campaigns/sync",
    "GET api/devices/proxy-config/{phone}",
    "GET api/flows/{id}",
    "GET api/keyword-replies",
    "GET api/scheduled/active",
    "GET api/templates-camp/{id}",
    "GET api/waba-call/assistant/{id}",
    "GET api/waba-call/voice-keys",
    "GET api/waba-creds",
    "GET api/whatsapp-message-settings",
    "GET api/whatsapp-settings",
    "GET api/workspace-attributes/{workspaceId}",
    "POST admin/settings/channel-setting/node",
    "POST admin/settings/channel-setting/node/test",
    "POST admin/settings/channel-setting/pacing",
    "POST api/appointments/book",
    "POST api/booking/book",
    "POST api/booking/reserve",
    "POST api/call-flow/active",
    "POST api/campaigns/drain",
    "POST api/campaigns/track-response",
    "POST api/campaigns/unsubscribe",
    "POST api/campaigns/update-contact-status",
    "POST api/campaigns/update-status",
    "POST api/campaigns/update-status-by-id",
    "POST api/chat/message-status",
    "POST api/commerce/check-inventory",
    "POST api/commerce/checkout-link",
    "POST api/commerce/waba-send-products",
    "POST api/devices/proxy-result",
    "POST api/email/flow-log",
    "POST api/email/flow-node",
    "POST api/email/flow-send",
    "POST api/facebook/flow-log",
    "POST api/facebook/flow-node",
    "POST api/flow-node/ai-agent-reply",
    "POST api/flow-node/ai-call",
    "POST api/flow-node/assign",
    "POST api/flow-node/deal-action",
    "POST api/flow-node/google-meet",
    "POST api/flow-node/google/doc-generate",
    "POST api/flow-node/google/form-send",
    "POST api/flow-node/google/sheet-read",
    "POST api/flow-node/google/sheet-write",
    "POST api/flow-node/mysql-query",
    "POST api/flow-node/order-cancel",
    "POST api/flow-node/order-confirm",
    "POST api/flow-node/order-parse",
    "POST api/flow-node/order-reply",
    "POST api/flow-node/order-shipping",
    "POST api/flow-node/place-ai-call",
    "POST api/flow-node/tag",
    "POST api/flow-node/wa-form-send",
    "POST api/flow-node/web-search",
    "POST api/flow/store-media",
    "POST api/google/form-response",
    "POST api/groups/sync",
    "POST api/inbound-message",
    "POST api/line/flow-log",
    "POST api/line/flow-node",
    "POST api/node-heartbeat",
    "POST api/telegram/flow-log",
    "POST api/telegram/flow-node",
    "POST api/tiktok/flow-log",
    "POST api/tiktok/flow-node",
    "POST api/update-broadcast-status",
    "POST api/update-message-status",
    "POST api/update-schedule-status",
    "POST api/update-scheduled-contact-status",
    "POST api/update-status",
    "POST api/viber/flow-log",
    "POST api/viber/flow-node",
    "POST api/waba-call/bridge-accepted",
    "POST api/waba-call/bridge-error",
    "POST api/waba-call/bridge-offer",
    "POST api/waba-call/transcript-turn",
    "POST api/wechat/flow-node",
    "POST api/wechat/flow-send",
    "POST wd-sync"
  ],
  "controllers": [
    "app/Http/Controllers/WdSyncController.php",
    "app/Http/Controllers/FlowNodeActionsController.php",
    "app/Http/Controllers/GoogleFlowNodeController.php",
    "app/Http/Controllers/BookingApiController.php",
    "app/Http/Controllers/FlowsCommerceController.php",
    "app/Http/Controllers/WaGroupController.php",
    "app/Http/Controllers/WaInboundController.php",
    "app/Http/Controllers/Facebook/FacebookFlowNodeController.php",
    "app/Http/Controllers/Telegram/TelegramFlowNodeController.php",
    "app/Http/Controllers/Tiktok/TiktokFlowNodeController.php",
    "app/Http/Controllers/Line/LineFlowNodeController.php",
    "app/Http/Controllers/Viber/ViberFlowNodeController.php",
    "app/Http/Controllers/WeChat/WeChatFlowNodeController.php",
    "app/Http/Controllers/Mailtrixy/EmailFlowNodeController.php"
  ],
  "services": [
    "app/Services/NodeCacheBuster.php",
    "app/Services/NodeSchedulerClient.php",
    "app/Support/EnvWriter.php",
    "app/Support/fc_helpers.php",
    "app/Services/Commerce/FlowSessionResolver.php",
    "app/Services/Facebook/FbFlowBridge.php",
    "app/Services/Line/LineFlowBridge.php",
    "app/Services/Mailtrixy/EmailFlowBridge.php",
    "app/Services/Telegram/TelegramAccountBridge.php",
    "app/Services/Telegram/TgFlowBridge.php",
    "app/Services/Tiktok/TtFlowBridge.php",
    "app/Services/Viber/ViberFlowBridge.php",
    "app/Services/WeChat/WeChatFlowBridge.php"
  ],
  "models": ["GoogleFormSession"],
  "tables": ["google_form_sessions"],
  "views": [],
  "commands": [],
  "permissions": [],
  "middleware": [],
  "node_files": [
    "node/.env",
    "node/app.cjs",
    "node/server.cjs",
    "node/index.js",
    "node/index-cpanel.js",
    "node/log-gate.js",
    "node/package.json",
    "node/package-lock.json",
    "node/config/config.js",
    "node/routes/index.js",
    "node/classes/BaileysClientManager.js",
    "node/controllers/broadcastController.js",
    "node/controllers/campaignController.js",
    "node/controllers/clientController.js",
    "node/controllers/emailFlowController.js",
    "node/controllers/facebookFlowController.js",
    "node/controllers/flowController.js",
    "node/controllers/groupController.js",
    "node/controllers/instagramFlowController.js",
    "node/controllers/lineFlowController.js",
    "node/controllers/messageController.js",
    "node/controllers/providerFlowController.js",
    "node/controllers/scheduleController.js",
    "node/controllers/telegramFlowController.js",
    "node/controllers/tiktokFlowController.js",
    "node/controllers/viberFlowController.js",
    "node/controllers/wabaCallController.js",
    "node/controllers/wechatFlowController.js",
    "node/services/broadcastService.js",
    "node/services/campaignService.js",
    "node/services/scheduleService.js",
    "node/services/telegramAccountService.js",
    "node/services/telegramBotFatherService.js",
    "node/services/wabaCallBridge.js",
    "node/services/callFlowRuntime.js",
    "node/services/emailFlowService.js",
    "node/services/facebookFlowService.js",
    "node/services/instagramFlowService.js",
    "node/services/lineFlowService.js",
    "node/services/telegramFlowService.js",
    "node/services/tiktokFlowService.js",
    "node/services/viberFlowService.js",
    "node/services/wechatFlowService.js",
    "node/services/flowService.js",
    "node/services/codeSandbox.js",
    "node/services/codeSandboxWorker.js",
    "node/utils/campaignHelpers.js",
    "node/utils/cleanup.js",
    "node/utils/helpers.js",
    "node/utils/sendSafety.js",
    "node/test/booking-smoke.mjs",
    "node/test/flow-condition-messy.mjs",
    "node/test/flow-condition.mjs",
    "node/test/flow-sheets-write.mjs",
    "node/test/flow-smoke.mjs",
    "node/test/ig-flow-smoke.mjs"
  ],
  "js_assets": [],
  "misc_files": ["app/Events/DeviceStatusChanged.php"],
  "config_files": ["config/wdsync.php"],
  "doc_pages": [
    "Documentation/pages/developer-guide/node-bridge.html",
    "Documentation/pages/developer-guide/engines.html",
    "Documentation/pages/developer-guide/architecture.html",
    "Documentation/pages/getting-started/proxy-isolation.html"
  ],
  "feature_map": {
    "WD-NODE-012": ["POST api/update-status"],
    "WD-NODE-013": ["GET api/devices/proxy-config/{phone}", "POST api/devices/proxy-result"],
    "WD-NODE-014": ["POST api/node-heartbeat"],
    "WD-NODE-015": ["POST api/campaigns/drain"],
    "WD-NODE-017": ["POST api/inbound-message"],
    "WD-NODE-019": ["GET api/keyword-replies"],
    "WD-NODE-020": ["POST api/chat/message-status"],
    "WD-NODE-021": ["POST api/groups/sync"],
    "WD-NODE-026": ["GET api/whatsapp-settings"],
    "WD-NODE-029": [
      "GET api/whatsapp-message-settings",
      "POST admin/settings/channel-setting/pacing"
    ],
    "WD-NODE-035": ["POST api/update-schedule-status", "POST api/update-scheduled-contact-status"],
    "WD-NODE-036": ["GET api/scheduled/active"],
    "WD-NODE-038": ["POST api/update-message-status", "POST api/update-broadcast-status"],
    "WD-NODE-039": ["GET api/campaigns/sync"],
    "WD-NODE-040": [
      "POST api/campaigns/update-status",
      "POST api/campaigns/update-contact-status",
      "POST api/campaigns/update-status-by-id",
      "POST api/campaigns/track-response",
      "POST api/campaigns/unsubscribe"
    ],
    "WD-NODE-043": [
      "GET api/flows/{id}",
      "GET api/workspace-attributes/{workspaceId}",
      "GET api/templates-camp/{id}",
      "POST api/flow/store-media"
    ],
    "WD-NODE-044": [
      "POST api/flow-node/tag",
      "POST api/flow-node/assign",
      "POST api/flow-node/deal-action",
      "POST api/flow-node/ai-agent-reply",
      "POST api/flow-node/ai-call",
      "POST api/flow-node/web-search",
      "POST api/flow-node/mysql-query",
      "POST api/flow-node/google-meet",
      "POST api/flow-node/wa-form-send"
    ],
    "WD-NODE-045": [
      "POST api/flow-node/order-parse",
      "POST api/flow-node/order-shipping",
      "POST api/flow-node/order-confirm",
      "POST api/flow-node/order-cancel",
      "POST api/flow-node/order-reply"
    ],
    "WD-NODE-046": [
      "POST api/flow-node/google/sheet-write",
      "POST api/flow-node/google/sheet-read",
      "POST api/flow-node/google/doc-generate",
      "POST api/flow-node/google/form-send",
      "POST api/google/form-response"
    ],
    "WD-NODE-047": [
      "POST api/commerce/checkout-link",
      "POST api/commerce/waba-send-products",
      "POST api/commerce/check-inventory"
    ],
    "WD-NODE-048": [
      "GET api/appointments/slots",
      "POST api/appointments/book",
      "GET api/booking/types",
      "GET api/booking/slots",
      "POST api/booking/reserve",
      "POST api/booking/book"
    ],
    "WD-NODE-049": [
      "POST api/call-flow/active",
      "GET api/waba-creds",
      "GET api/waba-call/assistant/{id}",
      "GET api/waba-call/voice-keys",
      "POST api/waba-call/bridge-accepted",
      "POST api/waba-call/bridge-error",
      "POST api/waba-call/transcript-turn",
      "POST api/waba-call/bridge-offer",
      "POST api/flow-node/place-ai-call"
    ],
    "WD-NODE-050": [
      "POST api/facebook/flow-log",
      "POST api/facebook/flow-node",
      "POST api/telegram/flow-log",
      "POST api/telegram/flow-node",
      "POST api/tiktok/flow-log",
      "POST api/tiktok/flow-node",
      "POST api/line/flow-log",
      "POST api/line/flow-node",
      "POST api/viber/flow-log",
      "POST api/viber/flow-node",
      "POST api/wechat/flow-send",
      "POST api/wechat/flow-node",
      "POST api/email/flow-send",
      "POST api/email/flow-node",
      "POST api/email/flow-log"
    ],
    "WD-NODE-052": [
      "POST admin/settings/channel-setting/node",
      "POST admin/settings/channel-setting/node/test"
    ],
    "WD-NODE-053": ["POST wd-sync"]
  }
}
```
