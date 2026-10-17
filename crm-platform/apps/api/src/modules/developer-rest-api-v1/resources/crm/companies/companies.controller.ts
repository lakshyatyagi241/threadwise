import { Body, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import {
  v1CompaniesQuerySchema,
  v1CreateCompanySchema,
  v1ListQuerySchema,
  type V1CompaniesQuery,
  type V1CreateCompany,
  type V1ListQuery,
} from '@crm/contracts';
import { zodPipe } from '../../../../../common/pipes/zod-validation.pipe';
import { RequireApiScope } from '../../../auth/api-scope';
import { V1Controller } from '../../../http/v1-controller.decorator';
import { ok, pageMeta } from '../../../http/v1-envelope';
import { CompaniesPlanGuard } from './companies-plan.guard';
import { V1CompaniesService } from './companies.service';

// The plan guard sits above `@V1Controller` so it runs after the key guard (it needs the key workspace) and before any pipe.
@UseGuards(CompaniesPlanGuard)
@V1Controller('companies')
export class V1CompaniesController {
  constructor(private readonly companies: V1CompaniesService) {}

  @Get()
  @RequireApiScope('companies:read')
  @ApiOperation({ summary: 'List companies, newest first, filtered by name, industry or owner' })
  async list(
    @Query(zodPipe(v1ListQuerySchema)) paging: V1ListQuery,
    @Query(zodPipe(v1CompaniesQuerySchema)) filter: V1CompaniesQuery,
  ) {
    const res = await this.companies.list(paging, filter);
    return ok(res.data, pageMeta(res.page));
  }

  @Get(':id')
  @RequireApiScope('companies:read')
  @ApiOperation({
    summary: 'One company, with its custom_fields (the workspace company properties)',
  })
  async show(@Param('id') id: string) {
    return ok(await this.companies.show(id));
  }

  @Post()
  @RequireApiScope('companies:write')
  @ApiOperation({
    summary: 'Create a company; custom_fields are checked against the company properties',
  })
  async create(@Body(zodPipe(v1CreateCompanySchema)) body: V1CreateCompany) {
    return ok(await this.companies.create(body));
  }

  // The body is validated after the company is found, so an unknown id with a bad body is a 404.
  @Put(':id')
  @RequireApiScope('companies:write')
  @ApiOperation({ summary: 'Change only the fields sent; custom_fields merge, null clears a key' })
  async update(@Param('id') id: string, @Body() raw: unknown) {
    return ok(await this.companies.update(id, raw));
  }

  @Patch(':id')
  @RequireApiScope('companies:write')
  @ApiOperation({ summary: 'Alias of PUT' })
  async patch(@Param('id') id: string, @Body() raw: unknown) {
    return ok(await this.companies.update(id, raw));
  }

  @Delete(':id')
  @RequireApiScope('companies:write')
  @ApiOperation({
    summary: 'Delete a company; its contacts, deals and tasks are kept and unlinked',
  })
  async remove(@Param('id') id: string) {
    return ok(await this.companies.remove(id));
  }
}
