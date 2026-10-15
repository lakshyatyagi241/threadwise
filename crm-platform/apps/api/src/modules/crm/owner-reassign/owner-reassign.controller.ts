import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createOwnerReassignSchema,
  ownerReassignListQuerySchema,
  ownerReassignPreviewSchema,
  type CreateOwnerReassignInput,
  type OwnerReassignListQuery,
  type OwnerReassignPreviewInput,
  type RecordScope,
} from '@crm/contracts';
import {
  ActorKinds,
  GrantedScope,
  Idempotent,
  RequirePermission,
} from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { OwnerReassignService } from './owner-reassign.service';

/**
 * Reassign a person's contacts and open deals as one batch, with undo and an opt-in return (BL-112 phase 2). Moving needs
 * `record.contacts.update` (and `record.deals.update` for deals) under the same record-scope rules as a single edit; reading the
 * history needs `team.leave.read`. Literal paths come before `:id`.
 */
@ApiTags('owner-reassignments')
@ActorKinds('user')
@Controller({ path: 'owner-reassignments', version: '2' })
export class OwnerReassignController {
  constructor(private readonly reassign: OwnerReassignService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: 'How many contacts and open deals a person holds (what a reassign would move)',
  })
  async preview(
    @Body(zodPipe(ownerReassignPreviewSchema)) body: OwnerReassignPreviewInput,
    @GrantedScope('record.contacts.update') scope: RecordScope,
  ) {
    return this.reassign.preview(body.fromUserId, scope);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary:
      "Move a person's contacts (and open deals) to a person, their delegate or a team round robin",
    description:
      'One batch with one audit row and event per record. `restoreOn` (optional, after today) brings back what nobody changed since on that day; undo works for 14 days. At most 50,000 of each kind per run: `remaining` says how many are left.',
  })
  async create(
    @Body(zodPipe(createOwnerReassignSchema)) body: CreateOwnerReassignInput,
    @GrantedScope('record.contacts.update') scope: RecordScope,
  ) {
    return this.reassign.create(body, scope);
  }

  @Get()
  @RequirePermission('team.leave.read')
  @ApiOperation({ summary: 'Recent reassignments, newest first' })
  async list(@Query(zodPipe(ownerReassignListQuerySchema)) query: OwnerReassignListQuery) {
    return this.reassign.list(query);
  }

  @Get(':id')
  @RequirePermission('team.leave.read')
  @ApiOperation({ summary: 'One reassignment with its counts' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.reassign.get(id);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: 'Undo a reassignment: put back what nobody has changed since',
    description:
      'Allowed for 14 days after the move, or any time while a return was planned. Contacts and deals whose owner was changed meanwhile, or that were deleted, stay where they are and are counted in `notRestored`.',
  })
  async restore(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.contacts.update') scope: RecordScope,
  ) {
    return this.reassign.restore(id, scope);
  }
}
