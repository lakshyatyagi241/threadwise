import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  extendLegalHoldSchema,
  legalHoldSubjectLookupSchema,
  listLegalHoldsQuerySchema,
  placeLegalHoldSchema,
  releaseLegalHoldSchema,
  reviewLegalHoldSchema,
  type ExtendLegalHoldInput,
  type ListLegalHoldsQuery,
  type LegalHoldSubjectLookup,
  type PlaceLegalHoldInput,
  type ReleaseLegalHoldInput,
  type ReviewLegalHoldInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { Throttle } from '../../platform-infrastructure';
import { LegalHoldsService } from './legal-holds.service';

/**
 * Legal holds (BL-295, docs/specs/legal-hold.md section 8): freeze erasure and every purge for a contact, a lead or the whole workspace.
 * Placing, extending, reviewing and releasing is `privacy.requests.manage` (Owner, Admin); reading the register and a person's status is
 * `privacy.requests.read` (Owner, Admin, Manager). No new permission key: the presets already know these two.
 */
@ApiTags('privacy')
@ActorKinds('user')
@Controller({ path: 'privacy/legal-holds', version: '2' })
export class LegalHoldsController {
  constructor(private readonly holds: LegalHoldsService) {}

  @Get()
  @RequirePermission('privacy.requests.read')
  @ApiOperation({
    summary:
      'The legal-hold register, newest first (filter by status, category, scope, review due, case reference)',
  })
  list(@Query(zodPipe(listLegalHoldsQuerySchema)) query: ListLegalHoldsQuery) {
    return this.holds.list(query);
  }

  @Get('status')
  @RequirePermission('privacy.requests.read')
  @ApiOperation({
    summary: 'Is this contact or lead under a legal hold? (backs the banner on the contact page)',
  })
  status(@Query(zodPipe(legalHoldSubjectLookupSchema)) q: LegalHoldSubjectLookup) {
    return this.holds.status(q.kind, q.id);
  }

  @Get('export')
  @RequirePermission('privacy.requests.read')
  @Throttle({ limit: 10, windowSeconds: 60, by: 'actor' })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({
    summary: 'The register as a CSV for auditors (same filters as the list). Audited as an export.',
  })
  async export(
    @Query(zodPipe(listLegalHoldsQuerySchema)) query: ListLegalHoldsQuery,
  ): Promise<StreamableFile> {
    const out = await this.holds.exportCsv(query);
    return new StreamableFile(Buffer.from(out.csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${out.fileName}"`,
    });
  }

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('privacy.requests.manage')
  @Throttle({ limit: 30, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary: 'Place a legal hold on a contact, a lead or the whole workspace',
    description:
      'Erasure and every purge of the subject are refused (409 LEGAL_HOLD_ACTIVE) and its open erasure requests become restricted. One active hold per subject (409 LEGAL_HOLD_EXISTS). Idempotency-Key supported.',
  })
  place(@Body(zodPipe(placeLegalHoldSchema)) body: PlaceLegalHoldInput) {
    return this.holds.place(body);
  }

  @Get(':id')
  @RequirePermission('privacy.requests.read')
  @ApiOperation({ summary: 'One legal hold with its history' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.holds.get(id);
  }

  @Post(':id/extend')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('privacy.requests.manage')
  @Throttle({ limit: 30, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary:
      'Change the review date or the end date, add a further case reference, or edit the note',
  })
  extend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(extendLegalHoldSchema)) body: ExtendLegalHoldInput,
  ) {
    return this.holds.extend(id, body);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('privacy.requests.manage')
  @Throttle({ limit: 30, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary:
      'Record that the hold was reviewed (who and when), optionally with the next review date',
  })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(reviewLegalHoldSchema)) body: ReviewLegalHoldInput,
  ) {
    return this.holds.review(id, body);
  }

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('privacy.requests.manage')
  @Throttle({ limit: 30, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary: 'Release the hold',
    description:
      'The cases it restricted leave the restriction; an erasure someone had already confirmed is executed by the worker within a minute.',
  })
  release(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(releaseLegalHoldSchema)) body: ReleaseLegalHoldInput,
  ) {
    return this.holds.release(id, body);
  }
}
