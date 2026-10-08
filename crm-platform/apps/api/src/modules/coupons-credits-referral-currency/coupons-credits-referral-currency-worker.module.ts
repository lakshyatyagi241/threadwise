import { Module } from '@nestjs/common';
import { CouponsCreditsReferralCurrencyModule } from './coupons-credits-referral-currency.module';
import {
  ReferralAttributionConsumer,
  ReferralCodeConsumer,
  ReferralRewardConsumer,
} from './referral.consumers';

/**
 * The referral programme's background half: the three outbox consumers (issue a code at sign-up, record an attribution, pay the
 * referrer on the first paid order). Imported ONLY by WorkersModule; the HTTP app never drains events.
 */
@Module({
  imports: [CouponsCreditsReferralCurrencyModule],
  providers: [ReferralCodeConsumer, ReferralAttributionConsumer, ReferralRewardConsumer],
})
export class CouponsCreditsReferralCurrencyWorkerModule {}
