import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { dedupeContactsSchema, type DedupeContactsInput } from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { ContactDedupeService } from './contact-dedupe.service';

/** Registered before ContactsController, like ContactBulkController: `contacts/duplicates` is a literal. */
@ApiTags('contacts')
@ActorKinds('user')
@Controller({ path: 'contacts', version: '2' })
export class ContactDedupeController {
  constructor(private readonly dedupe: ContactDedupeService) {}

  @Get('duplicates')
  @RequirePermission('record.contacts.merge')
  @ApiOperation({
    summary: 'Preview the duplicate sets (contacts sharing a canonical phone number)',
    description:
      'The oldest contact of each set is the one that stays. Needs merge permission over every contact.',
  })
  async preview() {
    return this.dedupe.preview();
  }

  @Post('dedupe')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.contacts.merge')
  @ApiOperation({
    summary: 'Merge duplicate contacts into the oldest of each set',
    description:
      'Groups, tags, attribute values, empty fields and everything pointing at a duplicate move to the survivor first. At most `maxSets` per call; `remainingSets` says whether to call again.',
  })
  async run(@Body(zodPipe(dedupeContactsSchema)) body: DedupeContactsInput) {
    return this.dedupe.run(body);
  }
}
