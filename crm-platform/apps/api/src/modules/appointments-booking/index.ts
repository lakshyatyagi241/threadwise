/**
 * Public surface of the appointments-booking module. Other modules import from HERE: the flow-runtime domain calls
 * `BookingOffersService` (the "Book appointment" node) and subscribes to `appointment.*` events; the payments domain calls
 * `AppointmentsService.recordPayment` when a gateway settles a booking's payment; the integrations and channel domains bind real
 * adapters to `APPOINTMENT_CALENDAR` and `APPOINTMENT_MESSENGER`.
 */
export { AppointmentsBookingModule } from './appointments-booking.module';
export { AppointmentsBookingWorkerModule } from './appointments-booking-worker.module';
export { AppointmentsService } from './appointments.service';
export { BookingOffersService } from './booking-offers.service';
export type { FlowBookInput, Offer, OfferedType } from './booking-offers.service';
export { BookingService } from './booking.service';
export { AppointmentsRepository } from './appointments.repository';
export type { AppointmentRow } from './appointments.repository';
export { BookingTypesRepository } from './booking-types.repository';
export { SlotsService } from './slots.service';
export { generateSlots, findOpenSlot, freeSeats, pickSeat } from './slot-engine';
export { buildIcs } from './ics';
// The workspace's one Google grant, for the Google account domain (it owns the page and the flow bindings; this module owns the token).
export { GoogleCalendarConnectService } from './google-calendar-connect.service';
export { CalendarNotConnectedError, GoogleCalendarTokens } from './google-calendar-tokens.service';
export { GoogleConsentService } from './google-consent.service';
