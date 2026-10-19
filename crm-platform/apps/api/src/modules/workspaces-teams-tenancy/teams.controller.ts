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
  addWspTeamMemberSchema,
  createWspTeamSchema,
  listWspTeamsQuerySchema,
  updateWspTeamMemberSchema,
  updateWspTeamSchema,
  type AddWspTeamMemberInput,
  type CreateWspTeamInput,
  type ListWspTeamsQuery,
  type UpdateWspTeamInput,
  type UpdateWspTeamMemberInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { TeamsService } from './teams.service';

/**
 * Teams (TW-WSP-022, Teams v2). Reading needs `team.read`; every write needs `team.manage`. `inbox.team.manage` (the key the
 * screen used before teams served records as well as conversations) is an alias for one release: either key opens a write, and a
 * custom role that only holds the old key keeps reading through the backfill of `team.read`.
 */
@ApiTags('workspace-teams')
@ActorKinds('user')
@Controller({ path: 'workspace/teams', version: '2' })
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @RequirePermission('team.read', 'team.manage', 'inbox.team.manage')
  @ApiOperation({
    summary:
      'Teams with their members, manager, parent and where they are used (cursor paginated; `order=asc` is creation order)',
  })
  async list(@Query(zodPipe(listWspTeamsQuerySchema)) query: ListWspTeamsQuery) {
    return this.teams.list(query);
  }

  @Get(':id')
  @RequirePermission('team.read', 'team.manage', 'inbox.team.manage')
  @ApiOperation({ summary: 'One team' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.teams.get(id);
  }

  @Post()
  @Idempotent()
  @RequirePermission('team.manage', 'inbox.team.manage')
  @ApiOperation({ summary: 'Create a team' })
  async create(@Body(zodPipe(createWspTeamSchema)) body: CreateWspTeamInput) {
    return this.teams.create(body);
  }

  @Patch(':id')
  @RequirePermission('team.manage', 'inbox.team.manage')
  @ApiOperation({
    summary: 'Edit a team',
    description:
      'Requires the rowVersion you read. `memberIds`, when present, replaces the member list; an empty list removes everyone. `parentId: null` makes the team top-level and `leadId: null` removes the manager. A parent that would make a loop is 422 WSP_TEAM_PARENT_CYCLE; one that would make the tree deeper than 5 levels is 422 WSP_TEAM_PARENT_INVALID.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateWspTeamSchema)) body: UpdateWspTeamInput,
  ) {
    return this.teams.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('team.manage', 'inbox.team.manage')
  @ApiOperation({
    summary:
      'Delete a team; conversations assigned to it become unassigned and its sub-teams move up one level',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.teams.remove(id);
  }

  @Post(':id/members')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('team.manage', 'inbox.team.manage')
  @ApiOperation({
    summary: 'Add a person to a team, or change their role / primary mark when already on it',
    description:
      'Only active members of the workspace. `isPrimary: true` makes this the person\'s main team (their mark on any other team is cleared). A person on exactly one team always has it as primary.',
  })
  async addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(addWspTeamMemberSchema)) body: AddWspTeamMemberInput,
  ) {
    return this.teams.addMember(id, body);
  }

  @Patch(':id/members/:userId')
  @RequirePermission('team.manage', 'inbox.team.manage')
  @ApiOperation({
    summary: "Change a member's role (member or lead) and/or primary mark",
    description:
      'Making the team\'s manager a plain member removes them as manager. Not on the team is 422 WSP_TEAM_MEMBER_NOT_ON_TEAM.',
  })
  async updateMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(zodPipe(updateWspTeamMemberSchema)) body: UpdateWspTeamMemberInput,
  ) {
    return this.teams.updateMember(id, userId, body);
  }

  @Delete(':id/members/:userId')
  @RequirePermission('team.manage', 'inbox.team.manage')
  @ApiOperation({
    summary: 'Take a person off a team',
    description: 'Answers with the team. The manager who is removed stops being the manager.',
  })
  async removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.teams.removeMember(id, userId);
  }
}
