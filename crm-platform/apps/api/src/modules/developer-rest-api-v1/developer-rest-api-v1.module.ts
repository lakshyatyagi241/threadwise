import { Module, type OnModuleInit } from '@nestjs/common';
import { registerProblemRenderer } from '../../common/filters/problem-exception.filter';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { PublicApiModule } from '../public-api';
import { BearerApiKeyGuard } from './auth/bearer-api-key.guard';
import { ApiV1DocsController } from './docs/api-v1-docs.controller';
import { ApiV1DocsService } from './docs/api-v1-docs.service';
import { renderV1Error, V1_PATH_PREFIX } from './http/v1-error-renderer';
import { ApiKeysController } from './keys/api-keys.controller';
import { ApiKeysRepository } from './keys/api-keys.repository';
import { ApiKeysService } from './keys/api-keys.service';
import { V1AutomationModule } from './resources/automation/automation.module';
import { V1BulkModule } from './resources/bulk/bulk.module';
import { V1CrmModule } from './resources/crm/crm.module';
import { V1MessagingModule } from './resources/messaging/messaging.module';

/**
 * The customer REST API (API domain): the Developers console's keys for staff (`/v2/developer/keys`) and the bearer-key API at
 * `/api/v1` that WaDesk customers call. Registered in app.module.ts.
 *
 * The signed partner surface (`/public/v1`, `PublicApiModule`) is a separate scheme over the same `api_keys` table and shares its rate
 * limit, plan-feature check and last-use bookkeeping through `ApiKeyAccessService`. Resources live in the four groups below so each can
 * be built and tested on its own; every resource controller is written with `@V1Controller('<path>')`.
 */
@Module({
  imports: [
    PlansCoreModule,
    PlatformSettingsModule,
    PublicApiModule,
    V1CrmModule,
    V1AutomationModule,
    V1BulkModule,
    V1MessagingModule,
  ],
  controllers: [ApiKeysController, ApiV1DocsController],
  providers: [ApiKeysRepository, ApiKeysService, BearerApiKeyGuard, ApiV1DocsService],
  exports: [ApiKeysService, ApiV1DocsService],
})
export class DeveloperRestApiV1Module implements OnModuleInit {
  /** `/api/v1` clients get WaDesk's `{ error: { code, message } }` envelope, whatever raised the error (a guard, a pipe, the router). */
  onModuleInit(): void {
    registerProblemRenderer(V1_PATH_PREFIX, renderV1Error);
  }
}
