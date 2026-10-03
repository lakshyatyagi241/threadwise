import { Module } from '@nestjs/common';
import { INBOUND_MEDIA_FETCHER } from './inbound-media-fetcher.port';
import { OUTBOUND_MEDIA_UPLOADER } from './outbound-media-uploader.port';
import { WhatsappInboundMediaFetcher } from './whatsapp-inbound-media.fetcher';
import { WhatsappOutboundMediaUploader } from './whatsapp-outbound-media.uploader';

/**
 * The WhatsApp media ports, bound: `INBOUND_MEDIA_FETCHER` (copy a customer's file into the store) and `OUTBOUND_MEDIA_UPLOADER` (get a
 * stored file to WhatsApp before sending). Import it wherever the Meta channel adapter is built. Injected and not imported here:
 * `ChatMediaStore` (global, from `ChatMediaModule`), the Redis client (global) and `WabaHttp` (global, from `WabaProvidersModule`: the
 * platform's one WhatsApp client, which knows the Meta and Interakt routes).
 */
@Module({
  providers: [
    WhatsappInboundMediaFetcher,
    WhatsappOutboundMediaUploader,
    { provide: INBOUND_MEDIA_FETCHER, useExisting: WhatsappInboundMediaFetcher },
    { provide: OUTBOUND_MEDIA_UPLOADER, useExisting: WhatsappOutboundMediaUploader },
  ],
  exports: [INBOUND_MEDIA_FETCHER, OUTBOUND_MEDIA_UPLOADER],
})
export class WhatsappMediaModule {}
