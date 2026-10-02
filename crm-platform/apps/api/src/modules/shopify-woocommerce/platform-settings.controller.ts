import { Body, Controller, Get, HttpCode, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  updateShopifySettingsSchema,
  updateWoocommerceSettingsSchema,
  type UpdateShopifySettingsInput,
  type UpdateWoocommerceSettingsInput,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { EcomSettingsService } from './platform-settings.service';

/**
 * The platform operator's Shopify and WooCommerce settings (WD-ECOM-001, 002). Every operator role reads; only super admins
 * change them, and every change is audited.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/ecom', version: '2' })
export class EcomPlatformSettingsController {
  constructor(private readonly settings: EcomSettingsService) {}

  @Get('shopify')
  @ApiOperation({
    summary:
      "The platform's Shopify app: switch, client id, scopes, redirect, counts. Never the secret.",
  })
  shopify() {
    return this.settings.shopifyPage();
  }

  @Put('shopify')
  @OperatorRoles('super_admin')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Save the Shopify app settings; what is left out stays, a blank secret keeps the saved one',
  })
  updateShopify(@Body(zodPipe(updateShopifySettingsSchema)) body: UpdateShopifySettingsInput) {
    return this.settings.updateShopify(body);
  }

  @Get('woocommerce')
  @ApiOperation({ summary: 'The WooCommerce switch and counts' })
  woocommerce() {
    return this.settings.woocommercePage();
  }

  @Put('woocommerce')
  @OperatorRoles('super_admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Turn the WooCommerce integration on or off for every workspace' })
  updateWoocommerce(
    @Body(zodPipe(updateWoocommerceSettingsSchema)) body: UpdateWoocommerceSettingsInput,
  ) {
    return this.settings.updateWoocommerce(body);
  }
}
