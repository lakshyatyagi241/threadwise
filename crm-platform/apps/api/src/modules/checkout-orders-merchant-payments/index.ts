/**
 * Public surface of the checkout-orders-merchant-payments domain (CHK). Other domains import only from here.
 *
 * The shared workspace gateway: `WorkspaceGatewayResolver.resolve(orgId, storefrontId?)` says which gateway the store checkout or a
 * Sales invoice uses; `GatewayPaymentRegistry` is how a domain registers the settlement of the payments it issued.
 */
export { CheckoutOrdersMerchantPaymentsModule } from './checkout-orders-merchant-payments.module';
export {
  WorkspaceGatewayResolver,
  GATEWAY_HTTP,
  type ResolvedGateway,
  type ResolveOptions,
} from './gateways/workspace-gateway.resolver';
export {
  GatewayPaymentRegistry,
  type GatewayPaymentContext,
  type GatewayPaymentOutcome,
  type GatewayPaymentSettler,
} from './gateways/gateway-payment.registry';
export {
  GatewayLinkService,
  type HostedLink,
  type HostedLinkRequest,
} from './gateways/gateway-link.service';
export { StoreKeysMirror } from './gateways/store-keys-mirror.service';
export { chooseGateway, supportsPaymentLinks } from './gateways/gateway-rules';
