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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  bulkAssignTasksSchema,
  bulkTaskIdsSchema,
  createTaskSchema,
  listLinkedTasksQuerySchema,
  listTasksQuerySchema,
  taskCountsQuerySchema,
  taskLinksSchema,
  taskTransitionSchema,
  updateTaskSchema,
  type BulkAssignTasksInput,
  type BulkTaskIdsInput,
  type CreateTaskInput,
  type ListLinkedTasksQuery,
  type ListTasksQuery,
  type RecordScope,
  type TaskCountsQuery,
  type TaskLinksInput,
  type TaskTransitionInput,
  type UpdateTaskInput,
} from '@crm/contracts';
import {
  ActorKinds,
  GrantedScope,
  Idempotent,
  RequirePermission,
} from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { SalesPipelineGuard } from '../deals/deals-plan';
import { TasksService } from './tasks.service';

/**
 * Tasks (TW-TASK-001..013). Every route needs the plan's sales pipeline (the flag Reference gated tasks on) and the capability it
 * names; "scope" is the caller's record scope over who the task is assigned to or created by (all / team / own).
 *
 * Literal paths (`my`, `counts`, `bulk/...`) are declared before `:id`: Express matches in registration order, and
 * `POST bulk/complete` would otherwise be read as `:id/complete` with the id "bulk".
 */
@ApiTags('tasks')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'tasks', version: '2' })
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequirePermission('record.tasks.read')
  @ApiOperation({
    summary: 'List tasks (cursor paginated)',
    description:
      'Open tasks by default, soonest due first (undated last). Filters: status, due (overdue | today | upcoming | none, cut in the workspace time zone), dueFrom/dueTo, priority, mine, assigneeId, unassigned, contactId, dealId, companyId, q (title). Sort: due | created | completed.',
  })
  async list(
    @Query(zodPipe(listTasksQuerySchema)) query: ListTasksQuery,
    @GrantedScope('record.tasks.read') scope: RecordScope,
  ) {
    return this.tasks.list(query, scope);
  }

  @Get('my')
  @RequirePermission('record.tasks.read')
  @ApiOperation({
    summary: 'My tasks: the list filtered to tasks assigned to the caller',
    description: 'Same query as the list; `mine` is forced on.',
  })
  async mine(
    @Query(zodPipe(listTasksQuerySchema)) query: ListTasksQuery,
    @GrantedScope('record.tasks.read') scope: RecordScope,
  ) {
    return this.tasks.myTasks(query, scope);
  }

  @Get('counts')
  @RequirePermission('record.tasks.read')
  @ApiOperation({
    summary: 'Counts per bucket for the tab badges',
    description:
      "overdue / today / upcoming / noDate partition the open tasks inside the filter; `done` counts completed ones; `mine` is the caller's own open and overdue count.",
  })
  async counts(
    @Query(zodPipe(taskCountsQuerySchema)) query: TaskCountsQuery,
    @GrantedScope('record.tasks.read') scope: RecordScope,
  ) {
    return this.tasks.counts(query, scope);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.tasks.create')
  @ApiOperation({
    summary: 'Create a task',
    description:
      'Omit the assignee for the caller, send null for nobody. An assignee who is not an active member is 422 TASK_ASSIGNEE_INVALID; a contact, deal or company that is not in the workspace is 404. A deal brings its contact and company unless named.',
  })
  async create(@Body(zodPipe(createTaskSchema)) body: CreateTaskInput) {
    return this.tasks.create(body);
  }

  // --- bulk (literal paths, before :id) -----------------------------------------------------------------------------------

  @Post('bulk/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.tasks.update')
  @ApiOperation({
    summary: 'Complete several tasks',
    description:
      'Unknown ids and ids outside the caller scope are listed in `failed`; they do not stop the rest. Tasks that are already done succeed without an event.',
  })
  async bulkComplete(
    @Body(zodPipe(bulkTaskIdsSchema)) body: BulkTaskIdsInput,
    @GrantedScope('record.tasks.update') scope: RecordScope,
  ) {
    return this.tasks.bulkComplete(body, scope);
  }

  @Post('bulk/reopen')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.tasks.update')
  @ApiOperation({ summary: 'Reopen several done tasks' })
  async bulkReopen(
    @Body(zodPipe(bulkTaskIdsSchema)) body: BulkTaskIdsInput,
    @GrantedScope('record.tasks.update') scope: RecordScope,
  ) {
    return this.tasks.bulkReopen(body, scope);
  }

  @Post('bulk/assign')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.tasks.update')
  @ApiOperation({
    summary: 'Assign several tasks to one member (or unassign them with null)',
    description:
      'A bad assignee fails the call with 422 TASK_ASSIGNEE_INVALID before any task changes.',
  })
  async bulkAssign(
    @Body(zodPipe(bulkAssignTasksSchema)) body: BulkAssignTasksInput,
    @GrantedScope('record.tasks.update') scope: RecordScope,
  ) {
    return this.tasks.bulkAssign(body, scope);
  }

  @Post('bulk/delete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.tasks.delete')
  @ApiOperation({ summary: 'Delete several tasks (audited; each emits task.deleted)' })
  async bulkDelete(
    @Body(zodPipe(bulkTaskIdsSchema)) body: BulkTaskIdsInput,
    @GrantedScope('record.tasks.delete') scope: RecordScope,
  ) {
    return this.tasks.bulkDelete(body, scope);
  }

  // --- one task ------------------------------------------------------------------------------------------------------------

  @Get(':id')
  @RequirePermission('record.tasks.read')
  @ApiOperation({ summary: 'Get one task by uuid' })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.tasks.read') scope: RecordScope,
  ) {
    return this.tasks.get(id, scope);
  }

  @Patch(':id')
  @RequirePermission('record.tasks.update')
  @ApiOperation({
    summary: 'Update a task',
    description:
      'Requires the rowVersion you read (409 ROW_VERSION_CONFLICT otherwise). Absent keeps, null clears. A new dueAt arms the reminder again. Status changes through complete / reopen.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateTaskSchema)) body: UpdateTaskInput,
    @GrantedScope('record.tasks.update') scope: RecordScope,
  ) {
    return this.tasks.update(id, body, scope);
  }

  @Put(':id/links')
  @RequirePermission('record.tasks.update')
  @ApiOperation({
    summary: 'Link or unlink a contact, a deal and a company',
    description: 'Absent keeps, null unlinks. No rowVersion: last write wins.',
  })
  async links(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(taskLinksSchema)) body: TaskLinksInput,
    @GrantedScope('record.tasks.update') scope: RecordScope,
  ) {
    return this.tasks.setLinks(id, body, scope);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.tasks.update')
  @ApiOperation({ summary: 'Mark a task done (a no-op when it already is)' })
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(taskTransitionSchema)) body: TaskTransitionInput,
    @GrantedScope('record.tasks.update') scope: RecordScope,
  ) {
    return this.tasks.complete(id, body, scope);
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.tasks.update')
  @ApiOperation({ summary: 'Reopen a done task (it can be reminded again)' })
  async reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(taskTransitionSchema)) body: TaskTransitionInput,
    @GrantedScope('record.tasks.update') scope: RecordScope,
  ) {
    return this.tasks.reopen(id, body, scope);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.tasks.delete')
  @ApiOperation({ summary: 'Delete a task (audited; emits task.deleted)' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.tasks.delete') scope: RecordScope,
  ): Promise<void> {
    await this.tasks.remove(id, scope);
  }
}

/** A contact's tasks, for the contact detail page (TW-TASK-008). */
@ApiTags('tasks')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'contacts/:contactId/tasks', version: '2' })
export class ContactTasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequirePermission('record.tasks.read')
  @ApiOperation({
    summary: "A contact's tasks (same filters and paging as the list)",
    description:
      'Needs record.tasks.read, and record.contacts.read on the contact (its record scope applies: a contact the caller cannot see is 404).',
  })
  async list(
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Query(zodPipe(listLinkedTasksQuerySchema)) query: ListLinkedTasksQuery,
    @GrantedScope('record.tasks.read') scope: RecordScope,
  ) {
    return this.tasks.forContact(contactId, query, scope);
  }
}

/** A deal's tasks, for the deal drawer (TW-TASK-014). */
@ApiTags('tasks')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'deals/:dealId/tasks', version: '2' })
export class DealTasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequirePermission('record.tasks.read')
  @ApiOperation({
    summary: "A deal's tasks (same filters and paging as the list)",
    description:
      'Includes the tasks added from the deal timeline. Needs record.tasks.read and record.deals.read on the deal (its record scope applies: a deal the caller cannot see is 404).',
  })
  async list(
    @Param('dealId', ParseUUIDPipe) dealId: string,
    @Query(zodPipe(listLinkedTasksQuerySchema)) query: ListLinkedTasksQuery,
    @GrantedScope('record.tasks.read') scope: RecordScope,
  ) {
    return this.tasks.forDeal(dealId, query, scope);
  }
}
