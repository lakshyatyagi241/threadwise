import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  broadcastAssistantSchema,
  growthActionDecisionSchema,
  growthActionsQuerySchema,
  syncAudienceSchema,
  updateGrowthSettingsSchema,
  type BroadcastAssistantInput,
  type GrowthActionDecisionInput,
  type GrowthActionsQuery,
  type SyncAudienceInput,
  type UpdateGrowthSettingsInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { GrowthActionsService } from './growth-actions.service';
import { GrowthAssistantService } from './growth-assistant.service';
import { GrowthService } from './growth.service';

const org = (): number => RequestContextStore.orgId();

/**
 * The growth pilot of a workspace. Every route except the settings read refuses a workspace that is not in the pilot (403
 * `GRW_NOT_AVAILABLE`), and a part that is switched off (422 `GRW_FEATURE_OFF`). Permissions are lead scoring's: reading needs
 * `lsc.runs.read`, running something `lsc.contacts.score`, the switches `lsc.settings.manage`, and deciding an action or a stage change
 * `lsc.stage.review`.
 */
@ApiTags('growth')
@ActorKinds('user')
@Controller({ path: 'growth', version: '2' })
export class GrowthController {
  constructor(
    private readonly growth: GrowthService,
    private readonly actions: GrowthActionsService,
    private readonly assistant: GrowthAssistantService,
  ) {}

  @Get('settings')
  @RequirePermission('lsc.runs.read')
  @ApiOperation({
    summary:
      'Which parts of the growth pilot are on, their thresholds, and whether the workspace is in the pilot',
  })
  settings() {
    return this.growth.settings(org());
  }

  @Patch('settings')
  @RequirePermission('lsc.settings.manage')
  @ApiOperation({
    summary: 'Switch parts of the growth pilot on or off and change their thresholds and rules',
  })
  updateSettings(@Body(zodPipe(updateGrowthSettingsSchema)) body: UpdateGrowthSettingsInput) {
    return this.growth.updateSettings(org(), body);
  }

  @Get('overview')
  @RequirePermission('lsc.runs.read')
  @ApiOperation({ summary: 'The settings and the latest daily digest, for the top of the screen' })
  overview() {
    return this.growth.overview(org());
  }

  // --- campaigns ---------------------------------------------------------------------------------------------------

  @Get('campaigns/report')
  @RequirePermission('lsc.runs.read')
  @ApiOperation({
    summary: 'Per campaign, the replies that really followed the send (24 and 72 hours)',
  })
  campaignReport() {
    return this.growth.campaignReport(org());
  }

  @Post('campaigns/stamp')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('lsc.contacts.score')
  @ApiOperation({
    summary:
      'Record the response time on every campaign recipient that wrote back, and recount the campaigns',
  })
  stamp() {
    return this.growth.stampResponses(org());
  }

  // --- audiences ---------------------------------------------------------------------------------------------------

  @Get('audiences')
  @RequirePermission('lsc.runs.read')
  @ApiOperation({
    summary:
      'The computed audiences (engaged, silent, lapsed, hot in chat, likely to convert, service due) with sizes',
  })
  audiences() {
    return this.growth.audiences(org());
  }

  @Post('audiences/sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('lsc.contacts.score')
  @ApiOperation({
    summary: 'Rebuild the contact group of one audience so a campaign can send to it',
  })
  syncAudience(@Body(zodPipe(syncAudienceSchema)) body: SyncAudienceInput) {
    return this.growth.syncAudience(org(), body.key);
  }

  // --- timing, the model, quality, the digest ----------------------------------------------------------------------

  @Get('send-times')
  @RequirePermission('lsc.runs.read')
  @ApiOperation({
    summary:
      'The hours when contacts read and write, in the workspace time zone, and the best hours to send',
  })
  sendTimes() {
    return this.growth.sendTimes(org());
  }

  @Get('propensity')
  @RequirePermission('lsc.runs.read')
  @ApiOperation({
    summary:
      'How well the conversion model does (AUC, share of converted contacts in its top tenth) and what drives it',
  })
  propensity() {
    return this.growth.propensityModel(org());
  }

  @Post('propensity/recompute')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('lsc.contacts.score')
  @ApiOperation({
    summary: 'Learn the conversion model again from the converted contacts and score everyone',
  })
  recompute() {
    return this.growth.recomputePropensity(org());
  }

  @Get('contacts/:uuid')
  @RequirePermission('lsc.runs.read')
  @ApiOperation({ summary: 'One contact: its conversion score and what enrichment found' })
  contact(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return this.growth.contactGrowth(org(), uuid);
  }

  @Get('quality')
  @RequirePermission('lsc.runs.read')
  @ApiOperation({
    summary:
      'Accept and dismiss rates, how well the score separates converted contacts, and what the AI cost',
  })
  quality() {
    return this.growth.quality(org());
  }

  @Get('digest')
  @RequirePermission('lsc.runs.read')
  @ApiOperation({ summary: "Today's summary of the workspace" })
  digest() {
    return this.growth.digest(org());
  }

  // --- the Growth inbox --------------------------------------------------------------------------------------------

  @Get('actions')
  @RequirePermission('lsc.runs.read')
  @ApiOperation({
    summary:
      'The Growth inbox: hot leads, unanswered questions, opt-outs, routing, lapsed customers... (open by default)',
  })
  listActions(@Query(zodPipe(growthActionsQuerySchema)) query: GrowthActionsQuery) {
    return this.actions.list(org(), query);
  }

  @Post('actions/decide')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('lsc.stage.review')
  @ApiOperation({
    summary: 'Accept or dismiss actions, one or many',
    description:
      'Accepting does the work of its kind as the signed-in person (assigning a conversation needs the right to assign; an opt-out is recorded in the consent ledger). Each is decided on its own.',
  })
  decide(@Body(zodPipe(growthActionDecisionSchema)) body: GrowthActionDecisionInput) {
    return this.actions.decide(body);
  }

  // --- automatic stage changes -------------------------------------------------------------------------------------

  @Get('auto-stage')
  @RequirePermission('lsc.runs.read')
  @ApiOperation({
    summary: 'The stage changes made automatically, how many today, and the daily cap',
  })
  autoStage() {
    return this.growth.autoStage(org());
  }

  @Post('auto-stage/:uuid/undo')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('lsc.stage.review')
  @ApiOperation({
    summary: 'Put a contact back where it was before an automatic change, if nobody moved it since',
  })
  async undo(@Param('uuid', ParseUUIDPipe) uuid: string): Promise<void> {
    await this.growth.undoAutoStage(org(), uuid);
  }

  // --- the assistant -----------------------------------------------------------------------------------------------

  @Post('assistant/broadcast')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('lsc.contacts.score')
  @ApiOperation({
    summary: 'Suggest the audience and the template for a goal',
    description:
      'Recommends from the workspace’s own groups and approved templates, weighted by real reply rates. Sends and creates nothing.',
  })
  recommend(@Body(zodPipe(broadcastAssistantSchema)) body: BroadcastAssistantInput) {
    return this.assistant.recommend(org(), body);
  }

  // --- enrichment --------------------------------------------------------------------------------------------------

  @Get('enrichment')
  @RequirePermission('lsc.runs.read')
  @ApiOperation({
    summary:
      'Whether an enrichment provider is configured and how many contacts it found, did not find or failed on',
  })
  enrichment() {
    return this.growth.enrichmentStatus(org());
  }

  @Post('enrichment/run')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('lsc.contacts.score')
  @ApiOperation({
    summary:
      'Look up the next batch of contacts that have a business email (50 at most); inert without a provider key',
  })
  async runEnrichment() {
    return { asked: await this.growth.enrich(org()) };
  }
}
