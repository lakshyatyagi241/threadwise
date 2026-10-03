import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createCurrencyRequestSchema,
  currencyListQuerySchema,
  setCurrencyActiveRequestSchema,
  setDefaultCurrencyRequestSchema,
  updateCurrencyRequestSchema,
  uuidSchema,
  type CreateCurrencyPayload,
  type CurrencyListQuery,
  type SetCurrencyActiveRequest,
  type SetDefaultCurrencyRequest,
  type UpdateCurrencyPayload,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { CurrencyAdminService } from './currency-admin.service';

/**
 * The platform currency catalogue for operators (TW-CPN-018..024). Every operator role reads; only super admins write, and every
 * write is recorded in security_events.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/currencies', version: '2' })
export class CurrenciesController {
  constructor(private readonly currencies: CurrencyAdminService) {}

  @Get()
  @ApiOperation({
    summary: 'The catalogue (12 per page, by code) with the KPI strip and the default selector',
  })
  list(@Query(zodPipe(currencyListQuerySchema)) query: CurrencyListQuery) {
    return this.currencies.list(query);
  }

  @Post()
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Add a currency' })
  create(@Body(zodPipe(createCurrencyRequestSchema)) body: CreateCurrencyPayload) {
    return this.currencies.create(body);
  }

  @Post('default')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Choose the platform default currency (must be active)' })
  setDefault(@Body(zodPipe(setDefaultCurrencyRequestSchema)) body: SetDefaultCurrencyRequest) {
    return this.currencies.setDefault(body.code);
  }

  @Post('fetch-rates')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Replace the exchange rates with the live ones from the rate provider' })
  fetchRates() {
    return this.currencies.fetchRates();
  }

  @Patch(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Edit a currency (name, symbol, decimals, rate, active; the code never changes)',
  })
  update(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updateCurrencyRequestSchema)) body: UpdateCurrencyPayload,
  ) {
    return this.currencies.update(id, body);
  }

  @Patch(':id/active')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Turn a currency on or off (the default cannot be turned off)' })
  setActive(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(setCurrencyActiveRequestSchema)) body: SetCurrencyActiveRequest,
  ) {
    return this.currencies.setActive(id, body.isActive);
  }

  @Delete(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Delete a currency (refused for the default and for one still in use)' })
  async remove(@Param('id', zodPipe(uuidSchema)) id: string) {
    await this.currencies.remove(id);
    return { ok: true as const };
  }
}
