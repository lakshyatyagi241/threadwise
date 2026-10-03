/** Public surface of the WhatsApp Cloud provider code (adapter, Graph client, normalisers, error table). */
export { WhatsappCloudModule } from './whatsapp-cloud.module';
export { MetaCloudChannelAdapter } from './meta-cloud-channel.adapter';
export { MetaGraphClient, type MetaCtx } from './meta-graph.client';
export { graphApiConfig, DEFAULT_GRAPH_VERSION, type GraphApiConfig } from './graph-api.config';
export { GRAPH_HTTP, GraphTransportError, FetchGraphHttp, type GraphHttp, type GraphRequest, type GraphResponse } from './graph-http';
export { META_ERROR_RULES, META_FAILURE, classifyMetaCode, describeMetaError, metaFailure } from './meta-errors';
export { normaliseMetaWebhook } from './meta-inbound';
export { buildMessageBody } from './meta-outbound';
export { buildHealth } from './meta-health';
export { verifyMetaSignature } from './meta-signature';
export {
  META_DIRECT_PROVIDER_KEY,
  StaticMetaDirectResolver,
  WHATSAPP_PROVIDER_RESOLVER,
  providerRoot,
  type ChannelProviderRef,
  type HeaderContext,
  type ResolvedWhatsAppProvider,
  type WhatsAppCredentialMode,
  type WhatsAppProviderCapabilities,
  type WhatsAppProviderResolver,
  type WhatsAppWebhookScheme,
} from './whatsapp-provider.resolver';
export { WhatsappProviderResolverModule, type WhatsappProviderResolverOptions } from './whatsapp-provider-resolver.module';
export { verifyDelivery } from './meta-signature';
