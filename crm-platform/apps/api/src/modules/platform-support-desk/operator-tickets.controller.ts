import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  assignTicketRequestSchema,
  operatorReplyRequestSchema,
  operatorTicketListQuerySchema,
  setTicketPriorityRequestSchema,
  setTicketStatusRequestSchema,
  uuidSchema,
  type AssignTicketRequest,
  type OperatorReplyRequest,
  type OperatorTicketListQuery,
  type SetTicketPriorityRequest,
  type SetTicketStatusRequest,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { OperatorTicketsService } from './operator-tickets.service';

/**
 * The operator helpdesk inbox (TW-SUPP-007..013). Every operator role reads; only super admins and support operators
 * write (Reference let any admin do everything and never enforced its seeded support.* keys; read-only auditors are a
 * deliberate tightening).
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/support/tickets', version: '2' })
export class OperatorTicketsController {
  constructor(private readonly tickets: OperatorTicketsService) {}

  @Get()
  @ApiOperation({ summary: 'Every organization’s tickets, newest first, with the KPI tiles' })
  async list(@Query(zodPipe(operatorTicketListQuerySchema)) query: OperatorTicketListQuery) {
    return this.tickets.list(query);
  }

  // Literal path before ':id' so it is not read as an id.
  @Get('assignees')
  @ApiOperation({ summary: 'Operators a ticket can be assigned to' })
  async assignees() {
    return this.tickets.assignees();
  }

  @Get(':id')
  @ApiOperation({ summary: 'One ticket with its whole thread, internal notes included' })
  async detail(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.tickets.detail(id);
  }

  @Post(':id/reply')
  @OperatorRoles('super_admin', 'support')
  @ApiOperation({ summary: 'Reply to the customer (emailed) or add an internal note' })
  async reply(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(operatorReplyRequestSchema)) body: OperatorReplyRequest,
  ) {
    return this.tickets.reply(id, body);
  }

  @Patch(':id/status')
  @OperatorRoles('super_admin', 'support')
  @ApiOperation({ summary: 'Set the ticket status (resolved_at rules apply)' })
  async setStatus(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(setTicketStatusRequestSchema)) body: SetTicketStatusRequest,
  ) {
    return this.tickets.setStatus(id, body);
  }

  @Patch(':id/priority')
  @OperatorRoles('super_admin', 'support')
  @ApiOperation({ summary: 'Set the ticket priority' })
  async setPriority(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(setTicketPriorityRequestSchema)) body: SetTicketPriorityRequest,
  ) {
    return this.tickets.setPriority(id, body);
  }

  @Patch(':id/assignee')
  @OperatorRoles('super_admin', 'support')
  @ApiOperation({ summary: 'Assign the ticket to an operator, or unassign it' })
  async assign(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(assignTicketRequestSchema)) body: AssignTicketRequest,
  ) {
    return this.tickets.assign(id, body);
  }
}
