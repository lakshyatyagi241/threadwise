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
  generateStoreOrderPaymentLinkSchema,
  listStoreOrdersQuerySchema,
  sendStoreOrderPaymentLinkSchema,
  updateStoreOrderStatusSchema,
  type GenerateStoreOrderPaymentLinkInput,
  type ListStoreOrdersQuery,
  type SendStoreOrderPaymentLinkInput,
  type UpdateStoreOrderStatusInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../../plans-subscriptions-trials';
import { StoreOrdersService } from './store-orders.service';

/**
 * The merchant's orders (Reference /store/orders). Behind the WhatsApp catalog plan feature (`wa_storefront`), like the rest of the store
 * screens. `counts` comes before `:id`.
 */
@ApiTags('store-orders')
@ActorKinds('user')
@RequirePlanFeature('wa_storefront')
@Controller({ path: 'store/orders', version: '2' })
export class StoreOrdersController {
  constructor(private readonly orders: StoreOrdersService) {}

  @Get()
  @RequirePermission('store.orders.read')
  @ApiOperation({
    summary:
      'Orders, newest first: filter by status, source, shop, payment status, date range, phone / name / order number',
  })
  async list(@Query(zodPipe(listStoreOrdersQuerySchema)) query: ListStoreOrdersQuery) {
    return this.orders.list(query);
  }

  @Get('counts')
  @RequirePermission('store.orders.read')
  @ApiOperation({ summary: 'The status tabs: one count per status and the total' })
  async counts() {
    return this.orders.counts();
  }

  @Get(':id')
  @RequirePermission('store.orders.read')
  @ApiOperation({
    summary:
      'One order: lines, totals, address, coupon, payments, history and the gateways it can be paid with',
  })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(id);
  }

  @Patch(':id/status')
  @Idempotent()
  @RequirePermission('store.orders.manage')
  @ApiOperation({
    summary: 'Change the status (any status to any), with notes and a payment link',
    description:
      'Send the `rowVersion` you read (409 `ROW_VERSION_CONFLICT` otherwise). The buyer is messaged on WhatsApp when the status changed or a link was typed; `notified` says whether that went out.',
  })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateStoreOrderStatusSchema)) body: UpdateStoreOrderStatusInput,
  ) {
    return this.orders.updateStatus(id, body);
  }

  @Post(':id/payment-link')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('store.orders.manage')
  @ApiOperation({ summary: 'Save a payment link on the order and send it to the buyer' })
  async sendPaymentLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(sendStoreOrderPaymentLinkSchema)) body: SendStoreOrderPaymentLinkInput,
  ) {
    return this.orders.sendPaymentLink(id, body);
  }

  @Post(':id/generate-payment-link')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('store.orders.manage')
  @ApiOperation({
    summary:
      'Create a hosted payment link on the shop gateway (or the one named) and send it to the buyer',
    description:
      '422 `STORE_GATEWAY_NOT_CONFIGURED` / `STORE_GATEWAY_UNAVAILABLE`, 502 `STORE_PAYMENT_LINK_FAILED`.',
  })
  async generatePaymentLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(generateStoreOrderPaymentLinkSchema)) body: GenerateStoreOrderPaymentLinkInput,
  ) {
    return this.orders.generatePaymentLink(id, body);
  }

  @Post(':id/create-invoice')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('store.orders.manage')
  @ApiOperation({
    summary: 'Turn the order into a sales order and an invoice',
    description:
      'Refused with the plan problem codes when the plan lacks invoicing or is out of invoices (PLAN_FEATURE_LOCKED, PLAN_LIMIT_REACHED), and with 409 for a cancelled order. Answers the existing invoice when the order has one.',
  })
  async createInvoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.createInvoice(id);
  }

  @Delete(':id')
  @Idempotent()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('store.orders.delete')
  @ApiOperation({ summary: 'Delete an order and its lines' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.orders.remove(id);
  }
}
