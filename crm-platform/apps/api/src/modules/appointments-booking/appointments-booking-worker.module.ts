import { Module } from '@nestjs/common';
import { ContactConsentModule } from '../contact-consent';
import { AppointmentsBookingModule } from './appointments-booking.module';
import { AppointmentCalendarConsumer } from './appointment-calendar.consumer';
import { CalendarReconcileProcessor, CalendarReconcileScheduler } from './calendar-reconcile.jobs';
import { GoogleConsentSweepService } from './google-consent-sweep.service';
import { CalendarReconcileService } from './calendar-reconcile.service';
import { AppointmentLifecycleSweepService } from './appointment-lifecycle-sweep.service';
import { AppointmentMessageConsumer } from './appointment-message.consumer';
import { AppointmentReminderSweepService } from './appointment-reminder-sweep.service';

/**
 * The reminder and lifecycle sweeps, the outbox consumers that send booking messages and write calendar events, and the bounded reconcile
 * of upcoming appointments against their Google events (TW-GACC-011). Imported ONLY by
 * WorkersModule (the worker process): an API pod that also swept would multiply the polling load on the database, and a consumer
 * registers itself with the kernel's OutboxSubscriberRegistry, which the drain loop in that process fans events out to.
 */
@Module({
  imports: [AppointmentsBookingModule, ContactConsentModule],
  providers: [
    AppointmentReminderSweepService,
    AppointmentLifecycleSweepService,
    AppointmentMessageConsumer,
    AppointmentCalendarConsumer,
    CalendarReconcileService,
    CalendarReconcileProcessor,
    CalendarReconcileScheduler,
    GoogleConsentSweepService,
  ],
})
export class AppointmentsBookingWorkerModule {}
