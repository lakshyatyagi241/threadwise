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
  createWspTeamSchema,
  listWspTeamsQuerySchema,
  updateWspTeamSchema,
  type CreateWspTeamInput,
  type ListWspTeamsQuery,
  type UpdateWspTeamInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { TeamsService } from './teams.service';

/** Teams (WD-WSP-022). Listing is open to every signed-in member (WaDesk applied no check); the writes need `inbox.team.manage`. */
@ApiTags('workspace-teams')
@ActorKinds('user')
@Controller({ path: 'workspace/teams', version: '2' })
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @ApiOperation({
    summary: 'Teams with their members (cursor paginated; `order=asc` is creation order)',
  })
  async list(@Query(zodPipe(listWspTeamsQuerySchema)) query: ListWspTeamsQuery) {
    return this.teams.list(query);
  }

  @Post()
  @Idempotent()
  @RequirePermission('inbox.team.manage')
  @ApiOperation({ summary: 'Create a team' })
  async create(@Body(zodPipe(createWspTeamSchema)) body: CreateWspTeamInput) {
    return this.teams.create(body);
  }

  @Patch(':id')
  @RequirePermission('inbox.team.manage')
  @ApiOperation({
    summary: 'Edit a team',
    description:
      'Requires the rowVersion you read. `memberIds`, when present, replaces the member list; an empty list removes everyone.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateWspTeamSchema)) body: UpdateWspTeamInput,
  ) {
    return this.teams.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('inbox.team.manage')
  @ApiOperation({ summary: 'Delete a team; conversations assigned to it become unassigned' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.teams.remove(id);
  }
}
