import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Res,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import {
  BRAND_LOGO_MAX_BYTES,
  BRAND_SLOTS,
  deleteWorkspaceRequestSchema,
  saveResidencyRequestSchema,
  exportTypeSchema,
  saveNotificationPrefsRequestSchema,
  savePreferencesRequestSchema,
  updateBrandingFieldsSchema,
  updateWorkingHoursSchema,
  updateWorkspaceSettingsRequestSchema,
  type DeleteWorkspaceRequest,
  type SaveNotificationPrefsRequest,
  type SavePreferencesRequest,
  type BrandSlot,
  type SaveResidencyRequest,
  type UpdateBrandingFields,
  type UpdateWorkingHoursInput,
  type UpdateWorkspaceSettingsRequest,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { WorkspaceExportService } from './workspace-export.service';
import { WorkspaceSettingsService } from './workspace-settings.service';

/**
 * The customer Settings page (TW-ASHELL-032..044). Any member reads; the owner writes (an administrator when the workspace
 * records no owner). There is no permission key: ownership is a fact about the workspace, not a role grant, as in Reference.
 * Literal paths come before any parameter.
 */
@ApiTags('shell')
@ActorKinds('user')
@Controller({ path: 'shell/workspace', version: '2' })
export class WorkspaceSettingsController {
  constructor(
    private readonly settings: WorkspaceSettingsService,
    private readonly exports: WorkspaceExportService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Workspace name, URL, timezone and currency (General tab)' })
  get() {
    return this.settings.get();
  }

  @Patch()
  @ApiOperation({
    summary: 'Save the General tab (owner only; blank values are ignored)',
  })
  update(
    @Body(zodPipe(updateWorkspaceSettingsRequestSchema)) body: UpdateWorkspaceSettingsRequest,
  ) {
    return this.settings.update(body);
  }

  @Get('working-hours')
  @ApiOperation({
    summary:
      'The weekly working hours and holidays (General tab); the business hours the inbox, SLA and flows read',
  })
  workingHours() {
    return this.settings.workingHours();
  }

  @Put('working-hours')
  @ApiOperation({
    summary: 'Save the working hours and holidays (owner only)',
    description:
      'Seven days, each with a window and up to two extra windows; a closing time before the opening time is an overnight window; 24:00 closes at the end of the day. Holidays are closed all day and are kept when omitted.',
  })
  saveWorkingHours(@Body(zodPipe(updateWorkingHoursSchema)) body: UpdateWorkingHoursInput) {
    return this.settings.saveWorkingHours(body);
  }

  @Get('notifications')
  @ApiOperation({ summary: 'The notification matrix: 18 events, 9 categories, Slack URL' })
  notifications() {
    return this.settings.notifications();
  }

  @Put('notifications')
  @ApiOperation({ summary: 'Save the notification matrix (owner only)' })
  saveNotifications(
    @Body(zodPipe(saveNotificationPrefsRequestSchema)) body: SaveNotificationPrefsRequest,
  ) {
    return this.settings.saveNotifications(body);
  }

  @Get('export')
  @ApiOperation({ summary: 'Row counts shown on the export cards' })
  exportCounts() {
    return this.exports.counts();
  }

  @Get('export/:type')
  @ApiOperation({
    summary: 'Download contacts, conversations or messages as CSV (owner only)',
    description: 'Streamed in batches. An unknown type is 422.',
  })
  async download(
    @Param('type', zodPipe(exportTypeSchema)) type: 'contacts' | 'conversations' | 'messages',
  ) {
    const chunks = await this.exports.open(type);
    return new StreamableFile(Readable.from(chunks, { objectMode: false }), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${type}.csv"`,
    });
  }

  @Get('integrations')
  @ApiOperation({ summary: 'Sheets key status and webhook counts (API and webhooks tab)' })
  integrations() {
    return this.settings.integrations();
  }

  @Get('data-residency')
  @ApiOperation({ summary: 'Which translation providers may receive message text' })
  residency() {
    return this.settings.residency();
  }

  @Put('data-residency')
  @ApiOperation({ summary: 'Set no restriction, EU only or on-premise only (owner only)' })
  saveResidency(@Body(zodPipe(saveResidencyRequestSchema)) body: SaveResidencyRequest) {
    return this.settings.saveResidency(body);
  }

  @Get('branding')
  @ApiOperation({ summary: 'Brand colours, logo and favicon (Branding tab)' })
  branding() {
    return this.settings.branding();
  }

  @Post('branding')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'logo', maxCount: 1 },
        { name: 'favicon', maxCount: 1 },
      ],
      // A little above the logo cap so a file just over it still reaches the policy and gets its precise message.
      { limits: { fileSize: Math.ceil(BRAND_LOGO_MAX_BYTES * 1.2) } },
    ),
  )
  @ApiOperation({
    summary: 'Save the Branding tab (owner only): three #RRGGBB colours, a logo and a favicon',
    description: 'Absent fields are untouched; a blank colour clears it.',
  })
  saveBranding(
    @Body() raw: Record<string, unknown>,
    @UploadedFiles()
    files: {
      logo?: Array<{ originalname: string; buffer: Buffer }>;
      favicon?: Array<{ originalname: string; buffer: Buffer }>;
    },
  ) {
    const parsed = updateBrandingFieldsSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      throw AppError.validation(
        'The brand colours must be #RRGGBB',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    const fields: UpdateBrandingFields = parsed.data;
    return this.settings.saveBranding(fields, {
      logo: files?.logo?.[0],
      favicon: files?.favicon?.[0],
    });
  }

  @Get('branding/:slot')
  @ApiExcludeEndpoint()
  async brandAsset(@Param('slot') slot: string, @Res() res: Response) {
    const found = (BRAND_SLOTS as readonly string[]).includes(slot)
      ? await this.settings.readBrandAsset(slot as BrandSlot)
      : null;
    if (!found) {
      res
        .status(404)
        .type('application/problem+json')
        .send({ type: 'about:blank', title: 'Not Found', status: 404, code: 'NOT_FOUND' });
      return;
    }
    res
      .status(200)
      .setHeader('content-type', found.mime)
      .setHeader('etag', `"${found.etag}"`)
      // The URL carries ?v=<etag>, so it can be cached hard and still change when the file does.
      .setHeader('cache-control', 'private, max-age=31536000, immutable')
      .setHeader('x-content-type-options', 'nosniff')
      .send(found.bytes);
  }

  @Delete()
  @ApiOperation({
    summary: 'Delete the workspace (owner only; needs the exact name and the password)',
  })
  async remove(@Body(zodPipe(deleteWorkspaceRequestSchema)) body: DeleteWorkspaceRequest) {
    await this.settings.deleteWorkspace(body);
    return { ok: true };
  }
}

/** Per-person Settings (TW-ASHELL-035): no owner needed, only the caller's own row. */
@ApiTags('shell')
@ActorKinds('user')
@Controller({ path: 'shell/preferences', version: '2' })
export class PreferencesController {
  constructor(private readonly settings: WorkspaceSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'My preferences (auto AI summarize)' })
  get() {
    return this.settings.preferences();
  }

  @Put()
  @ApiOperation({ summary: 'Save my preferences' })
  save(@Body(zodPipe(savePreferencesRequestSchema)) body: SavePreferencesRequest) {
    return this.settings.savePreferences(body);
  }
}
