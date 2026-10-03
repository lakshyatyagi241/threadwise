import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RolesPermissionsModule } from '../roles-permissions';
import { WabaModule } from '../whatsapp-cloud-api-waba';
import { WhatsAppProviderRegistryModule } from '../whatsapp-provider-registry';
import { ProviderAssignmentsService } from './provider-assignments.service';
import { ProviderInfoController } from './provider-info.controller';
import { ProviderInfoService } from './provider-info.service';
import { ProviderSwitchService } from './provider-switch.service';
import { WhatsappProvidersController } from './whatsapp-providers.controller';
import { WhatsappProvidersService } from './whatsapp-providers.service';

/**
 * The operator API of the WhatsApp provider registry (`/v2/platform/whatsapp-providers`) and the tenant-safe provider info
 * (`/v2/waba/provider-info`). The registry's read side (resolver, store) is `WhatsAppProviderRegistryModule`; moving a number is the
 * WABA module's (`WabaConnectService.moveToProvider`). HTTP app only: nothing here runs in the worker.
 */
@Module({
  imports: [WhatsAppProviderRegistryModule, WabaModule, RolesPermissionsModule],
  controllers: [WhatsappProvidersController, ProviderInfoController],
  providers: [
    CryptoService,
    WhatsappProvidersService,
    ProviderAssignmentsService,
    ProviderSwitchService,
    ProviderInfoService,
  ],
})
export class WhatsAppProviderAdminModule {}
