import { Body, Controller, Delete, Get, Param, Patch, Put, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Readable } from 'node:stream';
import {
  deleteWorkspaceRequestSchema,
  exportTypeSchema,
  saveNotificationPrefsRequestSchema,
  savePreferencesRequestSchema,
  updateWorkspaceSettingsRequestSchema,
  type DeleteWorkspaceRequest,
  type SaveNotificationPrefsRequest,
  type SavePreferencesRequest,
  type UpdateWorkspaceSettingsRequest,
} from '@crm/contracts';
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
