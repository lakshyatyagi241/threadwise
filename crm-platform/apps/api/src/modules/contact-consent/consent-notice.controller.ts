import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CONSENT_NOTICE_SCOPES,
  consentNoticeScopeSchema,
  saveConsentNoticeSchema,
  type SaveConsentNoticeInput,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { AppError } from '../../common/errors/app-error';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ConsentNoticeService } from './consent-notice.service';

const scopeOf = (raw: string) => {
  const parsed = consentNoticeScopeSchema.safeParse(raw);
  if (!parsed.success) {
    throw AppError.validation(`The scope must be one of: ${CONSENT_NOTICE_SCOPES.join(', ')}.`);
  }
  return parsed.data;
};

/**
 * The consent line of an intake point (the website chat widget, a booking type, a store): its wording, link and on/off state, versioned.
 * The settings screens of those features embed one editor that calls these two routes.
 */
@ApiTags('contact-consent')
@ActorKinds('user')
@Controller({ path: 'contact-consent/notices', version: '2' })
export class ConsentNoticeController {
  constructor(private readonly notices: ConsentNoticeService) {}

  @Get(':scope/:ref')
  @RequirePermission('settings.consent.manage')
  @ApiOperation({ summary: 'The current consent notice of a widget, booking type or store' })
  get(@Param('scope') scope: string, @Param('ref') ref: string) {
    return this.notices.get(scopeOf(scope), ref);
  }

  @Put(':scope/:ref')
  @RequirePermission('settings.consent.manage')
  @ApiOperation({
    summary: 'Save the consent notice of a widget, booking type or store',
    description:
      'A change to the text, the link or the on/off state appends the next version; a save that changes nothing writes nothing. ' +
      'An enabled notice needs its wording (422). The ref of a store is `shopify:<uuid>` or `woocommerce:<uuid>`; the workspace default notice (scope `workspace`) takes a language code such as `en` or `hi`.',
  })
  save(
    @Param('scope') scope: string,
    @Param('ref') ref: string,
    @Body(zodPipe(saveConsentNoticeSchema)) body: SaveConsentNoticeInput,
  ) {
    return this.notices.save(scopeOf(scope), ref, body);
  }
}
