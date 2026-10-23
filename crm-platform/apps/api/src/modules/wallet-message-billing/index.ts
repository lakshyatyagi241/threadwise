/**
 * Public surface of the wallet and per-message billing domain. Other modules (payment fulfilment, referrals, the send pipelines)
 * import from here, never from the files behind it.
 *
 *   WalletLedgerService      credit or debit a workspace's wallet inside the caller's transaction, idempotent on a key
 *   MessageBillingService    settleDelivered / settleFailed, for a caller that already knows the provider message id
 *   UsageBillingService      settle / settleFailed / assertCanAfford for everything that is not a WhatsApp message (SMS, email, calls, AI...)
 *   WalletGateService        assertCanLaunch: the bulk-send precheck
 *   WalletSettingsService    the platform's wallet economics (flat price, referral reward, switches)
 *
 * Channels do not call the billing service: they emit `message.delivery_reported` (see MESSAGE_DELIVERY_EVENT in the
 * contracts) through the outbox and the worker settles it.
 */
export { WalletMessageBillingModule } from './wallet-message-billing.module';
export { WalletMessageBillingWorkerModule } from './wallet-message-billing-worker.module';
export { WalletLedgerService, type PostEntry, type PostResult } from './wallet-ledger.service';
export {
  MessageBillingService,
  type SettleDelivered,
  type SettleOutcome,
} from './message-billing.service';
export { UsageBillingService, type SettleUsage, type UsageOutcome } from './usage-billing.service';
export { UsageSettingsService } from './usage-settings.service';
export { billedMinutes } from './usage-rules';
export { aiCostUsd, type AiCostInput } from './ai-cost';
export { AiChargeService } from './ai-charge.service';
export { WalletGateService, type LaunchRequest, type SendRequest } from './wallet-gate.service';
export { WalletSettingsService } from './wallet-settings.service';
export { countryOfPhone } from './phone-country';
export { RateCardService } from './rate-card.service';
export { BillingCurrencyService } from './billing-currency.service';
export { WalletQueryService } from './wallet-query.service';
