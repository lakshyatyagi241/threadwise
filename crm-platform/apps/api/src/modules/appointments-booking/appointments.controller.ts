import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  appointmentActionSchema,
  appointmentCountsQuerySchema,
  cancelAppointmentSchema,
  createAppointmentSchema,
  listAppointmentsQuerySchema,
  recordAppointmentPaymentSchema,
  rescheduleAppointmentSchema,
  updateAppointmentSchema,
  type AppointmentActionInput,
  type AppointmentCountsQuery,
  type CancelAppointmentInput,
  type CreateAppointmentInput,
  type ListAppointmentsQuery,
  type RecordAppointmentPaymentInput,
  type RecordScope,
  type RescheduleAppointmentInput,
  type UpdateAppointmentInput,
} from '@crm/contracts';
import { ActorKinds, GrantedScope, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AppointmentCalendarSyncService } from './appointment-calendar-sync.service';
import { AppointmentsService } from './appointments.service';
import { AppointmentBookingGuard } from './booking-plan';
import { GoogleCalendarConnectService } from './google-calendar-connect.service';

/**
 * Appointments (TW-APPT-002..004, 039; EXT-APPT-02, 04, 06, 07). Every route needs the plan's appointment booking and the capability it
 * names; "scope" is the caller's record scope over who hosts or booked the appointment (all / team / own).
 *
 * Literal paths (`counts`, `calendar`) are declared before `:id`: Express matches in registration order.
 */
@ApiTags('appointments')
@ActorKinds('user')
@UseGuards(AppointmentBookingGuard)
@Controller({ path: 'appointments', version: '2' })
export class AppointmentsController {
  constructor(
    private readonly appts: AppointmentsService,
    private readonly google: GoogleCalendarConnectService,
    private readonly sync: AppointmentCalendarSyncService,
  ) {}

  @Get()
  @RequirePermission('record.appointments.read')
  @ApiOperation({
    summary: 'List appointments (cursor paginated)',
    description:
      "Scope `upcoming` (default: not started, pending or confirmed, soonest first), `past` (started, latest first) or `all`. Filters: status (list), bookingTypeId, contactId, hostId, mine (hosted by the caller), from / to (the start), needsReview, q (title and the invitee's name, email or phone).",
  })
  list(
    @Query(zodPipe(listAppointmentsQuerySchema)) query: ListAppointmentsQuery,
    @GrantedScope('record.appointments.read') scope: RecordScope,
  ) {
    return this.appts.list(query, scope);
  }

  @Get('counts')
  @RequirePermission('record.appointments.read')
  @ApiOperation({
    summary: 'Counts per status for the tab badges',
    description:
      "The same filters as the list (not status or scope): a count per status, `upcoming` (pending or confirmed, not started), `past`, `needsReview` and the caller's own upcoming.",
  })
  counts(
    @Query(zodPipe(appointmentCountsQuerySchema)) query: AppointmentCountsQuery,
    @GrantedScope('record.appointments.read') scope: RecordScope,
  ) {
    return this.appts.counts(query, scope);
  }

  @Get('calendar')
  @RequirePermission('record.appointments.read')
  @ApiOperation({
    summary: 'Is an external calendar connected?',
    description:
      "`status` is `unavailable` (the platform has no Google OAuth client), `disconnected`, `connected` or `needs_reconnect` (Google refused the stored grant). `connected`, `account` and `provider` are the calendar port's own answer and stay as they were.",
  })
  async calendar() {
    return this.google.status();
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.appointments.create')
  @ApiOperation({
    summary: 'Book an appointment for a customer (staff)',
    description:
      'The time must be one the type offers (409 APPT_SLOT_TAKEN when the seat is gone, 422 APPT_SLOT_UNAVAILABLE when it is off the schedule) unless ignoreAvailability is set, which never overrides a taken seat. Staff are the approval: the result is confirmed. Send a contactId or an invitee (found or created by phone and email).',
  })
  create(@Body(zodPipe(createAppointmentSchema)) body: CreateAppointmentInput) {
    return this.appts.create(body);
  }

  @Get(':id')
  @RequirePermission('record.appointments.read')
  @ApiOperation({ summary: 'Get one appointment by uuid (with its customer manage link)' })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.appointments.read') scope: RecordScope,
  ) {
    return this.appts.get(id, scope);
  }

  @Get(':id/ics')
  @RequirePermission('record.appointments.read')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @ApiOperation({ summary: 'The appointment as an iCalendar (.ics) file' })
  async ics(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.appointments.read') scope: RecordScope,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const f = await this.appts.ics(id, scope);
    res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`);
    return f.body;
  }

  @Patch(':id')
  @RequirePermission('record.appointments.update')
  @ApiOperation({
    summary: 'Edit an appointment',
    description:
      'Requires the rowVersion you read (409 ROW_VERSION_CONFLICT otherwise). Absent keeps, null clears where a field can be empty. The time moves through `reschedule`, the status through the actions.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateAppointmentSchema)) body: UpdateAppointmentInput,
    @GrantedScope('record.appointments.update') scope: RecordScope,
  ) {
    return this.appts.update(id, body, scope);
  }

  @Post(':id/reschedule')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.appointments.update')
  @ApiOperation({
    summary: 'Move an appointment to another time',
    description:
      'Pending or confirmed, not started. The target is validated like a new booking (the booking itself does not block its new slot). The status stays; every reminder offset is armed again.',
  })
  reschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(rescheduleAppointmentSchema)) body: RescheduleAppointmentInput,
    @GrantedScope('record.appointments.update') scope: RecordScope,
  ) {
    return this.appts.reschedule(id, body, scope);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.appointments.update')
  @ApiOperation({ summary: 'Cancel (pending or confirmed): frees the slot' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(cancelAppointmentSchema)) body: CancelAppointmentInput,
    @GrantedScope('record.appointments.update') scope: RecordScope,
  ) {
    return this.appts.cancel(id, body, scope);
  }

  @Post(':id/calendar/push')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.appointments.update')
  @ApiOperation({
    summary: 'Push our time back to Google (the event is out of sync)',
    description:
      "Writes the appointment's Google event again from the appointment (a deleted event comes back under the same id). The appointment is not changed. 409 GOOGLE_SYNC_NOT_DRIFTED when the event is not out of sync; 409 APPT_CALENDAR_NOT_CONNECTED; 502 APPT_CALENDAR_PROVIDER_FAILED.",
  })
  pushCalendar(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.appointments.update') scope: RecordScope,
  ) {
    return this.sync.push(id, scope);
  }

  @Post(':id/calendar/accept')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.appointments.update')
  @ApiOperation({
    summary: "Accept Google's change (the event is out of sync)",
    description:
      "Reads the event again and applies what Google shows through the usual appointment rules: a deleted or missing event cancels the appointment, a moved event reschedules it to Google's start, changed guests are acknowledged. `notify` (default true) tells the customer as any staff cancel or move does. 409 GOOGLE_SYNC_NOT_DRIFTED when there is nothing to decide.",
  })
  acceptCalendar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(appointmentActionSchema)) body: AppointmentActionInput,
    @GrantedScope('record.appointments.update') scope: RecordScope,
  ) {
    return this.sync.accept(id, body, scope);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.appointments.update')
  @ApiOperation({ summary: 'Approve a pending booking' })
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(appointmentActionSchema)) body: AppointmentActionInput,
    @GrantedScope('record.appointments.update') scope: RecordScope,
  ) {
    return this.appts.confirm(id, body, scope);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.appointments.update')
  @ApiOperation({ summary: 'Decline a pending booking: frees the slot' })
  decline(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(appointmentActionSchema)) body: AppointmentActionInput,
    @GrantedScope('record.appointments.update') scope: RecordScope,
  ) {
    return this.appts.decline(id, body, scope);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.appointments.update')
  @ApiOperation({ summary: 'Mark a confirmed appointment completed (it must have started)' })
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(appointmentActionSchema)) body: AppointmentActionInput,
    @GrantedScope('record.appointments.update') scope: RecordScope,
  ) {
    return this.appts.complete(id, body, scope);
  }

  @Post(':id/no-show')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.appointments.update')
  @ApiOperation({
    summary: 'Mark a confirmed appointment a no-show (it must have started)',
    description: 'Records the no-show fee of the type when it has one (never charged here).',
  })
  noShow(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(appointmentActionSchema)) body: AppointmentActionInput,
    @GrantedScope('record.appointments.update') scope: RecordScope,
  ) {
    return this.appts.noShow(id, body, scope);
  }

  @Post(':id/check-in')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.appointments.update')
  @ApiOperation({
    summary: "Stamp the customer's arrival",
    description:
      'Idempotent. A checked-in confirmed appointment is completed by the worker once it has ended.',
  })
  checkIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(appointmentActionSchema)) body: AppointmentActionInput,
    @GrantedScope('record.appointments.update') scope: RecordScope,
  ) {
    return this.appts.checkIn(id, body, scope);
  }

  @Post(':id/payments')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.appointments.update')
  @ApiOperation({
    summary: 'Record money received for a booking',
    description:
      'No gateway is involved: a person at the till, or the payments domain, records a settled payment. When what is due to book is paid, a pending booking is confirmed (unless the type needs approval).',
  })
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(recordAppointmentPaymentSchema)) body: RecordAppointmentPaymentInput,
    @GrantedScope('record.appointments.update') scope: RecordScope,
  ) {
    return this.appts.recordPayment(id, body, scope);
  }

  @Post(':id/manage-link/rotate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.appointments.update')
  @ApiOperation({ summary: 'Issue a new customer manage link; the old one stops working at once' })
  rotate(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.appointments.update') scope: RecordScope,
  ) {
    return this.appts.rotateManageLink(id, scope);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.appointments.delete')
  @ApiOperation({ summary: 'Delete an appointment in a final status (audited)' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.appointments.delete') scope: RecordScope,
  ): Promise<void> {
    await this.appts.remove(id, scope);
  }
}

/** A contact's appointments, for the contact detail page (EXT-APPT-07). */
@ApiTags('appointments')
@ActorKinds('user')
@UseGuards(AppointmentBookingGuard)
@Controller({ path: 'contacts/:contactId/appointments', version: '2' })
export class ContactAppointmentsController {
  constructor(private readonly appts: AppointmentsService) {}

  @Get()
  @RequirePermission('record.appointments.read')
  @ApiOperation({
    summary: "A contact's appointments (same filters and paging as the list)",
    description:
      'Needs record.appointments.read, and record.contacts.read on the contact (its record scope applies: a contact the caller cannot see is 404).',
  })
  list(
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Query(zodPipe(listAppointmentsQuerySchema)) query: ListAppointmentsQuery,
    @GrantedScope('record.appointments.read') scope: RecordScope,
  ) {
    return this.appts.forContact(contactId, { ...query, scope: query.scope }, scope);
  }
}
