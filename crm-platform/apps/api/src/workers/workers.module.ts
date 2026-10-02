import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthMaintenanceService, AuthModule, OtpTemplateRefreshService } from '../modules/auth';
import { BspBillingEngineWorkerModule } from '../modules/bsp-billing-engine';
import { AppointmentsBookingWorkerModule } from '../modules/appointments-booking';
import { BroadcastsWorkerModule } from '../modules/broadcasts';
import { CatalogProductsWorkerModule } from '../modules/catalog-products';
import { ChatConversationsWorkerModule } from '../modules/chat-conversations';
import { CampaignsWorkerModule } from '../modules/campaigns';
import { ChannelTelegramWorkerModule } from '../modules/channel-telegram';
import {
  ContactImportWorkerModule,
  InvoicingWorkerModule,
  SalesDocsWorkerModule,
  SegmentsWorkerModule,
  TasksWorkerModule,
} from '../modules/crm';
import { MessageTemplatesWorkerModule } from '../modules/message-templates';
import { NotificationsWorkerModule } from '../modules/notifications';
import { WabaWorkerModule } from '../modules/whatsapp-cloud-api-waba';
import { OutboxDrainService } from './outbox-drain.service';
import { PartitionMaintenanceService } from './partition-maintenance.service';

/**
 * Background work.
 *
 * Imported ONLY by the worker bootstrap (worker.ts), never by the HTTP app. An
 * API pod that also drained the outbox would compete with request handling for
 * the event loop, and every API pod added would multiply the polling load on
 * the database.
 *
 * Still to land here: campaign sender (throttled), billing roll-up, SLA sweep,
 * counter flush, bulk import/export.
 */
@Module({
  // AuthModule: the OTP template poll reuses the sender registry and the Meta template client.
  imports: [
    ScheduleModule.forRoot(),
    AuthModule,
    ContactImportWorkerModule,
    TasksWorkerModule,
    BspBillingEngineWorkerModule,
    SegmentsWorkerModule,
    SalesDocsWorkerModule,
    InvoicingWorkerModule,
    NotificationsWorkerModule,
    AppointmentsBookingWorkerModule,
    BroadcastsWorkerModule,
    WabaWorkerModule,
    CatalogProductsWorkerModule,
    MessageTemplatesWorkerModule,
    ChatConversationsWorkerModule,
    CampaignsWorkerModule,
    ChannelTelegramWorkerModule,
  ],
  providers: [
    OutboxDrainService,
    PartitionMaintenanceService,
    AuthMaintenanceService,
    OtpTemplateRefreshService,
  ],
  exports: [
    OutboxDrainService,
    PartitionMaintenanceService,
    AuthMaintenanceService,
    OtpTemplateRefreshService,
  ],
})
export class WorkersModule {}
