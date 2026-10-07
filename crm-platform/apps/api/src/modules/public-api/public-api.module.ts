import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CrmModule } from '../crm';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { ApiKeyAccessModule } from './api-key-access.module';
import { ApiKeyGuard } from './api-key.guard';
import { PublicApiController } from './public-api.controller';
import { PublicApiService } from './public-api.service';

/**
 * External API surface for signed partner keys (`/public/v1`). The customer REST API (`/api/v1`, bearer keys, the Developers console)
 * is `DeveloperRestApiV1Module`; both share `ApiKeyAccessService` (rate limit, plan feature, last use).
 */
@Module({
  imports: [CrmModule, PlansCoreModule, ApiKeyAccessModule],
  controllers: [PublicApiController],
  providers: [PublicApiService, ApiKeyGuard, CryptoService],
  exports: [PublicApiService],
})
export class PublicApiModule {}
