import { Module } from '@nestjs/common';
import { AppointmentsBookingModule } from './appointments-booking.module';
import { AppointmentCalendarConsumer } from './appointment-calendar.consumer';
import { AppointmentLifecycleSweepService } from './appointment-lifecycle-sweep.service';
import { AppointmentMessageConsumer } from './appointment-message.consumer';
import { AppointmentReminderSweepService } from './appointment-reminder-sweep.service';

/**
 * The reminder and lifecycle sweeps and the outbox consumers that send booking messages and write calendar events. Imported ONLY by
 * WorkersModule (the worker process): an API pod that also swept would multiply the polling load on the database, and a consumer
 * registers itself with the kernel's OutboxSubscriberRegistry, which the drain loop in that process fans events out to.
 */
@Module({
  imports: [AppointmentsBookingModule],
  providers: [
    AppointmentReminderSweepService,
    AppointmentLifecycleSweepService,
    AppointmentMessageConsumer,
    AppointmentCalendarConsumer,
  ],
})
export class AppointmentsBookingWorkerModule {}
