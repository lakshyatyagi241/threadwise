import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { campaignAiImageSchema, type CampaignAiImageInput } from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { CampaignAiImageService } from './campaign-ai-image.service';

/** "Build with AI", the picture, on the campaign builder (an addition beyond Reference). The model picker is `GET /v2/ai/models`. */
@ApiTags('campaigns')
@ActorKinds('user')
@Controller({ path: 'campaigns/ai-image', version: '2' })
export class CampaignAiImageController {
  constructor(private readonly ai: CampaignAiImageService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('camp.campaigns.create')
  @ApiOperation({
    summary: 'Draw one picture for a campaign from a brief and store it as a marketing upload',
    description:
      '422 CAMP_AI_NO_KEY when no key is active for the vendor; 422 CAMP_AI_LIMIT_REACHED when the monthly allowance on the ' +
      "platform's key is used; 422 CAMP_AI_IMAGE_REFUSED when the vendor's safety system refuses the prompt; 502 " +
      'CAMP_AI_PROVIDER_FAILED when the vendor fails or returns nothing; 422 when the workspace storage is local (the file must be ' +
      'reachable by the provider).',
  })
  generate(@Body(zodPipe(campaignAiImageSchema)) body: CampaignAiImageInput) {
    return this.ai.generate(body);
  }
}
