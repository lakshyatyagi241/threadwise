import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { DashboardService } from './dashboard.service';

/** The store dashboard for both store types (TW-ECOM-023). */
@ApiTags('shopify', 'woocommerce')
@ActorKinds('user')
@Controller({ version: '2' })
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('shopify/stores/:id/dashboard')
  @RequirePermission('ecom.read')
  @ApiOperation({
    summary: 'Everything the Shopify store screen shows, from the CRM mirror, in one read',
  })
  shopify(@Param('id', ParseUUIDPipe) id: string) {
    return this.dashboard.get('shopify', id);
  }

  @Get('woocommerce/stores/:id/dashboard')
  @RequirePermission('ecom.read')
  @ApiOperation({
    summary:
      'Everything the WooCommerce store screen shows: live recent records and sales report, CRM figures from the mirror',
    description: 'A store that does not answer leaves its live lists empty; it is not an error.',
  })
  woocommerce(@Param('id', ParseUUIDPipe) id: string) {
    return this.dashboard.get('woocommerce', id);
  }
}
