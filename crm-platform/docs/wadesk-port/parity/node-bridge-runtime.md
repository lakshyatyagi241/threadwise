# Parity evidence: node-bridge-runtime (NODE)

WaDesk 1.7.0 vs this branch. Wiring map: [wiring/node-bridge-runtime.md](../wiring/node-bridge-runtime.md). Slice: WD-NODE-052 (settings and test),
WD-NODE-029 (admin pacing and the bridge's pull route), WD-NODE-002 (shared secret), WD-NODE-004 (health card consumer).

## Evidence

- `apps/api/test/e2e/node-bridge-runtime/node-bridge.e2e.spec.ts`: 18 scenarios over HTTP against real Postgres and Redis (access by role, save and
  version conflict, token never returned and stored encrypted, blank token keeps the stored one, installer port kept, all test-connection outcomes
  against a local stand-in bridge, pacing limits, the bridge's pull route and its wire format, fail-closed token guard, environment fallback, health card).
- `apps/web/src/features/node-bridge-runtime/lib/draft.test.ts`: 3 tests for the pacing form's limits.

## Checked by hand, side by side (2026-10-02)

Reference: Admin > Channel Settings (`/admin/settings/channel-setting`), ours: `/admin/node-bridge`, signed in locally on both.

- Same: block order (address, token, buttons, then pacing), labels, placeholders, hints, the "No token" / "Token set" badge, field order and limits of the
  pacing card, the "Pacing tip" text, the blank-token placeholder after saving, and the messages "Enter a valid Server URL (http:// or https://) first."
  and "Could not reach the bridge — check the URL and that the Node service is running."
- Ours, driven in the browser: save address and token, token field cleared with the "stored" placeholder, Test connection ("Bridge responded with HTTP 404."
  against a server without the route), Update timing, and the bridge route then returning exactly the saved pacing and 403 for a wrong or missing token.
- Differences: the address and pacing live on their own console page (WaDesk: top of the Channels hub and inside its providers form); the "Test connection"
  button has no icon; the pacing result is a toast instead of the inline "Saved · Ns gap active on bridge" line.

## Deliberate deviations

- **No push or refresh dance.** WaDesk mirrored the address and token into the Laravel `.env` (`EnvWriter`) and called the bridge's `refresh-settings`
  after every save; the bridge also cached settings for an hour. Here the platform store is the only copy and the bridge pulls the pacing, so a save
  needs no push (inventory port note for WD-NODE-052). The pacing toast reads "Sending timing updated." (WaDesk: "...and pushed to the bridge", plus the
  value the bridge reported holding).
- **Version check on save.** Both forms send the `rowVersion` they read; a stale one is a 409 instead of a silent last-write-wins (architecture rule).
- **Operator roles.** Every operator may read the panel; only a super admin saves or tests (WaDesk: any admin). The token authenticates every bridge call,
  so changing it is not for every role. Same precedent as the settings and AI keys panels.
- **Test connection does not follow redirects** (hardening); a blank address is refused with 422 before any call, as in WaDesk.
- **Problem+json on a bad token** (403) instead of WaDesk's mix of `{ok:false}`, `abort(403)` and 401 bodies. The bridge only looks at the status.
- **Token resolution** keeps WaDesk's order: saved token first, then the `NODE_WEBHOOK_TOKEN` environment value; the legacy `baileys_callback_token` key
  has no equivalent in a fresh install and is not read. WaDesk's `groups/sync` reading the env only (a quirk) is not reproduced.
- **Bridge address keeps the installer's port.** The installer stores `{serverUrl, port}`; saving a new address leaves `port` alone, or takes it from
  the URL (default 8888) when there was none.

## WD-NODE-028 media fetch (deliberate deviations)

- **Every redirect hop is checked** (WaDesk checked only the first, so an allowed host could redirect to an internal one). Security hardening.
- **The connection is pinned** to the address that was checked (WaDesk resolved the name twice).
- **Local file paths are refused** instead of read from an allow-list. A user-supplied value must never name a file on the server; media comes from a URL
  or from storage. WaDesk's internal callers that passed a path will pass a storage key or URL instead.
- **100 MB size cap** (WaDesk had none). WhatsApp's own document ceiling.
- Evidence: `apps/api/test/unit/node-bridge-runtime/safe-fetch.spec.ts` (49): every blocked range, redirect re-validation, DNS names, size cap, MIME.

## WD-NODE-030 to 036 scheduled messages (deliberate deviations)

- **The row is the schedule.** No in-memory cron, no boot sync: nothing is lost on a restart (WaDesk lost single and broadcast schedules and left their rows
  `scheduled` for ever). A job is only the next occurrence; a reconciliation pass queues a run again if its job finished or vanished.
- **`repeat_every` is honoured and the end date is inclusive** (the bridge ignored the first and stopped before the second); weekly walks to the next chosen
  weekday, monthly adds months without overflow, all in the schedule's own zone.
- **Late policy.** A one-off more than `SCHED_MAX_LATE_MINUTES` (60) late is failed with "Missed its time" instead of being left `scheduled`; a recurring one
  does not catch up and moves to its next future occurrence (as WaDesk did).
- **Per-recipient claim** (`processing`, new migration) so a retry after a crash never messages the same person twice (WaDesk sent again after a restart).
- **Every occurrence of a recurring schedule reaches the whole audience**; recipients are pending again after each run and totals are cumulative. WaDesk ignored
  later runs as "duplicate callbacks".
- **`paused` is a real status** with an automatic resume (daily cap: next midnight UTC; emergency halt: retried in 5 minutes). Laravel rejected `paused` and left
  the row `running`.
- **No callbacks.** The bridge's status posts and Laravel's duplicate guard are direct writes in the run's own transactions; a single scheduled message's outcome is
  now recorded (WaDesk never reported it). The unknown-interval 500 at registration becomes "the recurrence ends after its first run".
- **One run per number** across broadcasts and schedules (shared lease).

## WD-NODE-005 to 014 device runtime (deliberate deviations)

- **The session is in Postgres, not on a disk.** Encrypted rows in `device_auth_state` replace `baileys_auth/session_<phone>/`, so a redeploy or a second worker does not
  mean every customer scans a QR again. Restore keeps WaDesk's rule: fewer than 3 entries is not restored and the device is reported Disconnected.
- **A Redis lease per device** instead of in-memory managers and a connection lock, so two sockets for one number cannot run, and a dead worker's devices are adopted by
  another within 90 s. WaDesk's restored devices were not registered with their manager (terminate, status and shutdown skipped them, and a second socket could be built);
  here every owned device is in one registry.
- **Commands, not HTTP calls.** The API publishes a command, the worker that owns the device answers (`DeviceControlService`). A missing worker is a clear message, not a 502.
- **`check-connection` is not ported.** It was a GET that unlinked any device that was not ready at that moment, including one that was merely reconnecting. Status is a
  pure read; Disconnect is `terminate` (unlink on the phone and forget the session).
- **Pairing code** is generated by the library (WaDesk generated its own random code and hard-coded the library's default). The same code is returned for 2 minutes.
- **Status is a closed set** with the labels WaDesk showed; the three device states use WaDesk's exact buckets. `Pairing failed: ...` still buckets as "needs pairing" (WaDesk's
  quirk, kept: a failed code attempt leaves the device unpaired, not disconnected).
- **Heartbeat.** The owner touches `last_seen_at`, and a device nobody touches for 90 s flips to disconnected (WaDesk: the same rule, fed by the bridge's POST). The sweeps WaDesk
  ran from the heartbeat belong to their own domains as BullMQ jobs.
- **Reconnect never gives up** and events are applied in order, so a slow status write cannot land after a later one.

## WD-NODE-016 to 025, 027 sending, receiving, receipts (deliberate deviations)

- **No HTTP between the bridge and the inbox.** WaDesk posted every message to `api/inbound-message` and every receipt to a status endpoint; here the worker hands them to
  registered consumers in-process (`InboundRouter`, `ReceiptRouter`). A message with no consumer registered is reported as unclaimed, not silently dropped.
- **Dedup by message id per device** (7 days, in Redis) replaces the database's unique key, so a replay after a reconnect and the phone's echo of a mirrored message collapse to one.
- **A LID-only group speaker keeps the LID** instead of the message being rejected for a missing phone (WaDesk lost those messages).
- **Receipts are matched by the provider message id in each consumer's own rows**, not by what Node's memory held, so a restart cannot send an in-flight broadcast's receipts to the wrong place.
- **Receipt timestamps** are when the runtime heard of it (as WaDesk); WhatsApp's own times are not used.
- **Twilio media and locations work** (WaDesk's media endpoints had no Twilio branch and answered 404 for a Twilio workspace).
- **The pairing of engine and sender is the row's**, not the request's `provider` field, so a send can no longer fall through to the wrong engine when credentials are missing (WaDesk fell through to the unofficial engine silently).
- **Pin keeps 24 hours.** WaDesk accepted a 24 h / 7 d / 30 d choice that never had an effect; the library call has no duration, so the choice is not offered here either.
- **A slow send is not reported failed early:** the send path waits for the socket's own 120 s query timeout (WaDesk's callers gave up after 20 to 90 s and invited duplicates).
- **Media downloads go through SafeFetch** (see the media section), including its refusal of local paths.

## Not built (sending)

- Branding footer (SET and plan gate), interactive buttons and carousels (the official library has none; they need the fork or the template pipeline), Cloud API media and media with buttons,
  inline `attachment_base64`, product catalog sends (CAT), templates by `ContentSid`.
- Inbound media bytes: no object storage client exists yet (F5), so the message carries its type, name and size only.

## Not verified (device runtime)

- **Live WhatsApp.** The Baileys adapter is checked by the compiler against the library's types and by nothing else: no real QR, pairing code, reconnect or close code was
  exercised. Everything around it is tested with a fake socket against real Postgres and Redis.
- **A real proxy.** The probe through an http or socks5 proxy is not run against one.
- Not built: contact export (010; Baileys 6.7 has no contact store, and its only consumer is the mobile app, MOB).

## Not verified (scheduler)

- Real transports: the engine is tested with a fake transport. The Cloud API (text and media), Baileys and Twilio transports exist; none was run against a live number or account.
- Not built here: wallet and plan metering of each message (WALLET, PLAN), the warmer's daily budget and hold (SCHED), re-resolving tags and groups at fire time
  (the SCHED screens write the audience), a run-history table (none in the schema), delivered and read states (WD-NODE-020 receipts), media from storage and
  templates (they fail the schedule up front with the reason).

## Not verified

- **Automated twin run.** `wadesk-playwright-parity` could not be used for this slice: its scripts list changed files without `git diff --relative`,
  so under this repo layout (git root one level above `crm-platform/`) they see zero feature files, and the operator console login needs MFA enrolment
  that the harness does not drive. Checked by hand instead (below). The twin spec is still to write.
- **Against the real Node bridge.** The reference runs without its bridge here, so "Test connection" was exercised against a stand-in that answers
  like `/api/refresh-settings` (200, 401, 403, 500, connection refused), not the bridge itself.
- Not built: bridge-side endpoints of WD-NODE-004 (`/`, `/health`, `current-settings`): the bridge process is replaced by the in-app worker, which has no HTTP
  surface of its own.

## Not verified (Cloud API and broadcasts)

- Cloud API sends go through the shared `MetaCloudProvider` (WABA domain); the NODE transport sends text and media (by public https link) through it, and Interakt numbers use the same credential rules as broadcasts. Tested with a fake provider only.
- Broadcasts on the unofficial engine and Twilio render the template body with the contact's values and send it as text or media (header, body, footer
  as lines). Send-time overrides, buttons and carousels are Cloud API components and are not applied on these engines.

## Inbox wiring (WD-NODE-017, 018, 020)

- The unofficial engine is the inbox channel kind `whatsapp_qr` (one per linked device, handle = device uuid, not metered). `QrChannelAdapter` sends through
  `DeviceControlService`; `InboxBridge` (worker) turns what the runtime reads into the inbox's own `channel.ingest` jobs and keeps the channel's status in step.
- Plan decision 1 (plan-inbox-chat.md) puts QR onboarding off by default with a ban warning at connect; neither the flag nor the warning is built here (WADEV owns
  the connect screen).
- Deviations: group messages are not threads (WaDesk's inbox listed individual chats); a customer file larger than 25 MB, or one that fails to download, arrives as
  text saying it is not available; an echo's file or place is described on the thread, not copied; reactions sent from the inbox assume the target is the customer's message.
- Not verified: a live number. Tested with a fake socket against real Postgres, Redis and the inbox workers (`inbox-bridge.e2e.spec.ts`).
- Touches the chat-conversations zone (Lakshya): channel kind and peer rule, `ChannelAdapterRegistry.register` and export, `ChannelRegistryService.syncDeviceChannel`,
  `ChannelsRepository.byExternal`, the `QR` badge in the inbox web.

## Campaigns and health (WD-NODE-015, 040, 004)

- `campaign-unofficial.e2e.spec.ts`: the real campaign dispatcher sends each recipient through the real engine adapter to a fake socket; delivery and read acks move the
  recipient forward through the campaign's own receipt rules; a failed send does not stop the others. Not run against a live number.
- Health: each worker writes `wa:worker:<id>` (90 s) every pass and removes it on shutdown; `NodeWorkerStatus` counts them and the devices they hold, and the console
  health card's Node check shows that ("1 worker · 2 devices connected"). With no worker reporting it falls back to the saved-address probe, as before.
- Not changed: template-kind campaigns on the unofficial engine and Twilio (a Meta template has no plain-text body here); interactive buttons are ignored on these engines.

## Intended difference: the unofficial engine is OFF behind a platform switch and a per-workspace allow-list (owner decisions 2026-10-05, 2026-10-06)

WaDesk supports the unofficial WhatsApp engine (personal numbers over Baileys, channel kind `whatsapp_qr`, the `devices` table, the Node bridge) as a
first-class sender. **We disable it by owner decision.** Only the official route (Meta Cloud API / WABA, directly or through a BSP of the provider
registry) is supported now. The engine stays in the code, **default OFF**, and only a platform super admin can turn it on in the admin console.
Status: `intended`. Runbook: [whatsapp-unofficial-switch.md](../../runbooks/whatsapp-unofficial-switch.md).

**Two levels (2026-10-06).** The engine is not open to all workspaces: a workspace has access only when the platform switch is ON **and** the workspace is on
the allow-list `unofficial_whatsapp_workspaces` (migration `20261103090000`; `org_id` PK, `enabled_at`, `enabled_by_operator_id`, `note`; a tenant may read only
its own row, only the privileged flag writes). No row means off, nothing is inserted, platform-owned workspaces get no special treatment. The platform switch
stays the global kill-switch. `UnofficialWhatsappGate` has `isEnabledFor(orgId)` / `assertEnabledFor(orgId)` (platform on AND allowed, allow-list cached 5 s,
dropped at once on a write on that instance) and `enabledOrgIds()` (the allow-list when the platform switch is on, for sweeps that decide per row with
`org_id = ANY(...)`); `isEnabled()` / `assertEnabled()` answer the platform question only. Every site below that has an orgId (request or row) uses the
org-aware form; the bridge pull `GET /api/whatsapp-message-settings` has no workspace and follows the platform switch. Admin API (super admin only):
`GET /v2/platform/node-bridge/unofficial/workspaces`, `GET .../workspace-options`, `PUT .../workspaces/:orgUuid` `{ enabled, note? }`, audited as
`platform.whatsapp_unofficial.workspace_enabled` / `workspace_disabled`; `GET /v2/platform/node-bridge` carries `unofficialWorkspaceCount`.

- **The platform switch.** `platform_settings` key `wa.unofficial.enabled` (JSON boolean, a missing row is OFF), read through `UnofficialWhatsappSwitch`
  (`modules/auth/platform/unofficial-whatsapp-switch.ts`, injected by the `UNOFFICIAL_WHATSAPP_GATE` token from `modules/auth/unofficial-whatsapp.port.ts`),
  5 s snapshot cache of `PlatformSettingsService`.
- **API.** `GET /v2/platform/node-bridge` now carries `unofficialEnabled`; `PUT /v2/platform/node-bridge/unofficial` `{ enabled }` (super admin only) returns
  `{ unofficialEnabled }` and audits `platform.whatsapp_unofficial.updated` with `before` and `after`.
- **User actions are refused** with 422 `WA_UNOFFICIAL_DISABLED`: a broadcast, campaign or scheduled message that names a `baileys:` sender, saving a warmer
  profile for a device, choosing a device as the commerce "send from", every `DeviceControlService` action (QR, pairing code, disconnect, send, act, group), and
  a Baileys transport open. A blank provider and the workspace `default_engine` fall back to `waba` instead of `baileys`.
- **Background paths skip, never fail.** Existing rows are preserved and not sent: a due broadcast is not queued, a scheduled campaign is not started, a
  scheduled message goes back to `scheduled`, a running campaign is left to the stalled-run sweep that parks it as `scheduled`. They are picked up again when
  the switch is turned on (a one-off scheduled message that is then later than `SCHED_MAX_LATE_MINUTES` ends failed as missed, as after any outage).
  The worker opens and leases no socket, closes the ones it holds on the next pass, keeps the saved sessions, and logs once. `GET /api/whatsapp-message-settings`
  answers `{ success: false, disabled: true }`.
- **Read surfaces.** The inbox channel list hides `whatsapp_qr` channels (the rows, conversations and the adapter stay; a send on one fails non-retryable with
  `WA_UNOFFICIAL_DISABLED`); the sender pickers of broadcasts, scheduled messages, flows, WooCommerce automations, the warmer page and the store wizard list no
  devices; the dashboard devices card and the analytics devices panel return an empty list with `unofficialDisabled: true`.
- **Entitlements.** `GET /v2/billing/entitlements` appends the synthetic key `unofficial_whatsapp` only when the platform switch is on AND the workspace is on
  the allow-list (platform-owned workspaces included in the rule, no exemption). It is not a plan feature. The plan `devices` limit stays in the catalogue and keeps its value, but only applies while the switch is on.
- **Not enforced here.** The flow runtime sends through the channel dispatcher, so a flow on a `whatsapp_qr` channel ends its prompt as failed or skips a plain
  message with `WA_UNOFFICIAL_DISABLED` instead of being refused when the flow is saved (flows keep their `provider` stamp). There is no devices CRUD API yet
  (`blocked:` the devices domain): it must call `UnofficialWhatsappGate.assertEnabledFor(orgId)` when built.
- **Evidence.** `test/unit/node-bridge-runtime/unofficial-switch.spec.ts`, `test/e2e/node-bridge-runtime/unofficial-switch.e2e.spec.ts` (admin API, two-workspace
  enforcement, per-row due sweep, device runtime stopping one workspace's sockets), `test/integration/node-bridge-runtime/unofficial-workspaces-rls.spec.ts`.
  The e2e harness starts the older suites with the switch ON and every test workspace allowed (a test-only trigger on `organizations`); `unofficialWhatsapp:
'platform-only'` turns only the platform switch on, `false` leaves both off (the new spec).
