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
  applyTaxPresetsSchema,
  createTaxRateSchema,
  listTaxPresetsQuerySchema,
  listTaxRatesQuerySchema,
  updateTaxRateSchema,
  type ApplyTaxPresetsInput,
  type CreateTaxRateInput,
  type ListTaxPresetsQuery,
  type ListTaxRatesQuery,
  type UpdateTaxRateInput,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { SalesPipelineGuard } from '../deals/deals-plan';
import { TaxRatesService } from './tax-rates.service';
import { RequirePlanFeature } from '../../plans-subscriptions-trials';

/** Tax rates: named, typed percentages an invoice line can point at (inclusive or exclusive, one default per workspace). */
@ApiTags('tax-rates')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'tax-rates', version: '2' })
export class TaxRatesController {
  constructor(private readonly taxRates: TaxRatesService) {}

  @Get()
  @RequirePermission('record.tax-rates.read')
  @ApiOperation({
    summary: 'List tax rates (default first)',
    description:
      'active=true lists only the rates that can be picked today (active and inside their effective dates).',
  })
  async list(@Query(zodPipe(listTaxRatesQuerySchema)) query: ListTaxRatesQuery) {
    return this.taxRates.list(query);
  }

  // Plan feature on write routes only: a downgraded workspace still reads and prints the documents it has; public invoice pages and the gateway webhook are separate open controllers.
  @RequirePlanFeature('invoicing')
  @Post()
  @RequirePermission('record.tax-rates.create')
  @ApiOperation({
    summary: 'Create a tax rate',
    description:
      'Components of a compound rate must add up to the rate (422 TAX_RATE_INVALID). A taken name is 409 TAX_RATE_NAME_TAKEN. isDefault makes it the workspace default.',
  })
  async create(@Body(zodPipe(createTaxRateSchema)) body: CreateTaxRateInput) {
    return this.taxRates.create(body);
  }

  @Get('presets')
  @RequirePermission('record.tax-rates.read')
  @ApiOperation({
    summary: "A country's tax rates from the tax engine, as ready-to-use rows (docs/tax-engine.md)",
    description:
      "Defaults compiled from public sources on a stated date, not legal or tax advice. `exists` marks the ones the workspace already has. India's combined slabs come as a CGST + SGST row and an IGST row.",
  })
  async presets(@Query(zodPipe(listTaxPresetsQuerySchema)) query: ListTaxPresetsQuery) {
    return this.taxRates.presets(query);
  }

  @RequirePlanFeature('invoicing')
  @Post('presets')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.tax-rates.create')
  @ApiOperation({
    summary: 'Create tax rates from a country preset',
    description:
      'Names already in use are skipped, so applying twice adds nothing. The first row marked default becomes the workspace default when there is none.',
  })
  async applyPresets(@Body(zodPipe(applyTaxPresetsSchema)) body: ApplyTaxPresetsInput) {
    return this.taxRates.applyPresets(body);
  }

  @Get(':id')
  @RequirePermission('record.tax-rates.read')
  @ApiOperation({ summary: 'Get one tax rate' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.taxRates.get(id);
  }

  @RequirePlanFeature('invoicing')
  @Patch(':id')
  @RequirePermission('record.tax-rates.update')
  @ApiOperation({
    summary: 'Edit a tax rate',
    description:
      'Requires the rowVersion you read. Invoices already written keep the rate they were priced with.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateTaxRateSchema)) body: UpdateTaxRateInput,
  ) {
    return this.taxRates.update(id, body);
  }

  @RequirePlanFeature('invoicing')
  @Post(':id/default')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.tax-rates.update')
  @ApiOperation({
    summary: 'Make this the workspace default rate (the previous default stops being one)',
  })
  async setDefault(@Param('id', ParseUUIDPipe) id: string) {
    return this.taxRates.setDefault(id);
  }

  @RequirePlanFeature('invoicing')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.tax-rates.delete')
  @ApiOperation({ summary: 'Delete a tax rate (invoices written with it keep their snapshot)' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.taxRates.remove(id);
  }
}
