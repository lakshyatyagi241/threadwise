import { Module } from '@nestjs/common';
import { ContactViewsController } from './contact-views/contact-views.controller';
import { ContactViewsRepository } from './contact-views/contact-views.repository';
import { ContactViewsService } from './contact-views/contact-views.service';
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
import { TagsController } from './tags/tags.controller';
import { TagsRepository } from './tags/tags.repository';
import { TagsService } from './tags/tags.service';

/**
 * CRM app.
 *
 * Contacts is implemented end-to-end as the reference slice, now extended
 * with Phase 11's list/bulk/tags/views surface. Field sections, fields
 * (+ options + dependencies) and status options are Phase 8's field-metadata
 * registry (Settings > Data Management > Contact Properties) that Contacts'
 * add/edit form and bulk-edit read from. Deals, leads, pipelines, invoices,
 * tickets and activities follow the same four files (controller / service /
 * repository / mapper) — copy a folder here rather than inventing a new
 * arrangement.
 */
@Module({
  controllers: [
    ContactsController,
    FieldSectionsController,
    FieldsController,
    StatusOptionsController,
    TagsController,
    ContactViewsController,
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
    TagsService,
    TagsRepository,
    ContactViewsService,
    ContactViewsRepository,
  ],
  exports: [
    ContactsService,
    ContactsRepository,
    FieldSectionsService,
    FieldsService,
    StatusOptionsService,
    TagsService,
    ContactViewsService,
  ],
})
export class CrmModule {}
