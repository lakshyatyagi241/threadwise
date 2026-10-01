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
  boardQuerySchema,
  boardStageQuerySchema,
  createDealActivitySchema,
  createDealSchema,
  dealReportsQuerySchema,
  listDealActivitiesQuerySchema,
  listDealsQuerySchema,
  listDealTasksQuerySchema,
  markDealLostSchema,
  markDealWonSchema,
  moveDealStageSchema,
  reopenDealSchema,
  updateDealSchema,
  type BoardQuery,
  type BoardStageQuery,
  type CreateDealActivityInput,
  type CreateDealInput,
  type DealReportsQuery,
  type ListDealActivitiesQuery,
  type ListDealsQuery,
  type ListDealTasksQuery,
  type MarkDealLostInput,
  type MarkDealWonInput,
  type MoveDealStageInput,
  type RecordScope,
  type ReopenDealInput,
  type UpdateDealInput,
} from '@crm/contracts';
import {
  ActorKinds,
  GrantedScope,
  Idempotent,
  RequirePermission,
} from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { DealActivitiesService } from './deal-activities.service';
import { DealBoardService } from './deal-board.service';
import { DealReportsService } from './deal-reports.service';
import { SalesPipelineGuard } from './deals-plan';
import { DealsService } from './deals.service';

/**
 * Deals (TW-DEAL-003..016, 019). Every route needs the plan's sales pipeline and the capability it names; "scope" is the
 * caller's record scope over the deal's owner (all / team / own), applied to which deals the call can see or change.
 * Literal paths (`board`, `reports`, `tasks`) are declared before `:id`.
 */
@ApiTags('deals')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'deals', version: '2' })
export class DealsController {
  constructor(
    private readonly deals: DealsService,
    private readonly board: DealBoardService,
    private readonly reports: DealReportsService,
    private readonly activities: DealActivitiesService,
  ) {}

  @Get()
  @RequirePermission('record.deals.read')
  @ApiOperation({ summary: 'List deals (cursor paginated, newest first)' })
  async list(
    @Query(zodPipe(listDealsQuerySchema)) query: ListDealsQuery,
    @GrantedScope('record.deals.read') scope: RecordScope,
  ) {
    return this.deals.list(query, scope);
  }

  @Get('board')
  @RequirePermission('record.deals.read')
  @ApiOperation({
    summary: 'The Kanban board of one pipeline',
    description:
      'One column per stage with the first page of cards, the column count and per-currency totals, and the KPI strip. Load more of a column with `board/stages/:stageId/deals`.',
  })
  async boardOf(
    @Query(zodPipe(boardQuerySchema)) query: BoardQuery,
    @GrantedScope('record.deals.read') scope: RecordScope,
  ) {
    return this.board.board(query, scope);
  }

  @Get('board/stages/:stageId/deals')
  @RequirePermission('record.deals.read')
  @ApiOperation({ summary: 'The next page of one board column, in the column order' })
  async stagePage(
    @Param('stageId', ParseUUIDPipe) stageId: string,
    @Query(zodPipe(boardStageQuerySchema)) query: BoardStageQuery,
    @GrantedScope('record.deals.read') scope: RecordScope,
  ) {
    return this.board.stagePage(stageId, query, scope);
  }

  @Get('reports')
  @RequirePermission('record.deals.report')
  @ApiOperation({
    summary: 'Pipeline reports',
    description:
      'Per-currency totals (pass `convertTo` for one currency), open-only forecast, won this month in the workspace zone, win rate, value by stage, six months of won/lost, top owners and lost reasons.',
  })
  async report(
    @Query(zodPipe(dealReportsQuerySchema)) query: DealReportsQuery,
    @GrantedScope('record.deals.report') scope: RecordScope,
  ) {
    return this.reports.reports(query, scope);
  }

  @Get('tasks')
  @RequirePermission('record.deals.read')
  @ApiOperation({ summary: 'Tasks across deals (mine, overdue, ...), soonest due first' })
  async tasks(
    @Query(zodPipe(listDealTasksQuerySchema)) query: ListDealTasksQuery,
    @GrantedScope('record.deals.read') scope: RecordScope,
  ) {
    return this.activities.tasks(query, scope);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.deals.create')
  @ApiOperation({
    summary: 'Create a deal',
    description:
      'Omit the pipeline for the default one and the stage for its first. A stage of another pipeline is 422 DEAL_STAGE_MISMATCH; an owner who is not an active member is 422 DEAL_OWNER_INVALID.',
  })
  async create(@Body(zodPipe(createDealSchema)) body: CreateDealInput) {
    return this.deals.create(body);
  }

  @Get(':id')
  @RequirePermission('record.deals.read')
  @ApiOperation({ summary: 'Get one deal by uuid' })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.deals.read') scope: RecordScope,
  ) {
    return this.deals.get(id, scope);
  }

  @Patch(':id')
  @RequirePermission('record.deals.update')
  @ApiOperation({
    summary: 'Update a deal',
    description:
      'Requires the rowVersion you read (409 ROW_VERSION_CONFLICT otherwise). Absent keeps, null clears. A new currency needs the value with it. The stage moves through `:id/stage`.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateDealSchema)) body: UpdateDealInput,
    @GrantedScope('record.deals.update') scope: RecordScope,
  ) {
    return this.deals.update(id, body, scope);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.deals.delete')
  @ApiOperation({ summary: 'Delete a deal and its timeline (audited; emits deal.deleted)' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.deals.delete') scope: RecordScope,
  ): Promise<void> {
    await this.deals.remove(id, scope);
  }

  @Patch(':id/stage')
  @RequirePermission('record.deals.update')
  @ApiOperation({
    summary: 'Move a deal to a stage, or within its column',
    description:
      'Status and won/lost stamps follow the stage. `beforeDealId` / `afterDealId` place the card between two others and the order persists. A move into a lost stage needs a reason when the workspace requires one.',
  })
  async move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(moveDealStageSchema)) body: MoveDealStageInput,
    @GrantedScope('record.deals.update') scope: RecordScope,
  ) {
    return this.deals.moveStage(id, body, scope);
  }

  @Post(':id/won')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.deals.update')
  @ApiOperation({ summary: "Mark a deal won: moves it to the pipeline's Won stage" })
  async won(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(markDealWonSchema)) body: MarkDealWonInput,
    @GrantedScope('record.deals.update') scope: RecordScope,
  ) {
    return this.deals.markWon(id, body, scope);
  }

  @Post(':id/lost')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.deals.update')
  @ApiOperation({
    summary: "Mark a deal lost with a reason: moves it to the pipeline's Lost stage",
    description:
      '`lostReasonId` (catalogue) and/or `reason` (free text). 422 DEAL_LOST_REASON_REQUIRED when the workspace requires one and none is given.',
  })
  async lost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(markDealLostSchema)) body: MarkDealLostInput,
    @GrantedScope('record.deals.update') scope: RecordScope,
  ) {
    return this.deals.markLost(id, body, scope);
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.deals.update')
  @ApiOperation({
    summary: 'Reopen a won or lost deal into an open stage (clears the stamps and the reason)',
  })
  async reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(reopenDealSchema)) body: ReopenDealInput,
    @GrantedScope('record.deals.update') scope: RecordScope,
  ) {
    return this.deals.reopen(id, body, scope);
  }

  // --- timeline and tasks ----------------------------------------------------------------------------------------------

  @Get(':id/activities')
  @RequirePermission('record.deals.read')
  @ApiOperation({
    summary: "The deal's timeline, newest first (notes, calls, tasks, stage changes, ...)",
  })
  async listActivities(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listDealActivitiesQuerySchema)) query: ListDealActivitiesQuery,
    @GrantedScope('record.deals.read') scope: RecordScope,
  ) {
    return this.activities.list(id, query, scope);
  }

  @Post(':id/activities')
  @Idempotent()
  @RequirePermission('record.deals.update')
  @ApiOperation({
    summary: 'Add a note, call, message, email, meeting or task to the timeline',
    description: '`dueAt` and `assigneeId` are for tasks only (422 otherwise).',
  })
  async addActivity(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(createDealActivitySchema)) body: CreateDealActivityInput,
    @GrantedScope('record.deals.update') scope: RecordScope,
  ) {
    return this.activities.add(id, body, scope);
  }

  @Post(':id/activities/:activityId/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.deals.update')
  @ApiOperation({ summary: 'Mark a task done (a no-op when it already is)' })
  async completeTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @GrantedScope('record.deals.update') scope: RecordScope,
  ) {
    return this.activities.complete(id, activityId, scope);
  }

  @Post(':id/activities/:activityId/reopen')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.deals.update')
  @ApiOperation({ summary: 'Reopen a done task (it can be reminded again)' })
  async reopenTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @GrantedScope('record.deals.update') scope: RecordScope,
  ) {
    return this.activities.reopen(id, activityId, scope);
  }
}

/** A contact's deals and rollup, for the contact detail page (TW-DEAL-037). */
@ApiTags('deals')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'contacts/:contactId/deals', version: '2' })
export class ContactDealsController {
  constructor(private readonly deals: DealsService) {}

  @Get()
  @RequirePermission('record.deals.read')
  @ApiOperation({
    summary:
      "A contact's deals (open first, newest first, at most 50) with the open and won rollup",
    description:
      'Needs record.deals.read, and record.contacts.read on the contact (its record scope applies: a contact the caller cannot see is 404).',
  })
  async list(
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @GrantedScope('record.deals.read') scope: RecordScope,
  ) {
    return this.deals.forContact(contactId, scope);
  }
}
