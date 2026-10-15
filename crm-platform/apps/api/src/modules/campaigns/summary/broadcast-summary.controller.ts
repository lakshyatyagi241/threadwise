import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  campaignSummaryPeopleQuerySchema,
  campaignSummaryQuerySchema,
  type CampaignSummaryPeopleQuery,
  type CampaignSummaryQuery,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { CampaignSummaryService } from './campaign-summary.service';

/**
 * The director summary of a legacy broadcast, same shapes as a campaign's (`kind: 'broadcast'`, read from `broadcast_contacts`).
 * It lives with the campaign summary so the two share one engine; the broadcasts module cannot import campaigns.
 */
@ApiTags('broadcasts')
@ActorKinds('user')
@Controller({ path: 'broadcasts', version: '2' })
export class BroadcastSummaryController {
  constructor(private readonly summary: CampaignSummaryService) {}

  @Get(':id/summary')
  @RequirePermission('bcast.broadcasts.read')
  @ApiOperation({
    summary:
      'Director summary of a broadcast: people messaged, delivered, read, wrote back, filled a form',
  })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(campaignSummaryQuerySchema)) query: CampaignSummaryQuery,
  ) {
    return this.summary.summary('broadcast', id, query);
  }

  @Get(':id/summary/people')
  @RequirePermission('bcast.broadcasts.read')
  @ApiOperation({ summary: 'The people behind a broadcast summary figure' })
  people(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(campaignSummaryPeopleQuerySchema)) query: CampaignSummaryPeopleQuery,
  ) {
    return this.summary.people('broadcast', id, query);
  }
}
