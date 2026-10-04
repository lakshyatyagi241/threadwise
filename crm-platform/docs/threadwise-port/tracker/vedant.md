# Reference port tracker — Vedant

Only Vedant edits this file (`threadwise-ownership-guard` enforces it). Statuses: todo · in-progress · backend-done · frontend-done · done · verified · blocked · wontfix.
Update with: `python3 .claude/skills/threadwise-parity-tracker/scripts/tracker.py set TW-XXX-001 in-progress --pr 123`

## whatsapp-devices-baileys (wadev)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-WADEV-001 | todo |  |  |
| TW-WADEV-002 | todo |  |  |
| TW-WADEV-003 | todo |  |  |
| TW-WADEV-004 | todo |  |  |
| TW-WADEV-005 | todo |  |  |
| TW-WADEV-006 | todo |  |  |
| TW-WADEV-007 | todo |  |  |
| TW-WADEV-008 | todo |  |  |
| TW-WADEV-009 | todo |  |  |
| TW-WADEV-010 | todo |  |  |
| TW-WADEV-011 | todo |  |  |
| TW-WADEV-012 | todo |  |  |
| TW-WADEV-013 | todo |  |  |
| TW-WADEV-014 | todo |  |  |
| TW-WADEV-015 | todo |  |  |
| TW-WADEV-016 | todo |  |  |
| TW-WADEV-017 | todo |  |  |
| TW-WADEV-018 | todo |  |  |
| TW-WADEV-019 | todo |  |  |
| TW-WADEV-020 | todo |  |  |
| TW-WADEV-021 | todo |  |  |
| TW-WADEV-022 | todo |  |  |
| TW-WADEV-023 | todo |  |  |
| TW-WADEV-024 | todo |  |  |
| TW-WADEV-025 | todo |  |  |
| TW-WADEV-026 | todo |  |  |
| TW-WADEV-027 | todo |  |  |
| TW-WADEV-028 | todo |  |  |
| TW-WADEV-029 | todo |  |  |
| TW-WADEV-030 | todo |  |  |
| TW-WADEV-031 | todo |  |  |
| TW-WADEV-032 | todo |  |  |
| TW-WADEV-033 | todo |  |  |
| TW-WADEV-034 | todo |  |  |
| TW-WADEV-035 | todo |  |  |
| TW-WADEV-036 | todo |  |  |
| TW-WADEV-037 | todo |  |  |
| TW-WADEV-038 | todo |  |  |
| TW-WADEV-039 | todo |  |  |
| TW-WADEV-040 | todo |  |  |
| TW-WADEV-041 | todo |  |  |
| TW-WADEV-042 | todo |  |  |
| TW-WADEV-043 | todo |  |  |
| TW-WADEV-044 | todo |  |  |
| TW-WADEV-045 | todo |  |  |
| TW-WADEV-046 | todo |  |  |

## campaigns (camp) additions: Create broadcast wizard

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-CAMP-029 | done |  | ADDITION (not in Reference): Create-broadcast wizard shell, draft, resume. api+web+e2e on akshay/campaigns/broadcast-wizard; not parity-checked against a Reference twin (none exists) |
| TW-CAMP-030 | done |  | ADDITION: audience groups+segments+rules, count, exclusions |
| TW-CAMP-031 | done |  | ADDITION: credit check, variable mapping, sample messages |
| TW-CAMP-032 | done |  | ADDITION: test send, logged, charged on delivery; Cloud API delivery reports now reach campaigns (WabaReceiptRegistry) |
| TW-CAMP-033 | done |  | ADDITION: now / scheduled / recurring series with child runs |
| TW-CAMP-034 | done |  | ADDITION: 131049 retries every 24h to an end date; real Meta behaviour unverified (sandbox only) |
| TW-CAMP-035 | done |  | ADDITION: wizard broadcasts list, status, pause, resume, cancel |

## whatsapp-cloud-api-waba (waba)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-WABA-001 | frontend-done |  | platform Meta app credentials: the whatsapp settings group and admin page /admin/settings/whatsapp; saved values overlay the environment (15 s) in API and worker; secrets encrypted, never returned; waba-config.spec |
| TW-WABA-002 | frontend-done |  | platform admin check of the four coexistence webhook fields on the Meta app (GET /platform/waba/webhook-status) shown on the WhatsApp settings page; unit tested, not run against real Meta |
| TW-WABA-003 | frontend-done |  | one-click subscribe keeps every existing field and the callback Meta has on file (POST /platform/waba/webhook-subscribe); unit tested, not run against real Meta |
| TW-WABA-004 | frontend-done |  | numbers section at /channels/whatsapp: cards, actions, inbound badge; waba-connect.e2e |
| TW-WABA-005 | frontend-done |  | Meta JS SDK launcher and connect modals; embedded-signup.test.ts; the popup was never opened against real Meta |
| TW-WABA-006 | frontend-done |  | manual connect (paste credentials) modal and API; waba-connect.e2e |
| TW-WABA-007 | frontend-done |  | pre-save token check reports each scope; waba-connect.e2e |
| TW-WABA-008 | wontfix |  | dead endpoint in Reference (no page calls it); connect and renew do the exchange server-side; inventory says do not port unless a UI needs it |
| TW-WABA-009 | frontend-done |  | Embedded Signup: code exchange, Interakt registration, callback override, ids proven against token scopes; waba-connect.e2e |
| TW-WABA-010 | frontend-done |  | coexistence launch and flag; echoes (044) and history re-sync button (028) built; history import is row 046 |
| TW-WABA-011 | backend-done |  | subscribe the app to a WABA with callback override, warns when Interakt refuses; waba-connect.e2e |
| TW-WABA-012 | frontend-done |  | Cloud API registration with a kept PIN, auto and manual, hint when two-step is on; waba-connect.e2e |
| TW-WABA-013 | frontend-done |  | inbound-wired verification, stamp and badge on the card; waba-connect.e2e |
| TW-WABA-014 | frontend-done |  | Fix inbound re-subscribes and verifies; waba-connect.e2e |
| TW-WABA-015 | frontend-done |  | live inbound check per number with a typed verdict plus the callback URL and verify token for a customer's own Meta app; e2e with Meta faked at the HTTP edge |
| TW-WABA-016 | frontend-done |  | primary and auto-promotion; waba-connect.e2e keeps-one-primary |
| TW-WABA-017 | frontend-done |  | disconnect hands primary on; waba-connect.e2e |
| TW-WABA-018 | frontend-done |  | remove hands primary on; waba-connect.e2e |
| TW-WABA-019 | frontend-done |  | replace token only when Meta accepts it; waba-connect.e2e |
| TW-WABA-020 | frontend-done |  | renew in place, says so when Meta cannot renew it; waba-connect.e2e |
| TW-WABA-021 | frontend-done |  | health dashboard from live Meta reads (phone, WABA, scopes, subscribed apps, template tally); waba-connect.e2e, waba-health-details.spec |
| TW-WABA-022 | backend-done |  | derived issues and overall status, worst first; waba-rules.spec deriveHealth |
| TW-WABA-023 | frontend-done |  | health tile from Meta conversation analytics (optional card, omitted when analytics do not answer); allowance constant 1000 kept as Reference, may be obsolete after Meta's July 2025 per-message pricing; not run against real Meta |
| TW-WABA-024 | frontend-done |  | verified-badge checklist and the calling card (CallingToggleCard of the calling domain, the same switch as /calling) on the health page; the card reuses the /calling number card and has no component test of its own |
| TW-WABA-025 | frontend-done |  | claim and release a business username with Meta's handle rules checked first, suggestions from the server, error 100 explained, release always clears the local record; not run against real Meta |
| TW-WABA-026 | backend-done |  | business_username_update webhook keeps the stored handle and status current, deleted clears it; e2e through the real webhook door |
| TW-WABA-027 | frontend-done |  | QR codes: create (PNG, 140 chars), list and delete on the health page; Reference had the routes but no screen; not run against real Meta |
| TW-WABA-028 | frontend-done |  | history re-sync button for coexistence numbers re-subscribes the WABA and reports the historical messages already imported; the import itself (046) is not built |
| TW-WABA-029 | backend-done |  | webhook GET handshake with saved, env or derived verify token; waba-rules.spec |
| TW-WABA-030 | backend-done |  | request authentication by signature or platform key in the URL; requireSignature closes the URL-key door; waba-rules.spec |
| TW-WABA-031 | backend-done |  | entry routing, config resolution and field dispatch; waba-rules.spec splitWebhook; waba-coexistence.e2e through WabaIngestService |
| TW-WABA-032 | backend-done |  | inbound content extraction, in the inbox's own normaliser (infra/providers/whatsapp/meta-inbound.ts); inbox unit specs |
| TW-WABA-033 | backend-done |  | dedupe by wamid claimed in Redis (released on failure) with the inbox ledger behind it; self-echo and reactions in the inbox normaliser; message-ingest e2e |
| TW-WABA-034 | backend-done |  | built on main by the inbox work (PR 30): WabaInboxSink, WabaChannelLinkService and the whatsapp_cloud channel make the thread, contact and message from a WhatsApp delivery; nothing duplicated here |
| TW-WABA-035 | backend-done |  | built on main by the inbox work (PR 30): the file is fetched in the background by the ingest worker; nothing duplicated here |
| TW-WABA-036 | backend-done |  | the post-store fan-out is the flow runtime's InboundMessageHooks, run by the inbox ingest after the commit for every stored inbound message (flows, keyword and away replies); history imports and group messages deliberately skip it |
| TW-WABA-037 | backend-done |  | built on main by the inbox work (PR 30): delivery reports the broadcasts did not claim become receipts on the inbox message; wallet settlement once belongs with WALLET |
| TW-WABA-038 | backend-done |  | built in the campaign and broadcast engines: Meta 131049 engagement block is retried on a spaced, capped schedule; nothing left in WABA |
| TW-WABA-039 | backend-done |  | group messages are stored on a thread keyed g:<group id> with no contact, titled by the group subject, the participant in the message meta (WabaInboxSink.onGroupMessage); per-participant statuses fold into one bubble with delivered_to, billable and free counts and only move forward; waba-coexistence.e2e, waba-groups-handoff.spec. No hook fires for groups, so nothing auto-replies |
| TW-WABA-040 | backend-done |  | the four Groups webhooks keep waba_groups in step: create, delete, participant count, join requests, settings by success flag, suspension; waba-groups-handoff.spec, waba-coexistence.e2e |
| TW-WABA-041 | backend-done |  | template status, quality and category webhooks mirrored onto the template row scoped to the WABA; template-event-rules.spec |
| TW-WABA-042 | backend-done |  | a catalog cart becomes one wa_orders row with lines, deduped by message id; whatsapp.order.received goes through the outbox and is consumed twice: WabaOrderAckConsumer sends the buyer's order-received message through the catalog's CatalogOrderAckService, and the flow runtime's trigger consumer starts the order flow; waba-coexistence.e2e, waba-order-ack.consumer.spec, flow-runtime e2e |
| TW-WABA-043 | backend-done |  | form submissions and payment statuses leave through the outbox (whatsapp.form.submitted, whatsapp.payment.updated) and never reach the inbox; calls reach the calling domain through WABA_CALLS_SINK; waba-coexistence.e2e |
| TW-WABA-044 | backend-done |  | messages typed on the Business app (smb_message_echoes) become one outbound bubble with no unread, no routing, deduped by message id; a file or place is described, not copied (Reference downloaded echo media); e2e through the real webhook door |
| TW-WABA-045 | backend-done |  | smb_app_state_sync adds the business app's contacts through ContactsService with quiet (no contact.created event, so no flow or notification), fills a blank name only, never applies remove; waba-coexistence.e2e |
| TW-WABA-046 | backend-done |  | history webhook stored quietly through the inbox ingest: backdated to the real send time, both sides by own numbers, deduped by message id in the ledger, capped at 2000 per delivery, no unread, no contact, no realtime alert; waba-coexistence.e2e |
| TW-WABA-047 | blocked |  | Twilio inbound needs the Twilio connection and an inbox channel kind for it, both part of WADEV (Baileys/Twilio devices); the shared ingest is ready for it |
| TW-WABA-048 | wontfix |  | the bridge's inbound mirror is the in-process inbox path built in NODE (TW-NODE-017): no HTTP endpoint to port |
| TW-WABA-049 | backend-done |  | built on main by the inbox work (PR 30): the Cloud API send adapter of the inbox channel (text, media, template, location, reaction; Meta or Interakt route); not run against real Meta |
| TW-WABA-050 | wontfix |  | there is no Node bridge to hand credentials to: the unofficial engine runs in the worker and the Cloud API reads credentials from the number's own row |
| TW-WABA-051 | backend-done |  | describeMetaError (Meta words first, code and trace appended), connect translators for 190/463/467/460, 200 and 100, a retryable flag for the inbox; waba-errors in infra/providers, meta-errors for the inbox, waba-connect.e2e |
| TW-WABA-052 | wontfix |  | repair job for a connection without a WABA id; the connect flow here requires and proves the WABA id, so nothing creates such a row |
| TW-WABA-053 | backend-done |  | daily worker job pulls Meta template button clicks onto wpcampaigns.meta_clicked_count (window from creation day, max 89 days, enables insights once and retries); waba-click-sync.e2e, waba-groups-handoff.spec |
| TW-WABA-054 | blocked |  | the ads client reusing WABA ids is MADS code; WabaConnectService.resolveConnection already serves the primary number's ids to it |
| TW-WABA-055 | frontend-done |  | saved customers: API (list, search, upsert by phone digits) and the Customers screen at /store/customers with a Settings tile; waba-customers.e2e |
| TW-WABA-056 | frontend-done |  | removes the profile only and keeps the orders (Reference also deleted every order of that phone: a deliberate deviation, see parity); an unknown id is a 404; waba-customers.e2e |
| TW-WABA-057 | wontfix |  | dead code in Reference (no page includes the views); the modern popup flow replaces it; the catalog link idea goes to CAT as an explicit action |

## node-bridge-runtime (node)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-NODE-001 | blocked |  | no bridge process in this repo until decision E |
| TW-NODE-002 | backend-done |  | NodeTokenGuard on the one bridge-facing route; the bridge's other routes became in-process commands (Redis), so no other route needs it |
| TW-NODE-003 | wontfix |  | not needed: no browser client reaches the bridge; the API already has CORS and body limits (main.ts); inventory port note |
| TW-NODE-004 | backend-done |  | worker heartbeat in Redis (one key per running worker, 90 s); the console health card's Node check reads it (workers and devices held), falling back to the saved-address probe when no worker reports; no HTTP surface on the worker by design |
| TW-NODE-005 | backend-done |  | registry is a per-worker map plus a Redis lease per device; no in-memory schedules or boot sync; shutdown releases leases |
| TW-NODE-006 | backend-done |  | shutdown closes connections and releases leases, keeps sessions, never unlinks; enableShutdownHooks already on |
| TW-NODE-007 | backend-done |  | restore at boot and every pass: devices with a saved session (3+ rows) and no owner are opened, staggered; thin sessions reported Disconnected; also the failover when a worker dies |
| TW-NODE-008 | backend-done |  | DeviceControlService.requestQr: command to the owning worker, QR within 35 s, 429-style busy lock, already-linked answer; the Devices screens (WADEV) call it |
| TW-NODE-009 | backend-done |  | pairing code command: same code for 2 minutes, short numbers refused with Pairing failed status; the library generates the code |
| TW-NODE-010 | in-progress |  | status read and terminate done; check-connection not ported (destructive GET, intended); contact export blocked on MOB (Baileys 6.7 has no store) |
| TW-NODE-011 | backend-done |  | state machine with the full close-code table, backoff, QR stall, mismatch, watchdog (tested with a fake socket); Baileys adapter compiles against the library; NOT verified against live WhatsApp |
| TW-NODE-012 | backend-done |  | status goes to devices.status (same buckets as Reference), an outbox event device.status_changed and Redis for the QR and progress |
| TW-NODE-013 | backend-done |  | per-device proxy (http, socks5) read at every connect, probed through the proxy, fail-closed, result kept on the device; NOT verified against a real proxy |
| TW-NODE-014 | backend-done |  | liveness: owner touches last_seen_at, a device untouched for 90 s flips to disconnected; the other sweeps belong to their own domains as BullMQ jobs |
| TW-NODE-015 | backend-done |  | CAMP's dispatcher sends custom campaigns on the unofficial engine and Twilio through the registry adapter; e2e: real dispatcher, real adapter, fake socket; template-kind content stays Cloud API only |
| TW-NODE-016 | backend-done |  | capture and normalization of every message (filters, 10-minute replay guard, sender and LID resolution, text priority, media, location, contact, reaction, forwarded) with per-device dedup, delivered to registered consumers; media bytes wait for storage (F5) |
| TW-NODE-017 | backend-done |  | unofficial engine is an inbox channel kind (whatsapp_qr), one channel per device; customer messages go through the inbox ingest queue (replaces the inbound-message HTTP endpoint); small files kept, large or failed ones arrive as text saying so; groups are not threads; not run against a live number |
| TW-NODE-018 | backend-done |  | phone-typed echoes are recorded on the thread as outbound once (ledger); group messages stay in the group directory; echo files and places are described, not copied; mirroring auto-replies belongs with 019 |
| TW-NODE-019 | backend-done |  | keyword auto-reply and flow triggering are the flow runtime's trigger service (TW-FLR-001 to 004): the bridge's in-process matcher became module code; vishal/FLR |
| TW-NODE-020 | backend-done |  | receipts go to the broadcast recipient, the scheduled recipient or the inbox message that owns the id (marker per inbox send), upward only |
| TW-NODE-021 | backend-done |  | group commands (list, metadata, create, participants, subject, description, settings, leave, invite) and change snapshots delivered to consumers; the directory tables belong to WFL (not built) |
| TW-NODE-022 | in-progress |  | text send and engine routing for Cloud API, Twilio and the unofficial engine; branding footer, buttons and carousel not built (the official library has no interactive buttons or carousel; they need the forked library or the template pipeline) |
| TW-NODE-023 | backend-done |  | media on the unofficial engine, Twilio and the Cloud API (public https link, caption with footer, document file name, no caption on audio); inline attachment_base64 not ported: media comes from a URL or storage, never from a request body |
| TW-NODE-024 | in-progress |  | location, contact card and group message with mentions done; product catalog sends blocked on the catalog domain (CAT) and the template pipeline |
| TW-NODE-025 | backend-done |  | react, pin, star, edit, delete through the owning socket; pin keeps Reference's fixed 24 hours (its duration choice never had an effect) |
| TW-NODE-026 | wontfix |  | intended: engine and credentials come from the device row, no settings hop or cache (inventory port note) |
| TW-NODE-027 | backend-done |  | Cloud API text transport (shared Meta provider) and a Twilio transport (text, media with caption, location); templates by ContentSid belong to the template pipeline; Twilio status callback belongs to the WhatsApp provider domain |
| TW-NODE-028 | backend-done |  | SafeFetch: all-address DNS check, pinned IP, every redirect hop checked, size cap, MIME; consumer is 023; local paths intentionally refused |
| TW-NODE-029 | backend-done |  | admin form + real reader wired into BCAST pacing; per-socket send serialization is in the Baileys adapter; jitter, daily cap and lease in BCAST |
| TW-NODE-030 | backend-done |  | DB row is the schedule; due poller queues one BullMQ job per occurrence (jobId = uuid + time); late policy configurable; no cron, no boot sync |
| TW-NODE-031 | backend-done |  | run engine: per-recipient claim, pacing, daily cap, lease shared with BCAST, halt; send-now via SchedulerService; text on every engine, media and location when a transport supports them |
| TW-NODE-032 | backend-done |  | next run from repeat_every, weekdays, months without overflow, end date inclusive; every occurrence reaches the whole audience |
| TW-NODE-033 | backend-done |  | same engine with one recipient row; outcome is now recorded (Reference never reported it) |
| TW-NODE-034 | backend-done |  | SchedulerService: pause, resume, cancel, send-now; a run in progress stops before its next batch; the SCHED screens call it |
| TW-NODE-035 | backend-done |  | callbacks became direct writes in the run; recipient states only move up; delivered/read arrive with receipts (020); wallet metering blocked on WALLET |
| TW-NODE-036 | backend-done |  | replaced: the row is the schedule, so nothing is lost on restart; a reconciliation pass queues a stuck run again |
| TW-NODE-037 | backend-done |  | broadcasts reach the unofficial engine and Twilio through TransportEngineSender (rendered text, media as link, header/footer); pacing, cap, lease already in BCAST |
| TW-NODE-038 | backend-done |  | same adapter as 037; per-number daily cap and gaps in BCAST |
| TW-NODE-039 | wontfix |  | dead code in Reference (campaign engine in Node is never reached and throws a ReferenceError) |
| TW-NODE-040 | backend-done |  | campaign delivery and read reports reach CampaignReceiptsService through the receipt router; proven in the campaign e2e on the unofficial engine |
| TW-NODE-041 | backend-done |  | flow start, resume and end are FlowLaunchService.start, the engine's reply routing and cancel/takeover (TW-FLR-011, 013, 050); no bridge endpoint is needed; vishal/FLR |
| TW-NODE-042 | in-progress |  | the WhatsApp Cloud API inbound handoff is the InboundMessageHooks seam of the flow runtime (vishal/FLR); the Twilio part waits for the Twilio inbound row TW-WABA-047 (WADEV) |
| TW-NODE-043 | backend-done |  | flow definition, attributes, template data and media store are module-internal calls of the flow runtime (compile-graph, TemplateService, ChatMediaStore); vishal/FLR |
| TW-NODE-044 | in-progress |  | tag, assign, deal, AI, Meet and WhatsApp form are node executors (TW-FLR-030, 035 to 037, 043, 047); the MySQL node waits for a driver (TW-FLR-034); web search is not built |
| TW-NODE-045 | backend-done |  | the ordering endpoints are TW-FLR-042 (parse, shipping, confirm, cancel, reply under /public/v1/flows/ordering); vishal/FLR |
| TW-NODE-046 | in-progress |  | Google Sheets, Docs, Form and Meet nodes are built against GoogleWorkspacePort (TW-FLR-044 to 047); no Google account store exists yet, so they report no account |
| TW-NODE-047 | in-progress |  | the Commerce shop node's WhatsApp Shop stock and native list are served by the catalog (CatalogShopAdapter, TW-FLR-041); the checkout link for WooCommerce and Shopify waits for the store domains |
| TW-NODE-048 | backend-done |  | booking for flows is the Book appointment node over the appointments domain (TW-FLR-040); vishal/FLR |
| TW-NODE-049 | blocked |  | collapses into module-internal calls of the owning domain (FLR flows, CALL calling, INTG Google, CHK/APPT commerce, channel domains); built with that domain, not as a bridge endpoint |
| TW-NODE-050 | backend-done |  | one flow engine serves every channel through channel profiles (TW-FLR-060 to 068): the per-channel Node engines and Laravel callbacks are not needed; vishal/FLR |
| TW-NODE-051 | blocked |  | collapses into module-internal calls of the owning domain (FLR flows, CALL calling, INTG Google, CHK/APPT commerce, channel domains); built with that domain, not as a bridge endpoint |
| TW-NODE-052 | frontend-done |  | address, token, test connection; parity run pending |
| TW-NODE-053 | wontfix |  | developer-only file-sync endpoint (tw-sync); not a product feature |
| TW-NODE-054 | wontfix |  | Reference smoke scripts; replaced by this repo's own tests |

## chat-conversations (chat)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-CHAT-001 | todo |  |  |
| TW-CHAT-002 | todo |  |  |
| TW-CHAT-003 | todo |  |  |
| TW-CHAT-004 | todo |  |  |
| TW-CHAT-005 | todo |  |  |
| TW-CHAT-006 | todo |  |  |
| TW-CHAT-007 | todo |  |  |
| TW-CHAT-008 | todo |  |  |
| TW-CHAT-009 | todo |  |  |
| TW-CHAT-010 | todo |  |  |
| TW-CHAT-011 | todo |  |  |
| TW-CHAT-012 | todo |  |  |
| TW-CHAT-013 | todo |  |  |
| TW-CHAT-014 | todo |  |  |
| TW-CHAT-015 | todo |  |  |
| TW-CHAT-016 | todo |  |  |
| TW-CHAT-017 | todo |  |  |
| TW-CHAT-018 | todo |  |  |
| TW-CHAT-019 | todo |  |  |
| TW-CHAT-020 | todo |  |  |
| TW-CHAT-021 | todo |  |  |
| TW-CHAT-022 | todo |  |  |
| TW-CHAT-023 | todo |  |  |
| TW-CHAT-024 | todo |  |  |
| TW-CHAT-025 | todo |  |  |
| TW-CHAT-026 | todo |  |  |
| TW-CHAT-027 | todo |  |  |
| TW-CHAT-028 | todo |  |  |
| TW-CHAT-029 | todo |  |  |
| TW-CHAT-030 | todo |  |  |
| TW-CHAT-031 | todo |  |  |
| TW-CHAT-032 | todo |  |  |
| TW-CHAT-033 | todo |  |  |
| TW-CHAT-034 | todo |  |  |
| TW-CHAT-035 | todo |  |  |
| TW-CHAT-036 | todo |  |  |
| TW-CHAT-037 | todo |  |  |
| TW-CHAT-038 | todo |  |  |
| TW-CHAT-039 | todo |  |  |
| TW-CHAT-040 | todo |  |  |
| TW-CHAT-041 | todo |  |  |
| TW-CHAT-042 | todo |  |  |
| TW-CHAT-043 | todo |  |  |
| TW-CHAT-044 | todo |  |  |

## team-inbox-conversations (tib1)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-TIB1-001 | todo |  |  |
| TW-TIB1-002 | todo |  |  |
| TW-TIB1-003 | todo |  |  |
| TW-TIB1-004 | todo |  |  |
| TW-TIB1-005 | todo |  |  |
| TW-TIB1-006 | todo |  |  |
| TW-TIB1-007 | todo |  |  |
| TW-TIB1-008 | todo |  |  |
| TW-TIB1-009 | todo |  |  |
| TW-TIB1-010 | todo |  |  |
| TW-TIB1-011 | todo |  |  |
| TW-TIB1-012 | todo |  |  |
| TW-TIB1-013 | todo |  |  |
| TW-TIB1-014 | todo |  |  |
| TW-TIB1-015 | todo |  |  |
| TW-TIB1-016 | todo |  |  |
| TW-TIB1-017 | todo |  |  |
| TW-TIB1-018 | todo |  |  |
| TW-TIB1-019 | todo |  |  |
| TW-TIB1-020 | todo |  |  |
| TW-TIB1-021 | todo |  |  |
| TW-TIB1-022 | todo |  |  |
| TW-TIB1-023 | todo |  |  |
| TW-TIB1-024 | todo |  |  |
| TW-TIB1-025 | todo |  |  |
| TW-TIB1-026 | todo |  |  |
| TW-TIB1-027 | todo |  |  |
| TW-TIB1-028 | todo |  |  |
| TW-TIB1-029 | todo |  |  |
| TW-TIB1-030 | todo |  |  |
| TW-TIB1-031 | todo |  |  |
| TW-TIB1-032 | todo |  |  |
| TW-TIB1-033 | todo |  |  |
| TW-TIB1-034 | todo |  |  |
| TW-TIB1-035 | todo |  |  |
| TW-TIB1-036 | todo |  |  |
| TW-TIB1-037 | todo |  |  |
| TW-TIB1-038 | todo |  |  |
| TW-TIB1-039 | todo |  |  |
| TW-TIB1-040 | todo |  |  |
| TW-TIB1-041 | todo |  |  |
| TW-TIB1-042 | todo |  |  |
| TW-TIB1-043 | todo |  |  |
| TW-TIB1-044 | todo |  |  |
| TW-TIB1-045 | todo |  |  |
| TW-TIB1-046 | todo |  |  |
| TW-TIB1-047 | todo |  |  |
| TW-TIB1-048 | todo |  |  |
| TW-TIB1-049 | todo |  |  |
| TW-TIB1-050 | todo |  |  |
| TW-TIB1-051 | todo |  |  |
| TW-TIB1-052 | todo |  |  |
| TW-TIB1-053 | todo |  |  |
| TW-TIB1-054 | todo |  |  |
| TW-TIB1-055 | todo |  |  |

## team-inbox-routing-sla (tib2)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-TIB2-001 | todo |  |  |
| TW-TIB2-002 | todo |  |  |
| TW-TIB2-003 | todo |  |  |
| TW-TIB2-004 | done |  | auto-assignment build: rules API under /v2/inbox/routing, screens under Settings > Automation > Auto-assignment |
| TW-TIB2-005 | done |  | auto-assignment build: rules API under /v2/inbox/routing, screens under Settings > Automation > Auto-assignment |
| TW-TIB2-006 | done |  | auto-assignment build: rules API under /v2/inbox/routing, screens under Settings > Automation > Auto-assignment |
| TW-TIB2-007 | done |  | auto-assignment build: rules API under /v2/inbox/routing, screens under Settings > Automation > Auto-assignment |
| TW-TIB2-008 | done |  | auto-assignment build: rules API under /v2/inbox/routing, screens under Settings > Automation > Auto-assignment |
| TW-TIB2-009 | done |  | auto-assignment build: rules API under /v2/inbox/routing, screens under Settings > Automation > Auto-assignment |
| TW-TIB2-010 | in-progress |  | assign action only (round_robin, least_busy, specific, contact agent); other actions, sticky, team strategy/capacity not built |
| TW-TIB2-011 | in-progress |  | assign action only (round_robin, least_busy, specific, contact agent); other actions, sticky, team strategy/capacity not built |
| TW-TIB2-012 | in-progress |  | assign action only (round_robin, least_busy, specific, contact agent); other actions, sticky, team strategy/capacity not built |
| TW-TIB2-013 | in-progress |  | assign action only (round_robin, least_busy, specific, contact agent); other actions, sticky, team strategy/capacity not built |
| TW-TIB2-014 | todo |  |  |
| TW-TIB2-015 | todo |  |  |
| TW-TIB2-016 | todo |  |  |
| TW-TIB2-017 | todo |  |  |
| TW-TIB2-018 | todo |  |  |
| TW-TIB2-019 | todo |  |  |
| TW-TIB2-020 | in-progress |  | assign action only (round_robin, least_busy, specific, contact agent); other actions, sticky, team strategy/capacity not built |
| TW-TIB2-021 | todo |  |  |
| TW-TIB2-022 | todo |  |  |
| TW-TIB2-023 | todo |  |  |
| TW-TIB2-024 | todo |  |  |
| TW-TIB2-025 | todo |  |  |
| TW-TIB2-026 | todo |  |  |
| TW-TIB2-027 | todo |  |  |
| TW-TIB2-028 | todo |  |  |
| TW-TIB2-029 | todo |  |  |
| TW-TIB2-030 | todo |  |  |
| TW-TIB2-031 | todo |  |  |
| TW-TIB2-032 | todo |  |  |
| TW-TIB2-033 | todo |  |  |
| TW-TIB2-034 | todo |  |  |
| TW-TIB2-035 | todo |  |  |
| TW-TIB2-036 | todo |  |  |

## message-templates (tpl)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-TPL-001 | todo |  |  |
| TW-TPL-002 | todo |  |  |
| TW-TPL-003 | todo |  |  |
| TW-TPL-004 | todo |  |  |
| TW-TPL-005 | todo |  |  |
| TW-TPL-006 | todo |  |  |
| TW-TPL-007 | todo |  |  |
| TW-TPL-008 | todo |  |  |
| TW-TPL-009 | todo |  |  |
| TW-TPL-010 | todo |  |  |
| TW-TPL-011 | todo |  |  |
| TW-TPL-012 | todo |  |  |
| TW-TPL-013 | todo |  |  |
| TW-TPL-014 | todo |  |  |
| TW-TPL-015 | todo |  |  |
| TW-TPL-016 | todo |  |  |
| TW-TPL-017 | todo |  |  |
| TW-TPL-018 | todo |  |  |
| TW-TPL-019 | todo |  |  |
| TW-TPL-020 | todo |  |  |
| TW-TPL-021 | todo |  |  |
| TW-TPL-022 | todo |  |  |
| TW-TPL-023 | todo |  |  |
| TW-TPL-024 | todo |  |  |
| TW-TPL-025 | todo |  |  |
| TW-TPL-026 | todo |  |  |
| TW-TPL-027 | todo |  |  |
| TW-TPL-028 | todo |  |  |
| TW-TPL-029 | todo |  |  |
| TW-TPL-030 | todo |  |  |
| TW-TPL-031 | todo |  |  |
| TW-TPL-032 | todo |  |  |
| TW-TPL-033 | todo |  |  |
| TW-TPL-034 | todo |  |  |
| TW-TPL-035 | todo |  |  |
| TW-TPL-036 | todo |  |  |
| TW-TPL-037 | todo |  |  |
| TW-TPL-038 | todo |  |  |
| TW-TPL-039 | todo |  |  |
| TW-TPL-040 | todo |  |  |
| TW-TPL-041 | todo |  |  |
| TW-TPL-042 | todo |  |  |
| TW-TPL-043 | todo |  |  |
| TW-TPL-044 | todo |  |  |
| TW-TPL-045 | todo |  |  |
| TW-TPL-046 | todo |  |  |
| TW-TPL-047 | todo |  |  |
| TW-TPL-048 | todo |  |  |
| TW-TPL-049 | todo |  |  |
| TW-TPL-050 | todo |  |  |

## broadcasts (bcast)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-BCAST-001 | todo |  |  |
| TW-BCAST-002 | todo |  |  |
| TW-BCAST-003 | todo |  |  |
| TW-BCAST-004 | todo |  |  |
| TW-BCAST-005 | todo |  |  |
| TW-BCAST-006 | todo |  |  |
| TW-BCAST-007 | todo |  |  |
| TW-BCAST-008 | todo |  |  |
| TW-BCAST-009 | todo |  |  |
| TW-BCAST-010 | todo |  |  |
| TW-BCAST-011 | todo |  |  |
| TW-BCAST-012 | todo |  |  |
| TW-BCAST-013 | todo |  |  |
| TW-BCAST-014 | todo |  |  |
| TW-BCAST-015 | todo |  |  |
| TW-BCAST-016 | todo |  |  |
| TW-BCAST-017 | todo |  |  |
| TW-BCAST-018 | todo |  |  |
| TW-BCAST-019 | todo |  |  |
| TW-BCAST-020 | todo |  |  |
| TW-BCAST-021 | todo |  |  |
| TW-BCAST-022 | todo |  |  |
| TW-BCAST-023 | todo |  |  |
| TW-BCAST-024 | todo |  |  |
| TW-BCAST-025 | todo |  |  |
| TW-BCAST-026 | todo |  |  |
| TW-BCAST-027 | todo |  |  |
| TW-BCAST-028 | todo |  |  |
| TW-BCAST-029 | todo |  |  |
| TW-BCAST-030 | todo |  |  |
| TW-BCAST-031 | todo |  |  |
| TW-BCAST-032 | todo |  |  |
| TW-BCAST-033 | todo |  |  |
| TW-BCAST-034 | todo |  |  |
| TW-BCAST-035 | todo |  |  |
| TW-BCAST-036 | todo |  |  |
| TW-BCAST-037 | todo |  |  |
| TW-BCAST-038 | todo |  |  |
| TW-BCAST-039 | todo |  |  |
| TW-BCAST-040 | todo |  |  |
| TW-BCAST-041 | todo |  |  |
| TW-BCAST-042 | todo |  |  |
| TW-BCAST-043 | todo |  |  |

## scheduled-queue-warmer (sched)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-SCHED-001 | frontend-done |  | list with stats, up-next, tabs, search and row actions (web + API); the stats strip is computed from the page shown; not opened in a browser or run against Reference side by side |
| TW-SCHED-002 | frontend-done |  | 5-step composer: basics and senders, audience with live preview, message, schedule, review; not in a browser; media is a link, no file drop; no template categories |
| TW-SCHED-003 | backend-done |  | plan flag and limit, 2-minute lead time, audience, halt and content guard, wallet, multi-sender split, warmer reservation, one transaction; 16 e2e |
| TW-SCHED-004 | backend-done |  | group, tag, earlier broadcasts, typed numbers; opted-out and archived contacts never messaged, one copy per person (Reference's gap fixed); recipients fixed when saved |
| TW-SCHED-005 | backend-done |  | round-robin split, one schedule per sender named after it, tag audiences split too (Reference left them empty) |
| TW-SCHED-006 | in-progress |  | text, media by link, location, template as text on the unofficial engine and Twilio; no upload until the send port takes file bytes; no Cloud API template |
| TW-SCHED-007 | backend-done |  | a test message to a number typed in the composer after the schedule is saved; a failure never undoes the schedule |
| TW-SCHED-008 | backend-done |  | reserved per send date for one-off schedules from a warming number, held with Reference's wording, and released on cancel, delete or fail |
| TW-SCHED-009 | backend-done |  | emergency halt and content guardrails before saving, wallet precheck once for the whole audience |
| TW-SCHED-010 | backend-done |  | covered by TW-NODE-030: the row is the schedule, no bridge registration |
| TW-SCHED-011 | backend-done |  | covered by TW-NODE-030, 032: cadence, weekdays, end date inclusive, next run in the schedule's zone |
| TW-SCHED-012 | frontend-done |  | detail with progress, funnel, recipients and actions; no engagement curve or donut chart; not in a browser |
| TW-SCHED-013 | frontend-done |  | pause and resume from list and detail; 409 when the status does not allow it |
| TW-SCHED-014 | frontend-done |  | cancel from list and detail; releases the warmer budget the unsent part reserved |
| TW-SCHED-015 | frontend-done |  | run now: due at once from waiting, running, paused or failed; recipients already sent are skipped |
| TW-SCHED-016 | backend-done |  | PATCH name, time, message with a version check, 2-minute lead time and zone check; the web has no edit screen (the reference detail has none) |
| TW-SCHED-017 | frontend-done |  | retry with a new time; only failed recipients are tried again (Reference re-sent to everyone) |
| TW-SCHED-018 | frontend-done |  | delete from list and detail; hard delete; releases the warmer budget |
| TW-SCHED-019 | backend-done |  | plan feature and limit scheduled_messages, permissions sched.schedules.read and manage (Owner, Admin, Manager) |
| TW-SCHED-020 | backend-done |  | covered by TW-NODE-030: BullMQ and the due poller replace the bridge's in-memory cron |
| TW-SCHED-021 | backend-done |  | covered by TW-NODE-031: ScheduledRunService; now also applies the number's warmer hours, gap and spintax |
| TW-SCHED-022 | backend-done |  | covered by TW-NODE-032 |
| TW-SCHED-023 | backend-done |  | covered by TW-NODE-033: counters on the row |
| TW-SCHED-024 | backend-done |  | covered by TW-NODE-035: per-recipient receipts; wallet settlement per delivery is not verified for scheduled sends |
| TW-SCHED-025 | backend-done |  | covered by TW-NODE-030: nothing to restore, state is in the database |
| TW-SCHED-026 | backend-done |  | covered by TW-NODE-036: durable retry of failed one-offs |
| TW-SCHED-027 | backend-done |  | covered: the broadcast retry policy is shared |
| TW-SCHED-028 | blocked |  | needs the customer API domain; public-api here is a lead-intake skeleton; ScheduleCreateService is the use case to call |
| TW-SCHED-029 | blocked |  | needs the mobile domain |
| TW-SCHED-030 | backend-done |  | ScheduleProducerService: ordinary schedules with source and external_key; a key replaces its old schedule; cancel by key; e2e |

## auto-reply-keywords (ar)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-AR-001 | todo |  |  |
| TW-AR-002 | todo |  |  |
| TW-AR-003 | todo |  |  |
| TW-AR-004 | todo |  |  |
| TW-AR-005 | todo |  |  |
| TW-AR-006 | todo |  |  |
| TW-AR-007 | todo |  |  |
| TW-AR-008 | todo |  |  |
| TW-AR-009 | todo |  |  |
| TW-AR-010 | todo |  |  |
| TW-AR-011 | todo |  |  |
| TW-AR-012 | todo |  |  |
| TW-AR-013 | todo |  |  |
| TW-AR-014 | todo |  |  |
| TW-AR-015 | todo |  |  |
| TW-AR-016 | todo |  |  |
| TW-AR-017 | todo |  |  |
| TW-AR-018 | todo |  |  |
| TW-AR-019 | todo |  |  |
| TW-AR-020 | todo |  |  |
| TW-AR-021 | todo |  |  |
| TW-AR-022 | todo |  |  |
| TW-AR-023 | todo |  |  |
| TW-AR-024 | todo |  |  |
| TW-AR-025 | todo |  |  |
| TW-AR-026 | todo |  |  |
| TW-AR-027 | todo |  |  |
| TW-AR-028 | todo |  |  |
| TW-AR-029 | todo |  |  |
| TW-AR-030 | todo |  |  |
| TW-AR-031 | todo |  |  |
| TW-AR-032 | todo |  |  |
| TW-AR-033 | todo |  |  |
| TW-AR-034 | todo |  |  |
| TW-AR-035 | todo |  |  |
| TW-AR-036 | todo |  |  |
| TW-AR-037 | todo |  |  |
| TW-AR-038 | todo |  |  |
| TW-AR-039 | todo |  |  |
| TW-AR-040 | todo |  |  |
| TW-AR-041 | todo |  |  |
| TW-AR-042 | todo |  |  |
| TW-AR-043 | todo |  |  |
| TW-AR-044 | todo |  |  |

## flow-builder-editor (flb)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-FLB-001 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| TW-FLB-002 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| TW-FLB-003 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| TW-FLB-004 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| TW-FLB-005 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| TW-FLB-006 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| TW-FLB-007 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| TW-FLB-008 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| TW-FLB-009 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| TW-FLB-010 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| TW-FLB-011 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| TW-FLB-012 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| TW-FLB-013 | verified |  | list twin run: fixed, 0 open defects (parity/flow-builder-editor-list.md) |
| TW-FLB-014 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| TW-FLB-015 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| TW-FLB-016 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| TW-FLB-017 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| TW-FLB-018 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| TW-FLB-019 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| TW-FLB-020 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| TW-FLB-021 | done |  | managed keyword row intentionally not created (FLR matches flows directly, TW-FLR-004) |
| TW-FLB-022 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| TW-FLB-023 | wontfix |  | dead code in Reference: the Variables modal has no button; identical to the observer |
| TW-FLB-024 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| TW-FLB-025 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| TW-FLB-026 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| TW-FLB-027 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| TW-FLB-028 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| TW-FLB-029 | done |  | editor twin run, 1 open defect elsewhere (051); parity/flow-builder-editor.md |
| TW-FLB-030 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-031 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-032 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-033 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-034 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-035 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-036 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-037 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-038 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-039 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-040 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-041 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-042 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-043 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-044 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-045 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-046 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-047 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-048 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-049 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-050 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-051 | blocked |  | Create new AI agent dialog waits on the AI agents create API |
| TW-FLB-052 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-053 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-054 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-055 | done |  | builder side done; Google file pickers answer 503 until a Google account store exists (INTG) |
| TW-FLB-056 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-057 | done |  | builder side done; Google file pickers answer 503 until a Google account store exists (INTG) |
| TW-FLB-058 | done |  | builder side done; Google file pickers answer 503 until a Google account store exists (INTG) |
| TW-FLB-059 | done |  | builder side done; Google file pickers answer 503 until a Google account store exists (INTG) |
| TW-FLB-060 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-061 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-062 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-063 | done |  | builder forms done; runtime executors for these types are missing in FLR TYPE_MAP |
| TW-FLB-064 | done |  | builder forms done; runtime executors for these types are missing in FLR TYPE_MAP |
| TW-FLB-065 | done |  | builder forms done; runtime executors for these types are missing in FLR TYPE_MAP |
| TW-FLB-066 | done |  | builder forms done; runtime executors for these types are missing in FLR TYPE_MAP |
| TW-FLB-067 | done |  | builder form, ports, defaults and card summary; twin run; see parity doc |
| TW-FLB-068 | done |  | owned by FLR (ordering contracts and endpoints there) |
| TW-FLB-069 | done |  | owned by NODE/FLR: the Node bridge is replaced by the in-process engine |
| TW-FLB-070 | done |  | flbToRuntimeData + FlowReaderService done; compileGraph calls flbToRuntimeData (branch akshay/flr/flb-runtime-hook, authorised on the FLR side), template and AI assistant uuids resolved by org; e2e editor-flows |
| TW-FLB-071 | done |  | owned by FLR, built there (TW-FLR-052..058) |
| TW-FLB-072 | done |  | owned by FLR, built there (TW-FLR-052..058) |
| TW-FLB-073 | done |  | owned by FLR, built there (TW-FLR-052..058) |
| TW-FLB-074 | done |  | owned by FLR, built there (TW-FLR-052..058) |
| TW-FLB-075 | done |  | owned by FLR, built there (TW-FLR-052..058) |
| TW-FLB-076 | done |  | owned by FLR, built there (TW-FLR-052..058) |
| TW-FLB-077 | done |  | owned by FLR, built there (TW-FLR-052..058) |
| TW-FLB-078 | wontfix |  | dead code in Reference: table kept, no screen or writer |
| TW-FLB-079 | blocked |  | needs the Instaflow remote service (IG domain) |
| TW-FLB-080 | wontfix |  | dev fixture; superseded by compile-seam and runtime-shape-compile specs |
| TW-FLB-081 | done |  | addition beyond Reference (owner request): Ask for file / image. Contracts, FLR executor, editor card/panel/form, test runner, en+ar; unit + API e2e (simulator channel, no real WhatsApp) |
| TW-FLB-082 | done |  | addition beyond Reference (owner request): Ask for location with the WhatsApp send-location request. Same coverage; the request payload is unit-tested, never sent to Meta |
| TW-FLB-083 | done |  | addition beyond Reference (owner request): Geta console publishing. Port + HTTP/fixture adapters, sealed per-workspace credentials, outbox event + worker consumer, sync state with retry, editor status and settings screen, en+ar; unit (stub server) + API e2e + RLS integration + web unit. The real console was never called |

## flow-runtime-engine (flr)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-FLR-001 | backend-done |  | trigger kinds (ten), live = published and active, workspace-scoped lookup, trigger_channel_id replaces trigger_device_id; the editor (FLB) writes the columns; 12 e2e |
| TW-FLR-002 | backend-done |  | keyword start, restart on the same text, default route last, replaces a live run; typed digits also answer a menu (numbered text channels); fuzzy and media-order matching stay with Auto reply |
| TW-FLR-003 | backend-done |  | same inbound hook for every channel; consumed handshake returned to the pipeline; the auto reply and AI agent that must read it do not exist yet |
| TW-FLR-004 | backend-done |  | no shadow keyword rows: keyword flows queried directly, catch-all spellings last; Auto reply can call matchKeywordFlow |
| TW-FLR-005 | backend-done |  | tag, group, created, opt-in through outbox events; imports never fire contact_created; no producer yet for a contact re-subscribing |
| TW-FLR-006 | backend-done |  | order placed (once per order) and deal stage changed (once per deal and stage); the order trigger now hears the storefront checkout (store.order_placed) and a WhatsApp catalog cart (whatsapp.order.received) as well as order.placed; flow-runtime e2e |
| TW-FLR-007 | backend-done |  | away and out of hours from the workspace settings; overnight ranges; re-arms after 12 h; unit-tested hours |
| TW-FLR-008 | frontend-done |  | enroll API plus the Enroll panel on the subscribers page, runs, run detail and analytics screens; not opened in a browser; no Playwright parity run yet |
| TW-FLR-009 | backend-done |  | GET/POST /public/v1/flows under the API-key guard; counts over every subscriber; not exercised with a real signed key in e2e |
| TW-FLR-010 | backend-done |  | campaign (CAMPAIGN_FLOW_STARTER bound) and inbox start built; routing trigger_flow, lead webhook and hand-off call FlowLaunchService.start when their domains exist |
| TW-FLR-011 | backend-done |  | FlowLaunchService: one door, run row on every path, failed launch marks the subscriber with the reason; queue instead of HTTP; retry via flow_retry_logs |
| TW-FLR-012 | backend-done |  | intended: appointment_booked and comment_to_dm are not accepted; forced flowId path dropped |
| TW-FLR-013 | backend-done |  | compileGraph (pure, unit-tested ports and handles); the editor must save flowNodes and flowEdges; runs keep a graph snapshot |
| TW-FLR-014 | backend-done |  | run row before any node; contact and workspace attribute defaults seeded by the engine; conversation_id set |
| TW-FLR-015 | backend-done |  | QUIRK fixed: runs are rows, Delay is a wake-up time, idle and absolute limits, sweeper; a lost job is recovered; e2e restart-style test |
| TW-FLR-016 | backend-done |  | job per step, first edge per port, dead end keeps the last menu, End node, loop guard 20 (run fails with the reason), pause 1.5 s only on the unofficial engine |
| TW-FLR-017 | backend-done |  | one strong resolver for every node, JSON-escape mode; Reference condition tests ported |
| TW-FLR-018 | backend-done |  | taps routed to the menu they belong to (old menus work), 20-character label match, media-only ignored unless accepted, location to a maps link, persistent menus |
| TW-FLR-019 | backend-done |  | one send door (dispatcher then thread), interactive content degraded per channel (buttons, list, link button, pin); no branding footer; a 24 hour window refusal fails the run with the reason |
| TW-FLR-020 | backend-done |  | daily cap shared with broadcasts through the Redis tally, channel down halts and retries every 5 minutes |
| TW-FLR-021 | backend-done |  | Message, Sequence and Media nodes: each reply in order, files by chatmedia key; flow-runtime e2e |
| TW-FLR-022 | backend-done |  | Ask node: validated answers, retry text, timeout; flow-runtime e2e |
| TW-FLR-023 | backend-done |  | Buttons node (three buttons; four to ten become a list where the channel has lists; numbered text elsewhere); channel-render.spec |
| TW-FLR-024 | backend-done |  | List node and its numbered fallback; channel-render.spec |
| TW-FLR-025 | backend-done |  | Poll as a list or numbered text (no native poll on any channel here), as Reference's own partial |
| TW-FLR-026 | backend-done |  | Template node: approved templates by id within the workspace, variables filled from the run, a text fallback on channels without templates; commerce-template e2e |
| TW-FLR-027 | backend-done |  | CTA and Location nodes; channel-render.spec |
| TW-FLR-028 | backend-done |  | Condition node and the operator rules; condition unit spec |
| TW-FLR-029 | backend-done |  | Delay node as a sleeping run with a resume time; flow-runtime e2e |
| TW-FLR-030 | backend-done |  | AI node: one-shot, extraction, silent, conversation mode with an exit keyword, token ledger and the monthly cap on the platform key; ai-nodes e2e (20), ai-call-service spec |
| TW-FLR-031 | in-progress |  | Sub-flow built (same workspace, published flows only, depth cap 10); the Chatbot hand-off to an AI agent waits for the AI agents domain: the executor and port are built and the port answers unavailable |
| TW-FLR-032 | backend-done |  | Webhook node through the guarded fetch (no private hosts, no redirects, 5 MB cap), JSON-escaped variables, saved response; integrations-nodes e2e |
| TW-FLR-033 | backend-done |  | Code node in a worker-thread vm with a memory cap and a 2 s limit; the ceiling (vm is not a hard security boundary) is written in the file header; integrations-nodes spec |
| TW-FLR-034 | blocked |  | MySQL node: the executor, the read-only guard and the 100-row cap are built against a port; there is no mysql2 driver in the repo, so the default adapter says so |
| TW-FLR-035 | backend-done |  | Tag node on the run's contact (add or remove, by id or name); actions-nodes e2e. Does not fire tag_added flows, as Reference |
| TW-FLR-036 | backend-done |  | Assign agent node through AssignmentService with the flow actor; actions-nodes e2e |
| TW-FLR-037 | backend-done |  | Deal node creates or moves the contact's open deal through the stage engine; actions-nodes e2e |
| TW-FLR-038 | backend-done |  | Copy-to-number node through the run's channel, nothing recorded on the customer thread; actions-nodes e2e |
| TW-FLR-039 | backend-done |  | WhatsApp-to-Instagram link node; actions-nodes e2e |
| TW-FLR-040 | backend-done |  | Book appointment node through the appointments domain; commerce-book e2e |
| TW-FLR-041 | backend-done |  | Commerce shop node over FlowShopPort; CatalogShopAdapter binds the catalog behind it: WhatsApp Shop stock by retailer id and the native product list through CatalogSendService (card for one product, multi-product list for more); the single-use checkout link and WooCommerce and Shopify stock still answer cannot, because the store domains expose neither; commerce-shop-form spec, catalog-shop-adapter spec |
| TW-FLR-042 | backend-done |  | Natural-language ordering endpoints (parse, shipping, confirm, cancel, reply) for text orders; voice, photo and group notification sit behind ports; ai-nodes e2e |
| TW-FLR-043 | backend-done |  | WhatsApp Form node and the form-submission resume; commerce-shop-form spec |
| TW-FLR-044 | backend-done |  | Google Sheets node against a workspace port; no Google account store exists yet, so the nodes report no account and move on; integrations-nodes e2e |
| TW-FLR-045 | backend-done |  | Google Docs node against the same port; integrations-nodes spec |
| TW-FLR-046 | backend-done |  | Google Form node: sends the link, parks the run on a custom wait, the response webhook (per-org token) resumes it or the timeout port leaves; integrations-nodes e2e |
| TW-FLR-047 | backend-done |  | Google Meet node against the Google port; integrations-nodes spec |
| TW-FLR-048 | blocked |  | AI voice call node: built against AiCallPort whose default answers calls_unavailable; the real adapter binds when the calling domain (vishal/CALL) merges |
| TW-FLR-049 | backend-done |  | Inbound media as an answer is kept as a chatmedia key, never a public link; flow-runtime e2e |
| TW-FLR-050 | backend-done |  | Ending a run from outside: cancel by hand, agent takeover and a removed sender end the run; flow-runtime e2e |
| TW-FLR-051 | backend-done |  | Run lifecycle: completed is really set (Reference never set it); statuses and the subscriber mirror; flow-runtime e2e |
| TW-FLR-052 | frontend-done |  | Subscriber list, counts, pause and resume; per-row retry through the same confirmation as the history tab |
| TW-FLR-053 | frontend-done |  | Analytics: KPIs, trend, status mix, source bars, leaderboard, all-time period and flow scope, the second counter band; counts launches that failed before a run existed; flow-runtime-read e2e |
| TW-FLR-054 | frontend-done |  | Execution history: filters, status counts that ignore the status filter, search, dates, bulk retry bar; flow-runtime-read e2e |
| TW-FLR-055 | frontend-done |  | Error logs: grouped reasons with first and last seen, retry these, show these runs; flow-runtime-read e2e |
| TW-FLR-056 | frontend-done |  | Retry records table with outcome chips and totals; flow-runtime-read e2e |
| TW-FLR-057 | frontend-done |  | Retry one: flow off 422, 30 s cooldown (FLR_RETRY_TOO_SOON, 429), then state 409; outcome and reason returned; flow-runtime-read e2e |
| TW-FLR-058 | frontend-done |  | Bulk retry of up to 50 named runs with a count per outcome; flow-runtime-read e2e |
| TW-FLR-059 | backend-done |  | Compare-and-set on step_seq, one job id per step, sweeper for lost jobs; flow-runtime e2e |
| TW-FLR-060 | backend-done |  | One engine for every channel: a channel profile (buttons, list, link, location, templates, pace) says what a kind can show, the rest degrades to numbered text; channel-render.spec |
| TW-FLR-061 | backend-done |  | Facebook Messenger: profile with reply buttons and a link button, no list or location; the channel adapter joins by registering for the kind (branch punya/punyafix, PR 34) |
| TW-FLR-062 | backend-done |  | Instagram: the same profile as Messenger; the channel adapter joins by registering for the kind (PR 34) |
| TW-FLR-063 | backend-done |  | TikTok: text with numbered options through the default profile |
| TW-FLR-064 | backend-done |  | Telegram: text with numbered options; the payment node is not built (needs the Telegram payment provider) |
| TW-FLR-065 | backend-done |  | LINE: text with numbered options through the default profile |
| TW-FLR-066 | backend-done |  | Viber: text with numbered options through the default profile |
| TW-FLR-067 | backend-done |  | WeChat: text with numbered options through the default profile |
| TW-FLR-068 | backend-done |  | Email: text with numbered options through the default profile |
| TW-FLR-069 | blocked |  | Call-flow (voice IVR) is the calling domain's: vishal/CALL, PR 35, and its AI assistant rows |
| TW-FLR-070 | wontfix |  | dead code in Reference: the per-channel session tables are replaced by flow_runs |
| TW-FLR-071 | backend-done |  | the runtime regression suite is the unit and e2e specs of this domain (218 unit, 80 e2e) |

## chatbot-widget (wgt)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-WGT-001 | done |  |  |
| TW-WGT-002 | done |  |  |
| TW-WGT-003 | done |  |  |
| TW-WGT-004 | done |  |  |
| TW-WGT-005 | done |  |  |
| TW-WGT-006 | done |  |  |
| TW-WGT-007 | done |  |  |
| TW-WGT-008 | done |  |  |
| TW-WGT-009 | done |  |  |
| TW-WGT-010 | done |  |  |
| TW-WGT-011 | done |  |  |
| TW-WGT-012 | done |  |  |
| TW-WGT-013 | done |  |  |
| TW-WGT-014 | done |  |  |
| TW-WGT-015 | done |  |  |
| TW-WGT-016 | done |  |  |
| TW-WGT-017 | done |  |  |
| TW-WGT-018 | done |  |  |
| TW-WGT-019 | partial |  | Widget side done through the InboxGateway shim (SQL writes to the inbox tables; thread, contact, opening line in the legacy messages table, polling contract tested); Team Inbox screens, the agent reply path and the mobile list belong to TIB1/MOB |
| TW-WGT-020 | done |  |  |
| TW-WGT-021 | done |  | as Reference has it: allowedDomains API and CORS enforcement, no builder control (its docs promise one, the screen has none); blank entry 422 and the widget's own posts blocked are reproduced quirks |
| TW-WGT-022 | done |  |  |
| TW-WGT-023 | done |  |  |
| TW-WGT-024 | done |  |  |
| TW-WGT-025 | done |  |  |
| TW-WGT-026 | done |  | as Reference: nothing can pause a widget (no endpoint or action); status views inert |
| TW-WGT-027 | done |  | RBAC keys plus the `chatbot_widgets` plan flag (catalogue + entitlement gate, 422 PLAN_FEATURE_LOCKED, paywall); widget limit unenforced and public routes ignore the plan, as Reference |
| TW-WGT-028 | partial |  | sidebar item done; More tile, quick access and command palette belong to the shell. Also the user-requested Interakt WhatsApp builder page and launcher (accordion of five cards, live preview, panel with Start Conversation to wa.me), `chatbot_widgets.launcher` jsonb |
| TW-WGT-029 | done |  |  |
| TW-WGT-030 | wontfix |  | greenfield port: no legacy widget messages to backfill |

## team-chat (tchat)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-TCHAT-001 | todo |  |  |
| TW-TCHAT-002 | todo |  |  |
| TW-TCHAT-003 | todo |  |  |
| TW-TCHAT-004 | todo |  |  |
| TW-TCHAT-005 | todo |  |  |
| TW-TCHAT-006 | todo |  |  |
| TW-TCHAT-007 | todo |  |  |
| TW-TCHAT-008 | todo |  |  |
| TW-TCHAT-009 | todo |  |  |
| TW-TCHAT-010 | todo |  |  |
| TW-TCHAT-011 | todo |  |  |
| TW-TCHAT-012 | todo |  |  |
| TW-TCHAT-013 | todo |  |  |
| TW-TCHAT-014 | todo |  |  |
| TW-TCHAT-015 | todo |  |  |
| TW-TCHAT-016 | todo |  |  |
| TW-TCHAT-017 | todo |  |  |
| TW-TCHAT-018 | todo |  |  |
| TW-TCHAT-019 | todo |  |  |
| TW-TCHAT-020 | todo |  |  |
| TW-TCHAT-021 | todo |  |  |
| TW-TCHAT-022 | todo |  |  |
| TW-TCHAT-023 | todo |  |  |
| TW-TCHAT-024 | todo |  |  |
| TW-TCHAT-025 | todo |  |  |
| TW-TCHAT-026 | todo |  |  |
| TW-TCHAT-027 | todo |  |  |
| TW-TCHAT-028 | todo |  |  |
| TW-TCHAT-029 | todo |  |  |
| TW-TCHAT-030 | todo |  |  |
| TW-TCHAT-031 | todo |  |  |
| TW-TCHAT-032 | todo |  |  |

## calling-voice (call)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-CALL-001 | backend-done |  | alias of the WABA handshake at /v2/public/webhooks/wa-calling; e2e |
| TW-CALL-002 | backend-done |  | calls field handled through WABA_CALLS_SINK; one handler instead of two; indexed route lookup |
| TW-CALL-003 | backend-done |  | GET /v2/calling/numbers; call.calls.use and plan feature waba_calling |
| TW-CALL-004 | backend-done |  | toggle with Meta first, coexistence refused locally, Meta refusals in words; e2e against a fake Meta |
| TW-CALL-005 | backend-done |  | permission request, 138017 treated as already permitted, ledger reset; e2e |
| TW-CALL-006 | backend-done |  | ledger from permission_update, eligibility from the conversation's own number, lapsed grant reads expired |
| TW-CALL-007 | frontend-done |  | CallButton with the modal flow, mounted in the inbox thread header (InboxProviders and thread-pane); component tests pass; not tried with a real number |
| TW-CALL-008 | backend-done |  | permission first, calling must be on, refused dial is failed not ringing; e2e |
| TW-CALL-009 | frontend-done |  | CallPeer with SDP rules and recording, 36 unit tests on fakes; no real microphone or Meta test |
| TW-CALL-010 | backend-done |  | progress poll returns the SDP answer only for an active call; e2e |
| TW-CALL-011 | backend-done |  | connect: inbound ringing row matched to contact and thread, outbound answered; idempotent; AI answer and voicemail timer not built |
| TW-CALL-012 | frontend-done |  | pending endpoint and IncomingCallToast, mounted by InboxProviders; poll only, no push |
| TW-CALL-013 | backend-done |  | atomic claim, pre_accept, 900 ms, accept, rollback to ringing on refusal; two simultaneous accepts e2e |
| TW-CALL-014 | wontfix |  | dead code in Reference; pre_accept is a step of accept (inventory port note) |
| TW-CALL-015 | backend-done |  | decline only a ringing call |
| TW-CALL-016 | backend-done |  | terminate, idempotent; row closes on Meta's terminate event |
| TW-CALL-017 | backend-done |  | terminate event closes the row with Meta's status and duration, one system bubble in the customer's thread; Node bridge close not built |
| TW-CALL-018 | frontend-done |  | OnCallPanel with timer, mute, end, record and the consent line, mounted by InboxProviders |
| TW-CALL-019 | backend-done |  | recording upload and playback in private storage, workspace only, replaced file removed; browser recorder in the web feature |
| TW-CALL-020 | wontfix |  | dead code in Reference; AI calls arm recording from the assistant (not built) |
| TW-CALL-021 | backend-done |  | wa_call_events written at every step (connect, dial_sent, accept_sent, terminate, ...) |
