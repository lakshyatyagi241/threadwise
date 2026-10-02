import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { saveAutomationsSchema, type SaveAutomationsInput } from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AutomationsService } from './automations.service';

/** A store's automations (TW-ECOM-009, 033), for both store types. */
@ApiTags('shopify', 'woocommerce')
@ActorKinds('user')
@Controller({ version: '2' })
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Get('shopify/stores/:id/automations')
  @RequirePermission('ecom.read')
  @ApiOperation({
    summary: 'Every event the Shopify store can fire, with its automation (off when never set up)',
  })
  shopify(@Param('id', ParseUUIDPipe) id: string) {
    return this.automations.get('shopify', id);
  }

  @Put('shopify/stores/:id/automations')
  @Idempotent()
  @RequirePermission('ecom.automations.manage')
  @ApiOperation({
    summary: 'Save the Shopify store’s automations in one step',
    description:
      'Unknown event types are ignored. An automation that is on needs a template. `senderKey` is ignored.',
  })
  saveShopify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(saveAutomationsSchema)) body: SaveAutomationsInput,
  ) {
    return this.automations.save('shopify', id, body);
  }

  @Get('woocommerce/stores/:id/automations')
  @RequirePermission('ecom.read')
  @ApiOperation({
    summary:
      'Every event the WooCommerce store can fire, with its automation and the chosen sender',
  })
  woocommerce(@Param('id', ParseUUIDPipe) id: string) {
    return this.automations.get('woocommerce', id);
  }

  @Put('woocommerce/stores/:id/automations')
  @Idempotent()
  @RequirePermission('ecom.automations.manage')
  @ApiOperation({
    summary: 'Save the WooCommerce store’s automations and its “send from” number in one step',
    description:
      'Unknown event types are ignored. 422 for an unknown template, an automation that is on without one, or a sender that is not connected.',
  })
  saveWoocommerce(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(saveAutomationsSchema)) body: SaveAutomationsInput,
  ) {
    return this.automations.save('woocommerce', id, body);
  }
}
