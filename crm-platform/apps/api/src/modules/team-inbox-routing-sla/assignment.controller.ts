import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { assignConversationSchema, type AssignConversationInput } from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AssigneesService } from './assignees.service';
import { AssignmentService } from './assignment.service';

/**
 * Who a conversation is assigned to (WD-TIB2-021, 022). The paths sit under `/inbox` with the conversation routes the web calls
 * together, but the code is the routing domain's: `AssignmentService` is the only writer of the assignee columns.
 */
@ApiTags('team-inbox')
@ActorKinds('user')
@Controller({ path: 'inbox', version: '2' })
export class AssignmentController {
  constructor(
    private readonly assignment: AssignmentService,
    private readonly assignees: AssigneesService,
  ) {}

  @Get('assignees')
  @RequirePermission('inbox.conversation.read')
  @ApiOperation({
    summary: 'The people and teams a conversation can be given to',
    description:
      'Active members who may open the inbox, with availability and a live count of open conversations, and the workspace teams.',
  })
  async list() {
    return this.assignees.list();
  }

  @Post('conversations/:id/assign')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  // Either right opens the route; the service then decides which one the request needs (anyone, or only a claim).
  @RequirePermission('inbox.conversation.assign', 'inbox.conversation.assign_self')
  @ApiOperation({
    summary: 'Assign, claim or unassign a conversation (manual)',
    description:
      '`userId` assigns a person (their own id is a claim), `null` unassigns them; `teamId` likewise for the team; an omitted field is left alone. Requires the rowVersion you read. `inbox.conversation.assign_self` allows only a claim.',
  })
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(assignConversationSchema)) body: AssignConversationInput,
  ) {
    return this.assignment.assign(id, body);
  }
}
