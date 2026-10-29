import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createSalesItemSchema,
  listSalesItemsQuerySchema,
  updateSalesItemSchema,
  type CreateSalesItemInput,
  type ListSalesItemsQuery,
  type UpdateSalesItemInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { ProductsServicesService } from './products-services.service';

/**
 * Products and services (the add-on of docs/specs/crm-deal-estimate-invoice-products.md 5). Every route needs the plan feature
 * `products_services`, granted only by owning the Marketplace app: a workspace without it answers 422 PLAN_FEATURE_LOCKED, reads included,
 * even to a hand-typed URL.
 */
@ApiTags('products-services')
@ActorKinds('user')
@RequirePlanFeature('products_services')
@Controller({ path: 'products-services', version: '2' })
export class ProductsServicesController {
  constructor(private readonly items: ProductsServicesService) {}

  @Get()
  @RequirePermission('record.sales-items.read')
  @ApiOperation({ summary: 'The price list, by name, with the counts for its tabs' })
  list(@Query(zodPipe(listSalesItemsQuerySchema)) query: ListSalesItemsQuery) {
    return this.items.list(query);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.sales-items.create')
  @ApiOperation({
    summary: 'Add a product or a service',
    description: '409 PRD_SKU_TAKEN when another item has the same SKU (case does not matter).',
  })
  create(@Body(zodPipe(createSalesItemSchema)) body: CreateSalesItemInput) {
    return this.items.create(body);
  }

  @Get(':id')
  @RequirePermission('record.sales-items.read')
  @ApiOperation({ summary: 'One product or service' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.items.get(id);
  }

  @Patch(':id')
  @RequirePermission('record.sales-items.update')
  @ApiOperation({
    summary: 'Change a product or service, or switch it off',
    description:
      'Needs the `rowVersion` that was read: 409 when it changed since. A field sent as empty clears it.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateSalesItemSchema)) body: UpdateSalesItemInput,
  ) {
    return this.items.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.sales-items.delete')
  @ApiOperation({ summary: 'Delete a product or service' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.items.remove(id);
  }
}
