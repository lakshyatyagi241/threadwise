import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createWabooMigrationBatchSchema,
  createWabooMigrationRunSchema,
  uuidSchema,
  wabooMigrationReadinessQuerySchema,
  wabooMigrationRunsQuerySchema,
  type CreateWabooMigrationBatchInput,
  type CreateWabooMigrationRunInput,
  type WabooMigrationRunsQuery,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { WabooMigrationService } from './waboo-migration.service';

/** The Waboo migration panel API. Super admins only, reads included: a run names an organization and its database. */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@OperatorRoles('super_admin')
@Controller({ path: 'platform/waboo-migration', version: '2' })
export class WabooMigrationController {
  constructor(private readonly runs: WabooMigrationService) {}

  @Post('runs')
  @ApiOperation({
    summary: 'Queue (or schedule) a migration run for one Waboo organization (dry by default)',
    description:
      'organizationId is the Waboo workspace id (database name); the client key is derived from it unless given. runAt (optional, future, max 90 days) schedules it. mode "load" needs confirm equal to the organization id and a green dry run from the last 24 hours, re-checked by the worker right before it starts. One active run per client.',
  })
  async create(@Body(zodPipe(createWabooMigrationRunSchema)) body: CreateWabooMigrationRunInput) {
    return this.runs.create(body);
  }

  @Get('runs')
  @ApiOperation({ summary: 'Runs, newest first' })
  async list(@Query(zodPipe(wabooMigrationRunsQuerySchema)) query: WabooMigrationRunsQuery) {
    return { data: await this.runs.list(query.limit) };
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'One run with its step timeline, verdict and report' })
  async get(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.runs.get(id);
  }

  @Post('runs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a queued or scheduled run',
    description: 'A running migration cannot be cancelled in v1 (409 WMIG_NOT_CANCELLABLE).',
  })
  async cancel(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.runs.cancel(id);
  }

  @Post('readiness')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Is the latest dry run of each organization green and fresh enough to load?',
  })
  async readiness(
    @Body(zodPipe(wabooMigrationReadinessQuerySchema)) body: { organizationIds: string[] },
  ) {
    return this.runs.readiness(body.organizationIds);
  }

  @Post('batches')
  @ApiOperation({
    summary: 'Queue (or schedule) a migration for up to 50 organizations, run one after another',
    description:
      'mode "load" needs confirmCount equal to the number of organizations and a green dry run from the last 24 hours for EVERY organization (422 WMIG_DRY_RUN_REQUIRED lists the missing ones). A failed organization does not stop the rest unless stopOnFailure is true.',
  })
  async createBatch(
    @Body(zodPipe(createWabooMigrationBatchSchema)) body: CreateWabooMigrationBatchInput,
  ) {
    return this.runs.createBatch(body);
  }

  @Get('batches')
  @ApiOperation({ summary: 'Batches, newest first' })
  async listBatches(@Query(zodPipe(wabooMigrationRunsQuerySchema)) query: WabooMigrationRunsQuery) {
    return { data: await this.runs.listBatches(query.limit) };
  }

  @Get('batches/:id')
  @ApiOperation({ summary: 'One batch with every organization, its steps and verdict' })
  async getBatch(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.runs.getBatch(id);
  }

  @Post('batches/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cancel a queued or scheduled batch (a running batch stops after the organization in progress)',
  })
  async cancelBatch(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.runs.cancelBatch(id);
  }
}
