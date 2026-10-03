# Wiring map: wallet-message-billing (WALLET)

| Row | Where | Status |
|---|---|---|
| Wallet tab / statement / CSV | web `/billing/wallet`, `/billing/wallet/statement`; API `/v2/wallet/*`; keys `wallet.balance.read`, `wallet.statement.read`, `wallet.statement.export` | built |
| Balance chip | `useWalletBalance` / `WalletBalanceChip`; server pushes `wallet.updated` on the org room, poll as fallback | built |
| Price panel on templates | `MessagePricingPanel` exported; the templates screen (TPL) must mount it | exported, mount **blocked on TPL** |
| Top-up credit | PAYGW `FulfilmentService` -> `WalletLedgerService.post` (key `order:<uuid>`) | built |
| Referral payout (TW-030) | CPN calls `WalletLedgerService.post({type:'earn', source:'referral.paid'})` | API ready, caller **blocked on CPN** |
| Settle points (TW-012) | each channel emits `message.delivery_reported`; consumer in worker | consumer built; emitters **blocked on WABA, NODE, CHAT, BCAST, CAMP, SCHED, FLR, SMS** |
| Launch gate (TW-013) | `WalletGateService.assertCanLaunch`; broadcasts/campaigns bind it in place of their `WalletGate`/`CampaignBilling` shims | service built, binding **blocked on BCAST/CAMP owners** |
| Scheduled poller filter (TW-013 rule 6) | SCHED | **blocked on SCHED** |
| Low-balance alert | outbox `wallet.low_balance` -> in-app notification to Owners (`WalletNotificationsConsumer`); email/Slack copies by NOTIF preferences | in-app built |
| Billing mode | `BillingModeService.isPayPerMessage` (BSP) + switch `billing.pay_per_message` | built |
| Reseller P&L | reads `usage_charges`, `message_rates.meta_cost_minor`, `wallets` | compatible |
| Mobile/extension wallet API (TW-025..029) | `GET /v2/wallet/snapshot`, ledger, PAYGW top-up orders | built; MOB/EXT call these when they exist |
| Credit packages (TW-019) | `/v2/platform/wallet/packages`, web `/admin/wallet/packages` | built (catalogue) |
| Credit-package checkout / self-confirm (TW-017/018) | not ported: see parity file | wontfix |
| Margin pricing | `wallet.pricing_mode`, `plan_message_margins`, `workspace_message_margins`; read by `RateCardService` on every settlement and the price panel | built |
| Settings | `wallet.economics` (flat price, referral reward, alert threshold, launch coverage), `wallet.per_country_enabled`, `billing.pay_per_message`; all have readers | built |
