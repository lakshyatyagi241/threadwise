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
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  createPrivacyRequestSchema,
  erasePrivacyRequestSchema,
  holdPrivacyRequestSchema,
  listPrivacyRequestsQuerySchema,
  privacySubjectSearchQuerySchema,
  rejectPrivacyRequestSchema,
  updatePrivacyRequestsSettingsSchema,
  verifyPrivacyRequestSchema,
  type CreatePrivacyRequestInput,
  type ErasePrivacyRequestInput,
  type HoldPrivacyRequestInput,
  type ListPrivacyRequestsQuery,
  type PrivacyRequestsSettings,
  type PrivacySubjectSearchQuery,
  type RejectPrivacyRequestInput,
  type VerifyPrivacyRequestInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { Throttle } from '../../platform-infrastructure';
import { PrivacyRequestsService } from './privacy-requests.service';

/**
 * Data requests: what a person asked about their data, the identity check, the export and the erasure (spec
 * docs/specs/privacy-and-data-governance.md section 4.5). Reading is `privacy.requests.read` (Owner, Admin, Manager); creating,
 * verifying, holding and exporting is `privacy.requests.manage` (Owner, Admin); erasing is `privacy.erase.execute` (Owner, Admin).
 * Nothing here answers with the person's name, number or address: a subject is a masked label.
 */
@ApiTags('privacy')
@ActorKinds('user')
@Controller({ path: 'privacy', version: '2' })
export class PrivacyRequestsController {
  constructor(private readonly requests: PrivacyRequestsService) {}

  @Get('settings')
  @RequirePermission('privacy.requests.read')
  @ApiOperation({ summary: 'The workspace clock for data requests (days to answer)' })
  getSettings() {
    return this.requests.getSettings();
  }

  @Patch('settings')
  @RequirePermission('privacy.requests.manage')
  @ApiOperation({ summary: 'Set the days a data request has to be answered (default 30)' })
  updateSettings(
    @Body(zodPipe(updatePrivacyRequestsSettingsSchema)) body: PrivacyRequestsSettings,
  ) {
    return this.requests.updateSettings(body);
  }

  @Get('subjects')
  @RequirePermission('privacy.requests.manage')
  @Throttle({ limit: 60, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary: 'Find the person a request is about, by name, phone or email (contacts and leads)',
    description: 'Phone and email come back masked.',
  })
  searchSubjects(
    @Query(zodPipe(privacySubjectSearchQuerySchema)) query: PrivacySubjectSearchQuery,
  ) {
    return this.requests.searchSubjects(query.q);
  }

  @Get('requests')
  @RequirePermission('privacy.requests.read')
  @ApiOperation({ summary: 'Data requests, newest first (filter by status, type, overdue)' })
  list(@Query(zodPipe(listPrivacyRequestsQuerySchema)) query: ListPrivacyRequestsQuery) {
    return this.requests.list(query);
  }

  @Post('requests')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('privacy.requests.manage')
  @Throttle({ limit: 30, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary:
      'Log a data request (access, export, erasure, rectification, restriction, objection, withdrawal, portability)',
    description:
      'The subject is a contact, a lead, or a phone / email for a person who is not a contact. The clock starts now (workspace setting, default 30 days). Idempotency-Key supported.',
  })
  create(@Body(zodPipe(createPrivacyRequestSchema)) body: CreatePrivacyRequestInput) {
    return this.requests.create(body);
  }

  @Get('requests/:id')
  @RequirePermission('privacy.requests.read')
  @ApiOperation({ summary: 'One data request with its history and exports' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.requests.get(id);
  }

  @Post('requests/:id/verify')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('privacy.requests.manage')
  @Throttle({ limit: 30, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary: 'Record the identity check: started, verified (with the method) or failed',
    description: 'The evidence is a reference id only (a ticket, a message id), never a document.',
  })
  verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(verifyPrivacyRequestSchema)) body: VerifyPrivacyRequestInput,
  ) {
    return this.requests.verify(id, body);
  }

  @Post('requests/:id/hold')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('privacy.requests.manage')
  @Throttle({ limit: 30, windowSeconds: 60, by: 'actor' })
  @ApiOperation({ summary: 'Put the request on legal hold (erasure refused) or release the hold' })
  hold(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(holdPrivacyRequestSchema)) body: HoldPrivacyRequestInput,
  ) {
    return this.requests.hold(id, body);
  }

  @Post('requests/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('privacy.requests.manage')
  @Throttle({ limit: 30, windowSeconds: 60, by: 'actor' })
  @ApiOperation({ summary: 'Refuse the request, with the reason' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(rejectPrivacyRequestSchema)) body: RejectPrivacyRequestInput,
  ) {
    return this.requests.reject(id, body);
  }

  @Post('requests/:id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('privacy.requests.manage')
  @Throttle({ limit: 30, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary:
      'Close a verified request that ends without an erasure (rectification, restriction, objection, withdrawal, or a delivered export)',
  })
  complete(@Param('id', ParseUUIDPipe) id: string) {
    return this.requests.complete(id);
  }

  @Post('requests/:id/export')
  @Idempotent()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('privacy.requests.manage')
  @Throttle({ limit: 6, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary: 'Prepare the ZIP of everything the workspace holds about the person (202)',
    description:
      'Built by a worker: per-module JSON, the messages as a CSV in plain language and the stored files with links that work 7 days. Secrets are masked. Nothing is emailed to the person: download it from the request. 409 PRIVACY_IDENTITY_NOT_VERIFIED before the identity is verified.',
  })
  requestExport(@Param('id', ParseUUIDPipe) id: string) {
    return this.requests.requestExport(id);
  }

  @Get('requests/:id/exports/:exportId/download')
  @RequirePermission('privacy.requests.manage')
  @Throttle({ limit: 20, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary: 'The finished ZIP (kept 7 days); audited, and it delivers an export request',
  })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('exportId', ParseUUIDPipe) exportId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, fileName } = await this.requests.downloadExport(id, exportId);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(stream);
  }

  @Post('requests/:id/erase')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('privacy.erase.execute')
  @Throttle({ limit: 6, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary: 'Preview (dryRun: true) or execute the erasure of the person',
    description:
      'The preview returns the rows per table and the files that would go, and changes nothing. Executing needs a preview of the same request from the last 24 hours and the typed phrase "ERASE <reference>"; the counts are re-checked in the same transaction and must equal the preview. Irreversible. 409 while on legal hold or before the identity is verified.',
  })
  erase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(erasePrivacyRequestSchema)) body: ErasePrivacyRequestInput,
  ) {
    return this.requests.erase(id, body);
  }
}
