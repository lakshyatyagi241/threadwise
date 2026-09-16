import { Module } from '@nestjs/common';
import { ContactsController } from './contacts/contacts.controller';
import { ContactsRepository } from './contacts/contacts.repository';
import { ContactsService } from './contacts/contacts.service';

/**
 * CRM app.
 *
 * Contacts is implemented end-to-end as the reference slice. Companies, deals,
 * leads, pipelines, invoices, tickets and activities follow the same four
 * files (controller / service / repository / mapper) — copy the contacts
 * folder rather than inventing a new arrangement.
 */
@Module({
  controllers: [ContactsController],
  providers: [ContactsService, ContactsRepository],
  exports: [ContactsService, ContactsRepository],
})
export class CrmModule {}
