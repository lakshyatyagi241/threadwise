import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  acceptWspInviteSchema,
  wspInvitePreviewQuerySchema,
  type AcceptWspInviteInput,
} from '@crm/contracts';
import { Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { InvitationsService } from './invitations.service';
import { Throttle } from '../platform-infrastructure';

/** The invitee's two public calls (TW-WSP-016, 021). Rate limited per IP; every failure is the same 400 WSP_INVITE_INVALID. */
@ApiTags('workspace-invitations')
@Controller({ path: 'workspace/invitations', version: '2' })
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Public()
  @Throttle('auth')
  @Get('preview')
  @ApiOperation({
    summary: 'Who invited whom to what, for the accept page (does not use the token up)',
  })
  async preview(
    @Query(zodPipe(wspInvitePreviewQuerySchema)) query: { token: string; orgSlug: string },
  ) {
    return this.invitations.preview(query.token, query.orgSlug);
  }

  @Public()
  @Post('accept')
  @ApiOperation({
    summary: 'Accept an invitation by choosing a password; answers with the signed-in session',
    description: 'The response is the same body as POST /auth/login: tokens, landing and flags.',
  })
  async accept(@Body(zodPipe(acceptWspInviteSchema)) body: AcceptWspInviteInput) {
    return this.invitations.accept(body);
  }
}
