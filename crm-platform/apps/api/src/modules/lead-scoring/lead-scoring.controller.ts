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
  updateLscSettingsSchema,
  type LscBackfillInput,
  type LscRunsQuery,
  type UpdateLscSettingsInput,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { LeadScoringService } from './lead-scoring.service';

/** AI lead scoring of a workspace: its switch, the log with the cost, scoring one contact now, and the backfill. */
@ApiTags('lead-scoring')
@ActorKinds('user')
@Controller({ path: 'lead-scoring', version: '2' })
export class LeadScoringController {
  constructor(private readonly scoring: LeadScoringService) {}

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
}
