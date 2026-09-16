import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { publicLeadSubmitSchema, type PublicLeadSubmitInput } from '@crm/contracts';
import { Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiKeyGuard } from './api-key.guard';
import { PublicApiService } from './public-api.service';

/**
 * The external API.
 *
 * Note the path: `/public/v1`, versioned separately from the internal `/v1`.
 * Internal routes change with the product; this one changes only with a
 * migration plan and notice to whoever is integrating.
 *
 * `@Public()` disables the JWT guard — authentication here is the API key
 * guard, which is a different mechanism entirely.
 */
@ApiTags('public-api')
@Public()
@UseGuards(ApiKeyGuard)
@ApiHeader({ name: 'Authorization', description: 'ApiKey <prefix>.<secret>', required: true })
@ApiHeader({
  name: 'X-Signature',
  description:
    'hex HMAC-SHA256 of `{timestamp}.{METHOD}.{path}.{rawBody}` using the signing secret',
  required: true,
})
@ApiHeader({ name: 'X-Timestamp', description: 'Unix seconds', required: true })
// Version-neutral so the global URI versioning does not prefix this into
// /v1/public/v1. The external contract carries its own version in the path,
// on purpose: it moves on a different clock from the internal API.
@Controller({ path: 'public/v1', version: VERSION_NEUTRAL })
export class PublicApiController {
  constructor(private readonly publicApi: PublicApiService) {}

  @Get('leads/:id')
  @ApiOperation({
    summary: 'Read a lead',
    description:
      'Name, email, mobile, lifecycle stage, college tag and last-updated. Served from the read replica — expect sub-second replication lag.',
  })
  async getLead(@Param('id', ParseUUIDPipe) id: string) {
    return this.publicApi.getLead(id);
  }

  @Post('leads')
  @ApiOperation({
    summary: 'Submit a lead',
    description:
      'Deduplicated against existing contacts by email/phone. `created: false` means an existing contact was matched and updated rather than a new one created.',
  })
  async submitLead(@Body(zodPipe(publicLeadSubmitSchema)) body: PublicLeadSubmitInput) {
    return this.publicApi.submitLead(body);
  }
}
