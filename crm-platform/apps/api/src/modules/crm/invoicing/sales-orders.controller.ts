import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  cancelOrderSchema,
  createSalesOrderSchema,
  fulfilOrderSchema,
  invoiceFromOrderSchema,
  listSalesOrdersQuerySchema,
  updateSalesOrderSchema,
  type CancelOrderInput,
  type CreateSalesOrderInput,
  type FulfilOrderInput,
  type InvoiceFromOrderInput,
  type ListSalesOrdersQuery,
  type RecordScope,
  type UpdateSalesOrderInput,
} from '@crm/contracts';
import { ActorKinds, GrantedScope, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { SalesPipelineGuard } from '../deals/deals-plan';
import { SalesOrdersService } from './sales-orders.service';

/** Sales orders: accepted estimate -> order -> one or more invoices -> fulfilment. `counts` is a literal path before `:id`. */
@ApiTags('sales-orders')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'sales-orders', version: '2' })
export class SalesOrdersController {
  constructor(private readonly orders: SalesOrdersService) {}

  @Get()
  @RequirePermission('record.sales-orders.read')
  @ApiOperation({
    summary: 'List sales orders (cursor paginated)',
    description: 'Filters: status, invoicingStatus (not_invoiced, partially_invoiced, invoiced), fulfilmentStatus, contactId, dealId, q.',
  })
  list(@Query(zodPipe(listSalesOrdersQuerySchema)) query: ListSalesOrdersQuery, @GrantedScope('record.sales-orders.read') scope: RecordScope) {
    return this.orders.list(query, scope);
  }

  @Get('counts')
  @RequirePermission('record.sales-orders.read')
  @ApiOperation({ summary: 'Counts per status, orders waiting to be invoiced or delivered, and the open value per currency' })
  counts(@GrantedScope('record.sales-orders.read') scope: RecordScope) {
    return this.orders.counts(scope);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.sales-orders.create')
  @ApiOperation({
    summary: 'Create a sales order from an accepted offer (quoteId) or from lines',
    description: 'A draft until confirmed. An offer that is not accepted is 409 SO_QUOTE_NOT_ACCEPTED; one that already has a live order is 409 SO_QUOTE_TAKEN.',
  })
  create(@Body(zodPipe(createSalesOrderSchema)) body: CreateSalesOrderInput, @GrantedScope('record.sales-orders.create') scope: RecordScope) {
    return this.orders.create(body, scope);
  }

  @Get(':id')
  @RequirePermission('record.sales-orders.read')
  @ApiOperation({ summary: 'Get one sales order, with its lines, progress and invoices' })
  get(@Param('id', ParseUUIDPipe) id: string, @GrantedScope('record.sales-orders.read') scope: RecordScope) {
    return this.orders.get(id, scope);
  }

  @Patch(':id')
  @RequirePermission('record.sales-orders.update')
  @ApiOperation({ summary: 'Edit a draft order (rowVersion required)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateSalesOrderSchema)) body: UpdateSalesOrderInput,
    @GrantedScope('record.sales-orders.update') scope: RecordScope,
  ) {
    return this.orders.update(id, body, scope);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.sales-orders.update')
  @ApiOperation({ summary: 'Confirm a draft: its prices are frozen, it can be invoiced and delivered' })
  confirm(@Param('id', ParseUUIDPipe) id: string, @GrantedScope('record.sales-orders.update') scope: RecordScope) {
    return this.orders.confirm(id, scope);
  }

  @Post(':id/invoice')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('record.sales-orders.invoice')
  @ApiOperation({
    summary: 'Invoice part or all of the order',
    description:
      'Returns { order, invoice }. A draft invoice unless issue is true. Quantities above what is left are 422 SO_QUANTITY_EXCEEDS; shipping is billed with the first invoice. Voiding or deleting the invoice gives its quantities back.',
  })
  invoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(invoiceFromOrderSchema)) body: InvoiceFromOrderInput,
    @GrantedScope('record.sales-orders.invoice') scope: RecordScope,
  ) {
    return this.orders.invoice(id, body, scope);
  }

  @Post(':id/fulfil')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('record.sales-orders.update')
  @ApiOperation({ summary: 'Record a delivery of some or all quantities' })
  fulfil(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(fulfilOrderSchema)) body: FulfilOrderInput,
    @GrantedScope('record.sales-orders.update') scope: RecordScope,
  ) {
    return this.orders.fulfil(id, body, scope);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.sales-orders.update')
  @ApiOperation({ summary: 'Cancel an order that has no live invoice (409 SO_HAS_INVOICES otherwise)' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(cancelOrderSchema)) body: CancelOrderInput,
    @GrantedScope('record.sales-orders.update') scope: RecordScope,
  ) {
    return this.orders.cancel(id, body, scope);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.sales-orders.delete')
  @ApiOperation({ summary: 'Delete a draft order' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @GrantedScope('record.sales-orders.delete') scope: RecordScope) {
    await this.orders.remove(id, scope);
  }
}
