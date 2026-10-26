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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createTaskOutcomeSchema,
  listTaskOutcomesQuerySchema,
  reorderTaskOutcomesSchema,
  updateTaskOutcomeSchema,
  type CreateTaskOutcomeInput,
  type ListTaskOutcomesQuery,
  type ReorderTaskOutcomesInput,
  type UpdateTaskOutcomeInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { TaskOutcomesService } from './task-outcomes.service';

/**
 * The task outcome list. Reading it needs only `record.tasks.read` (it is what the outcome picker on a task offers); changing it needs
 * `settings.task_outcomes.manage`. No plan gate: the list is a workspace setting, not a sales-pipeline feature.
 */
@ApiTags('tasks')
@ActorKinds('user')
@Controller({ path: 'task-outcomes', version: '2' })
export class TaskOutcomesController {
  constructor(private readonly outcomes: TaskOutcomesService) {}

  @Get()
  @RequirePermission('record.tasks.read')
  @ApiOperation({
    summary: 'List task outcomes in order (activeOnly=true for a picker)',
    description: 'Each outcome carries the number of tasks that use it.',
  })
  async list(@Query(zodPipe(listTaskOutcomesQuerySchema)) query: ListTaskOutcomesQuery) {
    return this.outcomes.list(query.activeOnly ?? false);
  }

  @Post()
  @Idempotent()
  @RequirePermission('settings.task_outcomes.manage')
  @ApiOperation({
    summary: 'Add a task outcome',
    description:
      'A name another outcome already has (ignoring case) is 409 TASK_OUTCOME_NAME_TAKEN. It goes last.',
  })
  async create(@Body(zodPipe(createTaskOutcomeSchema)) body: CreateTaskOutcomeInput) {
    return this.outcomes.create(body);
  }

  @Put('order')
  @RequirePermission('settings.task_outcomes.manage')
  @ApiOperation({
    summary: 'Reorder the task outcomes (send every id once)',
    description: 'Anything but every id exactly once is 422 TASK_OUTCOME_ORDER_INVALID.',
  })
  async reorder(@Body(zodPipe(reorderTaskOutcomesSchema)) body: ReorderTaskOutcomesInput) {
    return this.outcomes.reorder(body);
  }

  @Patch(':id')
  @RequirePermission('settings.task_outcomes.manage')
  @ApiOperation({
    summary: 'Rename or hide/show a task outcome',
    description:
      'Requires the rowVersion you read (409 ROW_VERSION_CONFLICT otherwise). A hidden outcome is not offered in pickers but stays on its tasks.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateTaskOutcomeSchema)) body: UpdateTaskOutcomeInput,
  ) {
    return this.outcomes.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('settings.task_outcomes.manage')
  @ApiOperation({
    summary: 'Delete a task outcome',
    description: 'An outcome that tasks still carry is 409 TASK_OUTCOME_IN_USE: hide it instead.',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.outcomes.remove(id);
  }
}
