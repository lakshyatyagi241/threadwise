import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createSupportTicketRequestSchema,
  customerTicketListQuerySchema,
  supportReplyRequestSchema,
  uuidSchema,
  type CreateSupportTicketRequest,
  type CustomerTicketListQuery,
  type SupportReplyRequest,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { CustomerTicketsService } from './customer-tickets.service';

/**
 * The customer's own support tickets (TW-SUPP-001..005). Any signed-in workspace user: no permission key, no plan
 * gate (the same as Reference). Ownership is the query, not a check, so another user's ticket is a 404.
 */
@ApiTags('support')
@ActorKinds('user')
@Controller({ path: 'support/tickets', version: '2' })
export class CustomerTicketsController {
  constructor(private readonly tickets: CustomerTicketsService) {}

  @Post()
  @ApiOperation({ summary: 'File a support ticket' })
  async create(@Body(zodPipe(createSupportTicketRequestSchema)) body: CreateSupportTicketRequest) {
    return this.tickets.create(body);
  }

  @Get()
  @ApiOperation({ summary: 'My newest tickets plus open/resolved counts' })
  async list(@Query(zodPipe(customerTicketListQuerySchema)) query: CustomerTicketListQuery) {
    return this.tickets.list(query.limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of my tickets with its thread (internal notes never included)' })
  async detail(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.tickets.detail(id);
  }

  @Post(':id/reply')
  @ApiOperation({ summary: 'Reply on my ticket (reopens a resolved one)' })
  async reply(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(supportReplyRequestSchema)) body: SupportReplyRequest,
  ) {
    return this.tickets.reply(id, body.body);
  }
}
