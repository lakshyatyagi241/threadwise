import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  createCreditNoteSchema,
  issueCreditNoteSchema,
  listCreditNotesQuerySchema,
  updateCreditNoteSchema,
  voidCreditNoteSchema,
  type CreateCreditNoteInput,
  type IssueCreditNoteInput,
  type ListCreditNotesQuery,
  type RecordScope,
  type UpdateCreditNoteInput,
  type VoidCreditNoteInput,
} from '@crm/contracts';
import { ActorKinds, GrantedScope, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { SalesPipelineGuard } from '../deals/deals-plan';
import { CreditNotesService } from './credit-notes.service';
import { renderInvoicePdf } from './invoice-render';

/** Credit notes: a document that reduces an issued invoice (full or partial), applied to its balance or refunded. */
@ApiTags('credit-notes')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'credit-notes', version: '2' })
export class CreditNotesController {
  constructor(private readonly notes: CreditNotesService) {}

  @Get()
  @RequirePermission('record.credit-notes.read')
  @ApiOperation({ summary: 'List credit notes (cursor paginated)', description: 'Filters: invoiceId, status, q, from/to.' })
  list(@Query(zodPipe(listCreditNotesQuerySchema)) query: ListCreditNotesQuery, @GrantedScope('record.credit-notes.read') scope: RecordScope) {
    return this.notes.list(query, scope);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.credit-notes.create')
  @ApiOperation({
    summary: 'Create a draft credit note against an issued invoice',
    description: 'Send `full: true`, or `lines` (an invoice line with a quantity, or a free-form amount). Credits can never exceed what the invoice still allows (422 CN_EXCEEDS_INVOICE).',
  })
  create(@Body(zodPipe(createCreditNoteSchema)) body: CreateCreditNoteInput, @GrantedScope('record.credit-notes.create') scope: RecordScope) {
    return this.notes.create(body, scope);
  }

  @Get(':id')
  @RequirePermission('record.credit-notes.read')
  @ApiOperation({ summary: 'Get one credit note' })
  get(@Param('id', ParseUUIDPipe) id: string, @GrantedScope('record.credit-notes.read') scope: RecordScope) {
    return this.notes.get(id, scope);
  }

  @Get(':id/pdf')
  @RequirePermission('record.credit-notes.read')
  @ApiOperation({ summary: 'The credit note as a PDF' })
  async pdf(@Param('id', ParseUUIDPipe) id: string, @GrantedScope('record.credit-notes.read') scope: RecordScope, @Res() res: Response) {
    const doc = await this.notes.document(id, scope);
    res
      .status(200)
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${doc.number}.pdf"`,
        'Cache-Control': 'private, no-store',
      })
      .send(renderInvoicePdf(doc));
  }

  @Patch(':id')
  @RequirePermission('record.credit-notes.create')
  @ApiOperation({ summary: 'Edit a draft credit note (rowVersion required)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateCreditNoteSchema)) body: UpdateCreditNoteInput,
    @GrantedScope('record.credit-notes.create') scope: RecordScope,
  ) {
    return this.notes.update(id, body, scope);
  }

  @Post(':id/issue')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('record.credit-notes.issue')
  @ApiOperation({
    summary: 'Issue the credit note: takes its number, reduces the invoice balance and, for a refund settlement, records the cash returned',
  })
  issue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(issueCreditNoteSchema)) body: IssueCreditNoteInput,
    @GrantedScope('record.credit-notes.issue') scope: RecordScope,
  ) {
    return this.notes.issue(id, body, scope);
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.credit-notes.void')
  @ApiOperation({ summary: 'Void an issued credit note that returned no cash (409 CN_HAS_REFUND otherwise)' })
  void(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(voidCreditNoteSchema)) body: VoidCreditNoteInput,
    @GrantedScope('record.credit-notes.void') scope: RecordScope,
  ) {
    return this.notes.void(id, body, scope);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.credit-notes.delete')
  @ApiOperation({ summary: 'Delete a draft credit note' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @GrantedScope('record.credit-notes.delete') scope: RecordScope) {
    await this.notes.remove(id, scope);
  }
}
