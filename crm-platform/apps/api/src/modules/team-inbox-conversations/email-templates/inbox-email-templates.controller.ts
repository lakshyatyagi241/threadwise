import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { renderEmailTemplateSchema, type RenderEmailTemplateInput } from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../../plans-subscriptions-trials';
import { InboxEmailTemplatesService } from './inbox-email-templates.service';

/** The composer's "Templates" picker for an email thread: `POST /v2/inbox/email-templates/:id/render`. */
@ApiTags('team-inbox')
@ActorKinds('user')
@RequirePlanFeature('email_channel')
@Controller({ path: 'inbox/email-templates', version: '2' })
export class InboxEmailTemplatesController {
  constructor(private readonly templates: InboxEmailTemplatesService) {}

  @Post(':id/render')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('mail.templates.read')
  @ApiOperation({
    summary: 'Fill an email template for the conversation you have open',
    description:
      "Variables come from the conversation's contact, you and the workspace; ones left as written are listed in `issues`. Needs `mail.templates.read` and the right to reply to that conversation. Sends nothing and counts nothing: the agent reads it in the composer, and the use is counted when the reply is sent. 404 if the template or conversation is not yours to see, 422 EMAIL_TEMPLATE_ARCHIVED or CHANNEL_CAPABILITY_UNSUPPORTED (not an email thread).",
  })
  render(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(renderEmailTemplateSchema)) body: RenderEmailTemplateInput,
  ) {
    return this.templates.render(id, body);
  }
}
