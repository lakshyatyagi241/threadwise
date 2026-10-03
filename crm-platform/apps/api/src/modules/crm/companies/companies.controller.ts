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
  bulkCompanyIdsSchema,
  companySelectQuerySchema,
  companyStatsQuerySchema,
  createCompanySchema,
  linkCompanyContactsSchema,
  listCompaniesQuerySchema,
  listCompanyActivityQuerySchema,
  listCompanyContactsQuerySchema,
  updateCompanySchema,
  type BulkCompanyIdsInput,
  type CompanySelectQuery,
  type CompanyStatsQuery,
  type CreateCompanyInput,
  type LinkCompanyContactsInput,
  type ListCompaniesQuery,
  type ListCompanyActivityQuery,
  type ListCompanyContactsQuery,
  type RecordScope,
  type UpdateCompanyInput,
} from '@crm/contracts';
import {
  ActorKinds,
  GrantedScope,
  Idempotent,
  RequirePermission,
} from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { SalesPipelineGuard } from '../deals/deals-plan';
import { CompaniesService } from './companies.service';

/**
 * Companies (TW-CTP-001..). Every route needs the plan's sales pipeline (the flag Reference gated companies on) and the capability it
 * names; "scope" is the caller's record scope over who owns the company or created it (all / team / own).
 *
 * Literal paths (`stats`, `industries`, `select-data`, `bulk/delete`) are declared before `:id`: Express matches in registration
 * order, and `POST bulk/delete` would otherwise never be reached.
 */
@ApiTags('companies')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'companies', version: '2' })
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @RequirePermission('record.companies.read')
  @ApiOperation({
    summary: 'List companies (cursor paginated)',
    description:
      'Newest first by default (sort=name for A to Z). Filters: q (substring of the name), ownerId, unassigned, industry, hasOpenDeals. Every row carries its rollup: contact count, deal counts and open / won value per currency (null for a kind the caller cannot read).',
  })
  async list(
    @Query(zodPipe(listCompaniesQuerySchema)) query: ListCompaniesQuery,
    @GrantedScope('record.companies.read') scope: RecordScope,
  ) {
    return this.companies.list(query, scope);
  }

  @Get('stats')
  @RequirePermission('record.companies.read')
  @ApiOperation({
    summary: 'The tiles over the list: companies, with an open deal, won value',
    description: 'Same filters as the list, so the tiles follow the search box.',
  })
  async stats(
    @Query(zodPipe(companyStatsQuerySchema)) query: CompanyStatsQuery,
    @GrantedScope('record.companies.read') scope: RecordScope,
  ) {
    return this.companies.stats(query, scope);
  }

  @Get('industries')
  @RequirePermission('record.companies.read')
  @ApiOperation({ summary: 'The distinct industries typed so far, for the industry filter' })
  async industries(@GrantedScope('record.companies.read') scope: RecordScope) {
    return this.companies.industries(scope);
  }

  @Get('select-data')
  @RequirePermission('record.companies.read')
  @ApiOperation({
    summary: 'Lightweight rows for pickers and typeaheads (Reference: GET companies/search)',
    description: 'Up to `limit` companies (default 20) whose name contains `q`, newest first.',
  })
  async selectData(
    @Query(zodPipe(companySelectQuerySchema)) query: CompanySelectQuery,
    @GrantedScope('record.companies.read') scope: RecordScope,
  ) {
    return this.companies.selectData(query, scope);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.companies.create')
  @ApiOperation({
    summary: 'Create a company',
    description:
      'Only the name is required. Omit ownerId for the caller, send null for nobody; an owner who is not an active member is 422 COMPANY_OWNER_INVALID. Duplicate names are allowed, as in Reference.',
  })
  async create(@Body(zodPipe(createCompanySchema)) body: CreateCompanyInput) {
    return this.companies.create(body);
  }

  @Post('bulk/delete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.companies.delete')
  @ApiOperation({
    summary: 'Delete several companies (audited; each emits company.deleted)',
    description:
      'Unknown ids and ids outside the caller scope are listed in `failed`; they do not stop the rest. Contacts, deals and every other record that pointed at a company are kept and unlinked.',
  })
  async bulkDelete(
    @Body(zodPipe(bulkCompanyIdsSchema)) body: BulkCompanyIdsInput,
    @GrantedScope('record.companies.delete') scope: RecordScope,
  ) {
    return this.companies.bulkDelete(body, scope);
  }

  @Get(':id')
  @RequirePermission('record.companies.read')
  @ApiOperation({ summary: 'Get one company by uuid, with its rollup' })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.companies.read') scope: RecordScope,
  ) {
    return this.companies.get(id, scope);
  }

  @Patch(':id')
  @RequirePermission('record.companies.update')
  @ApiOperation({
    summary: 'Update a company',
    description:
      'Requires the rowVersion you read (409 ROW_VERSION_CONFLICT otherwise). Absent keeps, null or an empty string clears; the name cannot be cleared.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateCompanySchema)) body: UpdateCompanyInput,
    @GrantedScope('record.companies.update') scope: RecordScope,
  ) {
    return this.companies.update(id, body, scope);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.companies.delete')
  @ApiOperation({
    summary: 'Delete a company (audited; emits company.deleted)',
    description:
      'Its contacts and deals are kept and unlinked, and so is everything else that pointed at it (tasks, projects, proposals, invoices, payments).',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.companies.delete') scope: RecordScope,
  ): Promise<void> {
    await this.companies.remove(id, scope);
  }

  // --- the company's contacts ----------------------------------------------------------------------------------------------

  @Get(':id/contacts')
  @RequirePermission('record.companies.read')
  @ApiOperation({
    summary: "A company's contacts (newest first, cursor paginated)",
    description:
      'Needs record.contacts.read too, and its record scope applies: a contact the caller cannot see is not listed.',
  })
  async contacts(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listCompanyContactsQuerySchema)) query: ListCompanyContactsQuery,
    @GrantedScope('record.companies.read') scope: RecordScope,
  ) {
    return this.companies.listContacts(id, query, scope);
  }

  @Post(':id/contacts')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.companies.update')
  @ApiOperation({
    summary: 'Put existing contacts under the company',
    description:
      'Needs record.contacts.update too (its record scope applies to each contact). A contact that belonged to another company moves. Unknown ids and contacts outside the caller scope are listed in `failed`; they do not stop the rest.',
  })
  async linkContacts(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(linkCompanyContactsSchema)) body: LinkCompanyContactsInput,
    @GrantedScope('record.companies.update') scope: RecordScope,
  ) {
    return this.companies.linkContacts(id, body, scope);
  }

  @Delete(':id/contacts/:contactId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.companies.update')
  @ApiOperation({
    summary: 'Take a contact out of the company (the contact is kept)',
    description:
      "404 when the contact is not one of the company's contacts. Needs record.contacts.update too.",
  })
  async unlinkContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @GrantedScope('record.companies.update') scope: RecordScope,
  ): Promise<void> {
    await this.companies.unlinkContact(id, contactId, scope);
  }

  @Get(':id/activity')
  @RequirePermission('record.companies.read')
  @ApiOperation({
    summary: "The company's activity: who changed what, newest first",
    description:
      'Read from the audit trail: the create, each edit (field by field), contacts linked and unlinked.',
  })
  async activity(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listCompanyActivityQuerySchema)) query: ListCompanyActivityQuery,
    @GrantedScope('record.companies.read') scope: RecordScope,
  ) {
    return this.companies.activity(id, query, scope);
  }
}
