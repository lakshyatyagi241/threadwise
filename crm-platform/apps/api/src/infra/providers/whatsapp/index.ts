/**
 * Public surface of the WhatsApp provider code. The platform's one WhatsApp client (`WabaHttp`) and its ports live in
 * `../whatsapp-cloud-api-waba`; what is here is the Cloud API provider (`MetaCloudProvider`, `whatsapp.port`) and the inbox's channel
 * adapter over it (normalisers, error table, health rules, media pipeline).
 */
export { WhatsappCloudModule } from './whatsapp-cloud.module';
export {
  MetaCloudChannelAdapter,
  PROVIDER_CREDENTIALS_REJECTED,
} from './meta-cloud-channel.adapter';
export {
  META_ERROR_RULES,
  META_FAILURE,
  classifyMetaCode,
  describeMetaError,
  metaFailure,
} from './meta-errors';
export { normaliseMetaWebhook } from './meta-inbound';
export { buildMessageBody } from './meta-outbound';
export { buildHealth } from './meta-health';
