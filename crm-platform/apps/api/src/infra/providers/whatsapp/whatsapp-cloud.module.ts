import { Module } from '@nestjs/common';
import { FetchGraphHttp, GRAPH_HTTP, type GraphHttp } from './graph-http';
import { graphApiConfig } from './graph-api.config';
import {
  INBOUND_MEDIA_FETCHER,
  OUTBOUND_MEDIA_UPLOADER,
  WhatsappMediaModule,
  type InboundMediaFetcher,
  type OutboundMediaUploader,
} from './media';
import { MetaCloudChannelAdapter } from './meta-cloud-channel.adapter';
import { MetaGraphClient } from './meta-graph.client';
import { WHATSAPP_PROVIDER_RESOLVER, type WhatsAppProviderResolver } from './whatsapp-provider.resolver';

/**
 * The WhatsApp channel adapter, built from its parts: the HTTP seam (`GRAPH_HTTP`, replaceable in a test), the Graph client, the
 * provider resolver (global, bound by `WhatsappProviderResolverModule`) and the two media ports (bound by `WhatsappMediaModule`).
 * The channel providers module registers the adapter under `CHANNEL_ADAPTERS`; nothing else needs to know this class exists.
 */
@Module({
  imports: [WhatsappMediaModule],
  providers: [
    { provide: GRAPH_HTTP, useFactory: (): GraphHttp => new FetchGraphHttp() },
    {
      provide: MetaGraphClient,
      inject: [GRAPH_HTTP],
      // Timeouts are read per call, so a test (or an operator) can change them without rebuilding the app.
      useFactory: (http: GraphHttp) =>
        new MetaGraphClient(
          http,
          () => graphApiConfig().sendTimeoutMs,
          () => graphApiConfig().readTimeoutMs,
        ),
    },
    {
      provide: MetaCloudChannelAdapter,
      inject: [MetaGraphClient, WHATSAPP_PROVIDER_RESOLVER, OUTBOUND_MEDIA_UPLOADER, INBOUND_MEDIA_FETCHER],
      useFactory: (
        graph: MetaGraphClient,
        resolver: WhatsAppProviderResolver,
        up: OutboundMediaUploader,
        down: InboundMediaFetcher,
      ) => new MetaCloudChannelAdapter(graph, resolver, up, down),
    },
  ],
  exports: [MetaCloudChannelAdapter, MetaGraphClient, GRAPH_HTTP],
})
export class WhatsappCloudModule {}
