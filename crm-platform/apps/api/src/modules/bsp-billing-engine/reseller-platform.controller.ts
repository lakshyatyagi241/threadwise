import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  attachCreditSchema,
  bspDashboardQuerySchema,
  listBspAllocationsQuerySchema,
  updateBspSettingsSchema,
  uuidSchema,
  type AttachCreditInput,
  type BspDashboardQuery,
  type ListBspAllocationsQuery,
  type UpdateBspSettingsInput,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { ResellerCreditService } from './reseller-credit.service';
import { ResellerReportService } from './reseller-report.service';
import { ResellerSettingsService } from './reseller-settings.service';

const revokeBodySchema = z
  .object({ rowVersion: z.number().int().positive().optional() })
  .default({});

function operatorId(): number {
  const id = RequestContextStore.require().actorId;
  if (!id) throw AppError.unauthenticated();
  return id;
}

/**
 * The reseller console for platform operators (TW-BSP-001, -003, -004, -006, -007, -009, -010, -014, -015). Every operator role
 * reads; only super admins change the connection or move a credit line, and each of those writes an audit row naming them.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/bsp', version: '2' })
export class ResellerPlatformController {
  constructor(
    private readonly settings: ResellerSettingsService,
    private readonly credit: ResellerCreditService,
    private readonly report: ResellerReportService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Health probe: configured, Graph version and allocation count' })
  async status() {
    return this.report.status();
  }

  @Get('settings')
  @ApiOperation({
    summary: 'The Meta connection. The token is never returned, only whether one is stored',
  })
  async getSettings() {
    return this.settings.view();
  }

  @Put('settings')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary:
      'Save the Meta connection (blank clears a field; the token changes only when one is sent)',
  })
  async saveSettings(@Body(zodPipe(updateBspSettingsSchema)) body: UpdateBspSettingsInput) {
    return this.settings.save(body, operatorId());
  }

  @Get('waba-candidates')
  @ApiOperation({ summary: 'Connected Cloud API numbers of every workspace, for the attach form' })
  async candidates() {
    return this.credit.wabaCandidates();
  }

  @Get('allocations')
  @ApiOperation({
    summary: 'Credit allocations of every workspace, newest first (cursor paginated)',
  })
  async list(@Query(zodPipe(listBspAllocationsQuerySchema)) query: ListBspAllocationsQuery) {
    return this.credit.list(query);
  }

  @Post('allocations')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Attach the credit line to one customer WABA',
    description:
      'A refusal by Meta is not an error: the response is the allocation with status `failed` and `lastError` holding the reason.',
  })
  async attach(@Body(zodPipe(attachCreditSchema)) body: AttachCreditInput) {
    return this.credit.attachOne(body.workspaceId, body.wabaId, body.currency, operatorId());
  }

  @Post('allocations/attach-all')
  @OperatorRoles('super_admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Attach every connected reseller number that is not attached (one bounded batch; repeat while `remaining` > 0)',
  })
  async attachAll() {
    return this.credit.attachAll(operatorId());
  }

  @Post('allocations/:id/revoke')
  @OperatorRoles('super_admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke an attached credit line at Meta' })
  async revoke(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(revokeBodySchema)) body: z.infer<typeof revokeBodySchema>,
  ) {
    return this.credit.revoke(id, operatorId(), body.rowVersion);
  }

  @Get('dashboard')
  @ApiOperation({
    summary: 'Reseller P&L of a month: revenue, Meta cost, margin, wallet float, per workspace',
  })
  async dashboard(@Query(zodPipe(bspDashboardQuerySchema)) query: BspDashboardQuery) {
    return this.report.dashboard(query);
  }
}
