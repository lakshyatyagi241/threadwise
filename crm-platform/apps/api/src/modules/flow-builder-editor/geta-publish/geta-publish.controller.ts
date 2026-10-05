import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  setFlowGetaChatbotRequestSchema,
  updateGetaPublishSettingsRequestSchema,
  uuidSchema,
  type SetFlowGetaChatbotRequest,
  type UpdateGetaPublishSettingsRequest,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../../plans-subscriptions-trials';
import { FLB_PLAN_FEATURE } from '../flows.controller';
import { GetaPublishSettingsService } from './geta-publish-settings.service';
import { GetaPublishSyncService } from './geta-publish-sync.service';

/**
 * Geta console publishing: the workspace's credentials and the remote state of each flow (an addition beyond WaDesk). Literal
 * `geta-publish/...` paths have two segments, so they never collide with `flows/:id`.
 */
@ApiTags('flows')
@ActorKinds('user')
@Controller({ path: 'flows', version: '2' })
export class GetaPublishController {
  constructor(
    private readonly settings: GetaPublishSettingsService,
    private readonly sync: GetaPublishSyncService,
  ) {}

  @Get('geta-publish/settings')
  @RequirePermission('flb.geta.manage')
  @ApiOperation({
    summary:
      'The workspace Geta publishing settings: base URL, origin, set / not set flags, chatbot summary',
    description:
      'Secrets are never returned: `authorizationSet` and `getaHostSet` are flags and the chatbot record is a summary (id, name, bot id).',
  })
  async getSettings() {
    return this.settings.get();
  }

  @Put('geta-publish/settings')
  @Idempotent()
  @RequirePermission('flb.geta.manage')
  @ApiOperation({
    summary: 'Save the Geta publishing settings (only the fields sent change; null clears one)',
    description:
      '422 FLB_GETA_SETTINGS_INVALID for a base URL that is not https, or a chatbot record that is not a JSON object with `id` and `bot_id`.',
  })
  async saveSettings(
    @Body(zodPipe(updateGetaPublishSettingsRequestSchema)) body: UpdateGetaPublishSettingsRequest,
  ) {
    return this.settings.update(body);
  }

  @Delete('geta-publish/settings')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('flb.geta.manage')
  @ApiOperation({ summary: 'Remove every Geta credential of the workspace' })
  async clearSettings() {
    return this.settings.clear();
  }

  @Get(':id/publish-sync')
  @RequirePermission('flb.flows.read')
  @ApiOperation({
    summary: 'The remote (Geta) state of a flow: none | not_configured | pending | live | failed',
  })
  async status(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.sync.get(id);
  }

  @Post(':id/publish-sync/retry')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('flb.flows.publish')
  @RequirePlanFeature(FLB_PLAN_FEATURE)
  @ApiOperation({
    summary: 'Push the flow to Geta again, from the step that failed',
    description:
      '409 FLB_GETA_NOT_RETRYABLE for a draft, a push in progress or a flow that is already live; 422 FLB_GETA_NOT_CONFIGURED without credentials. Answers at once with the state `pending`: the worker makes the calls.',
  })
  async retry(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.sync.retry(id);
  }

  @Put(':id/publish-sync/chatbot')
  @Idempotent()
  @RequirePermission('flb.geta.manage')
  @ApiOperation({
    summary:
      "Set or remove this flow's own Geta chatbot record (replaces the workspace one for this flow)",
  })
  async setChatbot(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(setFlowGetaChatbotRequestSchema)) body: SetFlowGetaChatbotRequest,
  ) {
    return this.sync.setChatbot(id, body);
  }
}
