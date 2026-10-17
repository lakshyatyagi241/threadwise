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
  lscBackfillSchema,
  lscRunsQuerySchema,
  lscSuggestionDecisionSchema,
  lscSuggestionsQuerySchema,
  updateLscSettingsSchema,
  type LscBackfillInput,
  type LscRunsQuery,
  type LscSuggestionDecisionInput,
  type LscSuggestionsQuery,
  type UpdateLscSettingsInput,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { LeadChatDigestService } from './lead-chat-digest.service';
import { LeadScoringService } from './lead-scoring.service';

/**
 * AI lead scoring of a workspace: its switch, the log with the cost, scoring one contact now, and the backfill. Every route needs the plan
 * feature `lead_scoring`, which the Marketplace app of the same name grants while it is installed (`422 PLAN_FEATURE_LOCKED` otherwise).
 */
@ApiTags('lead-scoring')
@ActorKinds('user')
@RequirePlanFeature('lead_scoring')
@Controller({ path: 'lead-scoring', version: '2' })
export class LeadScoringController {
  constructor(
    private readonly scoring: LeadScoringService,
    private readonly digests: LeadChatDigestService,
  ) {}

  @Get('settings')
  @RequirePermission('lsc.runs.read')
  @ApiOperation({
    summary: 'The workspace switch, the model and key in force, counts, and the 30 day cost',
  })
  settings() {
    return this.scoring.getSettings();
  }

  @Patch('settings')
  @RequirePermission('lsc.settings.manage')
  @ApiOperation({
    summary: 'Switch AI lead scoring on or off for the workspace',
    description: 'Opt-in: while off, no contact data is sent to an AI provider.',
  })
  updateSettings(@Body(zodPipe(updateLscSettingsSchema)) body: UpdateLscSettingsInput) {
    return this.scoring.updateSettings(body);
  }

  @Get('runs')
  @RequirePermission('lsc.runs.read')
  @ApiOperation({
    summary: 'The scoring log, newest first, with tokens and cost per score',
    description: 'Cursor pages of 25 by default.',
  })
  runs(@Query(zodPipe(lscRunsQuerySchema)) query: LscRunsQuery) {
    return this.scoring.listRuns(query);
  }

  @Post('contacts/:uuid/score')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('lsc.contacts.score')
  @ApiOperation({
    summary: 'Score one contact now',
    description:
      "Calls the AI provider before answering. Refused (409) when a person typed the contact's score.",
  })
  scoreContact(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return this.scoring.scoreNow(uuid);
  }

  @Post('backfill')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('lsc.contacts.score')
  @ApiOperation({
    summary:
      'Queue the contacts that have no score yet (up to the limit) to be scored in the background',
  })
  backfill(@Body(zodPipe(lscBackfillSchema)) body: LscBackfillInput) {
    return this.scoring.backfill(body);
  }

  @Get('contacts/:uuid/insight')
  @RequirePermission('lsc.runs.read')
  @ApiOperation({
    summary:
      "The latest reading of a contact's conversation and the stage move waiting for a decision",
  })
  insight(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return this.digests.insight(uuid);
  }

  @Post('contacts/:uuid/digest')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('lsc.contacts.score')
  @ApiOperation({
    summary: "Read one contact's conversation now",
    description:
      'Masks the recent messages and asks the AI provider for the intent, a score and a stage to suggest, before answering. Only for workspaces that switched the chat reading on.',
  })
  digestContact(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return this.digests.digestNow(uuid);
  }

  @Get('suggestions')
  @RequirePermission('lsc.runs.read')
  @ApiOperation({ summary: 'AI-suggested lifecycle stages, newest first (pending by default)' })
  suggestions(@Query(zodPipe(lscSuggestionsQuerySchema)) query: LscSuggestionsQuery) {
    return this.digests.listSuggestions(query);
  }

  @Post('suggestions/decide')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('lsc.stage.review')
  @ApiOperation({
    summary: 'Accept or dismiss suggested stages, one or many',
    description:
      'Accepting changes the contact stage as the signed-in person, so it also needs the right to edit that contact. Each suggestion is decided on its own; the answer lists the ones that could not be.',
  })
  decide(@Body(zodPipe(lscSuggestionDecisionSchema)) body: LscSuggestionDecisionInput) {
    return this.digests.decide(body);
  }

  @Post('suggestions/:uuid/undo')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('lsc.stage.review')
  @ApiOperation({
    summary: 'Put a contact back where it was before the AI moved it, if nobody moved it since',
    description:
      'The Undo on the chat line. Only a suggestion that was applied automatically can be undone; 409 when the contact moved on or it was undone already.',
  })
  async undo(@Param('uuid', ParseUUIDPipe) uuid: string): Promise<void> {
    await this.digests.undo(uuid);
  }
}
