import { Module } from '@nestjs/common';
import { WalletMessageBillingWorkerModule } from '../wallet-message-billing';
import { ReferralCodeService } from './referral-code.service';
import { ReferralConsumer } from './referral.consumer';
import { ReferralService } from './referral.service';

/**
 * The referral program's background half. Imported ONLY by WorkersModule: the consumer registers itself with the kernel's
 * OutboxSubscriberRegistry, which the drain loop in the worker fans events out to (see WalletMessageBillingWorkerModule).
 */
@Module({
  imports: [WalletMessageBillingWorkerModule],
  providers: [ReferralCodeService, ReferralService, ReferralConsumer],
})
export class CouponsCreditsReferralCurrencyWorkerModule {}
