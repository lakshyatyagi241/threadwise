import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { AttributesController } from './attributes/attributes.controller';
import { AttributesRepository } from './attributes/attributes.repository';
import { AttributesService } from './attributes/attributes.service';
import { MergeTagService } from './attributes/merge-tag.service';
import { ContactBulkController } from './contact-bulk/contact-bulk.controller';
import { ContactBulkRepository } from './contact-bulk/contact-bulk.repository';
import { ContactBulkService } from './contact-bulk/contact-bulk.service';
import { ContactDedupeController } from './contact-dedupe/contact-dedupe.controller';
import { ContactDedupeService } from './contact-dedupe/contact-dedupe.service';
import {
  ContactGroupMembershipController,
  ContactGroupsController,
} from './contact-groups/contact-groups.controller';
import { ContactGroupsRepository } from './contact-groups/contact-groups.repository';
import { ContactGroupsService } from './contact-groups/contact-groups.service';
import { ContactImportController } from './contact-import/contact-import.controller';
import { ContactImportEngine } from './contact-import/contact-import.engine';
import { ContactImportRepository } from './contact-import/contact-import.repository';
import { ContactImportService } from './contact-import/contact-import.service';
import { ContactQuotaService } from './contacts/contact-quota.service';
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
import { DealActivitiesRepository } from './deals/deal-activities.repository';
import { DealActivitiesService } from './deals/deal-activities.service';
import { DealBoardService } from './deals/deal-board.service';
import { DealEngine } from './deals/deal-engine.service';
import { DealReportsRepository } from './deals/deal-reports.repository';
import { DealReportsService } from './deals/deal-reports.service';
import { DealsPlan, SalesPipelineGuard } from './deals/deals-plan';
import { ContactDealsController, DealsController } from './deals/deals.controller';
import { DealsRepository } from './deals/deals.repository';
import { DealsService } from './deals/deals.service';
import { FieldSectionsController } from './field-sections/field-sections.controller';
import { FieldSectionsRepository } from './field-sections/field-sections.repository';
import { FieldSectionsService } from './field-sections/field-sections.service';
import { FieldDependenciesRepository } from './fields/field-dependencies.repository';
import { FieldOptionsRepository } from './fields/field-options.repository';
import { FieldsController } from './fields/fields.controller';
import { FieldsRepository } from './fields/fields.repository';
import { FieldsService } from './fields/fields.service';
import {
  DealSettingsController,
  LostReasonsController,
  PipelineStagesController,
  PipelinesController,
} from './pipelines/pipelines.controller';
import { LostReasonsService } from './pipelines/lost-reasons.service';
import { PipelinesRepository } from './pipelines/pipelines.repository';
import { PipelinesService } from './pipelines/pipelines.service';
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
  // PlansCoreModule: the contact and tag caps (WD-CON-026) are plan entitlements.
  imports: [PlansCoreModule],
  controllers: [
    // The literal-path controllers go first: `GET /contacts/stats`, `/contacts/duplicates` and
    // `/contacts/import/...` must be registered before ContactsController's `GET /contacts/:id`
    // or Express reads "stats" as an id.
    ContactBulkController,
    ContactDedupeController,
    ContactImportController,
    ContactsController,
    ContactGroupsController,
    ContactGroupMembershipController,
    AttributesController,
    FieldSectionsController,
    FieldsController,
    StatusOptionsController,
    TagsController,
    ContactViewsController,
    ContactNotesController,
    ContactFilesController,
    ContactActivitiesController,
    ContactMeetingsController,
    // Deals: `deals/board`, `deals/reports` and `deals/tasks` are literal paths declared before `deals/:id` inside the controller.
    DealsController,
    ContactDealsController,
    PipelinesController,
    PipelineStagesController,
    LostReasonsController,
    DealSettingsController,
  ],
  providers: [
    // Encrypts deal timeline bodies at rest (the same service the public API provides for its own module).
    CryptoService,
    ContactsService,
    ContactsRepository,
    ContactQuotaService,
    ContactGroupsService,
    ContactGroupsRepository,
    ContactBulkService,
    ContactBulkRepository,
    ContactDedupeService,
    ContactImportService,
    ContactImportEngine,
    ContactImportRepository,
    AttributesService,
    AttributesRepository,
    MergeTagService,
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
    DealsPlan,
    SalesPipelineGuard,
    DealsRepository,
    DealActivitiesRepository,
    DealReportsRepository,
    DealEngine,
    DealsService,
    DealActivitiesService,
    DealBoardService,
    DealReportsService,
    PipelinesRepository,
    PipelinesService,
    LostReasonsService,
  ],
  exports: [
    ContactsService,
    ContactsRepository,
    ContactQuotaService,
    ContactGroupsService,
    ContactBulkService,
    ContactImportEngine,
    MergeTagService,
    FieldSectionsService,
    FieldsService,
    StatusOptionsService,
    TagsService,
    ContactViewsService,
    ContactNotesService,
    ContactFilesService,
    ContactActivitiesService,
    ContactMeetingsService,
    DealsService,
    PipelinesService,
  ],
})
export class CrmModule {}
