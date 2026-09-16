import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CrmModule } from '../crm';
import { ApiKeyGuard } from './api-key.guard';
import { PublicApiController } from './public-api.controller';
import { PublicApiService } from './public-api.service';

/**
 * External API surface.
 *
 * Still to land: API-key management endpoints for staff (create, rotate,
 * revoke, scope), per-scope route checks, and an OpenAPI document published
 * separately from the internal one.
 */
@Module({
  imports: [CrmModule],
  controllers: [PublicApiController],
  providers: [PublicApiService, ApiKeyGuard, CryptoService],
  exports: [PublicApiService],
})
export class PublicApiModule {}
