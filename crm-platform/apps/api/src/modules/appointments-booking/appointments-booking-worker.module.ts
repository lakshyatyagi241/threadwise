import { Module } from '@nestjs/common';
import { APPOINTMENT_MESSENGER } from '../../infra/providers/appointments-booking';
import { BroadcastsModule } from '../broadcasts';
import { ChatConversationsModule } from '../chat-conversations';
import { SendWindowModule } from '../compliance-center';
import { ContactConsentModule } from '../contact-consent';
import { CrmModule } from '../crm';
import { MessageTemplatesModule } from '../message-templates';
import { AppointmentsBookingModule } from './appointments-booking.module';
import { AppointmentCalendarConsumer } from './appointment-calendar.consumer';
import { CalendarBackfillConsumer } from './calendar-backfill.consumer';
import { CalendarBackfillProcessor } from './calendar-backfill.jobs';
import { IcsFeedRefreshProcessor, IcsFeedRefreshScheduler } from './ics-feeds.jobs';
import {
  MeetingMirrorBackfillProcessor,
  MeetingMirrorBackfillScheduler,
} from './meeting-mirror-backfill.jobs';
import { CalendarReconcileProcessor, CalendarReconcileScheduler } from './calendar-reconcile.jobs';
import { GoogleConsentSweepService } from './google-consent-sweep.service';
import { CalendarReconcileService } from './calendar-reconcile.service';
import { AppointmentLifecycleSweepService } from './appointment-lifecycle-sweep.service';
import { AppointmentMessageConsumer } from './appointment-message.consumer';
import { AppointmentReminderService } from './appointment-reminder.service';
import { AppointmentReminderSweepService } from './appointment-reminder-sweep.service';
import { ChannelAppointmentMessenger } from './channel-appointment-messenger';

/**
 * The reminder and lifecycle sweeps, the reminder delivery, the outbox consumers that send booking messages and write calendar events, and the bounded reconcile
 * of upcoming appointments against their Google events (TW-GACC-011), and the back-fill of calendar events after a connect, a reconnect or a
 * change of provider (BL-035). Imported ONLY by
 * WorkersModule (the worker process): an API pod that also swept would multiply the polling load on the database, and a consumer
 * registers itself with the kernel's OutboxSubscriberRegistry, which the drain loop in that process fans events out to.
 */
@Module({
  imports: [
    AppointmentsBookingModule,
    ContactConsentModule,
    CrmModule,
    SendWindowModule,
    ChatConversationsModule,
    BroadcastsModule,
    MessageTemplatesModule,
  ],
  providers: [
    AppointmentReminderSweepService,
    AppointmentReminderService,
    // The real customer messenger (BL-283): the booking code talks to the port, this is what sits behind it.
    ChannelAppointmentMessenger,
    { provide: APPOINTMENT_MESSENGER, useExisting: ChannelAppointmentMessenger },
    AppointmentLifecycleSweepService,
    AppointmentMessageConsumer,
    AppointmentCalendarConsumer,
    CalendarBackfillConsumer,
    CalendarBackfillProcessor,
    MeetingMirrorBackfillProcessor,
    MeetingMirrorBackfillScheduler,
    IcsFeedRefreshProcessor,
    IcsFeedRefreshScheduler,
    CalendarReconcileService,
    CalendarReconcileProcessor,
    CalendarReconcileScheduler,
    GoogleConsentSweepService,
  ],
})
export class AppointmentsBookingWorkerModule {}
