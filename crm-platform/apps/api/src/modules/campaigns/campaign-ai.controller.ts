import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { campaignAiGenerateSchema, type CampaignAiGenerateInput } from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { CampaignAiService } from './campaign-ai.service';

/** "Build with AI" on the campaign builder (WD-CAMP-002). The model picker is `GET /v2/ai/models`. */
@ApiTags('campaigns')
@ActorKinds('user')
@Controller({ path: 'campaigns/ai-generate', version: '2' })
export class CampaignAiController {
  constructor(private readonly ai: CampaignAiService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('camp.campaigns.create')
  @ApiOperation({
    summary: 'Draft a campaign (name, message, footer, call to action, quick replies) from a brief',
    description:
      '422 CAMP_AI_NO_KEY when no key is active for the vendor; 422 CAMP_AI_LIMIT_REACHED when the monthly allowance on the ' +
      "platform's key is used; 502 CAMP_AI_PROVIDER_FAILED when the vendor fails or answers nothing; 422 CAMP_AI_BAD_JSON when " +
      'the answer is not the expected JSON. Nothing is stored.',
  })
  generate(@Body(zodPipe(campaignAiGenerateSchema)) body: CampaignAiGenerateInput) {
    return this.ai.generate(body);
  }
}
