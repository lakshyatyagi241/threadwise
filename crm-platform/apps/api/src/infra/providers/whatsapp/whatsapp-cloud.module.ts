import { Module } from '@nestjs/common';
import { WABA_ADMIN, type WabaAdminPort } from '../whatsapp-cloud-api-waba/waba-admin.port';
import { WabaHttp } from '../whatsapp-cloud-api-waba/waba-http';
import {
  INBOUND_MEDIA_FETCHER,
  OUTBOUND_MEDIA_UPLOADER,
  WhatsappMediaModule,
  type InboundMediaFetcher,
  type OutboundMediaUploader,
} from './media';
import { MetaCloudChannelAdapter } from './meta-cloud-channel.adapter';
import { OUTBOUND_SEND_GUARD, type OutboundSendGuard } from './send-guard.port';

/**
 * The WhatsApp channel adapter, built from its parts: the platform's one WhatsApp client (`WabaHttp`) and account port (`WABA_ADMIN`),
 * both global from `WabaProvidersModule`; the pre-send guard (`OUTBOUND_SEND_GUARD`, global from the auth domain's `SendGuardModule`:
 * only its outgoing footer is used here, the halt and the content screen run in the dispatcher); and the two media ports, bound by
 * `WhatsappMediaModule`. The channel providers module registers the adapter under `CHANNEL_ADAPTERS`; nothing else needs to know this
 * class exists.
 */
@Module({
  imports: [WhatsappMediaModule],
  providers: [
    {
      provide: MetaCloudChannelAdapter,
      inject: [
        WabaHttp,
        WABA_ADMIN,
        OUTBOUND_SEND_GUARD,
        OUTBOUND_MEDIA_UPLOADER,
        INBOUND_MEDIA_FETCHER,
      ],
      useFactory: (
        http: WabaHttp,
        admin: WabaAdminPort,
        guard: OutboundSendGuard,
        up: OutboundMediaUploader,
        down: InboundMediaFetcher,
      ) => new MetaCloudChannelAdapter(http, admin, guard, up, down),
    },
  ],
  exports: [MetaCloudChannelAdapter],
})
export class WhatsappCloudModule {}
