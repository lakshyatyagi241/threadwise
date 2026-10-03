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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  SCHEDULE_MIN_LEAD_MINUTES,
  createScheduleInputSchema,
  listSchedulesQuerySchema,
  previewAudienceInputSchema,
  retryScheduleInputSchema,
  updateScheduleInputSchema,
  type CreateScheduleInput,
  type ListSchedulesQuery,
  type RetryScheduleInput,
  type UpdateScheduleInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { RequestContextStore } from '../../common/context/request-context';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { DatabaseService } from '../../infra/db/database.service';
import { ScheduleActionsService } from './schedule-actions.service';
import { ScheduleAudienceService } from './audience/schedule-audience.service';
import { ScheduleCreateService } from './schedule-create.service';
import { ScheduleReadService } from './schedule-read.service';

/**
 * Scheduled messages (SCHED, TW-SCHED-001 to 019): the list with its stats, the composer's pickers, create, the detail, and what
 * a person does to a schedule. Reads need `sched.schedules.read`; every change `sched.schedules.manage`. A schedule is addressed by
 * uuid and looked up in the caller's workspace, so another workspace's id is a 404.
 */
@ApiTags('scheduled')
@ActorKinds('user')
@Controller({ path: 'scheduled', version: '2' })
export class ScheduledController {
  constructor(
    private readonly create: ScheduleCreateService,
    private readonly read: ScheduleReadService,
    private readonly actions: ScheduleActionsService,
    private readonly audience: ScheduleAudienceService,
    private readonly db: DatabaseService,
  ) {}

  @Get()
  @RequirePermission('sched.schedules.read')
  @ApiOperation({ summary: 'Scheduled messages with tab counts, search and the next one due' })
  list(@Query(zodPipe(listSchedulesQuerySchema)) q: ListSchedulesQuery) {
    return this.read.list(q);
  }

  @Get('options')
  @RequirePermission('sched.schedules.read')
  @ApiOperation({
    summary: 'What the composer offers: senders, groups, tags, earlier broadcasts and templates',
  })
  options() {
    return this.read.options(SCHEDULE_MIN_LEAD_MINUTES);
  }

  @Post('audience-preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('sched.schedules.manage')
  @ApiOperation({
    summary: 'How many people a draft audience would reach, and how many were left out',
  })
  async preview(
    @Body(zodPipe(previewAudienceInputSchema))
    body: ReturnType<typeof previewAudienceInputSchema.parse>,
  ) {
    const { orgId } = RequestContextStore.require();
    const r = await this.db.tx((tx) => this.audience.resolve(tx, orgId, body));
    return {
      total: r.recipients.length,
      optedOut: r.optedOut,
      sample: r.recipients.slice(0, 5).map((x) => x.phone),
    };
  }

  @Post()
  @RequirePermission('sched.schedules.manage')
  @Idempotent()
  @ApiOperation({ summary: 'Create a schedule (one per sender when the audience is split)' })
  schedule(@Body(zodPipe(createScheduleInputSchema)) body: CreateScheduleInput) {
    return this.create.create(body);
  }

  @Get(':id')
  @RequirePermission('sched.schedules.read')
  @ApiOperation({ summary: 'One schedule with its recipients and progress' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.read.detail(id);
  }

  @Patch(':id')
  @RequirePermission('sched.schedules.manage')
  @ApiOperation({ summary: 'Change the name, time or message of a waiting or paused schedule' })
  async edit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateScheduleInputSchema)) body: UpdateScheduleInput,
  ) {
    await this.actions.edit(id, body);
    return this.read.detail(id);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('sched.schedules.manage')
  async pause(@Param('id', ParseUUIDPipe) id: string) {
    await this.actions.pause(id);
    return this.read.detail(id);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('sched.schedules.manage')
  async resume(@Param('id', ParseUUIDPipe) id: string) {
    await this.actions.resume(id);
    return this.read.detail(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('sched.schedules.manage')
  async cancel(@Param('id', ParseUUIDPipe) id: string) {
    await this.actions.cancel(id);
    return this.read.detail(id);
  }

  @Post(':id/run-now')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('sched.schedules.manage')
  async runNow(@Param('id', ParseUUIDPipe) id: string) {
    await this.actions.runNow(id);
    return this.read.detail(id);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('sched.schedules.manage')
  @ApiOperation({
    summary:
      'Give a failed schedule a new time; failed recipients are tried again, sent ones are not',
  })
  async retry(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(retryScheduleInputSchema)) body: RetryScheduleInput,
  ) {
    await this.actions.retry(id, body);
    return this.read.detail(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('sched.schedules.manage')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.actions.remove(id);
  }
}
