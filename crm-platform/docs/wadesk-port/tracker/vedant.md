# WaDesk port tracker — Vedant

Only Vedant edits this file (`wadesk-ownership-guard` enforces it). Statuses: todo · in-progress · backend-done · frontend-done · done · verified · blocked · wontfix.
Update with: `python3 .claude/skills/wadesk-parity-tracker/scripts/tracker.py set WD-XXX-001 in-progress --pr 123`

## whatsapp-devices-baileys (wadev)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-WADEV-001 | todo |  |  |
| WD-WADEV-002 | todo |  |  |
| WD-WADEV-003 | todo |  |  |
| WD-WADEV-004 | todo |  |  |
| WD-WADEV-005 | todo |  |  |
| WD-WADEV-006 | todo |  |  |
| WD-WADEV-007 | todo |  |  |
| WD-WADEV-008 | todo |  |  |
| WD-WADEV-009 | todo |  |  |
| WD-WADEV-010 | todo |  |  |
| WD-WADEV-011 | todo |  |  |
| WD-WADEV-012 | todo |  |  |
| WD-WADEV-013 | todo |  |  |
| WD-WADEV-014 | todo |  |  |
| WD-WADEV-015 | todo |  |  |
| WD-WADEV-016 | todo |  |  |
| WD-WADEV-017 | todo |  |  |
| WD-WADEV-018 | todo |  |  |
| WD-WADEV-019 | todo |  |  |
| WD-WADEV-020 | todo |  |  |
| WD-WADEV-021 | todo |  |  |
| WD-WADEV-022 | todo |  |  |
| WD-WADEV-023 | todo |  |  |
| WD-WADEV-024 | todo |  |  |
| WD-WADEV-025 | todo |  |  |
| WD-WADEV-026 | todo |  |  |
| WD-WADEV-027 | todo |  |  |
| WD-WADEV-028 | todo |  |  |
| WD-WADEV-029 | todo |  |  |
| WD-WADEV-030 | todo |  |  |
| WD-WADEV-031 | todo |  |  |
| WD-WADEV-032 | todo |  |  |
| WD-WADEV-033 | todo |  |  |
| WD-WADEV-034 | todo |  |  |
| WD-WADEV-035 | todo |  |  |
| WD-WADEV-036 | todo |  |  |
| WD-WADEV-037 | todo |  |  |
| WD-WADEV-038 | todo |  |  |
| WD-WADEV-039 | todo |  |  |
| WD-WADEV-040 | todo |  |  |
| WD-WADEV-041 | todo |  |  |
| WD-WADEV-042 | todo |  |  |
| WD-WADEV-043 | todo |  |  |
| WD-WADEV-044 | todo |  |  |
| WD-WADEV-045 | todo |  |  |
| WD-WADEV-046 | todo |  |  |

## whatsapp-cloud-api-waba (waba)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-WABA-001 | frontend-done |  | platform Meta app credentials: the whatsapp settings group and admin page /admin/settings/whatsapp; saved values overlay the environment (15 s) in API and worker; secrets encrypted, never returned; waba-config.spec |
| WD-WABA-002 | frontend-done |  | platform admin check of the four coexistence webhook fields on the Meta app (GET /platform/waba/webhook-status) shown on the WhatsApp settings page; unit tested, not run against real Meta |
| WD-WABA-003 | frontend-done |  | one-click subscribe keeps every existing field and the callback Meta has on file (POST /platform/waba/webhook-subscribe); unit tested, not run against real Meta |
| WD-WABA-004 | frontend-done |  | numbers section at /channels/whatsapp: cards, actions, inbound badge; waba-connect.e2e |
| WD-WABA-005 | frontend-done |  | Meta JS SDK launcher and connect modals; embedded-signup.test.ts; the popup was never opened against real Meta |
| WD-WABA-006 | frontend-done |  | manual connect (paste credentials) modal and API; waba-connect.e2e |
| WD-WABA-007 | frontend-done |  | pre-save token check reports each scope; waba-connect.e2e |
| WD-WABA-008 | wontfix |  | dead endpoint in WaDesk (no page calls it); connect and renew do the exchange server-side; inventory says do not port unless a UI needs it |
| WD-WABA-009 | frontend-done |  | Embedded Signup: code exchange, Interakt registration, callback override, ids proven against token scopes; waba-connect.e2e |
| WD-WABA-010 | frontend-done |  | coexistence launch and flag; echoes (044) and history re-sync button (028) built; history import is row 046 |
| WD-WABA-011 | backend-done |  | subscribe the app to a WABA with callback override, warns when Interakt refuses; waba-connect.e2e |
| WD-WABA-012 | frontend-done |  | Cloud API registration with a kept PIN, auto and manual, hint when two-step is on; waba-connect.e2e |
| WD-WABA-013 | frontend-done |  | inbound-wired verification, stamp and badge on the card; waba-connect.e2e |
| WD-WABA-014 | frontend-done |  | Fix inbound re-subscribes and verifies; waba-connect.e2e |
| WD-WABA-015 | frontend-done |  | live inbound check per number with a typed verdict plus the callback URL and verify token for a customer's own Meta app; e2e with Meta faked at the HTTP edge |
| WD-WABA-016 | frontend-done |  | primary and auto-promotion; waba-connect.e2e keeps-one-primary |
| WD-WABA-017 | frontend-done |  | disconnect hands primary on; waba-connect.e2e |
| WD-WABA-018 | frontend-done |  | remove hands primary on; waba-connect.e2e |
| WD-WABA-019 | frontend-done |  | replace token only when Meta accepts it; waba-connect.e2e |
| WD-WABA-020 | frontend-done |  | renew in place, says so when Meta cannot renew it; waba-connect.e2e |
| WD-WABA-021 | frontend-done |  | health dashboard from live Meta reads (phone, WABA, scopes, subscribed apps, template tally); waba-connect.e2e, waba-health-details.spec |
| WD-WABA-022 | backend-done |  | derived issues and overall status, worst first; waba-rules.spec deriveHealth |
| WD-WABA-023 | frontend-done |  | health tile from Meta conversation analytics (optional card, omitted when analytics do not answer); allowance constant 1000 kept as WaDesk, may be obsolete after Meta's July 2025 per-message pricing; not run against real Meta |
| WD-WABA-024 | frontend-done |  | verified-badge checklist and the calling card (CallingToggleCard of the calling domain, the same switch as /calling) on the health page; the card reuses the /calling number card and has no component test of its own |
| WD-WABA-025 | frontend-done |  | claim and release a business username with Meta's handle rules checked first, suggestions from the server, error 100 explained, release always clears the local record; not run against real Meta |
| WD-WABA-026 | backend-done |  | business_username_update webhook keeps the stored handle and status current, deleted clears it; e2e through the real webhook door |
| WD-WABA-027 | frontend-done |  | QR codes: create (PNG, 140 chars), list and delete on the health page; WaDesk had the routes but no screen; not run against real Meta |
| WD-WABA-028 | frontend-done |  | history re-sync button for coexistence numbers re-subscribes the WABA and reports the historical messages already imported; the import itself (046) is not built |
| WD-WABA-029 | backend-done |  | webhook GET handshake with saved, env or derived verify token; waba-rules.spec |
| WD-WABA-030 | backend-done |  | request authentication by signature or platform key in the URL; requireSignature closes the URL-key door; waba-rules.spec |
| WD-WABA-031 | backend-done |  | entry routing, config resolution and field dispatch; waba-rules.spec splitWebhook; waba-coexistence.e2e through WabaIngestService |
| WD-WABA-032 | backend-done |  | inbound content extraction, in the inbox's own normaliser (infra/providers/whatsapp/meta-inbound.ts); inbox unit specs |
| WD-WABA-033 | backend-done |  | dedupe by wamid claimed in Redis (released on failure) with the inbox ledger behind it; self-echo and reactions in the inbox normaliser; message-ingest e2e |
| WD-WABA-034 | backend-done |  | built on main by the inbox work (PR 30): WabaInboxSink, WabaChannelLinkService and the whatsapp_cloud channel make the thread, contact and message from a WhatsApp delivery; nothing duplicated here |
| WD-WABA-035 | backend-done |  | built on main by the inbox work (PR 30): the file is fetched in the background by the ingest worker; nothing duplicated here |
| WD-WABA-036 | backend-done |  | the post-store fan-out is the flow runtime's InboundMessageHooks, run by the inbox ingest after the commit for every stored inbound message (flows, keyword and away replies); history imports and group messages deliberately skip it |
| WD-WABA-037 | backend-done |  | built on main by the inbox work (PR 30): delivery reports the broadcasts did not claim become receipts on the inbox message; wallet settlement once belongs with WALLET |
| WD-WABA-038 | backend-done |  | built in the campaign and broadcast engines: Meta 131049 engagement block is retried on a spaced, capped schedule; nothing left in WABA |
| WD-WABA-039 | backend-done |  | group messages are stored on a thread keyed g:<group id> with no contact, titled by the group subject, the participant in the message meta (WabaInboxSink.onGroupMessage); per-participant statuses fold into one bubble with delivered_to, billable and free counts and only move forward; waba-coexistence.e2e, waba-groups-handoff.spec. No hook fires for groups, so nothing auto-replies |
| WD-WABA-040 | backend-done |  | the four Groups webhooks keep waba_groups in step: create, delete, participant count, join requests, settings by success flag, suspension; waba-groups-handoff.spec, waba-coexistence.e2e |
| WD-WABA-041 | backend-done |  | template status, quality and category webhooks mirrored onto the template row scoped to the WABA; template-event-rules.spec |
| WD-WABA-042 | backend-done |  | a catalog cart becomes one wa_orders row with lines (products by retailer id or SKU, unknown ids fall back to wsn-unknown-N, minor units, last-line currency), deduped by message id, and whatsapp.order.received goes through the outbox; the buyer acknowledgement, WhatsApp Pay charge and flow resume belong to CHK and FLR and listen to that event; waba-coexistence.e2e |
| WD-WABA-043 | backend-done |  | form submissions and payment statuses leave through the outbox (whatsapp.form.submitted, whatsapp.payment.updated) and never reach the inbox; calls reach the calling domain through WABA_CALLS_SINK; waba-coexistence.e2e |
| WD-WABA-044 | backend-done |  | messages typed on the Business app (smb_message_echoes) become one outbound bubble with no unread, no routing, deduped by message id; a file or place is described, not copied (WaDesk downloaded echo media); e2e through the real webhook door |
| WD-WABA-045 | backend-done |  | smb_app_state_sync adds the business app's contacts through ContactsService with quiet (no contact.created event, so no flow or notification), fills a blank name only, never applies remove; waba-coexistence.e2e |
| WD-WABA-046 | backend-done |  | history webhook stored quietly through the inbox ingest: backdated to the real send time, both sides by own numbers, deduped by message id in the ledger, capped at 2000 per delivery, no unread, no contact, no realtime alert; waba-coexistence.e2e |
| WD-WABA-047 | blocked |  | Twilio inbound needs the Twilio connection and an inbox channel kind for it, both part of WADEV (Baileys/Twilio devices); the shared ingest is ready for it |
| WD-WABA-048 | wontfix |  | the bridge's inbound mirror is the in-process inbox path built in NODE (WD-NODE-017): no HTTP endpoint to port |
| WD-WABA-049 | backend-done |  | built on main by the inbox work (PR 30): the Cloud API send adapter of the inbox channel (text, media, template, location, reaction; Meta or Interakt route); not run against real Meta |
| WD-WABA-050 | wontfix |  | there is no Node bridge to hand credentials to: the unofficial engine runs in the worker and the Cloud API reads credentials from the number's own row |
| WD-WABA-051 | backend-done |  | describeMetaError (Meta words first, code and trace appended), connect translators for 190/463/467/460, 200 and 100, a retryable flag for the inbox; waba-errors in infra/providers, meta-errors for the inbox, waba-connect.e2e |
| WD-WABA-052 | wontfix |  | repair job for a connection without a WABA id; the connect flow here requires and proves the WABA id, so nothing creates such a row |
| WD-WABA-053 | backend-done |  | daily worker job pulls Meta template button clicks onto wpcampaigns.meta_clicked_count (window from creation day, max 89 days, enables insights once and retries); waba-click-sync.e2e, waba-groups-handoff.spec |
| WD-WABA-054 | blocked |  | the ads client reusing WABA ids is MADS code; WabaConnectService.resolveConnection already serves the primary number's ids to it |
| WD-WABA-055 | frontend-done |  | saved customers: API (list, search, upsert by phone digits) and the Customers screen at /store/customers with a Settings tile; waba-customers.e2e |
| WD-WABA-056 | frontend-done |  | removes the profile only and keeps the orders (WaDesk also deleted every order of that phone: a deliberate deviation, see parity); an unknown id is a 404; waba-customers.e2e |
| WD-WABA-057 | wontfix |  | dead code in WaDesk (no page includes the views); the modern popup flow replaces it; the catalog link idea goes to CAT as an explicit action |

## node-bridge-runtime (node)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-NODE-001 | blocked |  | no bridge process in this repo until decision E |
| WD-NODE-002 | backend-done |  | NodeTokenGuard on the one bridge-facing route; the bridge's other routes became in-process commands (Redis), so no other route needs it |
| WD-NODE-003 | wontfix |  | not needed: no browser client reaches the bridge; the API already has CORS and body limits (main.ts); inventory port note |
| WD-NODE-004 | backend-done |  | worker heartbeat in Redis (one key per running worker, 90 s); the console health card's Node check reads it (workers and devices held), falling back to the saved-address probe when no worker reports; no HTTP surface on the worker by design |
| WD-NODE-005 | backend-done |  | registry is a per-worker map plus a Redis lease per device; no in-memory schedules or boot sync; shutdown releases leases |
| WD-NODE-006 | backend-done |  | shutdown closes connections and releases leases, keeps sessions, never unlinks; enableShutdownHooks already on |
| WD-NODE-007 | backend-done |  | restore at boot and every pass: devices with a saved session (3+ rows) and no owner are opened, staggered; thin sessions reported Disconnected; also the failover when a worker dies |
| WD-NODE-008 | backend-done |  | DeviceControlService.requestQr: command to the owning worker, QR within 35 s, 429-style busy lock, already-linked answer; the Devices screens (WADEV) call it |
| WD-NODE-009 | backend-done |  | pairing code command: same code for 2 minutes, short numbers refused with Pairing failed status; the library generates the code |
| WD-NODE-010 | in-progress |  | status read and terminate done; check-connection not ported (destructive GET, intended); contact export blocked on MOB (Baileys 6.7 has no store) |
| WD-NODE-011 | backend-done |  | state machine with the full close-code table, backoff, QR stall, mismatch, watchdog (tested with a fake socket); Baileys adapter compiles against the library; NOT verified against live WhatsApp |
| WD-NODE-012 | backend-done |  | status goes to devices.status (same buckets as WaDesk), an outbox event device.status_changed and Redis for the QR and progress |
| WD-NODE-013 | backend-done |  | per-device proxy (http, socks5) read at every connect, probed through the proxy, fail-closed, result kept on the device; NOT verified against a real proxy |
| WD-NODE-014 | backend-done |  | liveness: owner touches last_seen_at, a device untouched for 90 s flips to disconnected; the other sweeps belong to their own domains as BullMQ jobs |
| WD-NODE-015 | backend-done |  | CAMP's dispatcher sends custom campaigns on the unofficial engine and Twilio through the registry adapter; e2e: real dispatcher, real adapter, fake socket; template-kind content stays Cloud API only |
| WD-NODE-016 | backend-done |  | capture and normalization of every message (filters, 10-minute replay guard, sender and LID resolution, text priority, media, location, contact, reaction, forwarded) with per-device dedup, delivered to registered consumers; media bytes wait for storage (F5) |
| WD-NODE-017 | backend-done |  | unofficial engine is an inbox channel kind (whatsapp_qr), one channel per device; customer messages go through the inbox ingest queue (replaces the inbound-message HTTP endpoint); small files kept, large or failed ones arrive as text saying so; groups are not threads; not run against a live number |
| WD-NODE-018 | backend-done |  | phone-typed echoes are recorded on the thread as outbound once (ledger); group messages stay in the group directory; echo files and places are described, not copied; mirroring auto-replies belongs with 019 |
| WD-NODE-019 | backend-done |  | keyword auto-reply and flow triggering are the flow runtime's trigger service (WD-FLR-001 to 004): the bridge's in-process matcher became module code; vishal/FLR |
| WD-NODE-020 | backend-done |  | receipts go to the broadcast recipient, the scheduled recipient or the inbox message that owns the id (marker per inbox send), upward only |
| WD-NODE-021 | backend-done |  | group commands (list, metadata, create, participants, subject, description, settings, leave, invite) and change snapshots delivered to consumers; the directory tables belong to WFL (not built) |
| WD-NODE-022 | in-progress |  | text send and engine routing for Cloud API, Twilio and the unofficial engine; branding footer, buttons and carousel not built (the official library has no interactive buttons or carousel; they need the forked library or the template pipeline) |
| WD-NODE-023 | backend-done |  | media on the unofficial engine, Twilio and the Cloud API (public https link, caption with footer, document file name, no caption on audio); inline attachment_base64 not ported: media comes from a URL or storage, never from a request body |
| WD-NODE-024 | in-progress |  | location, contact card and group message with mentions done; product catalog sends blocked on the catalog domain (CAT) and the template pipeline |
| WD-NODE-025 | backend-done |  | react, pin, star, edit, delete through the owning socket; pin keeps WaDesk's fixed 24 hours (its duration choice never had an effect) |
| WD-NODE-026 | wontfix |  | intended: engine and credentials come from the device row, no settings hop or cache (inventory port note) |
| WD-NODE-027 | backend-done |  | Cloud API text transport (shared Meta provider) and a Twilio transport (text, media with caption, location); templates by ContentSid belong to the template pipeline; Twilio status callback belongs to the WhatsApp provider domain |
| WD-NODE-028 | backend-done |  | SafeFetch: all-address DNS check, pinned IP, every redirect hop checked, size cap, MIME; consumer is 023; local paths intentionally refused |
| WD-NODE-029 | backend-done |  | admin form + real reader wired into BCAST pacing; per-socket send serialization is in the Baileys adapter; jitter, daily cap and lease in BCAST |
| WD-NODE-030 | backend-done |  | DB row is the schedule; due poller queues one BullMQ job per occurrence (jobId = uuid + time); late policy configurable; no cron, no boot sync |
| WD-NODE-031 | backend-done |  | run engine: per-recipient claim, pacing, daily cap, lease shared with BCAST, halt; send-now via SchedulerService; text on every engine, media and location when a transport supports them |
| WD-NODE-032 | backend-done |  | next run from repeat_every, weekdays, months without overflow, end date inclusive; every occurrence reaches the whole audience |
| WD-NODE-033 | backend-done |  | same engine with one recipient row; outcome is now recorded (WaDesk never reported it) |
| WD-NODE-034 | backend-done |  | SchedulerService: pause, resume, cancel, send-now; a run in progress stops before its next batch; the SCHED screens call it |
| WD-NODE-035 | backend-done |  | callbacks became direct writes in the run; recipient states only move up; delivered/read arrive with receipts (020); wallet metering blocked on WALLET |
| WD-NODE-036 | backend-done |  | replaced: the row is the schedule, so nothing is lost on restart; a reconciliation pass queues a stuck run again |
| WD-NODE-037 | backend-done |  | broadcasts reach the unofficial engine and Twilio through TransportEngineSender (rendered text, media as link, header/footer); pacing, cap, lease already in BCAST |
| WD-NODE-038 | backend-done |  | same adapter as 037; per-number daily cap and gaps in BCAST |
| WD-NODE-039 | wontfix |  | dead code in WaDesk (campaign engine in Node is never reached and throws a ReferenceError) |
| WD-NODE-040 | backend-done |  | campaign delivery and read reports reach CampaignReceiptsService through the receipt router; proven in the campaign e2e on the unofficial engine |
| WD-NODE-041 | backend-done |  | flow start, resume and end are FlowLaunchService.start, the engine's reply routing and cancel/takeover (WD-FLR-011, 013, 050); no bridge endpoint is needed; vishal/FLR |
| WD-NODE-042 | in-progress |  | the WhatsApp Cloud API inbound handoff is the InboundMessageHooks seam of the flow runtime (vishal/FLR); the Twilio part waits for the Twilio inbound row WD-WABA-047 (WADEV) |
| WD-NODE-043 | backend-done |  | flow definition, attributes, template data and media store are module-internal calls of the flow runtime (compile-graph, TemplateService, ChatMediaStore); vishal/FLR |
| WD-NODE-044 | in-progress |  | tag, assign, deal, AI, Meet and WhatsApp form are node executors (WD-FLR-030, 035 to 037, 043, 047); the MySQL node waits for a driver (WD-FLR-034); web search is not built |
| WD-NODE-045 | backend-done |  | the ordering endpoints are WD-FLR-042 (parse, shipping, confirm, cancel, reply under /public/v1/flows/ordering); vishal/FLR |
| WD-NODE-046 | in-progress |  | Google Sheets, Docs, Form and Meet nodes are built against GoogleWorkspacePort (WD-FLR-044 to 047); no Google account store exists yet, so they report no account |
| WD-NODE-047 | in-progress |  | the Commerce shop node is built over FlowShopPort (WD-FLR-041); the store domains bind stock, native list and checkout link |
| WD-NODE-048 | backend-done |  | booking for flows is the Book appointment node over the appointments domain (WD-FLR-040); vishal/FLR |
| WD-NODE-049 | blocked |  | collapses into module-internal calls of the owning domain (FLR flows, CALL calling, INTG Google, CHK/APPT commerce, channel domains); built with that domain, not as a bridge endpoint |
| WD-NODE-050 | backend-done |  | one flow engine serves every channel through channel profiles (WD-FLR-060 to 068): the per-channel Node engines and Laravel callbacks are not needed; vishal/FLR |
| WD-NODE-051 | blocked |  | collapses into module-internal calls of the owning domain (FLR flows, CALL calling, INTG Google, CHK/APPT commerce, channel domains); built with that domain, not as a bridge endpoint |
| WD-NODE-052 | frontend-done |  | address, token, test connection; parity run pending |
| WD-NODE-053 | wontfix |  | developer-only file-sync endpoint (wd-sync); not a product feature |
| WD-NODE-054 | wontfix |  | WaDesk smoke scripts; replaced by this repo's own tests |

## chat-conversations (chat)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-CHAT-001 | todo |  |  |
| WD-CHAT-002 | todo |  |  |
| WD-CHAT-003 | todo |  |  |
| WD-CHAT-004 | todo |  |  |
| WD-CHAT-005 | todo |  |  |
| WD-CHAT-006 | todo |  |  |
| WD-CHAT-007 | todo |  |  |
| WD-CHAT-008 | todo |  |  |
| WD-CHAT-009 | todo |  |  |
| WD-CHAT-010 | todo |  |  |
| WD-CHAT-011 | todo |  |  |
| WD-CHAT-012 | todo |  |  |
| WD-CHAT-013 | todo |  |  |
| WD-CHAT-014 | todo |  |  |
| WD-CHAT-015 | todo |  |  |
| WD-CHAT-016 | todo |  |  |
| WD-CHAT-017 | todo |  |  |
| WD-CHAT-018 | todo |  |  |
| WD-CHAT-019 | todo |  |  |
| WD-CHAT-020 | todo |  |  |
| WD-CHAT-021 | todo |  |  |
| WD-CHAT-022 | todo |  |  |
| WD-CHAT-023 | todo |  |  |
| WD-CHAT-024 | todo |  |  |
| WD-CHAT-025 | todo |  |  |
| WD-CHAT-026 | todo |  |  |
| WD-CHAT-027 | todo |  |  |
| WD-CHAT-028 | todo |  |  |
| WD-CHAT-029 | todo |  |  |
| WD-CHAT-030 | todo |  |  |
| WD-CHAT-031 | todo |  |  |
| WD-CHAT-032 | todo |  |  |
| WD-CHAT-033 | todo |  |  |
| WD-CHAT-034 | todo |  |  |
| WD-CHAT-035 | todo |  |  |
| WD-CHAT-036 | todo |  |  |
| WD-CHAT-037 | todo |  |  |
| WD-CHAT-038 | todo |  |  |
| WD-CHAT-039 | todo |  |  |
| WD-CHAT-040 | todo |  |  |
| WD-CHAT-041 | todo |  |  |
| WD-CHAT-042 | todo |  |  |
| WD-CHAT-043 | todo |  |  |
| WD-CHAT-044 | todo |  |  |

## team-inbox-conversations (tib1)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-TIB1-001 | todo |  |  |
| WD-TIB1-002 | todo |  |  |
| WD-TIB1-003 | todo |  |  |
| WD-TIB1-004 | todo |  |  |
| WD-TIB1-005 | todo |  |  |
| WD-TIB1-006 | todo |  |  |
| WD-TIB1-007 | todo |  |  |
| WD-TIB1-008 | todo |  |  |
| WD-TIB1-009 | todo |  |  |
| WD-TIB1-010 | todo |  |  |
| WD-TIB1-011 | todo |  |  |
| WD-TIB1-012 | todo |  |  |
| WD-TIB1-013 | todo |  |  |
| WD-TIB1-014 | todo |  |  |
| WD-TIB1-015 | todo |  |  |
| WD-TIB1-016 | todo |  |  |
| WD-TIB1-017 | todo |  |  |
| WD-TIB1-018 | todo |  |  |
| WD-TIB1-019 | todo |  |  |
| WD-TIB1-020 | todo |  |  |
| WD-TIB1-021 | todo |  |  |
| WD-TIB1-022 | todo |  |  |
| WD-TIB1-023 | todo |  |  |
| WD-TIB1-024 | todo |  |  |
| WD-TIB1-025 | todo |  |  |
| WD-TIB1-026 | todo |  |  |
| WD-TIB1-027 | todo |  |  |
| WD-TIB1-028 | todo |  |  |
| WD-TIB1-029 | todo |  |  |
| WD-TIB1-030 | todo |  |  |
| WD-TIB1-031 | todo |  |  |
| WD-TIB1-032 | todo |  |  |
| WD-TIB1-033 | todo |  |  |
| WD-TIB1-034 | todo |  |  |
| WD-TIB1-035 | todo |  |  |
| WD-TIB1-036 | todo |  |  |
| WD-TIB1-037 | todo |  |  |
| WD-TIB1-038 | todo |  |  |
| WD-TIB1-039 | todo |  |  |
| WD-TIB1-040 | todo |  |  |
| WD-TIB1-041 | todo |  |  |
| WD-TIB1-042 | todo |  |  |
| WD-TIB1-043 | todo |  |  |
| WD-TIB1-044 | todo |  |  |
| WD-TIB1-045 | todo |  |  |
| WD-TIB1-046 | todo |  |  |
| WD-TIB1-047 | todo |  |  |
| WD-TIB1-048 | todo |  |  |
| WD-TIB1-049 | todo |  |  |
| WD-TIB1-050 | todo |  |  |
| WD-TIB1-051 | todo |  |  |
| WD-TIB1-052 | todo |  |  |
| WD-TIB1-053 | todo |  |  |
| WD-TIB1-054 | todo |  |  |
| WD-TIB1-055 | todo |  |  |

## team-inbox-routing-sla (tib2)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-TIB2-001 | todo |  |  |
| WD-TIB2-002 | todo |  |  |
| WD-TIB2-003 | todo |  |  |
| WD-TIB2-004 | todo |  |  |
| WD-TIB2-005 | todo |  |  |
| WD-TIB2-006 | todo |  |  |
| WD-TIB2-007 | todo |  |  |
| WD-TIB2-008 | todo |  |  |
| WD-TIB2-009 | todo |  |  |
| WD-TIB2-010 | todo |  |  |
| WD-TIB2-011 | todo |  |  |
| WD-TIB2-012 | todo |  |  |
| WD-TIB2-013 | todo |  |  |
| WD-TIB2-014 | todo |  |  |
| WD-TIB2-015 | todo |  |  |
| WD-TIB2-016 | todo |  |  |
| WD-TIB2-017 | todo |  |  |
| WD-TIB2-018 | todo |  |  |
| WD-TIB2-019 | todo |  |  |
| WD-TIB2-020 | todo |  |  |
| WD-TIB2-021 | todo |  |  |
| WD-TIB2-022 | todo |  |  |
| WD-TIB2-023 | todo |  |  |
| WD-TIB2-024 | todo |  |  |
| WD-TIB2-025 | todo |  |  |
| WD-TIB2-026 | todo |  |  |
| WD-TIB2-027 | todo |  |  |
| WD-TIB2-028 | todo |  |  |
| WD-TIB2-029 | todo |  |  |
| WD-TIB2-030 | todo |  |  |
| WD-TIB2-031 | todo |  |  |
| WD-TIB2-032 | todo |  |  |
| WD-TIB2-033 | todo |  |  |
| WD-TIB2-034 | todo |  |  |
| WD-TIB2-035 | todo |  |  |
| WD-TIB2-036 | todo |  |  |

## message-templates (tpl)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-TPL-001 | todo |  |  |
| WD-TPL-002 | todo |  |  |
| WD-TPL-003 | todo |  |  |
| WD-TPL-004 | todo |  |  |
| WD-TPL-005 | todo |  |  |
| WD-TPL-006 | todo |  |  |
| WD-TPL-007 | todo |  |  |
| WD-TPL-008 | todo |  |  |
| WD-TPL-009 | todo |  |  |
| WD-TPL-010 | todo |  |  |
| WD-TPL-011 | todo |  |  |
| WD-TPL-012 | todo |  |  |
| WD-TPL-013 | todo |  |  |
| WD-TPL-014 | todo |  |  |
| WD-TPL-015 | todo |  |  |
| WD-TPL-016 | todo |  |  |
| WD-TPL-017 | todo |  |  |
| WD-TPL-018 | todo |  |  |
| WD-TPL-019 | todo |  |  |
| WD-TPL-020 | todo |  |  |
| WD-TPL-021 | todo |  |  |
| WD-TPL-022 | todo |  |  |
| WD-TPL-023 | todo |  |  |
| WD-TPL-024 | todo |  |  |
| WD-TPL-025 | todo |  |  |
| WD-TPL-026 | todo |  |  |
| WD-TPL-027 | todo |  |  |
| WD-TPL-028 | todo |  |  |
| WD-TPL-029 | todo |  |  |
| WD-TPL-030 | todo |  |  |
| WD-TPL-031 | todo |  |  |
| WD-TPL-032 | todo |  |  |
| WD-TPL-033 | todo |  |  |
| WD-TPL-034 | todo |  |  |
| WD-TPL-035 | todo |  |  |
| WD-TPL-036 | todo |  |  |
| WD-TPL-037 | todo |  |  |
| WD-TPL-038 | todo |  |  |
| WD-TPL-039 | todo |  |  |
| WD-TPL-040 | todo |  |  |
| WD-TPL-041 | todo |  |  |
| WD-TPL-042 | todo |  |  |
| WD-TPL-043 | todo |  |  |
| WD-TPL-044 | todo |  |  |
| WD-TPL-045 | todo |  |  |
| WD-TPL-046 | todo |  |  |
| WD-TPL-047 | todo |  |  |
| WD-TPL-048 | todo |  |  |
| WD-TPL-049 | todo |  |  |
| WD-TPL-050 | todo |  |  |

## broadcasts (bcast)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-BCAST-001 | todo |  |  |
| WD-BCAST-002 | todo |  |  |
| WD-BCAST-003 | todo |  |  |
| WD-BCAST-004 | todo |  |  |
| WD-BCAST-005 | todo |  |  |
| WD-BCAST-006 | todo |  |  |
| WD-BCAST-007 | todo |  |  |
| WD-BCAST-008 | todo |  |  |
| WD-BCAST-009 | todo |  |  |
| WD-BCAST-010 | todo |  |  |
| WD-BCAST-011 | todo |  |  |
| WD-BCAST-012 | todo |  |  |
| WD-BCAST-013 | todo |  |  |
| WD-BCAST-014 | todo |  |  |
| WD-BCAST-015 | todo |  |  |
| WD-BCAST-016 | todo |  |  |
| WD-BCAST-017 | todo |  |  |
| WD-BCAST-018 | todo |  |  |
| WD-BCAST-019 | todo |  |  |
| WD-BCAST-020 | todo |  |  |
| WD-BCAST-021 | todo |  |  |
| WD-BCAST-022 | todo |  |  |
| WD-BCAST-023 | todo |  |  |
| WD-BCAST-024 | todo |  |  |
| WD-BCAST-025 | todo |  |  |
| WD-BCAST-026 | todo |  |  |
| WD-BCAST-027 | todo |  |  |
| WD-BCAST-028 | todo |  |  |
| WD-BCAST-029 | todo |  |  |
| WD-BCAST-030 | todo |  |  |
| WD-BCAST-031 | todo |  |  |
| WD-BCAST-032 | todo |  |  |
| WD-BCAST-033 | todo |  |  |
| WD-BCAST-034 | todo |  |  |
| WD-BCAST-035 | todo |  |  |
| WD-BCAST-036 | todo |  |  |
| WD-BCAST-037 | todo |  |  |
| WD-BCAST-038 | todo |  |  |
| WD-BCAST-039 | todo |  |  |
| WD-BCAST-040 | todo |  |  |
| WD-BCAST-041 | todo |  |  |
| WD-BCAST-042 | todo |  |  |
| WD-BCAST-043 | todo |  |  |

## scheduled-queue-warmer (sched)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-SCHED-001 | frontend-done |  | list with stats, up-next, tabs, search and row actions (web + API); the stats strip is computed from the page shown; not opened in a browser or run against WaDesk side by side |
| WD-SCHED-002 | frontend-done |  | 5-step composer: basics and senders, audience with live preview, message, schedule, review; not in a browser; media is a link, no file drop; no template categories |
| WD-SCHED-003 | backend-done |  | plan flag and limit, 2-minute lead time, audience, halt and content guard, wallet, multi-sender split, warmer reservation, one transaction; 16 e2e |
| WD-SCHED-004 | backend-done |  | group, tag, earlier broadcasts, typed numbers; opted-out and archived contacts never messaged, one copy per person (WaDesk's gap fixed); recipients fixed when saved |
| WD-SCHED-005 | backend-done |  | round-robin split, one schedule per sender named after it, tag audiences split too (WaDesk left them empty) |
| WD-SCHED-006 | in-progress |  | text, media by link, location, template as text on the unofficial engine and Twilio; no upload until the send port takes file bytes; no Cloud API template |
| WD-SCHED-007 | backend-done |  | a test message to a number typed in the composer after the schedule is saved; a failure never undoes the schedule |
| WD-SCHED-008 | backend-done |  | reserved per send date for one-off schedules from a warming number, held with WaDesk's wording, and released on cancel, delete or fail |
| WD-SCHED-009 | backend-done |  | emergency halt and content guardrails before saving, wallet precheck once for the whole audience |
| WD-SCHED-010 | backend-done |  | covered by WD-NODE-030: the row is the schedule, no bridge registration |
| WD-SCHED-011 | backend-done |  | covered by WD-NODE-030, 032: cadence, weekdays, end date inclusive, next run in the schedule's zone |
| WD-SCHED-012 | frontend-done |  | detail with progress, funnel, recipients and actions; no engagement curve or donut chart; not in a browser |
| WD-SCHED-013 | frontend-done |  | pause and resume from list and detail; 409 when the status does not allow it |
| WD-SCHED-014 | frontend-done |  | cancel from list and detail; releases the warmer budget the unsent part reserved |
| WD-SCHED-015 | frontend-done |  | run now: due at once from waiting, running, paused or failed; recipients already sent are skipped |
| WD-SCHED-016 | backend-done |  | PATCH name, time, message with a version check, 2-minute lead time and zone check; the web has no edit screen (the reference detail has none) |
| WD-SCHED-017 | frontend-done |  | retry with a new time; only failed recipients are tried again (WaDesk re-sent to everyone) |
| WD-SCHED-018 | frontend-done |  | delete from list and detail; hard delete; releases the warmer budget |
| WD-SCHED-019 | backend-done |  | plan feature and limit scheduled_messages, permissions sched.schedules.read and manage (Owner, Admin, Manager) |
| WD-SCHED-020 | backend-done |  | covered by WD-NODE-030: BullMQ and the due poller replace the bridge's in-memory cron |
| WD-SCHED-021 | backend-done |  | covered by WD-NODE-031: ScheduledRunService; now also applies the number's warmer hours, gap and spintax |
| WD-SCHED-022 | backend-done |  | covered by WD-NODE-032 |
| WD-SCHED-023 | backend-done |  | covered by WD-NODE-033: counters on the row |
| WD-SCHED-024 | backend-done |  | covered by WD-NODE-035: per-recipient receipts; wallet settlement per delivery is not verified for scheduled sends |
| WD-SCHED-025 | backend-done |  | covered by WD-NODE-030: nothing to restore, state is in the database |
| WD-SCHED-026 | backend-done |  | covered by WD-NODE-036: durable retry of failed one-offs |
| WD-SCHED-027 | backend-done |  | covered: the broadcast retry policy is shared |
| WD-SCHED-028 | blocked |  | needs the customer API domain; public-api here is a lead-intake skeleton; ScheduleCreateService is the use case to call |
| WD-SCHED-029 | blocked |  | needs the mobile domain |
| WD-SCHED-030 | backend-done |  | ScheduleProducerService: ordinary schedules with source and external_key; a key replaces its old schedule; cancel by key; e2e |

## auto-reply-keywords (ar)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-AR-001 | todo |  |  |
| WD-AR-002 | todo |  |  |
| WD-AR-003 | todo |  |  |
| WD-AR-004 | todo |  |  |
| WD-AR-005 | todo |  |  |
| WD-AR-006 | todo |  |  |
| WD-AR-007 | todo |  |  |
| WD-AR-008 | todo |  |  |
| WD-AR-009 | todo |  |  |
| WD-AR-010 | todo |  |  |
| WD-AR-011 | todo |  |  |
| WD-AR-012 | todo |  |  |
| WD-AR-013 | todo |  |  |
| WD-AR-014 | todo |  |  |
| WD-AR-015 | todo |  |  |
| WD-AR-016 | todo |  |  |
| WD-AR-017 | todo |  |  |
| WD-AR-018 | todo |  |  |
| WD-AR-019 | todo |  |  |
| WD-AR-020 | todo |  |  |
| WD-AR-021 | todo |  |  |
| WD-AR-022 | todo |  |  |
| WD-AR-023 | todo |  |  |
| WD-AR-024 | todo |  |  |
| WD-AR-025 | todo |  |  |
| WD-AR-026 | todo |  |  |
| WD-AR-027 | todo |  |  |
| WD-AR-028 | todo |  |  |
| WD-AR-029 | todo |  |  |
| WD-AR-030 | todo |  |  |
| WD-AR-031 | todo |  |  |
| WD-AR-032 | todo |  |  |
| WD-AR-033 | todo |  |  |
| WD-AR-034 | todo |  |  |
| WD-AR-035 | todo |  |  |
| WD-AR-036 | todo |  |  |
| WD-AR-037 | todo |  |  |
| WD-AR-038 | todo |  |  |
| WD-AR-039 | todo |  |  |
| WD-AR-040 | todo |  |  |
| WD-AR-041 | todo |  |  |
| WD-AR-042 | todo |  |  |
| WD-AR-043 | todo |  |  |
| WD-AR-044 | todo |  |  |

## flow-builder-editor (flb)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-FLB-001 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| WD-FLB-002 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| WD-FLB-003 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| WD-FLB-004 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| WD-FLB-005 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| WD-FLB-006 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| WD-FLB-007 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| WD-FLB-008 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| WD-FLB-009 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| WD-FLB-010 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| WD-FLB-011 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| WD-FLB-012 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| WD-FLB-013 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| WD-FLB-014 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| WD-FLB-015 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| WD-FLB-016 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| WD-FLB-017 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| WD-FLB-018 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| WD-FLB-019 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| WD-FLB-020 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| WD-FLB-021 | done |  | managed keyword row intentionally not created (FLR matches flows directly, WD-FLR-004) |
| WD-FLB-022 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| WD-FLB-023 | wontfix |  | dead code in WaDesk: the Variables modal has no button; identical to the observer |
| WD-FLB-024 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| WD-FLB-025 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| WD-FLB-026 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| WD-FLB-027 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| WD-FLB-028 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| WD-FLB-029 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| WD-FLB-030 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-031 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-032 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-033 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-034 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-035 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-036 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-037 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-038 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-039 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-040 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-041 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-042 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-043 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-044 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-045 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-046 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-047 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-048 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-049 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-050 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-051 | blocked |  | Create new AI agent dialog waits on the AI agents create API |
| WD-FLB-052 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-053 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-054 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-055 | done |  | builder side done; Google file pickers answer 503 until a Google account store exists (INTG) |
| WD-FLB-056 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-057 | done |  | builder side done; Google file pickers answer 503 until a Google account store exists (INTG) |
| WD-FLB-058 | done |  | builder side done; Google file pickers answer 503 until a Google account store exists (INTG) |
| WD-FLB-059 | done |  | builder side done; Google file pickers answer 503 until a Google account store exists (INTG) |
| WD-FLB-060 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-061 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-062 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-063 | done |  | builder forms done; runtime executors for these types are missing in FLR TYPE_MAP |
| WD-FLB-064 | done |  | builder forms done; runtime executors for these types are missing in FLR TYPE_MAP |
| WD-FLB-065 | done |  | builder forms done; runtime executors for these types are missing in FLR TYPE_MAP |
| WD-FLB-066 | done |  | builder forms done; runtime executors for these types are missing in FLR TYPE_MAP |
| WD-FLB-067 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| WD-FLB-068 | done |  | owned by FLR (ordering contracts and endpoints there) |
| WD-FLB-069 | done |  | owned by NODE/FLR: the Node bridge is replaced by the in-process engine |
| WD-FLB-070 | done |  | flbToRuntimeData + FlowReaderService done; compileGraph calls flbToRuntimeData (branch akshay/flr/flb-runtime-hook, authorised on the FLR side), template and AI assistant uuids resolved by org; e2e editor-flows |
| WD-FLB-071 | done |  | owned by FLR, built there (WD-FLR-052..058) |
| WD-FLB-072 | done |  | owned by FLR, built there (WD-FLR-052..058) |
| WD-FLB-073 | done |  | owned by FLR, built there (WD-FLR-052..058) |
| WD-FLB-074 | done |  | owned by FLR, built there (WD-FLR-052..058) |
| WD-FLB-075 | done |  | owned by FLR, built there (WD-FLR-052..058) |
| WD-FLB-076 | done |  | owned by FLR, built there (WD-FLR-052..058) |
| WD-FLB-077 | done |  | owned by FLR, built there (WD-FLR-052..058) |
| WD-FLB-078 | wontfix |  | dead code in WaDesk: table kept, no screen or writer |
| WD-FLB-079 | blocked |  | needs the Instaflow remote service (IG domain) |
| WD-FLB-080 | wontfix |  | dev fixture; superseded by compile-seam and runtime-shape-compile specs |
| WD-FLB-081 | done |  | addition beyond WaDesk (owner request): Ask for file / image. Contracts, FLR executor, editor card/panel/form, test runner, en+ar; unit + API e2e (simulator channel, no real WhatsApp) |
| WD-FLB-082 | done |  | addition beyond WaDesk (owner request): Ask for location with the WhatsApp send-location request. Same coverage; the request payload is unit-tested, never sent to Meta |
| WD-FLB-083 | done |  | addition beyond WaDesk (owner request): Geta console publishing. Port + HTTP/fixture adapters, sealed per-workspace credentials, outbox event + worker consumer, sync state with retry, editor status and settings screen, en+ar; unit (stub server) + API e2e + RLS integration + web unit. The real console was never called |

## flow-runtime-engine (flr)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-FLR-001 | backend-done |  | trigger kinds (ten), live = published and active, workspace-scoped lookup, trigger_channel_id replaces trigger_device_id; the editor (FLB) writes the columns; 12 e2e |
| WD-FLR-002 | backend-done |  | keyword start, restart on the same text, default route last, replaces a live run; typed digits also answer a menu (numbered text channels); fuzzy and media-order matching stay with Auto reply |
| WD-FLR-003 | backend-done |  | same inbound hook for every channel; consumed handshake returned to the pipeline; the auto reply and AI agent that must read it do not exist yet |
| WD-FLR-004 | backend-done |  | no shadow keyword rows: keyword flows queried directly, catch-all spellings last; Auto reply can call matchKeywordFlow |
| WD-FLR-005 | backend-done |  | tag, group, created, opt-in through outbox events; imports never fire contact_created; no producer yet for a contact re-subscribing |
| WD-FLR-006 | backend-done |  | order placed (once per order) and deal stage changed (once per deal and stage); no producer yet for order.placed |
| WD-FLR-007 | backend-done |  | away and out of hours from the workspace settings; overnight ranges; re-arms after 12 h; unit-tested hours |
| WD-FLR-008 | frontend-done |  | enroll API plus the Enroll panel on the subscribers page, runs, run detail and analytics screens; not opened in a browser; no Playwright parity run yet |
| WD-FLR-009 | backend-done |  | GET/POST /public/v1/flows under the API-key guard; counts over every subscriber; not exercised with a real signed key in e2e |
| WD-FLR-010 | backend-done |  | campaign (CAMPAIGN_FLOW_STARTER bound) and inbox start built; routing trigger_flow, lead webhook and hand-off call FlowLaunchService.start when their domains exist |
| WD-FLR-011 | backend-done |  | FlowLaunchService: one door, run row on every path, failed launch marks the subscriber with the reason; queue instead of HTTP; retry via flow_retry_logs |
| WD-FLR-012 | backend-done |  | intended: appointment_booked and comment_to_dm are not accepted; forced flowId path dropped |
| WD-FLR-013 | backend-done |  | compileGraph (pure, unit-tested ports and handles); the editor must save flowNodes and flowEdges; runs keep a graph snapshot |
| WD-FLR-014 | backend-done |  | run row before any node; contact and workspace attribute defaults seeded by the engine; conversation_id set |
| WD-FLR-015 | backend-done |  | QUIRK fixed: runs are rows, Delay is a wake-up time, idle and absolute limits, sweeper; a lost job is recovered; e2e restart-style test |
| WD-FLR-016 | backend-done |  | job per step, first edge per port, dead end keeps the last menu, End node, loop guard 20 (run fails with the reason), pause 1.5 s only on the unofficial engine |
| WD-FLR-017 | backend-done |  | one strong resolver for every node, JSON-escape mode; WaDesk condition tests ported |
| WD-FLR-018 | backend-done |  | taps routed to the menu they belong to (old menus work), 20-character label match, media-only ignored unless accepted, location to a maps link, persistent menus |
| WD-FLR-019 | backend-done |  | one send door (dispatcher then thread), interactive content degraded per channel (buttons, list, link button, pin); no branding footer; a 24 hour window refusal fails the run with the reason |
| WD-FLR-020 | backend-done |  | daily cap shared with broadcasts through the Redis tally, channel down halts and retries every 5 minutes |
| WD-FLR-021 | backend-done |  | Message, Sequence and Media nodes: each reply in order, files by chatmedia key; flow-runtime e2e |
| WD-FLR-022 | backend-done |  | Ask node: validated answers, retry text, timeout; flow-runtime e2e |
| WD-FLR-023 | backend-done |  | Buttons node (three buttons; four to ten become a list where the channel has lists; numbered text elsewhere); channel-render.spec |
| WD-FLR-024 | backend-done |  | List node and its numbered fallback; channel-render.spec |
| WD-FLR-025 | backend-done |  | Poll as a list or numbered text (no native poll on any channel here), as WaDesk's own partial |
| WD-FLR-026 | backend-done |  | Template node: approved templates by id within the workspace, variables filled from the run, a text fallback on channels without templates; commerce-template e2e |
| WD-FLR-027 | backend-done |  | CTA and Location nodes; channel-render.spec |
| WD-FLR-028 | backend-done |  | Condition node and the operator rules; condition unit spec |
| WD-FLR-029 | backend-done |  | Delay node as a sleeping run with a resume time; flow-runtime e2e |
| WD-FLR-030 | backend-done |  | AI node: one-shot, extraction, silent, conversation mode with an exit keyword, token ledger and the monthly cap on the platform key; ai-nodes e2e (20), ai-call-service spec |
| WD-FLR-031 | in-progress |  | Sub-flow built (same workspace, published flows only, depth cap 10); the Chatbot hand-off to an AI agent waits for the AI agents domain: the executor and port are built and the port answers unavailable |
| WD-FLR-032 | backend-done |  | Webhook node through the guarded fetch (no private hosts, no redirects, 5 MB cap), JSON-escaped variables, saved response; integrations-nodes e2e |
| WD-FLR-033 | backend-done |  | Code node in a worker-thread vm with a memory cap and a 2 s limit; the ceiling (vm is not a hard security boundary) is written in the file header; integrations-nodes spec |
| WD-FLR-034 | blocked |  | MySQL node: the executor, the read-only guard and the 100-row cap are built against a port; there is no mysql2 driver in the repo, so the default adapter says so |
| WD-FLR-035 | backend-done |  | Tag node on the run's contact (add or remove, by id or name); actions-nodes e2e. Does not fire tag_added flows, as WaDesk |
| WD-FLR-036 | backend-done |  | Assign agent node through AssignmentService with the flow actor; actions-nodes e2e |
| WD-FLR-037 | backend-done |  | Deal node creates or moves the contact's open deal through the stage engine; actions-nodes e2e |
| WD-FLR-038 | backend-done |  | Copy-to-number node through the run's channel, nothing recorded on the customer thread; actions-nodes e2e |
| WD-FLR-039 | backend-done |  | WhatsApp-to-Instagram link node; actions-nodes e2e |
| WD-FLR-040 | backend-done |  | Book appointment node through the appointments domain; commerce-book e2e |
| WD-FLR-041 | backend-done |  | Commerce shop node over a store port (stock check, native product list, checkout link); the port says cannot until the store domains bind an adapter, which is WaDesk's own failure path; commerce-shop-form spec |
| WD-FLR-042 | backend-done |  | Natural-language ordering endpoints (parse, shipping, confirm, cancel, reply) for text orders; voice, photo and group notification sit behind ports; ai-nodes e2e |
| WD-FLR-043 | backend-done |  | WhatsApp Form node and the form-submission resume; commerce-shop-form spec |
| WD-FLR-044 | backend-done |  | Google Sheets node against a workspace port; no Google account store exists yet, so the nodes report no account and move on; integrations-nodes e2e |
| WD-FLR-045 | backend-done |  | Google Docs node against the same port; integrations-nodes spec |
| WD-FLR-046 | backend-done |  | Google Form node: sends the link, parks the run on a custom wait, the response webhook (per-org token) resumes it or the timeout port leaves; integrations-nodes e2e |
| WD-FLR-047 | backend-done |  | Google Meet node against the Google port; integrations-nodes spec |
| WD-FLR-048 | blocked |  | AI voice call node: built against AiCallPort whose default answers calls_unavailable; the real adapter binds when the calling domain (vishal/CALL) merges |
| WD-FLR-049 | backend-done |  | Inbound media as an answer is kept as a chatmedia key, never a public link; flow-runtime e2e |
| WD-FLR-050 | backend-done |  | Ending a run from outside: cancel by hand, agent takeover and a removed sender end the run; flow-runtime e2e |
| WD-FLR-051 | backend-done |  | Run lifecycle: completed is really set (WaDesk never set it); statuses and the subscriber mirror; flow-runtime e2e |
| WD-FLR-052 | frontend-done |  | Subscriber list, counts, pause and resume; per-row retry through the same confirmation as the history tab |
| WD-FLR-053 | frontend-done |  | Analytics: KPIs, trend, status mix, source bars, leaderboard, all-time period and flow scope, the second counter band; counts launches that failed before a run existed; flow-runtime-read e2e |
| WD-FLR-054 | frontend-done |  | Execution history: filters, status counts that ignore the status filter, search, dates, bulk retry bar; flow-runtime-read e2e |
| WD-FLR-055 | frontend-done |  | Error logs: grouped reasons with first and last seen, retry these, show these runs; flow-runtime-read e2e |
| WD-FLR-056 | frontend-done |  | Retry records table with outcome chips and totals; flow-runtime-read e2e |
| WD-FLR-057 | frontend-done |  | Retry one: flow off 422, 30 s cooldown (FLR_RETRY_TOO_SOON, 429), then state 409; outcome and reason returned; flow-runtime-read e2e |
| WD-FLR-058 | frontend-done |  | Bulk retry of up to 50 named runs with a count per outcome; flow-runtime-read e2e |
| WD-FLR-059 | backend-done |  | Compare-and-set on step_seq, one job id per step, sweeper for lost jobs; flow-runtime e2e |
| WD-FLR-060 | backend-done |  | One engine for every channel: a channel profile (buttons, list, link, location, templates, pace) says what a kind can show, the rest degrades to numbered text; channel-render.spec |
| WD-FLR-061 | backend-done |  | Facebook Messenger: profile with reply buttons and a link button, no list or location; the channel adapter joins by registering for the kind (branch punya/punyafix, PR 34) |
| WD-FLR-062 | backend-done |  | Instagram: the same profile as Messenger; the channel adapter joins by registering for the kind (PR 34) |
| WD-FLR-063 | backend-done |  | TikTok: text with numbered options through the default profile |
| WD-FLR-064 | backend-done |  | Telegram: text with numbered options; the payment node is not built (needs the Telegram payment provider) |
| WD-FLR-065 | backend-done |  | LINE: text with numbered options through the default profile |
| WD-FLR-066 | backend-done |  | Viber: text with numbered options through the default profile |
| WD-FLR-067 | backend-done |  | WeChat: text with numbered options through the default profile |
| WD-FLR-068 | backend-done |  | Email: text with numbered options through the default profile |
| WD-FLR-069 | blocked |  | Call-flow (voice IVR) is the calling domain's: vishal/CALL, PR 35, and its AI assistant rows |
| WD-FLR-070 | wontfix |  | dead code in WaDesk: the per-channel session tables are replaced by flow_runs |
| WD-FLR-071 | backend-done |  | the runtime regression suite is the unit and e2e specs of this domain (218 unit, 80 e2e) |

## chatbot-widget (wgt)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-WGT-001 | done |  |  |
| WD-WGT-002 | done |  |  |
| WD-WGT-003 | done |  |  |
| WD-WGT-004 | done |  |  |
| WD-WGT-005 | done |  |  |
| WD-WGT-006 | done |  |  |
| WD-WGT-007 | done |  |  |
| WD-WGT-008 | done |  |  |
| WD-WGT-009 | done |  |  |
| WD-WGT-010 | done |  |  |
| WD-WGT-011 | done |  |  |
| WD-WGT-012 | done |  |  |
| WD-WGT-013 | done |  |  |
| WD-WGT-014 | done |  |  |
| WD-WGT-015 | done |  |  |
| WD-WGT-016 | done |  |  |
| WD-WGT-017 | done |  |  |
| WD-WGT-018 | done |  |  |
| WD-WGT-019 | partial |  | Widget side done through the InboxGateway shim (SQL writes to the inbox tables; thread, contact, opening line in the legacy messages table, polling contract tested); Team Inbox screens, the agent reply path and the mobile list belong to TIB1/MOB |
| WD-WGT-020 | done |  |  |
| WD-WGT-021 | done |  | as WaDesk has it: allowedDomains API and CORS enforcement, no builder control (its docs promise one, the screen has none); blank entry 422 and the widget's own posts blocked are reproduced quirks |
| WD-WGT-022 | done |  |  |
| WD-WGT-023 | done |  |  |
| WD-WGT-024 | done |  |  |
| WD-WGT-025 | done |  |  |
| WD-WGT-026 | done |  | as WaDesk: nothing can pause a widget (no endpoint or action); status views inert |
| WD-WGT-027 | done |  | RBAC keys plus the `chatbot_widgets` plan flag (catalogue + entitlement gate, 422 PLAN_FEATURE_LOCKED, paywall); widget limit unenforced and public routes ignore the plan, as WaDesk |
| WD-WGT-028 | partial |  | sidebar item done; More tile, quick access and command palette belong to the shell. Also the user-requested Interakt WhatsApp builder page and launcher (accordion of five cards, live preview, panel with Start Conversation to wa.me), `chatbot_widgets.launcher` jsonb |
| WD-WGT-029 | done |  |  |
| WD-WGT-030 | wontfix |  | greenfield port: no legacy widget messages to backfill |

## team-chat (tchat)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-TCHAT-001 | todo |  |  |
| WD-TCHAT-002 | todo |  |  |
| WD-TCHAT-003 | todo |  |  |
| WD-TCHAT-004 | todo |  |  |
| WD-TCHAT-005 | todo |  |  |
| WD-TCHAT-006 | todo |  |  |
| WD-TCHAT-007 | todo |  |  |
| WD-TCHAT-008 | todo |  |  |
| WD-TCHAT-009 | todo |  |  |
| WD-TCHAT-010 | todo |  |  |
| WD-TCHAT-011 | todo |  |  |
| WD-TCHAT-012 | todo |  |  |
| WD-TCHAT-013 | todo |  |  |
| WD-TCHAT-014 | todo |  |  |
| WD-TCHAT-015 | todo |  |  |
| WD-TCHAT-016 | todo |  |  |
| WD-TCHAT-017 | todo |  |  |
| WD-TCHAT-018 | todo |  |  |
| WD-TCHAT-019 | todo |  |  |
| WD-TCHAT-020 | todo |  |  |
| WD-TCHAT-021 | todo |  |  |
| WD-TCHAT-022 | todo |  |  |
| WD-TCHAT-023 | todo |  |  |
| WD-TCHAT-024 | todo |  |  |
| WD-TCHAT-025 | todo |  |  |
| WD-TCHAT-026 | todo |  |  |
| WD-TCHAT-027 | todo |  |  |
| WD-TCHAT-028 | todo |  |  |
| WD-TCHAT-029 | todo |  |  |
| WD-TCHAT-030 | todo |  |  |
| WD-TCHAT-031 | todo |  |  |
| WD-TCHAT-032 | todo |  |  |

## calling-voice (call)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-CALL-001 | backend-done |  | alias of the WABA handshake at /v2/public/webhooks/wa-calling; e2e |
| WD-CALL-002 | backend-done |  | calls field handled through WABA_CALLS_SINK; one handler instead of two; indexed route lookup |
| WD-CALL-003 | backend-done |  | GET /v2/calling/numbers; call.calls.use and plan feature waba_calling |
| WD-CALL-004 | backend-done |  | toggle with Meta first, coexistence refused locally, Meta refusals in words; e2e against a fake Meta |
| WD-CALL-005 | backend-done |  | permission request, 138017 treated as already permitted, ledger reset; e2e |
| WD-CALL-006 | backend-done |  | ledger from permission_update, eligibility from the conversation's own number, lapsed grant reads expired |
| WD-CALL-007 | frontend-done |  | CallButton with the modal flow, mounted in the inbox thread header (InboxProviders and thread-pane); component tests pass; not tried with a real number |
| WD-CALL-008 | backend-done |  | permission first, calling must be on, refused dial is failed not ringing; e2e |
| WD-CALL-009 | frontend-done |  | CallPeer with SDP rules and recording, 36 unit tests on fakes; no real microphone or Meta test |
| WD-CALL-010 | backend-done |  | progress poll returns the SDP answer only for an active call; e2e |
| WD-CALL-011 | backend-done |  | connect: inbound ringing row matched to contact and thread, outbound answered; idempotent; AI answer and voicemail timer not built |
| WD-CALL-012 | frontend-done |  | pending endpoint and IncomingCallToast, mounted by InboxProviders; poll only, no push |
| WD-CALL-013 | backend-done |  | atomic claim, pre_accept, 900 ms, accept, rollback to ringing on refusal; two simultaneous accepts e2e |
| WD-CALL-014 | wontfix |  | dead code in WaDesk; pre_accept is a step of accept (inventory port note) |
| WD-CALL-015 | backend-done |  | decline only a ringing call |
| WD-CALL-016 | backend-done |  | terminate, idempotent; row closes on Meta's terminate event |
| WD-CALL-017 | backend-done |  | terminate event closes the row with Meta's status and duration, one system bubble in the customer's thread; Node bridge close not built |
| WD-CALL-018 | frontend-done |  | OnCallPanel with timer, mute, end, record and the consent line, mounted by InboxProviders |
| WD-CALL-019 | backend-done |  | recording upload and playback in private storage, workspace only, replaced file removed; browser recorder in the web feature |
| WD-CALL-020 | wontfix |  | dead code in WaDesk; AI calls arm recording from the assistant (not built) |
| WD-CALL-021 | backend-done |  | wa_call_events written at every step (connect, dial_sent, accept_sent, terminate, ...) |
