import { Body, Controller, Get, Patch, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  updateInvoiceGatewaySchema,
  updateInvoiceProfileSchema,
  type UpdateInvoiceGatewayInput,
  type UpdateInvoiceProfileInput,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { SalesPipelineGuard } from '../deals/deals-plan';
import { InvoiceSettingsService } from './invoice-settings.service';
import { RequirePlanFeature } from '../../plans-subscriptions-trials';

/**
 * The invoicing profile (seller identity, numbering, defaults, bank details) and the online-payment connection. Reading the
 * profile needs only record.invoices.read (the invoice form shows the defaults); changing anything needs record.invoices.settings.
 * Literal path `gateway` is declared before nothing that could swallow it: this controller has no `:id` route.
 */
@ApiTags('invoice-settings')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'invoice-settings', version: '2' })
export class InvoiceSettingsController {
  constructor(private readonly settings: InvoiceSettingsService) {}

  @Get()
  @RequirePermission('record.invoices.read', 'record.invoices.settings')
  @ApiOperation({
    summary: 'The invoicing profile (defaults when nothing was saved; a read never writes)',
  })
  async get() {
    return this.settings.get();
  }

  // Plan feature on write routes only: a downgraded workspace still reads and prints the documents it has; public invoice pages and the gateway webhook are separate open controllers.
  @RequirePlanFeature('invoicing')
  @Patch()
  @RequirePermission('record.invoices.settings')
  @ApiOperation({
    summary: 'Change the invoicing profile',
    description:
      'Only the fields sent change (null clears where a field can be empty). A number format must contain {SEQ}, and one that restarts yearly must contain {YEAR} or {YY}. rowVersion is optional (last write wins without it).',
  })
  async update(@Body(zodPipe(updateInvoiceProfileSchema)) body: UpdateInvoiceProfileInput) {
    return this.settings.update(body);
  }

  @Get('gateway')
  @RequirePermission('record.invoices.settings')
  @ApiOperation({
    summary: 'The online-payment webhook connection (never returns the secret)',
  })
  async gateway() {
    return this.settings.gateway();
  }

  @RequirePlanFeature('invoicing')
  @Put('gateway')
  @RequirePermission('record.invoices.settings')
  @ApiOperation({
    summary: 'Set the webhook signing secret, the mode, and turn the connection on or off',
    description:
      'A connection cannot be enabled without a secret (422 PAY_GATEWAY_NOT_CONFIGURED). The response carries the webhook path to give the provider.',
  })
  async updateGateway(@Body(zodPipe(updateInvoiceGatewaySchema)) body: UpdateInvoiceGatewayInput) {
    return this.settings.updateGateway(body);
  }
}
