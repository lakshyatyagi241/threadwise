# Wiring map: node-bridge-runtime (NODE)

Read with [the inventory entry](../inventory/node-bridge-runtime.md). One row per feature: where it lives in WaDesk, what feeds it, what
consumes it, and where it lands in our code. `built` = in this repo and tested; `blocked:<id>` = waits on a feature another domain owns;
`intended` = deliberately different (reason in [parity/node-bridge-runtime.md](../parity/node-bridge-runtime.md)).

Only the slice built so far is mapped. The other NODE features (socket lifecycle, inbound, sends, schedules, flows) get their rows when they
are started.

## Storage: one copy of the address and token

| Setting                  | WaDesk                                                  | Ours                                                                                          | Written by                  | Read by                                                                               |
| ------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------- |
| Bridge address           | `system_settings.baileys_server_url`, `.env SERVER_URL` | `platform_settings` key `inst.node_bridge` (`serverUrl`, `port`, `_rv`)                       | install wizard (INST), 052  | `InstallSettingsService.nodeBridge()`, `NodeBridgeSettingsService.target()`, health card |
| Shared token             | `system_settings.node_webhook_token` (encrypted), `.env NODE_WEBHOOK_TOKEN`, node `.env` | `platform_settings` secret `inst.node_bridge.token`; `NODE_WEBHOOK_TOKEN` env is the fallback | install wizard (INST), 052  | `NodeTokenGuard`, test connection, health card                                       |
| Pacing (4 values)        | `system_settings` `msg_gap`, `batches_gap`, `bw_msg_gap`, `enable_batches` | `platform_settings` key `node.pacing` (`msgGap`, `batchesGap`, `bwMsgGap`, `enableBatches`, `_rv`) | 029 (Update timing)         | `GET /api/whatsapp-message-settings` (the bridge); the send pipeline when SCHED/BCAST land |

## Rows

| Id          | Feature                                | WaDesk route / source                                                 | Permission                            | Feeds it                          | Consumers                                                                                   | Status |
| ----------- | -------------------------------------- | --------------------------------------------------------------------- | ------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------- | ------ |
| WD-NODE-052 | Node bridge settings and test          | `admin.settings.node.update`, `admin.settings.node.test`              | operator: any reads, super admin saves | install wizard step 6 (INST)      | health card (WD-DASH-048), token guard, `InstallSettingsService.nodeBridge()`               | built  |
| WD-NODE-029 | Admin pacing ("Update timing")         | `admin.settings.pacing.update`, `GET api/whatsapp-message-settings`   | super admin saves; bridge token pulls | operator form                     | the bridge pull; `blocked:WD-NODE-022..038` for the send-side jitter, batching and daily cap | partial |
| WD-NODE-002 | Shared-secret auth                     | `node_token()`, `hash_equals` on every Node-facing route              | `X-Node-Token`                        | 052, `NODE_WEBHOOK_TOKEN` env     | `NodeTokenGuard` on `GET /api/whatsapp-message-settings`; every later bridge-facing route    | partial |
| WD-NODE-004 | Health and status endpoints            | bridge `/`, `/health`; Laravel `Admin/HealthController::checkNode`    | none (bridge), operator (health card) | the bridge process                | the console health card now reads the saved address and token                                | partial |
| WD-NODE-001 | Bridge process, entrypoints, config    | `node/index.js`, `node/.env`                                          | none                                  | installer                         | `blocked:decision E`: no bridge process exists in this repo yet; its env keys are covered by 052 | blocked |

## Our code

| Layer            | Where                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Contracts        | `packages/contracts/src/node-bridge-runtime/index.ts`                                                                              |
| API              | `apps/api/src/modules/node-bridge-runtime/` (settings service, operator controller, internal controller, token guard)              |
| Provider         | `apps/api/src/infra/providers/node-bridge-runtime/node-bridge.probe.ts`                                                            |
| Web              | `apps/web/src/features/node-bridge-runtime/`, route `/admin/node-bridge`, menu entry via `operator-nav.ts`                         |
| Tests            | `apps/api/test/e2e/node-bridge-runtime/node-bridge.e2e.spec.ts` (18), `apps/web/src/features/node-bridge-runtime/lib/draft.test.ts` (3) |
