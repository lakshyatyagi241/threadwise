import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { tplAiGenerateSchema, type TplAiGenerateInput } from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { TemplateAiService } from './template-ai.service';

/** "Build with AI" on the template form (TW-TPL-016). The model picker is `GET /v2/ai/models`. */
@ApiTags('message-templates')
@ActorKinds('user')
@Controller({ path: 'templates/ai-generate', version: '2' })
export class TemplateAiController {
  constructor(private readonly ai: TemplateAiService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('tpl.templates.create')
  @ApiOperation({
    summary: 'Draft a template (name, header, body, footer, buttons) from a business brief',
    description:
      '422 CAMP_AI_NO_KEY when no key is active for the vendor; 422 CAMP_AI_LIMIT_REACHED when the monthly allowance on the ' +
      "platform's key is used; 502 CAMP_AI_PROVIDER_FAILED when the vendor fails or answers nothing; 422 CAMP_AI_BAD_JSON when " +
      'the answer is not the expected JSON. Nothing is stored and nothing is sent to Meta.',
  })
  generate(@Body(zodPipe(tplAiGenerateSchema)) body: TplAiGenerateInput) {
    return this.ai.generate(body);
  }
}
