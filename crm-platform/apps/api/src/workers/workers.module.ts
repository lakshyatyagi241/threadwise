import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthMaintenanceService, AuthModule, OtpTemplateRefreshService } from '../modules/auth';
import { AppointmentsBookingWorkerModule } from '../modules/appointments-booking';
import { BroadcastsWorkerModule } from '../modules/broadcasts';
import {
  ContactImportWorkerModule,
  InvoicingWorkerModule,
  SalesDocsWorkerModule,
  SegmentsWorkerModule,
  TasksWorkerModule,
} from '../modules/crm';
import { NotificationsWorkerModule } from '../modules/notifications';
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
    SegmentsWorkerModule,
    SalesDocsWorkerModule,
    InvoicingWorkerModule,
    NotificationsWorkerModule,
    AppointmentsBookingWorkerModule,
    BroadcastsWorkerModule,
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
