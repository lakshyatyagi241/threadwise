# Wiring map: node-bridge-runtime (NODE)

Read with [the inventory entry](../inventory/node-bridge-runtime.md). One row per feature: where it lives in Reference, what feeds it, what
consumes it, and where it lands in our code. `built` = in this repo and tested; `blocked:<id>` = waits on a feature another domain owns;
`intended` = deliberately different (reason in [parity/node-bridge-runtime.md](../parity/node-bridge-runtime.md)).

Only the slice built so far is mapped. The other NODE features (socket lifecycle, inbound, sends, schedules, flows) get their rows when they
are started.

## Storage: one copy of the address and token

| Setting           | Reference                                                                                   | Ours                                                                                               | Written by                 | Read by                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| Bridge address    | `system_settings.baileys_server_url`, `.env SERVER_URL`                                  | `platform_settings` key `inst.node_bridge` (`serverUrl`, `port`, `_rv`)                            | install wizard (INST), 052 | `InstallSettingsService.nodeBridge()`, `NodeBridgeSettingsService.target()`, health card   |
| Shared token      | `system_settings.node_webhook_token` (encrypted), `.env NODE_WEBHOOK_TOKEN`, node `.env` | `platform_settings` secret `inst.node_bridge.token`; `NODE_WEBHOOK_TOKEN` env is the fallback      | install wizard (INST), 052 | `NodeTokenGuard`, test connection, health card                                             |
| Pacing (4 values) | `system_settings` `msg_gap`, `batches_gap`, `bw_msg_gap`, `enable_batches`               | `platform_settings` key `node.pacing` (`msgGap`, `batchesGap`, `bwMsgGap`, `enableBatches`, `_rv`) | 029 (Update timing)        | `GET /api/whatsapp-message-settings` (the bridge); the send pipeline when SCHED/BCAST land |

## Rows

| Id          | Feature                             | Reference route / source                                               | Permission                             | Feeds it                      | Consumers                                                                                        | Status  |
| ----------- | ----------------------------------- | ------------------------------------------------------------------- | -------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------ | ------- |
| TW-NODE-052 | Node bridge settings and test       | `admin.settings.node.update`, `admin.settings.node.test`            | operator: any reads, super admin saves | install wizard step 6 (INST)  | health card (TW-DASH-048), token guard, `InstallSettingsService.nodeBridge()`                    | built   |
| TW-NODE-029 | Admin pacing ("Update timing")      | `admin.settings.pacing.update`, `GET api/whatsapp-message-settings` | super admin saves; bridge token pulls  | operator form                 | the bridge pull; `blocked:TW-NODE-022..038` for the send-side jitter, batching and daily cap     | partial |
| TW-NODE-002 | Shared-secret auth                  | `node_token()`, `hash_equals` on every Node-facing route            | `X-Node-Token`                         | 052, `NODE_WEBHOOK_TOKEN` env | `NodeTokenGuard` on `GET /api/whatsapp-message-settings`; every later bridge-facing route        | partial |
| TW-NODE-004 | Health and status endpoints         | bridge `/`, `/health`; Laravel `Admin/HealthController::checkNode`  | none (bridge), operator (health card)  | the bridge process            | the console health card now reads the saved address and token                                    | partial |
| TW-NODE-001 | Bridge process, entrypoints, config | `node/index.js`, `node/.env`                                        | none                                   | installer                     | `blocked:decision E`: no bridge process exists in this repo yet; its env keys are covered by 052 | blocked |

## Our code

| Layer     | Where                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts | `packages/contracts/src/node-bridge-runtime/index.ts`                                                                                   |
| API       | `apps/api/src/modules/node-bridge-runtime/` (settings service, operator controller, internal controller, token guard)                   |
| Provider  | `apps/api/src/infra/providers/node-bridge-runtime/node-bridge.probe.ts`                                                                 |
| Web       | `apps/web/src/features/node-bridge-runtime/`, route `/admin/node-bridge`, menu entry via `operator-nav.ts`                              |
| Tests     | `apps/api/test/e2e/node-bridge-runtime/node-bridge.e2e.spec.ts` (18), `apps/web/src/features/node-bridge-runtime/lib/draft.test.ts` (3) |

## Media fetch safety (TW-NODE-028)

| Rule                                                   | Where                                                                                 | Notes                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Blocked address ranges, every resolved address checked | `infra/providers/node-bridge-runtime/safe-fetch.ts` (`isBlockedAddress`, `SafeFetch`) | adds multicast/reserved and IPv4-mapped forms                                                              |
| Redirects: max 3, each hop re-checked                  | same                                                                                  | Reference checked the first hop only (a bypass); fixed, see parity notes                                      |
| Local file paths                                       | not accepted                                                                          | Reference allowed a read allow-list (`MEDIA_READ_BASES`); media comes from a URL or storage, see parity notes |
| MIME and extension                                     | same (`resolveMime`, `extensionFor`)                                                  | server type, then extension, then `application/octet-stream`; default `.jpg`                               |
| `assertHttpsMedia` (broadcast pipeline)                | BCAST `template-guards.ts`                                                            | already ported there                                                                                       |
| Inline `attachment_base64`                             | with TW-NODE-023                                                                      | consumer of `SafeFetch`; not built yet                                                                     |

## How the other NODE features map to our architecture

| Group                                | Features                                                                     | Where it lives or what happens                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collapses, nothing to build          | 003, 005, 026                                                                | CORS and body limits exist in `main.ts`; in-memory registry becomes Redis leases and BullMQ jobs; engine and credentials come from the device row |
| Already built in BCAST               | 029 (jitter, daily cap, lease), 037, 038, 014 (tick), 027 (Cloud API sender) | `apps/api/src/modules/broadcasts`; the Baileys and Twilio engine adapters are the missing piece                                                   |
| Needs the socket runtime (`baileys`) | 007-013, 016-025, 021, 020                                                   | waits for the dependency PR and TW-NODE-011                                                                                                       |
| Scheduler                            | 030-036                                                                      | SCHED domain on BullMQ                                                                                                                            |
| Collapses into the owning domain     | 019, 041-051                                                                 | flows (FLR), calling (CALL), Google (INTG), commerce and booking (CHK, APPT), channels; built there, not as bridge endpoints                      |
| Not ported                           | 039, 053, 054                                                                | dead code in Reference, developer-only endpoint, smoke scripts                                                                                       |

## Scheduled messages (TW-NODE-030 to 036)

| Piece                      | Where                                                             | Notes                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Schedule rows              | `scheduled_messages`, `scheduled_message_contacts`                | created by the SCHED screens (not built yet); the engine reads and updates them                                       |
| Due poller, reconciliation | `scheduled-due.service.ts` (worker)                               | every 3 s; queues due rows, resumes system pauses, queues a stuck run again                                           |
| Run                        | `scheduled-run.processor.ts`, `scheduled-run.service.ts` (worker) | queue `sched-run`; shares BCAST's pacing, daily cap and one-run-per-number lease                                      |
| Lifecycle                  | `scheduler.service.ts` (API and worker)                           | pause, resume, cancel, send-now; callers: SCHED screens, appointment reminders                                        |
| Outbound port              | `node-bridge-runtime/outbound/`                                   | `SendCommand`, `OutboundRegistry`, `SenderResolver`, Cloud API text transport; Baileys and Twilio register when built |
| Settings                   | `config/domains/scheduled-queue-warmer.env.ts`                    | `SCHED_MAX_LATE_MINUTES` (60), `SCHED_STALE_RUN_MINUTES` (10)                                                         |
