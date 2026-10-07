import { Controller, Delete, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  EXT_SHEETS_USE_PERMISSION,
  type ExtSheetsKeyIssued,
  type ExtSheetsKeyStatus,
  type ExtSheetsOverview,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { SheetsFilesService } from './sheets-files.service';
import { SheetsKeyService } from './sheets-key.service';
import { SheetsSetupService } from './sheets-setup.service';

/**
 * The signed-in member's side of the Google Sheets add-on (WD-EXT-001 to 006): their own key, the setup page and the add-on source. Every
 * route acts on the caller alone; there is no member id anywhere in the path. The add-on's own API is `SheetsAddonController`.
 *
 * Using the add-on needs the role permission `app.google-sheets.use` (granted to the Admin preset when the app is installed). Looking at
 * the key and revoking it need no permission: a member whose role lost the app can still switch their own key off.
 */
@ApiTags('Google Sheets add-on')
@ActorKinds('user')
@Controller({ path: 'extension/sheets', version: '2' })
export class SheetsKeyController {
  constructor(
    private readonly keys: SheetsKeyService,
    private readonly setup: SheetsSetupService,
    private readonly files: SheetsFilesService,
  ) {}

  @Get('overview')
  @RequirePermission(EXT_SHEETS_USE_PERMISSION)
  @RequirePlanFeature('marketplace')
  overview(): Promise<ExtSheetsOverview> {
    return this.setup.overview();
  }

  @Get('key')
  status(): Promise<ExtSheetsKeyStatus> {
    return this.keys.status();
  }

  /** Not idempotent on purpose: each call makes a new key and ends the old one, and the answer carries a secret that must never be replayed. */
  @Post('key')
  @HttpCode(201)
  @RequirePermission(EXT_SHEETS_USE_PERMISSION)
  @RequirePlanFeature('marketplace')
  generate(@Res({ passthrough: true }) res: Response): Promise<ExtSheetsKeyIssued> {
    res.setHeader('Cache-Control', 'no-store');
    return this.keys.generate();
  }

  @Delete('key')
  revoke(): Promise<ExtSheetsKeyStatus> {
    return this.keys.revoke();
  }

  @Get('files')
  @RequirePermission(EXT_SHEETS_USE_PERMISSION)
  listFiles() {
    return this.files.list().then((files) => ({ files }));
  }

  @Get('files/:name')
  @RequirePermission(EXT_SHEETS_USE_PERMISSION)
  async download(@Param('name') name: string, @Res({ passthrough: true }) res: Response) {
    const file = await this.files.read(name);
    res.setHeader('Content-Type', `${file.contentType}; charset=UTF-8`);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return file.body;
  }
}
