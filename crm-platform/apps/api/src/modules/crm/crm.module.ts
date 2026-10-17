import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CheckoutOrdersMerchantPaymentsModule } from '../checkout-orders-merchant-payments';
import { SendWindowModule } from '../compliance-center';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { AttributesController } from './attributes/attributes.controller';
import { AttributesRepository } from './attributes/attributes.repository';
import { AttributesService } from './attributes/attributes.service';
import { MergeTagService } from './attributes/merge-tag.service';
import { CompaniesController } from './companies/companies.controller';
import { CompaniesCsvService } from './companies/companies-csv.service';
import { CompaniesRepository } from './companies/companies.repository';
import { CompaniesService } from './companies/companies.service';
import { ContactBulkController } from './contact-bulk/contact-bulk.controller';
import { ContactAssignmentController } from './contact-assignment/contact-assignment.controller';
import { ContactAssignmentEngine } from './contact-assignment/contact-assignment.engine';
import { ContactAssignmentRepository } from './contact-assignment/contact-assignment.repository';
import { ContactAssignmentService } from './contact-assignment/contact-assignment.service';
import { OwnerReassignController } from './owner-reassign/owner-reassign.controller';
import { OwnerReassignRepository } from './owner-reassign/owner-reassign.repository';
import { OwnerReassignService } from './owner-reassign/owner-reassign.service';
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
import { ContactResolverService } from './contacts/contact-resolver.service';
import { CONTACT_RESOLVER } from './contact-resolver.port';
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
import { CrmDashboardController } from './crm-dashboard/crm-dashboard.controller';
import { CrmDashboardRepository } from './crm-dashboard/crm-dashboard.repository';
import { CrmDashboardService } from './crm-dashboard/crm-dashboard.service';
import { RevenueExportPublisher } from './revenue-report/revenue-export.publisher';
import { RevenueExportRepository } from './revenue-report/revenue-export.repository';
import { RevenueExportService } from './revenue-report/revenue-export.service';
import { RevenueReportController } from './revenue-report/revenue-report.controller';
import { RevenueReportRepository } from './revenue-report/revenue-report.repository';
import { RevenueReportService } from './revenue-report/revenue-report.service';
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
import {
  CompanyTasksController,
  ContactTasksController,
  DealTasksController,
  TasksController,
} from './tasks/tasks.controller';
import {
  ContactSalesDocsController,
  DealSalesDocsController,
  SalesDocSettingsController,
  SalesDocsController,
} from './sales-docs/sales-docs.controller';
import { PublicSalesDocsController } from './sales-docs/sales-docs-public.controller';
import { PublicLinkThrottle } from './sales-docs/public-link-throttle';
import { SalesDocSettingsService } from './sales-docs/sales-doc-settings.service';
import { SalesDocsPublicService } from './sales-docs/sales-docs-public.service';
import { SalesDocsRepository } from './sales-docs/sales-docs.repository';
import { SalesDocsService } from './sales-docs/sales-docs.service';
import { SalesDocsSupport } from './sales-docs/sales-docs.support';
import { SALES_DOC_INVOICE_PORT } from './sales-docs';
import {
  INVOICE_PAYMENT_GATEWAYS,
  type InvoicePaymentGateway,
  type InvoicePaymentGateways,
} from '../../infra/providers/invoice-payments/invoice-payment-gateway.port';
import {
  HmacGenericGateway,
  ManualTransferGateway,
} from '../../infra/providers/invoice-payments/invoice-payment-gateways';
import { ContactConsentModule } from '../contact-consent';
import { PrivacyModule } from '../privacy';
import { CreditNotesController } from './invoicing/credit-notes.controller';
import { CreditNotesRepository } from './invoicing/credit-notes.repository';
import { CreditNotesService } from './invoicing/credit-notes.service';
import { RecurringInvoicesController } from './invoicing/recurring-invoices.controller';
import { RecurringInvoicesRepository } from './invoicing/recurring-invoices.repository';
import { RecurringInvoicesService } from './invoicing/recurring-invoices.service';
import { SalesOrdersController } from './invoicing/sales-orders.controller';
import { SalesOrdersRepository } from './invoicing/sales-orders.repository';
import { SalesOrdersService } from './invoicing/sales-orders.service';
import { InvoiceConversionService } from './invoicing/invoice-conversion.service';
import { ExternalOrderBillingService } from './invoicing/external-order-billing.service';
import { InvoiceGatewaySettler } from './invoicing/invoice-gateway-settler';
import { InvoiceGatewayWebhookController } from './invoicing/invoice-gateway-webhook.controller';
import { InvoiceGatewayWebhookService } from './invoicing/invoice-gateway-webhook.service';
import { InvoicePdfService } from './invoicing/invoice-pdf.service';
import { InvoicePublicController } from './invoicing/invoice-public.controller';
import { InvoicePublicService, PublicRateLimiter } from './invoicing/invoice-public.service';
import { InvoiceSettingsController } from './invoicing/invoice-settings.controller';
import { InvoiceSettingsRepository } from './invoicing/invoice-settings.repository';
import { InvoiceSettingsService } from './invoicing/invoice-settings.service';
import {
  ContactInvoicesController,
  DealInvoicesController,
  InvoicesController,
} from './invoicing/invoices.controller';
import { InvoicesRepository } from './invoicing/invoices.repository';
import { InvoicesService } from './invoicing/invoices.service';
import { PaymentsController } from './invoicing/payments.controller';
import { PaymentsRepository } from './invoicing/payments.repository';
import { PaymentsService } from './invoicing/payments.service';
import { TaxRatesController } from './invoicing/tax-rates.controller';
import { TaxRatesRepository } from './invoicing/tax-rates.repository';
import { TaxRatesService } from './invoicing/tax-rates.service';
import { TasksRepository } from './tasks/tasks.repository';
import { TasksService } from './tasks/tasks.service';
import { StatusOptionsController } from './status-options/status-options.controller';
import { StatusOptionsRepository } from './status-options/status-options.repository';
import { StatusOptionsService } from './status-options/status-options.service';
import { SegmentActionsService } from './segments/segment-actions.service';
import { SegmentThrottle } from './segments/segment-throttle';
import { SegmentsController } from './segments/segments.controller';
import { SegmentsRepository } from './segments/segments.repository';
import { SegmentsService } from './segments/segments.service';
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
  // PlansCoreModule: the contact and tag caps (TW-CON-026) are plan entitlements.
  imports: [
    PlansCoreModule,
    CheckoutOrdersMerchantPaymentsModule,
    PlatformSettingsModule,
    ContactConsentModule,
    PrivacyModule,
    SendWindowModule,
  ],
  controllers: [
    // The literal-path controllers go first: `GET /contacts/stats`, `/contacts/duplicates` and
    // `/contacts/import/...` must be registered before ContactsController's `GET /contacts/:id`
    // or Express reads "stats" as an id.
    ContactBulkController,
    OwnerReassignController,
    ContactAssignmentController,
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
    // Segments: `segments/usage`, `preview` and `from-filters` are literal paths declared before `segments/:id` inside the controller.
    SegmentsController,
    ContactNotesController,
    ContactFilesController,
    ContactActivitiesController,
    ContactMeetingsController,
    // Companies: `companies/stats`, `industries`, `select-data` and `bulk/delete` are literal paths declared before `companies/:id`
    // inside the controller.
    CompaniesController,
    // Deals: `deals/board`, `deals/reports` and `deals/tasks` are literal paths declared before `deals/:id` inside the controller.
    DealsController,
    ContactDealsController,
    CrmDashboardController,
    // The revenue report (`crm/revenue`, its files under `crm/revenue/exports`).
    RevenueReportController,
    PipelinesController,
    PipelineStagesController,
    LostReasonsController,
    DealSettingsController,
    // Tasks: `tasks/my`, `tasks/counts` and `tasks/bulk/...` are literal paths declared before `tasks/:id` inside the controller.
    TasksController,
    ContactTasksController,
    DealTasksController,
    CompanyTasksController,
    // Proposals and estimates: `sales-docs/settings`, `sales-docs/templates` (settings controller, registered first) and
    // `sales-docs/counts` are literal paths declared before `sales-docs/:id`. The public controller is unauthenticated (token).
    SalesDocSettingsController,
    SalesDocsController,
    ContactSalesDocsController,
    DealSalesDocsController,
    PublicSalesDocsController,
    // Invoices and payments: `invoices/counts` is a literal path declared before `invoices/:id`, and `payments/summary`, `aging`
    // and `outstanding` before `payments/:id`, inside their controllers. The settings controller has no `:id`. The public and
    // webhook controllers are unauthenticated (token / signature).
    InvoiceSettingsController,
    CreditNotesController,
    SalesOrdersController,
    RecurringInvoicesController,
    InvoicesController,
    ContactInvoicesController,
    DealInvoicesController,
    PaymentsController,
    TaxRatesController,
    InvoicePublicController,
    InvoiceGatewayWebhookController,
  ],
  providers: [
    // Encrypts deal timeline bodies at rest (the same service the public API provides for its own module).
    CryptoService,
    ContactsService,
    ContactsRepository,
    ContactQuotaService,
    ContactResolverService,
    { provide: CONTACT_RESOLVER, useExisting: ContactResolverService },
    ContactGroupsService,
    ContactGroupsRepository,
    ContactBulkService,
    OwnerReassignRepository,
    OwnerReassignService,
    ContactAssignmentRepository,
    ContactAssignmentEngine,
    ContactAssignmentService,
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
    SegmentsService,
    SegmentsRepository,
    SegmentActionsService,
    SegmentThrottle,
    ContactNotesService,
    ContactNotesRepository,
    ContactFilesService,
    ContactFilesRepository,
    ContactActivitiesService,
    ContactActivitiesRepository,
    ContactMeetingsService,
    ContactMeetingsRepository,
    CompaniesRepository,
    CompaniesService,
    CompaniesCsvService,
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
    CrmDashboardRepository,
    CrmDashboardService,
    RevenueReportRepository,
    RevenueReportService,
    RevenueExportRepository,
    RevenueExportService,
    RevenueExportPublisher,
    PipelinesRepository,
    PipelinesService,
    LostReasonsService,
    TasksRepository,
    TasksService,
    SalesDocsRepository,
    SalesDocsSupport,
    SalesDocsService,
    SalesDocsPublicService,
    SalesDocSettingsService,
    PublicLinkThrottle,
    InvoicesRepository,
    InvoicesService,
    CreditNotesRepository,
    CreditNotesService,
    SalesOrdersRepository,
    SalesOrdersService,
    RecurringInvoicesRepository,
    RecurringInvoicesService,
    PaymentsRepository,
    PaymentsService,
    TaxRatesRepository,
    TaxRatesService,
    InvoiceSettingsRepository,
    InvoiceSettingsService,
    InvoicePublicService,
    InvoicePdfService,
    InvoiceGatewayWebhookService,
    InvoiceGatewaySettler,
    PublicRateLimiter,
    // The pay-now hook's gateway port: the built-in adapters. A real gateway adapter registers here under its provider key.
    {
      provide: INVOICE_PAYMENT_GATEWAYS,
      useFactory: (): InvoicePaymentGateways =>
        new Map<string, InvoicePaymentGateway>([
          ['manual', new ManualTransferGateway()],
          ['hmac_generic', new HmacGenericGateway()],
        ]),
    },
    // Sales-docs' "create an invoice draft from an accepted document" port, implemented here.
    InvoiceConversionService,
    ExternalOrderBillingService,
    { provide: SALES_DOC_INVOICE_PORT, useExisting: InvoiceConversionService },
  ],
  exports: [
    ContactsService,
    ContactsRepository,
    // The growth pilot writes its chat summary as a note (modules/growth-pilot).
    ContactNotesRepository,
    ContactQuotaService,
    ContactResolverService,
    CONTACT_RESOLVER,
    ContactGroupsService,
    ContactBulkService,
    OwnerReassignRepository,
    OwnerReassignService,
    ContactAssignmentEngine,
    ContactImportEngine,
    MergeTagService,
    // The API Library lists the contact properties a response can be saved into (modules/api-library).
    AttributesService,
    FieldSectionsService,
    FieldsService,
    StatusOptionsService,
    TagsService,
    // The lead pipeline tags the contacts it creates (modules/leads).
    TagsRepository,
    ContactViewsService,
    SegmentsService,
    SegmentsRepository,
    SegmentActionsService,
    ContactNotesService,
    ContactFilesService,
    ContactActivitiesService,
    ContactMeetingsService,
    CompaniesService,
    CompaniesRepository,
    DealsService,
    PipelinesService,
    TasksService,
    SalesDocsService,
    SalesDocsRepository,
    InvoicesService,
    // The recurring-invoice sweep (InvoicingWorkerModule) drives it.
    RecurringInvoicesService,
    PaymentsService,
    TaxRatesService,
    // The store-order bridge (modules/store-orders-sales) bills channel orders through it and writes the contact's timeline entry.
    ExternalOrderBillingService,
    InvoiceSettingsService,
    ContactActivitiesRepository,
    // The revenue report file builder (RevenueReportWorkerModule) drives them.
    RevenueReportRepository,
    RevenueReportService,
    RevenueExportRepository,
  ],
})
export class CrmModule {}
