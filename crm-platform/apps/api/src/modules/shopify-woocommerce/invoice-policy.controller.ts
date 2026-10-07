import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { updateEcomInvoicePolicySchema, type UpdateEcomInvoicePolicyInput } from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { InvoicePolicyService } from './invoice-policy.service';

/** A store's invoicing policy, for the Invoices tab of both store types (TW-ECOM-035). */
@ApiTags('shopify', 'woocommerce')
@ActorKinds('user')
@Controller({ version: '2' })
export class InvoicePolicyController {
  constructor(private readonly policy: InvoicePolicyService) {}

  @Get('shopify/stores/:id/invoice-policy')
  @RequirePermission('ecom.read')
  @ApiOperation({
    summary: 'Whether the Shopify store’s orders are invoiced on their own, and on which event',
  })
  shopify(@Param('id', ParseUUIDPipe) id: string) {
    return this.policy.get('shopify', id);
  }

  @Put('shopify/stores/:id/invoice-policy')
  @Idempotent()
  @RequirePermission('ecom.connect')
  @ApiOperation({
    summary: 'Change the Shopify invoicing switch and trigger; what is left out stays',
    description:
      'Audited with the workspace’s invoice settings. 404 for another workspace’s store.',
  })
  saveShopify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateEcomInvoicePolicySchema)) body: UpdateEcomInvoicePolicyInput,
  ) {
    return this.policy.update('shopify', id, body);
  }

  @Get('woocommerce/stores/:id/invoice-policy')
  @RequirePermission('ecom.read')
  @ApiOperation({
    summary: 'Whether the WooCommerce store’s orders are invoiced on their own, and on which event',
  })
  woocommerce(@Param('id', ParseUUIDPipe) id: string) {
    return this.policy.get('woocommerce', id);
  }

  @Put('woocommerce/stores/:id/invoice-policy')
  @Idempotent()
  @RequirePermission('ecom.connect')
  @ApiOperation({
    summary: 'Change the WooCommerce invoicing switch and trigger; what is left out stays',
    description:
      'Audited with the workspace’s invoice settings. 404 for another workspace’s store.',
  })
  saveWoocommerce(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateEcomInvoicePolicySchema)) body: UpdateEcomInvoicePolicyInput,
  ) {
    return this.policy.update('woocommerce', id, body);
  }
}
