import {
  Body,
  Controller,
  Get,
  Headers,
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
  consentEventsQuerySchema,
  recordConsentSchema,
  recordPrivacyFlagSchema,
  testConsentMessageSchema,
  updateConsentSettingsSchema,
  type ConsentEventsQuery,
  type RecordConsentInput,
  type RecordPrivacyFlagInput,
  type TestConsentMessageInput,
  type UpdateConsentSettingsInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { Throttle } from '../platform-infrastructure';
import { ConsentExportService } from './consent-export.service';
import { ConsentSettingsService } from './consent-settings.service';
import { ContactConsentService } from './consent.service';
import { ContactPrivacyService } from './contact-privacy.service';

/** The consent ledger, the STOP / START settings and the proof exports (spec docs/specs/contact-consent-ledger.md). */
@ApiTags('contact-consent')
@ActorKinds('user')
@Controller({ path: 'contact-consent', version: '2' })
export class ContactConsentController {
  constructor(
    private readonly ledger: ContactConsentService,
    private readonly settings: ConsentSettingsService,
    private readonly exports: ConsentExportService,
    private readonly privacy: ContactPrivacyService,
  ) {}

  @Get('settings')
  @RequirePermission('settings.consent.manage')
  @ApiOperation({
    summary: 'STOP / START keywords, auto replies, the opt-out line and the policy switch',
  })
  getSettings() {
    return this.settings.get();
  }

  @Patch('settings')
  @RequirePermission('settings.consent.manage')
  @ApiOperation({
    summary: 'Save the whole consent settings document',
    description:
      'Needs the rowVersion read (absent on the first save). 409 ROW_VERSION_CONFLICT, 422 CONSENT_SETTINGS_INVALID.',
  })
  updateSettings(@Body(zodPipe(updateConsentSettingsSchema)) body: UpdateConsentSettingsInput) {
    return this.settings.update(body);
  }

  @Post('settings/test')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('settings.consent.manage')
  @Throttle({ limit: 60, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary: 'What would happen if a contact sent this text (nothing is changed or sent)',
  })
  test(@Body(zodPipe(testConsentMessageSchema)) body: TestConsentMessageInput) {
    return this.settings.test(body);
  }

  @Get('composer-config')
  @RequirePermission('bcast.broadcasts.create', 'camp.campaigns.create', 'settings.consent.manage')
  @ApiOperation({
    summary: 'The opt-out line and the policy switch, for the broadcast and campaign composers',
  })
  composerConfig() {
    return this.settings.composerConfig();
  }

  @Get('events')
  @RequirePermission('contacts.consent.read')
  @ApiOperation({ summary: 'The workspace consent ledger, newest first' })
  events(@Query(zodPipe(consentEventsQuerySchema)) query: ConsentEventsQuery) {
    return this.ledger.list(query);
  }

  @Get('export')
  @RequirePermission('contacts.consent.manage')
  @Throttle({ limit: 6, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary:
      'Consent proof of the whole workspace as CSV (formula-safe cells, capped at 50,000 rows)',
  })
  async exportAll(@Res({ passthrough: true }) res: Response): Promise<string> {
    const { csv, truncated } = await this.ledger.exportCsv();
    return this.csv(res, csv, 'consent-proof.csv', truncated);
  }

  @Post('exports')
  @Idempotent()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('contacts.consent.manage')
  @Throttle({ limit: 6, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary:
      'Prepare the consent proof of the whole workspace in the background (no row cap); announced by email (202)',
    description:
      'One at a time per workspace: 409 CONSENT_EXPORT_IN_PROGRESS while one is being built.',
  })
  requestExport() {
    return this.exports.request();
  }

  @Get('exports')
  @RequirePermission('contacts.consent.manage')
  @ApiOperation({
    summary:
      'The latest prepared exports, newest first, and whether the ledger is larger than the direct download carries',
  })
  listExports() {
    return this.exports.list();
  }

  @Get('exports/:id/download')
  @RequirePermission('contacts.consent.manage')
  @Throttle({ limit: 20, windowSeconds: 60, by: 'actor' })
  @ApiOperation({ summary: 'The finished export as CSV (kept 7 days)' })
  async downloadExport(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, fileName } = await this.exports.download(id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return new StreamableFile(stream);
  }

  @Get('contacts/:uuid')
  @RequirePermission('contacts.consent.read')
  @ApiOperation({ summary: 'A contact: roll-up, state per channel and the newest events' })
  forContact(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Query(zodPipe(consentEventsQuerySchema)) query: ConsentEventsQuery,
  ) {
    return this.ledger.forContact(uuid, query);
  }

  @Post('contacts/:uuid/events')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('contacts.consent.manage')
  @Throttle({ limit: 60, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary:
      'Record that a contact granted or withdrew consent (Mark as subscribed / unsubscribed)',
    description:
      'A grant needs a note (422 CONSENT_NOTE_REQUIRED). Idempotency-Key: a repeat records nothing.',
  })
  record(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body(zodPipe(recordConsentSchema)) body: RecordConsentInput,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.ledger.record(uuid, body, key);
  }

  @Post('contacts/:uuid/privacy-events')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('contacts.consent.manage')
  @Throttle({ limit: 60, windowSeconds: 60, by: 'actor' })
  @ApiOperation({
    summary:
      'Turn a privacy flag of a contact on or off: minor, guardian consent, Do Not Sell or Share',
    description:
      'Appends one event (who, when, source, evidence) and updates the flag in the same transaction. Guardian consent needs a note ' +
      '(422 CONSENT_NOTE_REQUIRED) and a contact flagged as a minor (422 CONSENT_PRIVACY_NOT_MINOR); it is evidence only and never ' +
      'creates a marketing grant. Clearing the minor flag also clears guardian consent. Idempotency-Key: a repeat records nothing. ' +
      'Answers the contact consent view, including the flags.',
  })
  async recordPrivacy(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body(zodPipe(recordPrivacyFlagSchema)) body: RecordPrivacyFlagInput,
    @Headers('idempotency-key') key?: string,
  ) {
    await this.privacy.record(uuid, body, key);
    return this.ledger.forContact(uuid, { limit: 50 });
  }

  @Get('contacts/:uuid/export')
  @RequirePermission('contacts.consent.read')
  @Throttle({ limit: 30, windowSeconds: 60, by: 'actor' })
  @ApiOperation({ summary: 'Consent proof of one contact as CSV' })
  async exportContact(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { csv, truncated } = await this.ledger.exportCsv(uuid);
    return this.csv(res, csv, `consent-proof-${uuid}.csv`, truncated);
  }

  private csv(res: Response, body: string, name: string, truncated: boolean): string {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    if (truncated) res.setHeader('X-Export-Truncated', 'true');
    return body;
  }
}
