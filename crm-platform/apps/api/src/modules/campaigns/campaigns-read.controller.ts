import { Controller, Get, Header, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  listCampaignsQuerySchema,
  listRecipientsQuerySchema,
  type ListCampaignsQuery,
  type ListRecipientsQuery,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { CampaignsReadService } from './campaigns-read.service';
import { SAMPLE_CSV, SAMPLE_CSV_FILE } from './campaign-rules';

/** What the campaign screens read (WD-CAMP-001, 002, 004, 010, 019). */
@ApiTags('campaigns')
@ActorKinds('user')
@Controller({ path: 'campaigns', version: '2' })
export class CampaignsReadController {
  constructor(private readonly read: CampaignsReadService) {}

  @Get()
  @RequirePermission('camp.campaigns.read')
  @ApiOperation({
    summary: 'The campaigns with filters, tiles, status counts and health cards',
    description:
      'Counts come from the recipient rows. A campaign whose recipients are all resolved is finished by this call.',
  })
  list(@Query(zodPipe(listCampaignsQuerySchema)) query: ListCampaignsQuery) {
    return this.read.list(query);
  }

  @Get('builder')
  @RequirePermission('camp.campaigns.read')
  @ApiOperation({ summary: 'Senders, templates, groups, tags and flows for the builder' })
  builder() {
    return this.read.builder();
  }

  @Get('sample-csv')
  @RequirePermission('camp.campaigns.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', `attachment; filename="${SAMPLE_CSV_FILE}"`)
  @ApiOperation({ summary: 'A sample recipients CSV: name, country_code, phone' })
  sampleCsv(): string {
    return SAMPLE_CSV;
  }

  @Get(':id/config')
  @RequirePermission('camp.campaigns.read')
  @ApiOperation({ summary: 'The whole campaign for the edit form, with its recipient contacts' })
  config(@Param('id', ParseUUIDPipe) id: string) {
    return this.read.config(id);
  }

  @Get(':id')
  @RequirePermission('camp.campaigns.read')
  @ApiOperation({
    summary: 'The detail page: rates, funnel, charts, preview, audience, failures, replies',
  })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.read.detail(id);
  }

  @Get(':id/live')
  @RequirePermission('camp.campaigns.read')
  @ApiOperation({ summary: 'The numbers the detail page repaints every 15 seconds' })
  live(@Param('id', ParseUUIDPipe) id: string) {
    return this.read.live(id);
  }

  @Get(':id/recipients')
  @RequirePermission('camp.campaigns.read')
  @ApiOperation({ summary: 'The recipient log, 50 a page, with a status filter and a search' })
  recipients(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listRecipientsQuerySchema)) query: ListRecipientsQuery,
  ) {
    return this.read.recipients(id, query);
  }
}
