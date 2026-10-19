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
import { wspHandoverSchema, type WspHandoverInput } from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { MemberHandoverService } from './member-handover.service';

/**
 * The questions the deactivate dialog asks before it deactivates somebody (Teams v2, D10). Same right as deactivating
 * (`admin.user.manage`); the records and conversations themselves are moved under the caller's own record-scope and inbox rules.
 */
@ApiTags('workspace-members')
@ActorKinds('user')
@Controller({ path: 'workspace/members', version: '2' })
export class MemberHandoverController {
  constructor(private readonly handover: MemberHandoverService) {}

  @Get(':id/handover')
  @RequirePermission('admin.user.manage')
  @ApiOperation({
    summary: 'What a person holds (contacts, open deals, open chats) and who could take it over',
    description:
      'Owned contacts, open deals, open conversations, and the active managers of the person\'s teams, nearest first (primary team first).',
  })
  async preview(@Param('id', ParseUUIDPipe) id: string) {
    return this.handover.preview(id);
  }

  @Post(':id/handover')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('admin.user.manage')
  @ApiOperation({
    summary: "Move a person's contacts, open deals and open chats to somebody else",
    description:
      '`mode: person` needs `userId`; `team_lead` picks the nearest active team manager; `leave` changes nothing. Contacts and deals use the owner-reassign batch (undo for 14 days); at most 200 open chats and 50,000 records move per call and `remaining` says what is left. Call it before deactivating the person.',
  })
  async run(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(wspHandoverSchema)) body: WspHandoverInput,
  ) {
    return this.handover.run(id, body);
  }
}
