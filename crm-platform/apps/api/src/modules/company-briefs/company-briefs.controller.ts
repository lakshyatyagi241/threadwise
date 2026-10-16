import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  generateCompanyBriefSchema,
  type GenerateCompanyBriefInput,
  type RecordScope,
} from '@crm/contracts';
import { ActorKinds, GrantedScope, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { Throttle } from '../platform-infrastructure';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { CompanyBriefsService } from './company-briefs.service';

/**
 * "Generate brief" on the company page (BL-194). Needs the plan's sales pipeline (the flag the company routes are gated on) and
 * `record.companies.read`; the company must be inside the caller record scope, and the brief is made from what the caller may see.
 */
@ApiTags('companies')
@ActorKinds('user')
@RequirePlanFeature('sales_pipeline')
@Controller({ path: 'companies/:id/brief', version: '2' })
export class CompanyBriefsController {
  constructor(private readonly briefs: CompanyBriefsService) {}

  @Get()
  @RequirePermission('record.companies.read')
  @ApiOperation({
    summary: 'Whether a brief can be written, and the caller own latest brief of the company',
    description:
      '`available` is false when no AI key is available to the workspace. `brief.stale` is true when the CRM changed since it was written. Calls no model.',
  })
  async state(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.companies.read') scope: RecordScope,
  ) {
    return this.briefs.state(id, scope);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('record.companies.read')
  @Throttle({ limit: 20, windowSeconds: 3600, by: 'actor' })
  @ApiOperation({
    summary: 'Write (or rewrite) the AI brief of a company',
    description:
      'Facts are read as the caller (their record scopes) and sent without names, emails or phone numbers. The same facts within a day return the stored brief and call no model unless `regenerate` is true; a second generation within 30 seconds is 429 COMPANY_BRIEF_RATE_LIMITED. No AI key is 422 COMPANY_BRIEF_AI_UNAVAILABLE; a failing provider is 502 COMPANY_BRIEF_PROVIDER_FAILED and the previous brief is kept.',
  })
  async generate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(generateCompanyBriefSchema)) body: GenerateCompanyBriefInput,
    @GrantedScope('record.companies.read') scope: RecordScope,
  ) {
    return this.briefs.generate(id, scope, body);
  }
}
