import { Global, Module } from '@nestjs/common';
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
  providers: [MetaCloudProvider, { provide: WHATSAPP_PROVIDER, useExisting: MetaCloudProvider }],
  exports: [WHATSAPP_PROVIDER, MetaCloudProvider],
})
export class ProvidersModule {}
