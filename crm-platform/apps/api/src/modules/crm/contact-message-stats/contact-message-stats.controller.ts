import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorKinds, RequirePermission } from '../../../common/decorators';
import { ContactMessageStatsService } from './contact-message-stats.service';

/** Contact detail page, Stats tab: the WhatsApp summary (sent, delivered, seen, received, failed, replied). */
@ApiTags('contact-message-stats')
@ActorKinds('user')
@Controller({ path: 'contacts/:contactId/message-stats', version: '2' })
export class ContactMessageStatsController {
  constructor(private readonly stats: ContactMessageStatsService) {}

  @Get('whatsapp')
  @RequirePermission('record.contacts.read')
  @ApiOperation({ summary: "Count a contact's WhatsApp messages: sent, delivered, seen, received, failed, replied" })
  async whatsapp(@Param('contactId', ParseUUIDPipe) contactId: string) {
    return this.stats.whatsapp(contactId);
  }
}
