import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { inboxRewriteSchema, type InboxRewriteInput } from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { InboxAiService } from './inbox-ai.service';

/** The composer's AI button: polish the agent's draft. The model picker is `GET /v2/ai/models`. */
@ApiTags('team-inbox-conversations')
@ActorKinds('user')
@Controller({ path: 'inbox/ai', version: '2' })
export class InboxAiController {
  constructor(private readonly ai: InboxAiService) {}

  @Post('rewrite')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inbox.conversation.reply')
  @ApiOperation({
    summary: "Rewrite the agent's draft (improve, fix, tone, shorter, longer)",
    description:
      '422 CAMP_AI_NO_KEY when no key is active for the vendor; 422 CAMP_AI_LIMIT_REACHED when the monthly allowance on the ' +
      "platform's key is used; 502 CAMP_AI_PROVIDER_FAILED when the vendor fails or answers nothing. Nothing is stored or sent.",
  })
  rewrite(@Body(zodPipe(inboxRewriteSchema)) body: InboxRewriteInput) {
    return this.ai.rewrite(body);
  }
}
