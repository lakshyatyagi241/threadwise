import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  referralExportQuerySchema,
  referralHistoryQuerySchema,
  type ReferralExportQuery,
  type ReferralHistoryQuery,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ReferralService } from './referral.service';

/**
 * The signed-in person's affiliate program (TW-CPN-035..037). No permission key: Reference showed it to every authenticated user, and
 * the data is the caller's own (their referrals, whichever workspace they are in).
 */
@ApiTags('affiliate')
@ActorKinds('user')
@Controller({ path: 'affiliate', version: '2' })
export class AffiliateController {
  constructor(private readonly referrals: ReferralService) {}

  @Get('me')
  @ApiOperation({ summary: 'My referral code, share link and what a referral earns' })
  mine() {
    return this.referrals.mine();
  }

  @Get('summary')
  @ApiOperation({
    summary: 'The Account page Affiliate tab: code, counters and the 50 newest referrals',
  })
  summary() {
    return this.referrals.summary();
  }

  @Get('history')
  @ApiOperation({
    summary: 'KPIs, chart series, top codes, recent payouts and a page of my referrals',
  })
  history(@Query(zodPipe(referralHistoryQuerySchema)) q: ReferralHistoryQuery) {
    return this.referrals.history(q);
  }

  @Get('export')
  @ApiOperation({ summary: 'My referrals in the range as a CSV file' })
  async export(
    @Query(zodPipe(referralExportQuerySchema)) q: ReferralExportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { body, fileName } = await this.referrals.exportCsv(q.range);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return new StreamableFile(Buffer.from(body, 'utf8'));
  }
}
