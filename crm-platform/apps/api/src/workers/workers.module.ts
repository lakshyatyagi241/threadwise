import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthMaintenanceService, AuthModule, OtpTemplateRefreshService } from '../modules/auth';
import { BspBillingEngineWorkerModule } from '../modules/bsp-billing-engine';
import { AppointmentsBookingWorkerModule } from '../modules/appointments-booking';
import { BroadcastsWorkerModule } from '../modules/broadcasts';
import { CampaignsWorkerModule } from '../modules/campaigns';
import { ChannelTelegramWorkerModule } from '../modules/channel-telegram';
import {
  ContactImportWorkerModule,
  InvoicingWorkerModule,
  SalesDocsWorkerModule,
  SegmentsWorkerModule,
  TasksWorkerModule,
} from '../modules/crm';
import { NodeBridgeRuntimeWorkerModule } from '../modules/node-bridge-runtime';
import { NotificationsWorkerModule } from '../modules/notifications';
import { ScheduledQueueWarmerWorkerModule } from '../modules/scheduled-queue-warmer';
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
    CampaignsWorkerModule,
    ChannelTelegramWorkerModule,
    ScheduledQueueWarmerWorkerModule,
    NodeBridgeRuntimeWorkerModule,
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
