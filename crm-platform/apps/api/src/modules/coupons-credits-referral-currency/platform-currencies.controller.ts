import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createCurrencyRequestSchema,
  listCurrenciesQuerySchema,
  setCurrencyActiveRequestSchema,
  setDefaultCurrencyRequestSchema,
  updateCurrencyRequestSchema,
  uuidSchema,
  type CreateCurrencyRequest,
  type ListCurrenciesQuery,
  type SetCurrencyActiveRequest,
  type SetDefaultCurrencyRequest,
  type UpdateCurrencyRequest,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { CurrenciesService } from './currencies.service';

/** The operator's currency catalog (TW-CPN-018..024): every operator role reads, only super admins write. */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/currencies', version: '2' })
export class PlatformCurrenciesController {
  constructor(private readonly currencies: CurrenciesService) {}

  @Get()
  @ApiOperation({ summary: 'The catalog by code, with KPIs, the default and the active options' })
  list(@Query(zodPipe(listCurrenciesQuerySchema)) q: ListCurrenciesQuery) {
    return this.currencies.list(q);
  }

  @Post()
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Add a currency' })
  create(@Body(zodPipe(createCurrencyRequestSchema)) body: CreateCurrencyRequest) {
    return this.currencies.create(body);
  }

  @Put('default')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Make an active catalog currency the platform default' })
  setDefault(@Body(zodPipe(setDefaultCurrencyRequestSchema)) body: SetDefaultCurrencyRequest) {
    return this.currencies.setDefault(body.code);
  }

  @Post('fetch-rates')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Pull live USD-based rates and update every catalog currency the provider knows',
  })
  fetchRates() {
    return this.currencies.fetchRates();
  }

  @Patch(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Edit name, symbol, decimals, rate or active (the code never changes)' })
  update(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updateCurrencyRequestSchema)) body: UpdateCurrencyRequest,
  ) {
    return this.currencies.update(id, body);
  }

  @Put(':id/active')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Switch a currency on or off (the default cannot be switched off)' })
  setActive(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(setCurrencyActiveRequestSchema)) body: SetCurrencyActiveRequest,
  ) {
    return this.currencies.setActive(id, body.value);
  }

  @Delete(':id')
  @OperatorRoles('super_admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a currency nothing uses (never the default)' })
  async remove(@Param('id', zodPipe(uuidSchema)) id: string) {
    await this.currencies.remove(id);
  }
}
