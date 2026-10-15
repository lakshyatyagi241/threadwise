import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createMemberLeaveSchema,
  listMemberLeavesQuerySchema,
  setMemberDelegateSchema,
  updateMemberLeaveSchema,
  type CreateMemberLeaveInput,
  type ListMemberLeavesQuery,
  type SetMemberDelegateInput,
  type UpdateMemberLeaveInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { LeaveService } from './leave.service';

/**
 * Member leave and delegate (BL-112). Reading needs `team.leave.read` (every preset has it); writing needs `team.leave.manage`, whose
 * record scope the service applies per person (`own` = only yourself, `all` = anyone). The reason of a leave is returned only to
 * people who may manage that person's leave.
 */
@ApiTags('workspace-leave')
@ActorKinds('user')
@Controller({ path: 'workspace', version: '2' })
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  @Get('leaves')
  @RequirePermission('team.leave.read')
  @ApiOperation({
    summary: 'Who is on leave and who will be (soonest first); `view=all` adds the ended ones',
    description:
      "`today` is the workspace calendar day the dates are compared with (its own time zone, not the browser's).",
  })
  async list(@Query(zodPipe(listMemberLeavesQuerySchema)) query: ListMemberLeavesQuery) {
    return this.leave.list(query);
  }

  @Get('members/:id/leave')
  @RequirePermission('team.leave.read')
  @ApiOperation({
    summary: "A member's leave panel: ongoing and coming leave, the delegate, and what they hold",
    description:
      'The reason and the workload (owned contacts, open chats) are only returned to people who may manage this member.',
  })
  async overview(@Param('id', ParseUUIDPipe) id: string) {
    return this.leave.overview(id);
  }

  @Post('members/:id/leaves')
  @Idempotent()
  @RequirePermission('team.leave.manage')
  @ApiOperation({
    summary: 'Set leave for a member (a range of days in the workspace calendar)',
    description:
      'A start today begins immediately; a later one is started by the worker on its day. Overlapping another leave of the same person is 409 WSP_LEAVE_OVERLAP; a first day in the past is 422 WSP_LEAVE_INVALID.',
  })
  async create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(createMemberLeaveSchema)) body: CreateMemberLeaveInput,
  ) {
    return this.leave.create(id, body);
  }

  @Patch('leaves/:id')
  @RequirePermission('team.leave.manage')
  @ApiOperation({
    summary: 'Change the dates or the reason of a leave',
    description: 'Requires the rowVersion you read. A leave that has begun keeps its first day.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateMemberLeaveSchema)) body: UpdateMemberLeaveInput,
  ) {
    return this.leave.update(id, body);
  }

  @Delete('leaves/:id')
  @RequirePermission('team.leave.manage')
  @ApiOperation({
    summary: 'Cancel a leave that has not begun, or end one that has (the person is back today)',
  })
  async end(@Param('id', ParseUUIDPipe) id: string) {
    return this.leave.end(id);
  }

  @Put('members/:id/delegate')
  @RequirePermission('team.leave.manage')
  @ApiOperation({
    summary: 'Name the member who stands in while this one is on leave (null removes)',
    description:
      'The delegate must be another active member of this workspace; a circle of delegates is 422 WSP_DELEGATE_CYCLE.',
  })
  async setDelegate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(setMemberDelegateSchema)) body: SetMemberDelegateInput,
  ) {
    const delegate = await this.leave.setDelegate(id, body);
    return { delegate };
  }
}
