import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  agingQuerySchema,
  listPaymentsQuerySchema,
  outstandingQuerySchema,
  paymentSummaryQuerySchema,
  recordPaymentForInvoiceSchema,
  refundPaymentSchema,
  type AgingQuery,
  type ListPaymentsQuery,
  type OutstandingQuery,
  type PaymentSummaryQuery,
  type RecordPaymentForInvoiceInput,
  type RecordScope,
  type RefundPaymentInput,
} from '@crm/contracts';
import {
  ActorKinds,
  GrantedScope,
  Idempotent,
  RequirePermission,
} from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { SalesPipelineGuard } from '../deals/deals-plan';
import { PaymentsService } from './payments.service';

/**
 * The payment ledger (WD-PAY-001..005, 015). Literal paths (`summary`, `aging`, `outstanding`) come before `:id`.
 */
@ApiTags('payments')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'payments', version: '2' })
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermission('record.payments.read')
  @ApiOperation({
    summary: 'List ledger entries (cursor paginated)',
    description:
      'Newest first. Filters: invoiceId, contactId, companyId, dealId, kind (payment | refund), method, currency, from/to (payment date), q (reference, receipt or invoice number).',
  })
  async list(
    @Query(zodPipe(listPaymentsQuerySchema)) query: ListPaymentsQuery,
    @GrantedScope('record.payments.read') scope: RecordScope,
  ) {
    return this.payments.list(query, scope);
  }

  @Get('summary')
  @RequirePermission('record.payments.read')
  @ApiOperation({
    summary: 'Collected in the last N days, refunded, outstanding and overdue, per currency',
    description: 'Amounts are never summed across currencies: each currency is its own row.',
  })
  async summary(
    @Query(zodPipe(paymentSummaryQuerySchema)) query: PaymentSummaryQuery,
    @GrantedScope('record.payments.read') scope: RecordScope,
  ) {
    return this.payments.summary(query, scope);
  }

  @Get('aging')
  @RequirePermission('record.payments.read')
  @ApiOperation({
    summary: 'Aging report: open balances by days past due',
    description:
      'Buckets: current (not yet due), 1-30, 31-60, 61-90, 90+ days past the due date (the issue date when there is none), per currency.',
  })
  async aging(
    @Query(zodPipe(agingQuerySchema)) query: AgingQuery,
    @GrantedScope('record.payments.read') scope: RecordScope,
  ) {
    return this.payments.aging(query, scope);
  }

  @Get('outstanding')
  @RequirePermission('record.payments.read')
  @ApiOperation({ summary: 'What each contact owes, per currency, biggest debt first' })
  async outstanding(
    @Query(zodPipe(outstandingQuerySchema)) query: OutstandingQuery,
    @GrantedScope('record.payments.read') scope: RecordScope,
  ) {
    return this.payments.outstanding(query, scope);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.payments.create')
  @ApiOperation({
    summary: 'Record a payment (the invoice is named in the body)',
    description: 'Same rules as POST /invoices/:id/payments.',
  })
  async record(
    @Body(zodPipe(recordPaymentForInvoiceSchema)) body: RecordPaymentForInvoiceInput,
    @GrantedScope('record.payments.create') scope: RecordScope,
  ) {
    const { invoiceId, ...rest } = body;
    return this.payments.record(invoiceId, rest, scope);
  }

  @Get(':id')
  @RequirePermission('record.payments.read')
  @ApiOperation({ summary: 'Get one ledger entry' })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.payments.read') scope: RecordScope,
  ) {
    return this.payments.get(id, scope);
  }

  @Get(':id/receipt')
  @RequirePermission('record.payments.read')
  @ApiOperation({ summary: 'The printable receipt of one ledger entry' })
  async receipt(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.payments.read') scope: RecordScope,
  ) {
    return this.payments.receipt(id, scope);
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('record.payments.refund')
  @ApiOperation({
    summary: 'Refund a payment, fully or partly, as a negative ledger entry',
    description:
      'Default amount: everything not refunded yet. More than that is 422 PAY_REFUND_EXCEEDS; a refund cannot be refunded (409 PAY_NOT_REFUNDABLE). No money moves at a gateway: this records that it was returned.',
  })
  async refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(refundPaymentSchema)) body: RefundPaymentInput,
    @GrantedScope('record.payments.refund') scope: RecordScope,
  ) {
    return this.payments.refund(id, body, scope);
  }
}
