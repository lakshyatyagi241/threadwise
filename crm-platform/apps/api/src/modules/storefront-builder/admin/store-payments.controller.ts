import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  listStorePaymentsQuerySchema,
  saveWhatsappPayConfigSchema,
  type ListStorePaymentsQuery,
  type SaveWhatsappPayConfigInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { StorePaymentsService } from './store-payments.service';

/** The store Payments screen (WaDesk /store/payments): the money side of store orders and the WhatsApp Pay configurations. */
@ApiTags('store-payments')
@ActorKinds('user')
@Controller({ path: 'store/payments', version: '2' })
export class StorePaymentsController {
  constructor(private readonly payments: StorePaymentsService) {}

  @Get()
  @RequirePermission('store.payments.view')
  @ApiOperation({
    summary:
      'Payment records of store orders (money asked for or received), newest first. Read only.',
  })
  async list(@Query(zodPipe(listStorePaymentsQuerySchema)) query: ListStorePaymentsQuery) {
    return this.payments.list(query);
  }

  @Get('summary')
  @RequirePermission('store.payments.view')
  @ApiOperation({ summary: 'Orders by payment status and the money collected per currency' })
  async summary() {
    return this.payments.summary();
  }

  @Get('whatsapp-pay')
  @RequirePermission('store.payments.view')
  @ApiOperation({ summary: 'WhatsApp Pay configurations (the Direct Pay Method names)' })
  async listWhatsappPay() {
    return this.payments.listWhatsappPay();
  }

  @Put('whatsapp-pay')
  @Idempotent()
  @RequirePermission('store.payments.manage')
  @ApiOperation({ summary: 'Save a WhatsApp Pay configuration by name (creates or updates)' })
  async saveWhatsappPay(
    @Body(zodPipe(saveWhatsappPayConfigSchema)) body: SaveWhatsappPayConfigInput,
  ) {
    return this.payments.saveWhatsappPay(body);
  }

  @Delete('whatsapp-pay/:id')
  @Idempotent()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('store.payments.manage')
  @ApiOperation({ summary: 'Remove a WhatsApp Pay configuration' })
  async removeWhatsappPay(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.payments.removeWhatsappPay(id);
  }
}
