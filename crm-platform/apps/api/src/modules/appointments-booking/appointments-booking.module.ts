import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import {
  APPOINTMENT_CALENDAR,
  APPOINTMENT_MESSENGER,
  GoogleCalendarClient,
  NoAppointmentMessenger,
} from '../../infra/providers/appointments-booking';
import { ContactConsentModule } from '../contact-consent';
import { CrmModule } from '../crm';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { AppointmentsController, ContactAppointmentsController } from './appointments.controller';
import { AppointmentsRepository } from './appointments.repository';
import { AppointmentsService } from './appointments.service';
import { AppointmentsSupport } from './appointments.support';
import { AppointmentBookingGuard, AppointmentPlan } from './booking-plan';
import { BookingOffersService } from './booking-offers.service';
import { BookingService } from './booking.service';
import { BookingTypesController } from './booking-types.controller';
import { BookingTypesRepository } from './booking-types.repository';
import { BookingTypesService } from './booking-types.service';
import { ContactLinkService } from './contact-link.service';
import { GoogleCalendarAdapter } from './google-calendar.adapter';
import { GoogleCalendarCallbackController } from './google-calendar-callback.controller';
import { GoogleCalendarConfig } from './google-calendar-config.service';
import { GoogleCalendarConnectService } from './google-calendar-connect.service';
import { GoogleCalendarConnectionRepository } from './google-calendar-connection.repository';
import { GoogleCalendarController } from './google-calendar.controller';
import { GoogleCalendarTokens } from './google-calendar-tokens.service';
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
 * The calendar and the customer messages go through two ports (`infra/providers/appointments-booking`). The calendar is served by the
 * Google Calendar adapter (a workspace with nothing connected behaves as the old stub did); the customer messages still have the stub
 * the channel domain replaces under the same token: a booking message is reported as skipped.
 *
 * The sweeps and the outbox consumers live in `AppointmentsBookingWorkerModule` (the worker process only).
 */
@Module({
  // CrmModule: contacts (find-or-create by phone and email). PlansCoreModule: the `appointment_booking` flag and the `appointments` cap.
  // PlatformSettingsModule: the operator's Google OAuth client (console, Google Calendar).
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
  ],
  providers: [
    CryptoService,
    AppointmentPlan,
    AppointmentBookingGuard,
    BookingTypesRepository,
    AppointmentsRepository,
    AppointmentsSupport,
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
    GoogleCalendarConnectService,
    { provide: APPOINTMENT_CALENDAR, useExisting: GoogleCalendarAdapter },
    { provide: APPOINTMENT_MESSENGER, useClass: NoAppointmentMessenger },
  ],
  exports: [
    AppointmentsService,
    BookingService,
    BookingOffersService,
    BookingTypesRepository,
    AppointmentsRepository,
    AppointmentsSupport,
    SlotsService,
    APPOINTMENT_CALENDAR,
    APPOINTMENT_MESSENGER,
  ],
})
export class AppointmentsBookingModule {}
