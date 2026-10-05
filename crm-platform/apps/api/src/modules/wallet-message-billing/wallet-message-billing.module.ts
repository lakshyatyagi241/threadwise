import { Module } from '@nestjs/common';
import { BspBillingEngineModule } from '../bsp-billing-engine';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { MessageBillingService } from './message-billing.service';
import { CreditPackagesService } from './credit-packages.service';
import { PlatformMarginsService } from './platform-margins.service';
import { BillingCurrencyService } from './billing-currency.service';
import { MetaRateCardService } from './meta-rate-card.service';
import { PlatformRatesService } from './platform-rates.service';
import { PlatformWalletController } from './platform-wallet.controller';
import { PlatformWalletService } from './platform-wallet.service';
import { RateCardService } from './rate-card.service';
import { WalletController } from './wallet.controller';
import { WalletExportService } from './wallet-export.service';
import { WalletGateService } from './wallet-gate.service';
import { WalletLedgerService } from './wallet-ledger.service';
import { WalletLogService } from './wallet-log.service';
import { WalletQueryService } from './wallet-query.service';
import { WalletSettingsService } from './wallet-settings.service';
import { WalletRepository } from './wallet.repository';

const SERVICES = [
  WalletRepository,
  WalletLogService,
  WalletSettingsService,
  RateCardService,
  WalletLedgerService,
  MessageBillingService,
  WalletGateService,
  WalletQueryService,
  WalletExportService,
  PlatformWalletService,
  PlatformRatesService,
  MetaRateCardService,
  BillingCurrencyService,
  PlatformMarginsService,
  CreditPackagesService,
];

const IMPORTS = [PlansCoreModule, PlatformSettingsModule, BspBillingEngineModule];

/**
 * The wallet and per-message billing (WD-WALLET): the ledger, the rate card, delivery-time settlement, the launch gate, the
 * customer's wallet and statement, and the operator's pricing and wallet console. Registered in app.module.ts; the
 * delivery subscriber, the notification consumer and the reconciliation job live in the worker module below.
 */
@Module({
  imports: IMPORTS,
  controllers: [WalletController, PlatformWalletController],
  providers: SERVICES,
  exports: [
    WalletLedgerService,
    MessageBillingService,
    WalletGateService,
    WalletSettingsService,
    RateCardService,
    BillingCurrencyService,
  ],
})
export class WalletMessageBillingModule {}
