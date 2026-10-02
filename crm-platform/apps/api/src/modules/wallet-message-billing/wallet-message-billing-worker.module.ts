import { Module } from '@nestjs/common';
import { BspBillingEngineModule } from '../bsp-billing-engine';
import { NotificationsRepository } from '../notifications';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { DeliveryBillingConsumer } from './delivery.consumer';
import { MessageBillingService } from './message-billing.service';
import { PlatformRatesService } from './platform-rates.service';
import { PlatformWalletService } from './platform-wallet.service';
import { RateCardService } from './rate-card.service';
import { WalletReconcileJob } from './reconcile.job';
import { WalletLedgerService } from './wallet-ledger.service';
import { WalletLogService } from './wallet-log.service';
import { WalletNotificationsConsumer } from './wallet-notifications.consumer';
import { WalletSettingsService } from './wallet-settings.service';
import { WalletRepository } from './wallet.repository';

/**
 * The wallet's background half. Imported ONLY by WorkersModule: the subscribers register themselves with the kernel's
 * OutboxSubscriberRegistry, which the drain loop in the worker process fans events out to, and the reconciliation job runs on the
 * worker's scheduler. An HTTP pod that also did this would multiply the polling and double every notification attempt.
 */
@Module({
  imports: [PlansCoreModule, PlatformSettingsModule, BspBillingEngineModule],
  providers: [
    WalletRepository,
    WalletLogService,
    WalletSettingsService,
    RateCardService,
    WalletLedgerService,
    MessageBillingService,
    PlatformWalletService,
    PlatformRatesService,
    NotificationsRepository,
    DeliveryBillingConsumer,
    WalletNotificationsConsumer,
    WalletReconcileJob,
  ],
})
export class WalletMessageBillingWorkerModule {}
