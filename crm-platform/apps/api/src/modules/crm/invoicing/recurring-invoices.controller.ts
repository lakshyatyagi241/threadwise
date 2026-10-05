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
  createRecurringInvoiceSchema,
  listRecurringInvoicesQuerySchema,
  listRecurringRunsQuerySchema,
  updateRecurringInvoiceSchema,
  type CreateRecurringInvoiceInput,
  type ListRecurringInvoicesQuery,
  type ListRecurringRunsQuery,
  type RecordScope,
  type UpdateRecurringInvoiceInput,
} from '@crm/contracts';
import {
  ActorKinds,
  GrantedScope,
  Idempotent,
  RequirePermission,
} from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { SalesPipelineGuard } from '../deals/deals-plan';
import { RecurringInvoicesService } from './recurring-invoices.service';
import { RequirePlanFeature } from '../../plans-subscriptions-trials';

/** Recurring invoices: a schedule and a template that a worker turns into one invoice per period. */
@ApiTags('recurring-invoices')
@ActorKinds('user')
@UseGuards(SalesPipelineGuard)
@Controller({ path: 'recurring-invoices', version: '2' })
export class RecurringInvoicesController {
  constructor(private readonly recurring: RecurringInvoicesService) {}

  @Get()
  @RequirePermission('record.recurring-invoices.read')
  @ApiOperation({
    summary: 'List recurring invoices (cursor paginated)',
    description: 'Filters: status (active, paused, ended), contactId.',
  })
  list(
    @Query(zodPipe(listRecurringInvoicesQuerySchema)) query: ListRecurringInvoicesQuery,
    @GrantedScope('record.recurring-invoices.read') scope: RecordScope,
  ) {
    return this.recurring.list(query, scope);
  }

  // Plan feature on write routes only: a downgraded workspace still reads and prints the documents it has; public invoice pages and the gateway webhook are separate open controllers.
  @RequirePlanFeature('invoicing')
  @Post()
  @Idempotent()
  @RequirePermission('record.recurring-invoices.create')
  @ApiOperation({
    summary: 'Create a schedule from a template or from an existing invoice',
    description:
      'The template is validated and priced now. mode: draft (each invoice stays a draft), issue (numbered at once) or issue_send (issued and sent). A start date more than 12 periods back is 422 REC_START_TOO_OLD.',
  })
  create(
    @Body(zodPipe(createRecurringInvoiceSchema)) body: CreateRecurringInvoiceInput,
    @GrantedScope('record.recurring-invoices.create') scope: RecordScope,
  ) {
    return this.recurring.create(body, scope);
  }

  @Get(':id')
  @RequirePermission('record.recurring-invoices.read')
  @ApiOperation({ summary: 'Get one schedule, with its next five dates' })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.recurring-invoices.read') scope: RecordScope,
  ) {
    return this.recurring.get(id, scope);
  }

  @Get(':id/runs')
  @RequirePermission('record.recurring-invoices.read')
  @ApiOperation({ summary: 'Run history: one row per generated (or failed) period, newest first' })
  runs(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listRecurringRunsQuerySchema)) query: ListRecurringRunsQuery,
    @GrantedScope('record.recurring-invoices.read') scope: RecordScope,
  ) {
    return this.recurring.runs(id, query, scope);
  }

  @RequirePlanFeature('invoicing')
  @Patch(':id')
  @RequirePermission('record.recurring-invoices.update')
  @ApiOperation({
    summary: 'Edit the schedule or replace the template for future invoices (rowVersion required)',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateRecurringInvoiceSchema)) body: UpdateRecurringInvoiceInput,
    @GrantedScope('record.recurring-invoices.update') scope: RecordScope,
  ) {
    return this.recurring.update(id, body, scope);
  }

  @RequirePlanFeature('invoicing')
  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.recurring-invoices.update')
  @ApiOperation({ summary: 'Pause a schedule' })
  pause(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.recurring-invoices.update') scope: RecordScope,
  ) {
    return this.recurring.pause(id, scope);
  }

  @RequirePlanFeature('invoicing')
  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.recurring-invoices.update')
  @ApiOperation({
    summary: 'Resume a paused schedule',
    description:
      'Periods that fell while paused are skipped: the next invoice is for today or later.',
  })
  resume(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.recurring-invoices.update') scope: RecordScope,
  ) {
    return this.recurring.resume(id, scope);
  }

  @RequirePlanFeature('invoicing')
  @Post(':id/run')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('record.recurring-invoices.update')
  @ApiOperation({ summary: 'Generate the next period now' })
  run(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.recurring-invoices.update') scope: RecordScope,
  ) {
    return this.recurring.runNow(id, scope);
  }

  @RequirePlanFeature('invoicing')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.recurring-invoices.delete')
  @ApiOperation({ summary: 'Delete a schedule (invoices already generated stay)' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.recurring-invoices.delete') scope: RecordScope,
  ) {
    await this.recurring.remove(id, scope);
  }
}
