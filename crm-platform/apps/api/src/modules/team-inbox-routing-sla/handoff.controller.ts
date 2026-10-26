import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  claimConversationSchema,
  requestHandoffSchema,
  returnToBotSchema,
  updateHandoffSettingsSchema,
  type ClaimConversationInput,
  type RequestHandoffInput,
  type ReturnToBotInput,
  type UpdateHandoffSettingsInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { HandoffService } from './handoff.service';

/**
 * Conversation handoff (BL-396..BL-404): the waiting queue's claim, a person's "send to queue", "return to bot", the handoff card, and the
 * workspace's handoff settings. None of these routes is behind a plan feature: the queue works on every plan; what a plan adds (automatic
 * assignment, owner modes) is decided inside the service and shown as `available` in the settings.
 */
@ApiTags('team-inbox')
@ActorKinds('user')
@Controller({ path: 'inbox', version: '2' })
export class HandoffController {
  constructor(private readonly handoff: HandoffService) {}

  @Post('conversations/:id/claim')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inbox.conversation.assign_self')
  @ApiOperation({
    summary: 'Claim a waiting conversation for yourself',
    description:
      'The caller takes a conversation nobody holds. 409 CONFLICT when somebody took it first. Makes the caller the contact owner when the workspace setting says so and the contact has no owner.',
  })
  async claim(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(claimConversationSchema)) body: ClaimConversationInput,
  ) {
    const out = await this.handoff.claim(id, body.rowVersion, body.acknowledgeLimit === true);
    return { conversation: out.summary, ownerSet: out.ownerSet };
  }

  @Post('conversations/:id/handoff')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inbox.conversation.assign')
  @ApiOperation({
    summary: 'Send a conversation to a person, a team queue or the assignment rules',
    description:
      'The same action a flow, an AI agent or a customer keyword uses. Mutes the bot and puts the conversation in the waiting queue when nobody can take it now.',
  })
  async request(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(requestHandoffSchema)) body: RequestHandoffInput,
  ) {
    const ctx = RequestContextStore.require();
    const out = await this.handoff.handoff({
      orgId: ctx.orgId,
      conversationUuid: id,
      source: 'manual',
      reason: body.reason,
      reasonText: body.reasonText ?? null,
      summary: body.summary ?? null,
      destination: body.destination,
      priority: body.priority ?? null,
      actor: { kind: 'user', userId: ctx.userId! },
    });
    return {
      outcome: out.outcome,
      handoffId: out.handoffId,
      refused: out.refused ?? null,
      conversation: await this.handoff.summaryOf(id),
      handoff: await this.handoff.card(id),
    };
  }

  @Post('conversations/:id/return-to-bot')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inbox.conversation.reply')
  @ApiOperation({
    summary: 'Give a conversation back to the bot',
    description:
      "Unassigns it and unmutes the bot. When the handoff came from a flow whose Human handoff step has a 'returned' exit, the flow continues there now; otherwise the bot answers the customer's next message. The answer says which (`resumed`).",
  })
  async returnToBot(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(returnToBotSchema)) body: ReturnToBotInput,
  ) {
    return this.handoff.returnToBot(id, body.note);
  }

  @Get('conversations/:id/handoff')
  @RequirePermission('inbox.conversation.read')
  @ApiOperation({
    summary: 'The latest handoff of a conversation (reason, summary, answers, trace)',
  })
  async card(@Param('id', ParseUUIDPipe) id: string) {
    return { handoff: await this.handoff.card(id) };
  }

  @Get('handoff-settings')
  @RequirePermission('inbox.settings.read')
  @ApiOperation({ summary: 'Handoff and assignment settings, with what the plan includes' })
  settings() {
    return this.handoff.getSettings();
  }

  @Put('handoff-settings')
  @Idempotent()
  @RequirePermission('inbox.routing.manage')
  @ApiOperation({ summary: 'Change the handoff and assignment settings' })
  update(@Body(zodPipe(updateHandoffSettingsSchema)) body: UpdateHandoffSettingsInput) {
    return this.handoff.updateSettings(body);
  }
}
