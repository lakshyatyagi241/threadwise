import { Body, Get, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { recordConsentSchema, type RecordConsentInput } from '@crm/contracts';
import { Idempotent } from '../../../../../common/decorators';
import { zodPipe } from '../../../../../common/pipes/zod-validation.pipe';
import { ContactConsentService } from '../../../../contact-consent';
import { RequireApiScope } from '../../../auth/api-scope';
import { V1Controller } from '../../../http/v1-controller.decorator';
import { ok } from '../../../http/v1-envelope';
import { uuidOrNotFound } from '../v1-ids';

/**
 * The consent ledger of a contact over the customer API (a product extension: the reference has only the `is_unsubscribed` flag).
 * Reading needs the `contacts:read` scope, recording a change `contacts:write`. A record is idempotent on `Idempotency-Key`.
 */
@V1Controller('contacts')
export class V1ContactConsentController {
  constructor(private readonly consent: ContactConsentService) {}

  @Get(':id/consent')
  @RequireApiScope('contacts:read')
  @ApiOperation({
    summary: "A contact's consent: the roll-up, the state per channel and the history",
  })
  async show(@Param('id') id: string) {
    return ok(await this.consent.forContact(uuidOrNotFound(id, 'Contact'), { limit: 50 }));
  }

  @Post(':id/consent')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequireApiScope('contacts:write')
  @ApiOperation({
    summary: 'Record that a contact granted or withdrew consent',
    description:
      'A grant needs a note (422 CONSENT_NOTE_REQUIRED). A repeat with the same Idempotency-Key records nothing. The source is stored as "api".',
  })
  async record(
    @Param('id') id: string,
    @Body(zodPipe(recordConsentSchema)) body: RecordConsentInput,
    @Headers('idempotency-key') key?: string,
  ) {
    return ok(
      await this.consent.record(uuidOrNotFound(id, 'Contact'), { ...body, source: 'api' }, key),
    );
  }
}
