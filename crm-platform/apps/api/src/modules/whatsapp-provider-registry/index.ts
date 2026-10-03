/** Public surface of the WhatsApp provider registry (read side). Other domains import only from here. */
export { WhatsAppProviderRegistryModule } from './whatsapp-provider-registry.module';
export {
  WhatsAppProviderResolver,
  openProvider,
  type NewNumberRoute,
} from './whatsapp-provider-resolver';
export {
  ProviderStore,
  CONNECTION_PROVIDER_KEY,
  type ProviderRow,
  type ProviderPatch,
  type NewProviderRow,
  type NumberRow,
  type AssignmentRow,
} from './provider-store';
export {
  chooseNewNumberProvider,
  credentialStates,
  last4,
  mergeSecrets,
  redactSecrets,
  safeTestPath,
  type NewNumberChoice,
  type ProviderSecrets,
  type RouteSource,
} from './provider-rules';
export {
  META_SIGNATURE_HEADER,
  verifyPayloadProviders,
  verifyProviderDelivery,
  type Delivery,
  type DeliveryProvider,
  type SchemeVerdict,
} from './webhook-scheme';
