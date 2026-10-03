# Shims

Stand-ins for services other domains own and have not built yet. Each is an interface plus a default implementation
that reads the tables the Reference schema migrations already created. When the owning domain exports the real service,
bind it to the same token in `broadcasts.module.ts` and delete the shim.

| Shim                                               | Real owner (TW domain)                                                                 | Used by           | Tracker row            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------- | ---------------------- |
| `SenderDirectory`                                  | whatsapp-devices-baileys / whatsapp-cloud-api-waba (`WorkspaceEngine`)                 | TW-BCAST-009, 014 | blocked on WADEV, WABA |
| `TemplateDirectory`                                | message-templates (TPL)                                                                | TW-BCAST-012      | blocked on TPL         |
| `WarmerGate`                                       | scheduled-queue-warmer (`WarmerService`)                                               | TW-BCAST-013      | blocked on SCHED       |
| `BroadcastPlanGate`                                | plans-subscriptions-trials (feature flag `broadcast` is not in the plan catalogue yet) | TW-BCAST-009      | blocked on PLAN        |
| `BroadcastInboxMirrorService` (not behind a token) | team-inbox (TIB1) `MessageMirror`                                                      | TW-BCAST-028      | blocked on TIB1        |

`WalletGate` is no longer a shim: `_shims/wallet-gate.ts` binds the token to wallet-message-billing's `WalletGateService.assertCanLaunch` (TW-WALLET-013). It is shared with campaigns (`source: 'campaign'`). The interface stays so callers do not import the wallet domain.
