# Shims

Stand-ins for services other domains own and have not built yet. Each is an interface plus a default implementation
that reads the tables the Reference schema migrations already created. When the owning domain exports the real service,
bind it to the same token in `broadcasts.module.ts` and delete the shim.

| Shim                | Real owner (TW domain)                                                                 | Used by           | Tracker row            |
| ------------------- | -------------------------------------------------------------------------------------- | ----------------- | ---------------------- |
| `SenderDirectory`   | whatsapp-devices-baileys / whatsapp-cloud-api-waba (`WorkspaceEngine`)                 | TW-BCAST-009, 014 | blocked on WADEV, WABA |
| `TemplateDirectory` | message-templates (TPL)                                                                | TW-BCAST-012      | blocked on TPL         |
| `WalletGate`        | wallet-message-billing (`SendGate` precheck)                                           | TW-BCAST-011      | blocked on WALLET      |
| `WarmerGate`        | scheduled-queue-warmer (`WarmerService`)                                               | TW-BCAST-013      | blocked on SCHED       |
| `BroadcastPlanGate` | plans-subscriptions-trials (feature flag `broadcast` is not in the plan catalogue yet) | TW-BCAST-009      | blocked on PLAN        |
