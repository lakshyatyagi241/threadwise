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
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createInvoiceSchema,
  invoiceCountsQuerySchema,
  invoiceEventsQuerySchema,
  issueInvoiceSchema,
  linkedInvoicesQuerySchema,
  listInvoicesQuerySchema,
  publicLinkSchema,
  recordPaymentSchema,
  sendInvoiceSchema,
  updateInvoiceSchema,
  voidInvoiceSchema,
  type CreateInvoiceInput,
  type InvoiceCountsQuery,
  type InvoiceEventsQuery,
  type IssueInvoiceInput,
  type LinkedInvoicesQuery,
  type ListInvoicesQuery,
  type PublicLinkInput,
  type RecordPaymentInput,
  type RecordScope,
  type SendInvoiceInput,
  type UpdateInvoiceInput,
  type VoidInvoiceInput,
} from '@crm/contracts';
import {
  ActorKinds,
  GrantedScope,
  Idempotent,
  RequirePermission,
} from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { SalesPipelineGuard } from '../deals/deals-plan';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';
import type { Response } from 'express';
import { Res } from '@nestjs/common';

/**
 * Invoices (TW-INV-001..031). Every route needs the plan's sales pipeline (the flag the other sales features share) and the
 * capability it names; "scope" is the caller's record scope over who owns or created the invoice (all / team / own).
 *
 * Literal paths (`counts`) are declared before `:id`: Express matches in registration order.
 */
@ApiTags('invoices')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'invoices', version: '2' })
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly pdf: InvoicePdfService,
  ) {}

  @Get()
  @RequirePermission('record.invoices.read')
  @ApiOperation({
    summary: 'List invoices (cursor paginated)',
    description:
      'Newest first. Filters: status (draft, issued, partially_paid, paid, overdue, void; comma separated; overdue is derived from the due date), docType, q (number, buyer, reference), contactId, companyId, dealId, ownerId, mine, currency, issuedFrom/issuedTo, dueFrom/dueTo.',
  })
  async list(
    @Query(zodPipe(listInvoicesQuerySchema)) query: ListInvoicesQuery,
    @GrantedScope('record.invoices.read') scope: RecordScope,
  ) {
    return this.invoices.list(query, scope);
  }

  @Get('counts')
  @RequirePermission('record.invoices.read')
  @ApiOperation({
    summary: 'Counts per status for the tabs, and the open balance per currency',
    description:
      'Takes every list filter except status. The statuses partition the invoices, so the counts add up to `all`.',
  })
  async counts(
    @Query(zodPipe(invoiceCountsQuerySchema)) query: InvoiceCountsQuery,
    @GrantedScope('record.invoices.read') scope: RecordScope,
  ) {
    return this.invoices.counts(query, scope);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.invoices.create')
  @ApiOperation({
    summary: 'Create a draft invoice',
    description:
      'Lines are priced on the server (the same rule as proposals and estimates). A line without taxRateId takes the default tax rate, null means no tax. A contact, company, deal or tax rate that is not in the workspace is 404; an owner who is not an active member is 422 INV_OWNER_INVALID.',
  })
  async create(@Body(zodPipe(createInvoiceSchema)) body: CreateInvoiceInput) {
    return this.invoices.create(body);
  }

  @Get(':id')
  @RequirePermission('record.invoices.read')
  @ApiOperation({
    summary: 'Get one invoice by uuid, with lines, tax summary and the public link (once issued)',
  })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.invoices.read') scope: RecordScope,
  ) {
    return this.invoices.get(id, scope);
  }

  @Patch(':id')
  @RequirePermission('record.invoices.update')
  @ApiOperation({
    summary: 'Edit an invoice',
    description:
      'Requires the rowVersion you read (409 ROW_VERSION_CONFLICT otherwise). A draft is edited whole; an issued invoice is frozen (409 INV_NOT_DRAFT) except due date, notes, terms, reference, owner, links and the buyer contact details.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateInvoiceSchema)) body: UpdateInvoiceInput,
    @GrantedScope('record.invoices.update') scope: RecordScope,
  ) {
    return this.invoices.update(id, body, scope);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.invoices.delete')
  @ApiOperation({
    summary: 'Delete a draft (an issued invoice is voided instead: 409 INV_NOT_DELETABLE)',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.invoices.delete') scope: RecordScope,
  ): Promise<void> {
    await this.invoices.remove(id, scope);
  }

  @Post(':id/issue')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('record.invoices.issue')
  @ApiOperation({
    summary: 'Issue a draft: number, due date, public link, frozen seller block',
    description:
      'The number comes from a locked per-series counter inside the same transaction. 409 INV_NOT_DRAFT when it is already issued.',
  })
  async issue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(issueInvoiceSchema)) body: IssueInvoiceInput,
    @GrantedScope('record.invoices.issue') scope: RecordScope,
  ) {
    return this.invoices.issue(id, body, scope);
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('record.invoices.issue')
  @ApiOperation({
    summary: 'Mark an issued invoice as sent and raise invoice.sent',
    description:
      'Channels: link (the staff member shares the public link themselves), email, whatsapp (both need the buyer contact detail, 422 INV_NO_RECIPIENT). Delivery adapters consume the event; none is built in.',
  })
  async send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(sendInvoiceSchema)) body: SendInvoiceInput,
    @GrantedScope('record.invoices.issue') scope: RecordScope,
  ) {
    return this.invoices.send(id, body, scope);
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.invoices.void')
  @ApiOperation({
    summary: 'Void an issued invoice (it keeps its number)',
    description:
      '409 INV_HAS_PAYMENTS while it carries a net payment: refund first. Pending online payment attempts expire.',
  })
  async voidInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(voidInvoiceSchema)) body: VoidInvoiceInput,
    @GrantedScope('record.invoices.void') scope: RecordScope,
  ) {
    return this.invoices.void(id, body, scope);
  }

  @Post(':id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  @Idempotent()
  @RequirePermission('record.invoices.create')
  @ApiOperation({
    summary: 'A new draft with the same buyer and lines (no number, dates or quote link)',
  })
  async duplicate(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.invoices.read') scope: RecordScope,
  ) {
    return this.invoices.duplicate(id, scope);
  }

  @Post(':id/public-link/regenerate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.invoices.update')
  @ApiOperation({
    summary: 'Give the invoice a new public link; the old one stops working at once',
  })
  async regenerateLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(publicLinkSchema)) body: PublicLinkInput,
    @GrantedScope('record.invoices.update') scope: RecordScope,
  ) {
    return this.invoices.regenerateLink(id, body, scope);
  }

  @Post(':id/public-link/revoke')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.invoices.update')
  @ApiOperation({ summary: 'Turn the public link off (the buyer sees "link unavailable")' })
  async revokeLink(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.invoices.update') scope: RecordScope,
  ) {
    return this.invoices.revokeLink(id, scope);
  }

  @Get(':id/events')
  @RequirePermission('record.invoices.read')
  @ApiOperation({
    summary:
      "The invoice's timeline: created, issued, sent, viewed, payments, overdue, voided (newest first)",
  })
  async events(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(invoiceEventsQuerySchema)) query: InvoiceEventsQuery,
    @GrantedScope('record.invoices.read') scope: RecordScope,
  ) {
    return this.invoices.events(id, query, scope);
  }

  @Get(':id/payments')
  @RequirePermission('record.payments.read')
  @ApiOperation({ summary: "The invoice's ledger entries, oldest first (payments and refunds)" })
  async payments_(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.payments.read') scope: RecordScope,
  ) {
    return this.payments.forInvoice(id, scope);
  }

  @Post(':id/payments')
  @Idempotent()
  @RequirePermission('record.payments.create')
  @ApiOperation({
    summary: 'Record a payment against an issued invoice',
    description:
      'The currency must be the invoice currency (422 PAY_CURRENCY_MISMATCH). More than the open balance is 422 PAY_OVERPAYMENT unless allowOverpayment is true (the excess shows as a credit). A draft or void invoice is 409 INV_NOT_ISSUED. paidAt may not be in the future.',
  })
  async recordPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(recordPaymentSchema)) body: RecordPaymentInput,
    @GrantedScope('record.payments.create') scope: RecordScope,
  ) {
    return this.payments.record(id, body, scope);
  }

  @Get(':id/pdf')
  @RequirePermission('record.invoices.read')
  @ApiOperation({
    summary:
      'The invoice as a PDF (rendered from the stored document; an issued invoice always renders the same)',
  })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.invoices.read') scope: RecordScope,
    @Res() res: Response,
  ) {
    const file = await this.pdf.forStaff(id, scope);
    res
      .status(200)
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${file.filename}"`,
        'Cache-Control': 'private, no-store',
      })
      .send(file.bytes);
  }
}

/** A contact's invoices, for the contact detail page (TW-INV-028, D-25). */
@ApiTags('invoices')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'contacts/:contactId/invoices', version: '2' })
export class ContactInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermission('record.invoices.read')
  @ApiOperation({
    summary: "A contact's invoices with the money rolled up per currency",
    description:
      'Needs record.invoices.read, and record.contacts.read on the contact (its record scope applies: a contact the caller cannot see is 404).',
  })
  async list(
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Query(zodPipe(linkedInvoicesQuerySchema)) query: LinkedInvoicesQuery,
    @GrantedScope('record.invoices.read') scope: RecordScope,
  ) {
    return this.invoices.forContact(contactId, query, scope);
  }
}

/** A deal's invoices, for the deal drawer. */
@ApiTags('invoices')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'deals/:dealId/invoices', version: '2' })
export class DealInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermission('record.invoices.read')
  @ApiOperation({
    summary: "A deal's invoices with the money rolled up per currency",
    description:
      'Needs record.invoices.read, and record.deals.read on the deal (its record scope applies: a deal the caller cannot see is 404).',
  })
  async list(
    @Param('dealId', ParseUUIDPipe) dealId: string,
    @Query(zodPipe(linkedInvoicesQuerySchema)) query: LinkedInvoicesQuery,
    @GrantedScope('record.invoices.read') scope: RecordScope,
  ) {
    return this.invoices.forDeal(dealId, query, scope);
  }
}
