/**
 * Public surface of the platform payment gateways domain. The driver library (TW-PAYGW-048) is exported from
 * infra/providers/platform-payment-gateways; this barrel carries the module for app.module.ts.
 */
export { PlatformPaymentGatewaysModule } from './paygw.module';
export { GatewayService } from './gateway.service';
