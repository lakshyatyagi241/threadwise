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
  changeWspMemberRoleSchema,
  listWspMembersQuerySchema,
  setWspAvailabilitySchema,
  updateWspMemberDetailsSchema,
  type ChangeWspMemberRoleInput,
  type ListWspMembersQuery,
  type SetWspAvailabilityInput,
  type UpdateWspMemberDetailsInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { MembersService } from './members.service';

/**
 * Workspace members (TW-WSP-015..019). Reading needs no permission key (any signed-in member, as in Reference); inviting,
 * removing and resetting need `org.member.invite`, changing a role needs `org.member.role_assign` (RBAC's keys). The rank rules on
 * top of those keys are RBAC's `WorkspaceRoleRulesService` for handing out a role and the service's for removing and resetting.
 * Literal paths are declared before `:id`.
 */
@ApiTags('workspace-members')
@ActorKinds('user')
@Controller({ path: 'workspace/members', version: '2' })
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @ApiOperation({
    summary: 'Members of the workspace, highest role first then by name (cursor paginated)',
    description:
      'Removed members are not listed. `order` is ignored: the sort is the tier, then the name.',
  })
  async list(@Query(zodPipe(listWspMembersQuerySchema)) query: ListWspMembersQuery) {
    return this.members.list(query);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Counts per role, the roles the caller may grant, seats and what the caller may do',
  })
  async summary() {
    return this.members.summary();
  }

  @Get('me/availability')
  @ApiOperation({
    summary:
      "The caller's own availability (Available / Offline), as automatic assignment reads it",
  })
  async myAvailability() {
    return this.members.myAvailability();
  }

  @Put('me/availability')
  @ApiOperation({
    summary:
      "Set the caller's own availability: offline agents are skipped by automatic assignment",
    description: 'Only the caller can change it. Chats the agent already holds stay with them.',
  })
  async setMyAvailability(@Body(zodPipe(setWspAvailabilitySchema)) body: SetWspAvailabilityInput) {
    return this.members.setMyAvailability(body);
  }

  @Post('invite')
  @Idempotent()
  @RequirePermission('org.member.invite')
  @ApiOperation({
    summary: 'Invite a person by email: they get a single-use link to choose their password',
    description:
      'The seat limit is checked first, then the payload, then whether the caller may grant the role. When the mail cannot be sent, `inviteLink` carries the link once.',
  })
  async invite(@Body() body: unknown) {
    return this.members.invite(body);
  }

  @Post(':id/resend-invite')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('org.member.invite')
  @ApiOperation({
    summary: 'Send a pending member a fresh invitation link (the old one stops working)',
  })
  async resend(@Param('id', ParseUUIDPipe) id: string) {
    return this.members.resendInvite(id);
  }

  @Patch(':id/role')
  @RequirePermission('org.member.role_assign')
  @ApiOperation({
    summary: "Change a member's role",
    description:
      "Replaces the member's role set with the one role. Requires the rowVersion you read.",
  })
  async changeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(changeWspMemberRoleSchema)) body: ChangeWspMemberRoleInput,
  ) {
    return this.members.changeRole(id, body);
  }

  @Patch(':id/details')
  @RequirePermission('org.member.invite')
  @ApiOperation({
    summary: "Change a member's phone number and maximum concurrent chats",
    description:
      'Requires the rowVersion you read. A null value clears the field, a missing key keeps it. The last login cannot be set.',
  })
  async updateDetails(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateWspMemberDetailsSchema)) body: UpdateWspMemberDetailsInput,
  ) {
    return this.members.updateDetails(id, body);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('org.member.invite')
  @ApiOperation({
    summary: 'Email the member a link to set a new password (no password is shown to anyone)',
  })
  async resetPassword(@Param('id', ParseUUIDPipe) id: string) {
    return this.members.resetPassword(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('org.member.invite')
  @ApiOperation({
    summary: 'Remove a member: access, roles and team places end now; the account is kept',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.members.remove(id);
  }
}
