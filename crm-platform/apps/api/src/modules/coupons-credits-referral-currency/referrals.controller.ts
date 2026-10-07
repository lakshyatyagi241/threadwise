import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  referralExportQuerySchema,
  referralListQuerySchema,
  type ReferralExportQuery,
  type ReferralListParams,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ReferralService } from './referral.service';

/**
 * The signed-in user's own affiliate data (WD-CPN-035..037). No permission key: like `/me/locale` it is the caller's own data,
 * scoped to them in SQL, so there is nothing a role could grant or withhold.
 */
@ApiTags('referrals')
@ActorKinds('user')
@Controller({ path: 'me', version: '2' })
export class ReferralsController {
  constructor(private readonly referrals: ReferralService) {}

  @Get('referral')
  @ApiOperation({
    summary: 'My referral code and link, the reward, true counts and the 50 newest referrals',
  })
  overview() {
    return this.referrals.overview();
  }

  @Get('referrals')
  @ApiOperation({
    summary:
      'My referrals for a range: cursor-paged table, stats, volume chart, top codes, payouts',
    description:
      'Money is integer hundredths of the platform currency. `bucket` is honoured when sent; when absent the server picks by range.',
  })
  list(@Query(zodPipe(referralListQuerySchema)) q: ReferralListParams) {
    return this.referrals.list(q);
  }

  @Get('referrals/export')
  @ApiOperation({
    summary: 'My referrals of a range as CSV (UTF-8 with BOM, newest first)',
  })
  export(
    @Query(zodPipe(referralExportQuerySchema)) q: ReferralExportQuery,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    const { stream, fileName } = this.referrals.exportCsv(q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return new StreamableFile(stream);
  }
}
