import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { Throttle } from '../platform-infrastructure';
import { PublicTrustService } from './public-trust.service';

/** The public sub-processor page of a workspace that switched it on (BL-173). No login, throttled per IP, nothing personal. */
@ApiTags('compliance')
@Public()
@Controller({ path: 'public/compliance', version: '2' })
export class PublicTrustController {
  constructor(private readonly trust: PublicTrustService) {}

  @Get('trust/:slug')
  @Throttle({ limit: 60, windowSeconds: 60, by: 'ip' })
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({
    summary:
      'The workspace sub-processors, privacy and terms links (404 unless the workspace switched the page on)',
  })
  page(@Param('slug') slug: string) {
    return this.trust.page(slug);
  }
}
