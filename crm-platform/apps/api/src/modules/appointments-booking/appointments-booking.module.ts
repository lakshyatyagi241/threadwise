import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import {
  APPOINTMENT_CALENDAR,
  APPOINTMENT_MESSENGER,
  NoAppointmentMessenger,
  NoCalendarSync,
} from '../../infra/providers/appointments-booking';
import { CrmModule } from '../crm';
import { PlansCoreModule } from '../plans-subscriptions-trials';
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
import {
  PublicBookingController,
  PublicBookingManageController,
} from './public-booking.controller';
import { PublicBookingService } from './public-booking.service';
import { BookingPublicThrottle } from './public-throttle';
import { SlotsService } from './slots.service';

/**
 * Appointments and booking (WD-APPT). Booking types, the slot engine, appointments with a guarded status machine, and the customer's
 * public booking and manage pages.
 *
 * The calendar and the customer messages go through two ports (`infra/providers/appointments-booking`). The stub adapters registered
 * here are what a deployment has until the integrations and channel domains bind real ones under the same tokens: bookings work without
 * a calendar, and a booking message is reported as skipped.
 *
 * The sweeps and the outbox consumers live in `AppointmentsBookingWorkerModule` (the worker process only).
 */
@Module({
  // CrmModule: contacts (find-or-create by phone and email). PlansCoreModule: the `appointment_booking` flag and the `appointments` cap.
  imports: [CrmModule, PlansCoreModule],
  controllers: [
    // `booking-types/options`, `preview-slots` and `appointments/counts`, `calendar` are literal paths declared before `:id` inside
    // their controllers. The public controllers are unauthenticated (a public page, a bearer token).
    BookingTypesController,
    AppointmentsController,
    ContactAppointmentsController,
    PublicBookingController,
    PublicBookingManageController,
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
    { provide: APPOINTMENT_CALENDAR, useClass: NoCalendarSync },
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
