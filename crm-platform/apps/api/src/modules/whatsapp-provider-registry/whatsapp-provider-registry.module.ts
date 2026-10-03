import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ProviderStore } from './provider-store';
import { WhatsAppProviderResolver } from './whatsapp-provider-resolver';

/**
 * The read side of the platform's WhatsApp provider registry: which provider a number is on and which one a new number gets. Imported by
 * the WABA module (connect, webhook) and by the operator API. The registry itself (`WabaRegistryRoutes`) lives in the global
 * `WabaProvidersModule`, so every sender sees what this module loads.
 */
@Module({
  providers: [CryptoService, ProviderStore, WhatsAppProviderResolver],
  exports: [ProviderStore, WhatsAppProviderResolver],
})
export class WhatsAppProviderRegistryModule {}
