/**
 * Public surface of the CRM module.
 *
 * This is the ONLY path other domain modules may import from. Reaching into
 * `modules/crm/contacts/...` (or field-sections/fields/status-options) from
 * outside fails the architecture check.
 */
export { CrmModule } from './crm.module';
export {
  ContactsService,
  ContactsRepository,
  ContactQuotaService,
  ContactResolverService,
  assertContactScope,
  contactSelectionWhere,
  contactScopeCondition,
  toContactResponse,
} from './contacts';
export type { ContactRow, ContactConsentContext } from './contacts';
export { contactConditions, whereOf } from './contacts';
export { missingRequired, requiredPropertiesError, isBlank } from './contacts';
export type { RequiredRule } from './contacts';
export { CompaniesService, CompaniesRepository, normaliseCompanyDomain } from './companies';
export type { CompanyRow } from './companies';
export {
  FieldSectionsService,
  FieldSectionsRepository,
  toFieldSectionResponse,
} from './field-sections';
export type { FieldSectionRow } from './field-sections';
export {
  FieldsService,
  FieldsRepository,
  FieldOptionsRepository,
  FieldDependenciesRepository,
  toFieldResponse,
  toFieldOptionResponse,
  toFieldDependencyResponse,
  toFieldOptionDependencyResponse,
} from './fields';
export type {
  FieldRow,
  FieldOptionRow,
  FieldDependencyRow,
  FieldOptionDependencyRow,
} from './fields';
export {
  StatusOptionsService,
  StatusOptionsRepository,
  toStatusOptionResponse,
} from './status-options';
export type { StatusOptionRow } from './status-options';
export { TagsService, TagsRepository, toTagResponse } from './tags';
export type { TagRow } from './tags';
export {
  ContactViewsService,
  ContactViewsRepository,
  toContactViewResponse,
} from './contact-views';
export type { ContactViewRow } from './contact-views';
export {
  ContactNotesService,
  ContactNotesRepository,
  toContactNoteResponse,
} from './contact-notes';
export type { ContactNoteRow } from './contact-notes';
export {
  ContactFilesService,
  ContactFilesRepository,
  toContactFileResponse,
} from './contact-files';
export type { ContactFileRow } from './contact-files';
export {
  ContactActivitiesService,
  ContactActivitiesRepository,
  toContactActivityResponse,
} from './contact-activities';
export type { ContactActivityRow } from './contact-activities';
export {
  ContactMeetingsService,
  ContactMeetingsRepository,
  toContactMeetingResponse,
} from './contact-meetings';
export type { BackfillBatch, BookedMeetingValues, ContactMeetingRow } from './contact-meetings';
export {
  ContactGroupsService,
  ContactGroupsRepository,
  toContactGroupResponse,
} from './contact-groups';
export type { ContactGroupRow } from './contact-groups';
export { ContactBulkService, csvLine, UTF8_BOM } from './contact-bulk';
export {
  SegmentsService,
  SegmentsRepository,
  SegmentActionsService,
  toSegmentResponse,
  compileRules,
  collectRuleRefs,
  loadRuleContext,
  countWithTimeout,
  segmentContactsWhere,
} from './segments';
export type { SegmentRow, CompiledRules, CountResult } from './segments';
export { SegmentsWorkerModule } from './segments/segments-worker.module';
export {
  ContactImportEngine,
  ContactImportProcessor,
  decodeUpload,
  parseCsv,
} from './contact-import';
export type { UploadedCsv } from './contact-import';
export { ContactImportWorkerModule } from './contact-import/contact-import-worker.module';
export type { ContactImportJobData } from './contact-import';
export { ContactDedupeService } from './contact-dedupe';
export { AttributesService, MergeTagService, renderMergeTags, resolveToken } from './attributes';
export type { MergeContact, MergeContext } from './attributes';
export {
  DealsService,
  DealBoardService,
  DealReportsService,
  DealEngine,
  toDealResponse,
} from './deals';
export type { DealRow } from './deals';
export { TasksService, TasksRepository, toTaskResponse } from './tasks';
export type { TaskRow } from './tasks';
export { TasksWorkerModule } from './tasks/tasks-worker.module';
export { SalesDocsService, SalesDocsRepository, SALES_DOC_INVOICE_PORT } from './sales-docs';
export type {
  InvoiceDraftLine,
  InvoiceDraftResult,
  InvoiceDraftSource,
  SalesDocInvoicePort,
  SalesDocRow,
} from './sales-docs';
export { SalesDocsWorkerModule } from './sales-docs/sales-docs-worker.module';
export {
  InvoicesService,
  InvoicesRepository,
  PaymentsService,
  TaxRatesService,
  InvoiceSettingsService,
  InvoiceConversionService,
  ExternalOrderBillingService,
  allocateDiscount,
  specsOfExternalOrder,
  toInvoiceSummary,
} from './invoicing';
export type {
  ExternalInvoiceOutcome,
  ExternalOrderInput,
  ExternalOrderLine,
  ExternalPaymentInput,
  ExternalSalesOrderRef,
} from './invoicing';
export type { InvoiceRow } from './invoicing';
export { InvoicingWorkerModule } from './invoicing/invoicing-worker.module';
export { OwnerReassignWorkerModule } from './owner-reassign/owner-reassign-worker.module';
export { ContactAssignmentWorkerModule } from './contact-assignment/contact-assignment-worker.module';
export { PipelinesService, PipelinesRepository, LostReasonsService } from './pipelines';
export type { PipelineRow, StageRow } from './pipelines';
export { CONTACT_RESOLVER } from './contact-resolver.port';
export type {
  ContactLink,
  ContactResolveInput,
  ContactResolverPort,
  ContactSkipReason,
} from './contact-resolver.port';
