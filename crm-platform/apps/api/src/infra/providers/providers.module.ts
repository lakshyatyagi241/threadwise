import { Global, Module } from '@nestjs/common';
import {
  FakeTelephonyProvider,
  GenericTelephonyProvider,
  TelephonyProviderRegistry,
} from './telephony';
import { WabaProvidersModule } from './whatsapp-cloud-api-waba/waba-providers.module';
import { MetaCloudProvider } from './whatsapp/meta-cloud.provider';
import { WHATSAPP_PROVIDER } from './whatsapp/whatsapp.port';

/**
 * External-service adapters.
 *
 * Bound to interface tokens, never injected by concrete class. Swapping Meta
 * Cloud for a BSP is a change in this file and nowhere else.
 */
@Global()
@Module({
  imports: [WabaProvidersModule],
  providers: [
    MetaCloudProvider,
    { provide: WHATSAPP_PROVIDER, useExisting: MetaCloudProvider },
    // Telephony vendors for the call logging framework; a vendor adapter is added to the registry (see docs/specs/call-logging.md).
    GenericTelephonyProvider,
    FakeTelephonyProvider,
    TelephonyProviderRegistry,
  ],
  exports: [WHATSAPP_PROVIDER, MetaCloudProvider, TelephonyProviderRegistry],
})
export class ProvidersModule {}
