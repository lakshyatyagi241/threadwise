import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  convertToDealSchema,
  createSalesDocSchema,
  createSalesDocTemplateSchema,
  duplicateSalesDocSchema,
  extendSalesDocSchema,
  listLinkedSalesDocsQuerySchema,
  listSalesDocEventsQuerySchema,
  listSalesDocsQuerySchema,
  listSalesDocTemplatesQuerySchema,
  regenerateLinkSchema,
  reviseSalesDocSchema,
  salesDocCountsQuerySchema,
  sendSalesDocSchema,
  staffDecisionSchema,
  updateSalesDocSchema,
  updateSalesDocSettingsSchema,
  updateSalesDocTemplateSchema,
  type ConvertToDealInput,
  type CreateSalesDocInput,
  type CreateSalesDocTemplateInput,
  type DuplicateSalesDocInput,
  type ExtendSalesDocInput,
  type ListLinkedSalesDocsQuery,
  type ListSalesDocEventsQuery,
  type ListSalesDocsQuery,
  type ListSalesDocTemplatesQuery,
  type RecordScope,
  type RegenerateLinkInput,
  type ReviseSalesDocInput,
  type SalesDocCountsQuery,
  type SendSalesDocInput,
  type StaffDecisionInput,
  type UpdateSalesDocInput,
  type UpdateSalesDocSettingsInput,
  type UpdateSalesDocTemplateInput,
} from '@crm/contracts';
import {
  ActorKinds,
  GrantedScope,
  Idempotent,
  RequirePermission,
} from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { SalesPipelineGuard } from '../deals/deals-plan';
import { SalesDocSettingsService } from './sales-doc-settings.service';
import { SalesDocsService } from './sales-docs.service';

/**
 * Module settings and templates (numbering, defaults, default terms and notes). Registered BEFORE `SalesDocsController`: its literal
 * paths (`sales-docs/settings`, `sales-docs/templates`) would otherwise be read as `sales-docs/:id`.
 */
@ApiTags('sales-docs')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'sales-docs', version: '2' })
export class SalesDocSettingsController {
  constructor(private readonly settings: SalesDocSettingsService) {}

  @Get('settings')
  @RequirePermission('record.sales-docs.read')
  @ApiOperation({
    summary: 'Numbering and defaults of proposals and estimates',
    description:
      'Prefixes, padding, starting numbers, the default validity and the link lifetime, plus the counters (the next number is last + 1). `rowVersion` is null until the first save.',
  })
  get() {
    return this.settings.getSettings();
  }

  @Patch('settings')
  @RequirePermission('record.sales-docs.settings')
  @ApiOperation({
    summary: 'Change numbering and defaults',
    description:
      'Shapes the NEXT numbers only (an issued number never changes and the counter is never lowered). The first save carries no rowVersion; later ones must carry the version read (409 ROW_VERSION_CONFLICT).',
  })
  update(@Body(zodPipe(updateSalesDocSettingsSchema)) body: UpdateSalesDocSettingsInput) {
    return this.settings.updateSettings(body);
  }

  @Get('templates')
  @RequirePermission('record.sales-docs.read')
  @ApiOperation({ summary: 'Templates of default terms and notes (the default of a kind first)' })
  listTemplates(
    @Query(zodPipe(listSalesDocTemplatesQuerySchema)) query: ListSalesDocTemplatesQuery,
  ) {
    return this.settings.listTemplates(query);
  }

  @Post('templates')
  @RequirePermission('record.sales-docs.settings')
  @ApiOperation({
    summary: 'Create a template',
    description:
      'Making it the default clears the flag on the previous default of its kind. A name is unique per kind (409 SALESDOC_TEMPLATE_NAME_TAKEN).',
  })
  createTemplate(@Body(zodPipe(createSalesDocTemplateSchema)) body: CreateSalesDocTemplateInput) {
    return this.settings.createTemplate(body);
  }

  @Patch('templates/:id')
  @RequirePermission('record.sales-docs.settings')
  @ApiOperation({ summary: 'Edit a template (requires the rowVersion read)' })
  updateTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateSalesDocTemplateSchema)) body: UpdateSalesDocTemplateInput,
  ) {
    return this.settings.updateTemplate(id, body);
  }

  @Delete('templates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.sales-docs.settings')
  @ApiOperation({ summary: 'Delete a template (documents already made from it keep their text)' })
  async deleteTemplate(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.settings.deleteTemplate(id);
  }
}

/**
 * Proposals and estimates (WD-PROP / WD-EST). Every route needs the plan's sales pipeline (the flag WaDesk gated them on) and a
 * capability; "scope" is the caller's record scope over who owns or created the document (all / team / own, out of scope is 404).
 * Literal paths (`counts`) are declared before `:id`.
 */
@ApiTags('sales-docs')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'sales-docs', version: '2' })
export class SalesDocsController {
  constructor(private readonly docs: SalesDocsService) {}

  @Get()
  @RequirePermission('record.sales-docs.read')
  @ApiOperation({
    summary: 'List proposals and estimates (cursor paginated, newest first)',
    description:
      'Filters: kind, status (comma list), q (number, title, contact or company name), contactId, companyId, dealId, ownerId, mine, currency, validFrom/validTo (the calendar reads this).',
  })
  list(
    @Query(zodPipe(listSalesDocsQuerySchema)) query: ListSalesDocsQuery,
    @GrantedScope('record.sales-docs.read') scope: RecordScope,
  ) {
    return this.docs.list(query, scope);
  }

  @Get('counts')
  @RequirePermission('record.sales-docs.read')
  @ApiOperation({
    summary: 'Counts per status and the open value, for the tabs and the value tile',
    description:
      'Same filters as the list without status and paging. `openValue` is sent, viewed and accepted-not-converted, one total per currency.',
  })
  counts(
    @Query(zodPipe(salesDocCountsQuerySchema)) query: SalesDocCountsQuery,
    @GrantedScope('record.sales-docs.read') scope: RecordScope,
  ) {
    return this.docs.counts(query, scope);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.sales-docs.create')
  @ApiOperation({
    summary: 'Create a proposal or an estimate (a draft)',
    description:
      'The number comes from a locked per-type counter (PRO-0001 / EST-0001, configurable). The buyer defaults to the linked contact. A contact, company or deal outside the workspace is 404; an owner who is not an active member is 422 SALESDOC_OWNER_INVALID; a bad amount is 422 SALESDOC_AMOUNT_INVALID with one detail per field.',
  })
  create(@Body(zodPipe(createSalesDocSchema)) body: CreateSalesDocInput) {
    return this.docs.create(body);
  }

  @Get(':id')
  @RequirePermission('record.sales-docs.read')
  @ApiOperation({
    summary:
      'Get one document with its lines, totals, link state and the actions its status allows',
  })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.sales-docs.read') scope: RecordScope,
  ) {
    return this.docs.get(id, scope);
  }

  @Patch(':id')
  @RequirePermission('record.sales-docs.update')
  @ApiOperation({
    summary: 'Edit a draft (whole document: fields, links, pricing, lines)',
    description:
      'Requires the rowVersion read (409 ROW_VERSION_CONFLICT). Only a draft is edited in place: any other status is 409 SALESDOC_NOT_EDITABLE (revise it). Absent keeps, null clears. `lines` replaces every line. A new currency needs the lines in the same call.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateSalesDocSchema)) body: UpdateSalesDocInput,
    @GrantedScope('record.sales-docs.update') scope: RecordScope,
  ) {
    return this.docs.update(id, body, scope);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.sales-docs.delete')
  @ApiOperation({
    summary: 'Delete a document (audited; emits salesdoc.deleted)',
    description:
      'Accepted and converted documents are evidence: 409 SALESDOC_NOT_DELETABLE. A deleted number is never reused.',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.sales-docs.delete') scope: RecordScope,
  ): Promise<void> {
    await this.docs.remove(id, scope);
  }

  @Get(':id/print')
  @RequirePermission('record.sales-docs.read')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Printable page (save as PDF from the browser)',
    description:
      'A self-contained print-optimised HTML page (A4, no scripts). A server-side PDF file is a listed follow-up.',
  })
  print(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.sales-docs.read') scope: RecordScope,
  ) {
    return this.docs.printHtml(id, scope);
  }

  @Get(':id/events')
  @RequirePermission('record.sales-docs.read')
  @ApiOperation({
    summary:
      'Timeline: every transition, send, view, decision and edit (newest first, cursor paginated)',
    description:
      'Buyer decisions carry the signer, IP and user agent (encrypted at rest). The drawn signature is on the single-event route.',
  })
  events(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listSalesDocEventsQuerySchema)) query: ListSalesDocEventsQuery,
    @GrantedScope('record.sales-docs.read') scope: RecordScope,
  ) {
    return this.docs.events(id, query, scope);
  }

  @Get(':id/events/:eventId')
  @RequirePermission('record.sales-docs.read')
  @ApiOperation({
    summary: "One timeline event, with the buyer's drawn signature when there is one",
  })
  event(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @GrantedScope('record.sales-docs.read') scope: RecordScope,
  ) {
    return this.docs.event(id, eventId, scope);
  }

  @Get(':id/revisions')
  @RequirePermission('record.sales-docs.read')
  @ApiOperation({
    summary: 'The earlier revisions of a document (kept when it was revised), newest first',
  })
  revisions(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.sales-docs.read') scope: RecordScope,
  ) {
    return this.docs.revisions(id, scope);
  }

  @Get(':id/revisions/:revision')
  @RequirePermission('record.sales-docs.read')
  @ApiOperation({ summary: 'The lines and totals a document had in one earlier revision' })
  revision(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('revision', ParseIntPipe) revision: number,
    @GrantedScope('record.sales-docs.read') scope: RecordScope,
  ) {
    return this.docs.revision(id, revision, scope);
  }

  @Post(':id/duplicate')
  @Idempotent()
  @RequirePermission('record.sales-docs.create')
  @ApiOperation({
    summary: 'Duplicate into a new draft (optionally as the other kind)',
    description:
      'New number and link; the lines, pricing, buyer and terms are copied; nothing of the sending history. Needs read on the original.',
  })
  duplicate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(duplicateSalesDocSchema)) body: DuplicateSalesDocInput,
  ) {
    return this.docs.duplicate(id, body);
  }

  @Post(':id/send')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.sales-docs.send')
  @ApiOperation({
    summary:
      'Send the document: email now, ask for WhatsApp, or mark it sent for a link you share yourself',
    description:
      '`email` mails the link (502 SALESDOC_SEND_FAILED leaves the document unchanged; 422 SALESDOC_NO_RECIPIENT without an address). `whatsapp` marks it sent and emits salesdoc.delivery_requested for the messaging side to deliver (TODO: that adapter belongs to the messaging domain). `link` is the copy-link / mark-as-sent path. A draft becomes sent; a sent or viewed one is re-sent (status kept); anything else is 409 SALESDOC_INVALID_TRANSITION. Needs an Idempotency-Key.',
  })
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(sendSalesDocSchema)) body: SendSalesDocInput,
    @GrantedScope('record.sales-docs.send') scope: RecordScope,
  ) {
    return this.docs.send(id, body, scope);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.sales-docs.update')
  @ApiOperation({
    summary: 'Record that the buyer accepted (a signed copy, a phone call)',
    description:
      'From draft, sent or viewed. Recorded in the timeline as staff-recorded. An open document past its valid-until date is 409 SALESDOC_EXPIRED (extend it first).',
  })
  accept(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(staffDecisionSchema)) body: StaffDecisionInput,
    @GrantedScope('record.sales-docs.update') scope: RecordScope,
  ) {
    return this.docs.accept(id, body, scope);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.sales-docs.update')
  @ApiOperation({ summary: 'Record that the buyer declined' })
  decline(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(staffDecisionSchema)) body: StaffDecisionInput,
    @GrantedScope('record.sales-docs.update') scope: RecordScope,
  ) {
    return this.docs.decline(id, body, scope);
  }

  @Post(':id/revise')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.sales-docs.update')
  @ApiOperation({
    summary: 'Back to a draft to change what was sent (revision + 1, the old content is kept)',
    description:
      'From sent, viewed, declined or expired. Accepted and converted documents are final: duplicate them instead.',
  })
  revise(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(reviseSalesDocSchema)) body: ReviseSalesDocInput,
    @GrantedScope('record.sales-docs.update') scope: RecordScope,
  ) {
    return this.docs.revise(id, body, scope);
  }

  @Post(':id/extend')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.sales-docs.update')
  @ApiOperation({
    summary: 'Give an open or expired document a new valid-until date',
    description:
      'An expired document is open again (viewed when the buyer had opened it, else sent). The date cannot be in the past.',
  })
  extend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(extendSalesDocSchema)) body: ExtendSalesDocInput,
    @GrantedScope('record.sales-docs.update') scope: RecordScope,
  ) {
    return this.docs.extend(id, body, scope);
  }

  @Get(':id/link')
  @RequirePermission('record.sales-docs.send')
  @ApiOperation({
    summary: 'The share link (token, web path and absolute url)',
    description:
      'The token is stored hashed for lookup and encrypted for this read. A bearer secret: anyone holding it can open the document.',
  })
  link(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.sales-docs.send') scope: RecordScope,
  ) {
    return this.docs.getLink(id, scope);
  }

  @Post(':id/link/regenerate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.sales-docs.send')
  @ApiOperation({
    summary: 'A new link; the old one stops working at once',
    description:
      "`expiresInDays` sets this link's own lifetime (null: none); absent uses the workspace default.",
  })
  regenerate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(regenerateLinkSchema)) body: RegenerateLinkInput,
    @GrantedScope('record.sales-docs.send') scope: RecordScope,
  ) {
    return this.docs.regenerateLink(id, body, scope);
  }

  @Post(':id/link/revoke')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.sales-docs.send')
  @ApiOperation({
    summary:
      'Revoke the link: the buyer gets 410 SALESDOC_LINK_UNAVAILABLE until a new one is made or the document is sent again',
  })
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.sales-docs.send') scope: RecordScope,
  ) {
    return this.docs.revokeLink(id, scope);
  }

  @Post(':id/convert/invoice')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.sales-docs.convert')
  @ApiOperation({
    summary:
      'Turn an accepted document into an invoice draft (through the invoicing port, in one transaction)',
    description:
      'Only an accepted document converts (409 SALESDOC_INVALID_TRANSITION otherwise); twice is 409 SALESDOC_ALREADY_CONVERTED. 501 SALESDOC_INVOICING_UNAVAILABLE until the invoicing module binds SALES_DOC_INVOICE_PORT.',
  })
  convertInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.sales-docs.convert') scope: RecordScope,
  ) {
    return this.docs.convertToInvoice(id, scope);
  }

  @Post(':id/convert/deal')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.sales-docs.convert')
  @ApiOperation({
    summary: 'Create a deal from the document and link it',
    description:
      "The deal takes the document's title, total, currency, contact, company and owner, in the chosen (default) pipeline's first stage. 409 SALESDOC_ALREADY_LINKED_DEAL when a deal is linked.",
  })
  convertDeal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(convertToDealSchema)) body: ConvertToDealInput,
    @GrantedScope('record.sales-docs.convert') scope: RecordScope,
  ) {
    return this.docs.convertToDeal(id, body, scope);
  }
}

/** A contact's documents, for the contact detail page (WD-PROP-025). */
@ApiTags('sales-docs')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'contacts/:contactId/sales-docs', version: '2' })
export class ContactSalesDocsController {
  constructor(private readonly docs: SalesDocsService) {}

  @Get()
  @RequirePermission('record.sales-docs.read')
  @ApiOperation({
    summary: "A contact's proposals and estimates (same filters and paging as the list)",
    description:
      'Needs record.sales-docs.read, and record.contacts.read on the contact (its record scope applies: a contact the caller cannot see is 404).',
  })
  list(
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Query(zodPipe(listLinkedSalesDocsQuerySchema)) query: ListLinkedSalesDocsQuery,
    @GrantedScope('record.sales-docs.read') scope: RecordScope,
  ) {
    return this.docs.forContact(contactId, query, scope);
  }
}

/** A deal's documents, for the deal drawer. */
@ApiTags('sales-docs')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'deals/:dealId/sales-docs', version: '2' })
export class DealSalesDocsController {
  constructor(private readonly docs: SalesDocsService) {}

  @Get()
  @RequirePermission('record.sales-docs.read')
  @ApiOperation({
    summary: "A deal's proposals and estimates (same filters and paging as the list)",
    description:
      'Needs record.sales-docs.read and record.deals.read on the deal (its record scope applies: a deal the caller cannot see is 404).',
  })
  list(
    @Param('dealId', ParseUUIDPipe) dealId: string,
    @Query(zodPipe(listLinkedSalesDocsQuerySchema)) query: ListLinkedSalesDocsQuery,
    @GrantedScope('record.sales-docs.read') scope: RecordScope,
  ) {
    return this.docs.forDeal(dealId, query, scope);
  }
}
