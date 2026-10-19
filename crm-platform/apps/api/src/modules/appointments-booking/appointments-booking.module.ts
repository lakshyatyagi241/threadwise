import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import {
  APPOINTMENT_CALENDAR,
  GoogleCalendarClient,
  HttpIcsFeedFetcher,
  ICS_FEED_FETCHER,
  MicrosoftCalendarClient,
} from '../../infra/providers/appointments-booking';
import { ContactConsentModule } from '../contact-consent';
import { CrmModule } from '../crm';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { AppointmentsController, ContactAppointmentsController } from './appointments.controller';
import { AppointmentRemindersRepository } from './appointment-reminders.repository';
import { AppointmentsRepository } from './appointments.repository';
import { AppointmentsService } from './appointments.service';
import { AppointmentCalendarSyncService } from './appointment-calendar-sync.service';
import { AppointmentCalendarWriter } from './appointment-calendar-writer.service';
import { MeetingCalendarGateway } from './meeting-calendar.gateway';
import { AppointmentMeetingMirror } from './appointment-meeting-mirror.service';
import { AppointmentsSupport } from './appointments.support';
import { AppointmentBookingGuard, AppointmentPlan } from './booking-plan';
import { BookingOffersService } from './booking-offers.service';
import { BookingService } from './booking.service';
import { BookingsFeedService } from './bookings-feed.service';
import { BookingTypesController } from './booking-types.controller';
import { BookingTypesRepository } from './booking-types.repository';
import { BookingTypesService } from './booking-types.service';
import { CalendarBackfillQueue } from './calendar-backfill.jobs';
import { CalendarBackfillService } from './calendar-backfill.service';
import { CalendarOverviewService } from './calendar-overview.service';
import {
  BookingsFeedController,
  BookingsFeedPublicController,
  IcsFeedsController,
} from './calendar-feeds.controller';
import { CalendarProviders } from './calendar-providers.service';
import { ContactLinkService } from './contact-link.service';
import { IcsBusySource } from './ics-busy.source';
import { IcsFeedsRepository } from './ics-feeds.repository';
import { IcsFeedsService } from './ics-feeds.service';
import { MeetingMirrorBackfillService } from './meeting-mirror-backfill.jobs';
import { GoogleConsentRepository } from './google-consent.repository';
import { GoogleConsentService } from './google-consent.service';
import { GoogleCalendarAdapter } from './google-calendar.adapter';
import { GoogleCalendarCallbackController } from './google-calendar-callback.controller';
import { GoogleCalendarConfig } from './google-calendar-config.service';
import { GoogleCalendarConnectService } from './google-calendar-connect.service';
import { GoogleCalendarConnectionRepository } from './google-calendar-connection.repository';
import { GoogleCalendarController } from './google-calendar.controller';
import { GoogleCalendarTokens } from './google-calendar-tokens.service';
import { MicrosoftCalendarAdapter } from './microsoft-calendar.adapter';
import { MicrosoftCalendarConfig } from './microsoft-calendar-config.service';
import { MicrosoftCalendarConnectService } from './microsoft-calendar-connect.service';
import { MicrosoftCalendarConnectionRepository } from './microsoft-calendar-connection.repository';
import {
  CalendarProvidersController,
  MicrosoftCalendarCallbackController,
  MicrosoftCalendarController,
} from './microsoft-calendar.controller';
import { MicrosoftCalendarTokens } from './microsoft-calendar-tokens.service';
import { MultiCalendarAdapter } from './multi-calendar.adapter';
import {
  PublicBookingController,
  PublicBookingManageController,
} from './public-booking.controller';
import { PublicBookingService } from './public-booking.service';
import { BookingPublicThrottle } from './public-throttle';
import { SlotsService } from './slots.service';

/**
 * Appointments and booking (TW-APPT). Booking types, the slot engine, appointments with a guarded status machine, and the customer's
 * public booking and manage pages.
 *
 * The calendar and the customer messages go through two ports (`infra/providers/appointments-booking`). The calendar port is fronted by
 * `MultiCalendarAdapter`: busy time from every connected Google and Outlook calendar, events written to one (a workspace with nothing
 * connected behaves as the old stub did); the customer messages go through the real channel messenger, which only the worker process
 * provides (`AppointmentsBookingWorkerModule`): nothing in the API process sends a booking message.
 *
 * The sweeps and the outbox consumers live in `AppointmentsBookingWorkerModule` (the worker process only).
 */
@Module({
  // CrmModule: contacts (find-or-create by phone and email). PlansCoreModule: the `appointment_booking` flag and the `appointments` cap.
  // PlatformSettingsModule: the operator's Google and Microsoft OAuth clients (console, Google Calendar / Microsoft Calendar).
  imports: [ContactConsentModule, CrmModule, PlansCoreModule, PlatformSettingsModule],
  controllers: [
    // `booking-types/options`, `preview-slots` and `appointments/counts`, `calendar` are literal paths declared before `:id` inside
    // their controllers. The public controllers are unauthenticated (a public page, a bearer token).
    BookingTypesController,
    AppointmentsController,
    ContactAppointmentsController,
    PublicBookingController,
    PublicBookingManageController,
    // `appointments/calendar/google/...` (staff) and the public OAuth callback.
    GoogleCalendarController,
    GoogleCalendarCallbackController,
    // `appointments/calendar/microsoft/...`, its public callback, and the cross-provider overview and choice.
    MicrosoftCalendarController,
    MicrosoftCalendarCallbackController,
    CalendarProvidersController,
    // Read-only iCal subscriptions, a person's own bookings feed, and the public feed a calendar app reads.
    IcsFeedsController,
    BookingsFeedController,
    BookingsFeedPublicController,
  ],
  providers: [
    CryptoService,
    AppointmentPlan,
    AppointmentBookingGuard,
    BookingTypesRepository,
    AppointmentsRepository,
    AppointmentRemindersRepository,
    AppointmentsSupport,
    AppointmentCalendarWriter,
    AppointmentCalendarSyncService,
    AppointmentMeetingMirror,
    MeetingMirrorBackfillService,
    SlotsService,
    BookingService,
    BookingTypesService,
    AppointmentsService,
    ContactLinkService,
    PublicBookingService,
    BookingPublicThrottle,
    BookingOffersService,
    GoogleCalendarClient,
    GoogleCalendarConfig,
    GoogleCalendarConnectionRepository,
    GoogleCalendarTokens,
    GoogleCalendarAdapter,
    GoogleConsentRepository,
    GoogleConsentService,
    GoogleCalendarConnectService,
    MicrosoftCalendarClient,
    MicrosoftCalendarConfig,
    MicrosoftCalendarConnectionRepository,
    MicrosoftCalendarTokens,
    MicrosoftCalendarAdapter,
    MicrosoftCalendarConnectService,
    CalendarProviders,
    MeetingCalendarGateway,
    CalendarBackfillService,
    CalendarBackfillQueue,
    CalendarOverviewService,
    IcsFeedsRepository,
    IcsFeedsService,
    IcsBusySource,
    BookingsFeedService,
    { provide: ICS_FEED_FETCHER, useClass: HttpIcsFeedFetcher },
    MultiCalendarAdapter,
    // The booking code talks to ONE port; it fronts the workspace's Google and Outlook calendars.
    { provide: APPOINTMENT_CALENDAR, useExisting: MultiCalendarAdapter },
  ],
  exports: [
    AppointmentsService,
    BookingService,
    BookingOffersService,
    BookingTypesRepository,
    AppointmentsRepository,
    AppointmentRemindersRepository,
    AppointmentsSupport,
    AppointmentCalendarWriter,
    AppointmentMeetingMirror,
    SlotsService,
    APPOINTMENT_CALENDAR,
    // The Google account domain (`/google-account`) shares this module's grant, its token refresh and its consent flow.
    GoogleCalendarConnectService,
    GoogleConsentService,
    GoogleCalendarTokens,
    GoogleCalendarConnectionRepository,
    CalendarProviders,
    // A contact's meeting uses the workspace's connected calendar through this seam (BL-362).
    MeetingCalendarGateway,
    CalendarBackfillQueue,
    // The worker's back-fill job runs it.
    CalendarBackfillService,
    // The worker's back-fill of the Meetings rows of existing bookings runs it.
    MeetingMirrorBackfillService,
    // The worker's iCal feed read runs them.
    IcsFeedsService,
    IcsFeedsRepository,
  ],
})
export class AppointmentsBookingModule {}
