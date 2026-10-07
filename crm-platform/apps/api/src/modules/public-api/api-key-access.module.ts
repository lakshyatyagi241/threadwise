import { Global, Module } from '@nestjs/common';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { ApiKeyAccessService } from './api-key-access.service';

/**
 * Global on purpose: `ApiKeyGuard` is a provider of every module whose controller uses `@UseGuards(ApiKeyGuard)` (flows, ordering, the
 * partner API), and each of those must be able to resolve what the guard needs without importing this module by hand.
 */
@Global()
@Module({
  imports: [PlansCoreModule],
  providers: [ApiKeyAccessService],
  exports: [ApiKeyAccessService],
})
export class ApiKeyAccessModule {}
