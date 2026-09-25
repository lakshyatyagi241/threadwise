import { Module } from '@nestjs/common';
import { ContactsController } from './contacts/contacts.controller';
import { ContactsRepository } from './contacts/contacts.repository';
import { ContactsService } from './contacts/contacts.service';
import { FieldSectionsController } from './field-sections/field-sections.controller';
import { FieldSectionsRepository } from './field-sections/field-sections.repository';
import { FieldSectionsService } from './field-sections/field-sections.service';
import { FieldDependenciesRepository } from './fields/field-dependencies.repository';
import { FieldOptionsRepository } from './fields/field-options.repository';
import { FieldsController } from './fields/fields.controller';
import { FieldsRepository } from './fields/fields.repository';
import { FieldsService } from './fields/fields.service';
import { StatusOptionsController } from './status-options/status-options.controller';
import { StatusOptionsRepository } from './status-options/status-options.repository';
import { StatusOptionsService } from './status-options/status-options.service';

/**
 * CRM app.
 *
 * Contacts is implemented end-to-end as the reference slice. Field sections,
 * fields (+ options + dependencies) and status options are Phase 8's
 * field-metadata registry (Settings > Data Management > Contact Properties)
 * — the schema root contacts' add/edit form and bulk-edit read from. Deals,
 * leads, pipelines, invoices, tickets and activities follow the same four
 * files (controller / service / repository / mapper) — copy a folder here
 * rather than inventing a new arrangement.
 */
@Module({
  controllers: [
    ContactsController,
    FieldSectionsController,
    FieldsController,
    StatusOptionsController,
  ],
  providers: [
    ContactsService,
    ContactsRepository,
    FieldSectionsService,
    FieldSectionsRepository,
    FieldsService,
    FieldsRepository,
    FieldOptionsRepository,
    FieldDependenciesRepository,
    StatusOptionsService,
    StatusOptionsRepository,
  ],
  exports: [
    ContactsService,
    ContactsRepository,
    FieldSectionsService,
    FieldsService,
    StatusOptionsService,
  ],
})
export class CrmModule {}
