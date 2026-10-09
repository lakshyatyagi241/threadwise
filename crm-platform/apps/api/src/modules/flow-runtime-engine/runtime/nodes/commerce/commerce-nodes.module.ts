import { Module } from '@nestjs/common';
import { AppointmentsBookingModule } from '../../../../appointments-booking';
import { CatalogProductsModule } from '../../../../catalog-products';
import { MessageTemplatesModule } from '../../../../message-templates';
import { ShopifyWoocommerceModule } from '../../../../shopify-woocommerce';
import { FlowRefResolver } from '../flow-refs';
import { BookNode } from './book-node';
import { CatalogShopAdapter } from './catalog-shop.adapter';
import { CommerceNodes } from './commerce-nodes';
import { FormNode } from './form-node';
import { FlowShopGate } from './shop-port';
import { ShopGateBinder } from './shop-binder';
import { ShopNode } from './shop-node';
import { WaFormRecords } from './wa-form-records';
import { TemplateNode } from './template-node';

/** Imports the domains this node group calls (their public modules only); never the flow runtime module (it imports this one). */
@Module({
  imports: [
    MessageTemplatesModule,
    AppointmentsBookingModule,
    ShopifyWoocommerceModule,
    CatalogProductsModule,
  ],
  providers: [
    CommerceNodes,
    TemplateNode,
    FlowRefResolver,
    BookNode,
    ShopNode,
    FormNode,
    FlowShopGate,
    ShopGateBinder,
    CatalogShopAdapter,
    WaFormRecords,
  ],
  // The gate is where a store domain binds its adapter; the form records are what the worker's resume listener writes through.
  exports: [CommerceNodes, FlowShopGate, WaFormRecords],
})
export class CommerceNodesModule {}
