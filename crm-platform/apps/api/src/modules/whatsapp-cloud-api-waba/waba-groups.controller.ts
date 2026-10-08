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
  createWabaGroupInputSchema,
  handleWabaGroupJoinRequestsInputSchema,
  removeWabaGroupParticipantsInputSchema,
  updateWabaGroupInputSchema,
  wabaGroupListQuerySchema,
  wabaGroupsStateQuerySchema,
  type CreateWabaGroupInput,
  type HandleWabaGroupJoinRequestsInput,
  type RemoveWabaGroupParticipantsInput,
  type UpdateWabaGroupInput,
  type WabaGroupListQuery,
  type WabaGroupsStateQuery,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { WabaGroupsAdminService } from './waba-groups-admin.service';

/**
 * WhatsApp Cloud API groups of one connected number (BL-094; WaDesk `/waba-groups`). The plan feature `waba_groups` gates every route
 * (owner decision 2026-10-08: not in every plan; WaDesk had no gate): a workspace on a plan without it is refused with 422
 * PLAN_FEATURE_LOCKED. Keys: `waba.groups.read` (screen, link), `.create`, `.manage` (link reset, subject, join requests, members) and
 * `.delete`. The numbers of people waiting to join and of members are personal data and go only to `.manage`.
 */
@ApiTags('whatsapp-groups')
@ActorKinds('user')
@RequirePlanFeature('waba_groups')
@Controller({ path: 'waba/numbers/:id/groups', version: '2' })
export class WabaGroupsController {
  constructor(private readonly groups: WabaGroupsAdminService) {}

  @Get('state')
  @RequirePermission('waba.groups.read')
  @ApiOperation({ summary: 'Can this number use Groups? (cached probe; ?fresh=1 asks Meta again)' })
  state(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(wabaGroupsStateQuerySchema)) query: WabaGroupsStateQuery,
  ) {
    return this.groups.state(id, query.fresh ?? false);
  }

  @Get()
  @RequirePermission('waba.groups.read')
  @ApiOperation({ summary: 'Groups of the number, newest first, with the four counters' })
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(wabaGroupListQuerySchema)) query: WabaGroupListQuery,
  ) {
    return this.groups.list(id, query);
  }

  @Post()
  @Idempotent()
  @RequirePermission('waba.groups.create')
  @ApiOperation({ summary: 'Create a group on Meta (the invite link arrives on a webhook)' })
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(createWabaGroupInputSchema)) body: CreateWabaGroupInput,
  ) {
    return this.groups.create(id, body);
  }

  @Post(':gid/refresh')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('waba.groups.read')
  @ApiOperation({ summary: 'Refresh one group and its invite link from Meta' })
  refresh(@Param('id', ParseUUIDPipe) id: string, @Param('gid', ParseUUIDPipe) gid: string) {
    return this.groups.refresh(id, gid);
  }

  @Post(':gid/invite-link/reset')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('waba.groups.manage')
  @ApiOperation({ summary: 'New invite link; every link shared before stops working' })
  resetInviteLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('gid', ParseUUIDPipe) gid: string,
  ) {
    return this.groups.resetInviteLink(id, gid);
  }

  @Patch(':gid')
  @HttpCode(HttpStatus.ACCEPTED)
  @Idempotent()
  @RequirePermission('waba.groups.manage')
  @ApiOperation({
    summary: 'Change subject and description; Meta confirms each on a webhook (202)',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('gid', ParseUUIDPipe) gid: string,
    @Body(zodPipe(updateWabaGroupInputSchema)) body: UpdateWabaGroupInput,
  ) {
    return this.groups.update(id, gid, body);
  }

  @Post(':gid/join-requests')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('waba.groups.manage')
  @ApiOperation({ summary: 'Approve or reject people waiting to join' })
  joinRequests(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('gid', ParseUUIDPipe) gid: string,
    @Body(zodPipe(handleWabaGroupJoinRequestsInputSchema)) body: HandleWabaGroupJoinRequestsInput,
  ) {
    return this.groups.handleJoinRequests(id, gid, body);
  }

  @Get(':gid/participants')
  @RequirePermission('waba.groups.manage')
  @ApiOperation({ summary: 'Members, read from Meta on demand (never stored)' })
  members(@Param('id', ParseUUIDPipe) id: string, @Param('gid', ParseUUIDPipe) gid: string) {
    return this.groups.members(id, gid);
  }

  @Delete(':gid/participants')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('waba.groups.manage')
  @ApiOperation({ summary: 'Remove up to 8 people from the group' })
  removeParticipants(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('gid', ParseUUIDPipe) gid: string,
    @Body(zodPipe(removeWabaGroupParticipantsInputSchema)) body: RemoveWabaGroupParticipantsInput,
  ) {
    return this.groups.removeParticipants(id, gid, body);
  }

  @Delete(':gid')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Idempotent()
  @RequirePermission('waba.groups.delete')
  @ApiOperation({ summary: 'Delete the group on Meta (everyone is removed) and the row' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @Param('gid', ParseUUIDPipe) gid: string) {
    await this.groups.delete(id, gid);
  }
}
