import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { ContactAttributionService } from './contact-attribution.service';

/** Contact detail: where the contact came from. Gated behind `record.contacts.read`, like the other contact sub-resources. */
@ApiTags('contact-attribution')
@ActorKinds('user')
@Controller({ path: 'contacts/:contactId/attribution', version: '2' })
export class ContactAttributionController {
  constructor(private readonly attribution: ContactAttributionService) {}

  @Get()
  @RequirePermission('record.contacts.read')
  @ApiOperation({
    summary: "A contact's attribution",
    description:
      'First touch, latest touch and up to 50 touches, newest first: platform, campaign, ad set, ad, form and when. Contacts that never came through a lead source have none (`total: 0`).',
  })
  get(@Param('contactId', ParseUUIDPipe) contactId: string) {
    return this.attribution.forContact(contactId);
  }
}
