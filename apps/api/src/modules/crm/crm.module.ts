import { Module } from '@nestjs/common';
import { ContactActivitiesController } from './contact-activities/contact-activities.controller';
import { ContactActivitiesRepository } from './contact-activities/contact-activities.repository';
import { ContactActivitiesService } from './contact-activities/contact-activities.service';
import { ContactFilesController } from './contact-files/contact-files.controller';
import { ContactFilesRepository } from './contact-files/contact-files.repository';
import { ContactFilesService } from './contact-files/contact-files.service';
import { ContactMeetingsController } from './contact-meetings/contact-meetings.controller';
import { ContactMeetingsRepository } from './contact-meetings/contact-meetings.repository';
import { ContactMeetingsService } from './contact-meetings/contact-meetings.service';
import { ContactNotesController } from './contact-notes/contact-notes.controller';
import { ContactNotesRepository } from './contact-notes/contact-notes.repository';
import { ContactNotesService } from './contact-notes/contact-notes.service';
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
 * Contacts is implemented end-to-end as the reference slice, extended with
 * Phase 11's list/bulk/tags/views surface plus the detail-page tabs (notes,
 * files, activity timeline, meetings — field history reuses the kernel
 * audit trail, see AuditService.listByRecord, rather than its own table).
 * Field sections, fields (+ options + dependencies) and status options are
 * Phase 8's field-metadata registry (Settings > Data Management > Contact
 * Properties) that Contacts' add/edit form and bulk-edit read from — the same
 * registry, keyed by moduleKey='companies', also serves Phase 7 (Company
 * Properties); see field-metadata-permission.ts for how the two stay
 * permission-isolated from each other. Deals,
 * leads, pipelines, invoices and tickets follow the same four files
 * (controller / service / repository / mapper) — copy a folder here rather
 * than inventing a new arrangement.
 */
@Module({
  controllers: [
    ContactsController,
    FieldSectionsController,
    FieldsController,
    StatusOptionsController,
    TagsController,
    ContactViewsController,
    ContactNotesController,
    ContactFilesController,
    ContactActivitiesController,
    ContactMeetingsController,
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
    ContactNotesService,
    ContactNotesRepository,
    ContactFilesService,
    ContactFilesRepository,
    ContactActivitiesService,
    ContactActivitiesRepository,
    ContactMeetingsService,
    ContactMeetingsRepository,
  ],
  exports: [
    ContactsService,
    ContactsRepository,
    FieldSectionsService,
    FieldsService,
    StatusOptionsService,
    TagsService,
    ContactViewsService,
    ContactNotesService,
    ContactFilesService,
    ContactActivitiesService,
    ContactMeetingsService,
  ],
})
export class CrmModule {}
