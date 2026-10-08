import { Injectable, type OnModuleInit } from '@nestjs/common';
import { EcomFlowShop } from '../../../../shopify-woocommerce';
import { FlowShopGate } from './shop-port';

/**
 * Hands the store domain's adapter to the shop node's gate when the app starts (WD-ECOM-036). The store domain is imported by the
 * flow runtime, so it cannot import the gate; this is the one place the two meet. `EcomFlowShop` matches `FlowShopPort` structurally,
 * and the compiler checks it here.
 */
@Injectable()
export class ShopGateBinder implements OnModuleInit {
  constructor(
    private readonly gate: FlowShopGate,
    private readonly ecom: EcomFlowShop,
  ) {}

  onModuleInit(): void {
    this.gate.use(this.ecom);
  }
}
