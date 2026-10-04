import {
  appointmentCountsResponseSchema,
  appointmentPageResponseSchema,
  appointmentResponseSchema,
  bookingTypeListResponseSchema,
  bookingTypeResponseSchema,
  calendarConnectStartResponseSchema,
  calendarListResponseSchema,
  calendarStatusResponseSchema,
  previewSlotsResponseSchema,
  publicBookResponseSchema,
  publicBookingPageSchema,
  publicManageViewSchema,
  slotsResponseSchema,
} from '@crm/contracts';
import { z } from 'zod';
import { ApiError } from '@/lib/api/errors';
import { call, callPublic } from './http';
import type {
  Appointment,
  AppointmentCounts,
  BookingSettings,
  BookingSettingsInput,
  BookingType,
  BookingTypeInput,
  CalendarConnection,
  CalendarOption,
  PreviewDraft,
  PublicBookInput,
  PublicDirectory,
  PublicManage,
  PublicTypePage,
  SlotList,
} from './schemas';
import {
  countParams,
  duplicateOf,
  listParams,
  slotQuery,
  toAppointment,
  toCalendar,
  toCalendarOptions,
  toBookingType,
  toBookBody,
  toPreviewBody,
  toPublicBooked,
  toPublicDirectory,
  toPublicManage,
  toPublicTypePage,
  toSlotList,
  toTypeBody,
} from './wire';

type Query = Record<string, string | number | boolean | undefined>;

export interface AppointmentPageResult {
  appointments: Appointment[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Where a list of appointments comes from: the whole workspace, or the bookings of one contact. */
export type AppointmentSource = { kind: 'all' } | { kind: 'contact'; id: string };

const pathOf = (s: AppointmentSource) =>
  s.kind === 'all' ? '/appointments' : `/contacts/${s.id}/appointments`;

/** What a call to something this server does not offer fails with (the screens show their "not available" state). */
const notAvailable = (): ApiError =>
  new ApiError(501, 'NOT_IMPLEMENTED', 'Not available on this server');

const appointmentOne = appointmentResponseSchema.transform(toAppointment);
const appointmentPage = appointmentPageResponseSchema.transform((p) => ({
  appointments: p.data.map(toAppointment),
  nextCursor: p.page.nextCursor,
  hasMore: p.page.hasMore,
}));
const counts = appointmentCountsResponseSchema.transform((c): AppointmentCounts => ({
  upcoming: c.upcoming,
  past: c.past,
  needsReview: c.needsReview,
}));
const calendarOne = calendarStatusResponseSchema.transform(toCalendar);
const calendarOptions = calendarListResponseSchema.transform(toCalendarOptions);
const typeOne = bookingTypeResponseSchema.transform(toBookingType);
const typeList = bookingTypeListResponseSchema.transform((l) => l.data.map(toBookingType));

/** The staff calls of the real API (`/v2/appointments`, `/v2/booking-types`), converted by `./wire`. */
export const realAppointmentsApi = {
  async list(
    source: AppointmentSource,
    query: Query,
    signal?: AbortSignal,
  ): Promise<AppointmentPageResult> {
    return call(pathOf(source), { query: listParams(query), schema: appointmentPage, signal });
  },
  counts(query: Query, signal?: AbortSignal): Promise<AppointmentCounts> {
    return call('/appointments/counts', { query: countParams(query), schema: counts, signal });
  },
  get(id: string, signal?: AbortSignal): Promise<Appointment> {
    return call(`/appointments/${id}`, { schema: appointmentOne, signal });
  },
  /** Notes are the only free edit; everything else is an action below. Needs the `rowVersion` that was read. */
  saveNotes(a: Pick<Appointment, 'id' | 'rowVersion'>, notes: string | null): Promise<Appointment> {
    return call(`/appointments/${a.id}`, {
      method: 'PATCH',
      body: { notes, rowVersion: a.rowVersion },
      schema: appointmentOne,
    });
  },
  confirm: (id: string): Promise<Appointment> =>
    call(`/appointments/${id}/confirm`, { method: 'POST', body: {}, schema: appointmentOne }),
  /** Pending to declined (the request is turned down). */
  decline: (id: string): Promise<Appointment> =>
    call(`/appointments/${id}/decline`, { method: 'POST', body: {}, schema: appointmentOne }),
  cancel: (id: string): Promise<Appointment> =>
    call(`/appointments/${id}/cancel`, { method: 'POST', body: {}, schema: appointmentOne }),
  complete: (id: string): Promise<Appointment> =>
    call(`/appointments/${id}/complete`, { method: 'POST', body: {}, schema: appointmentOne }),
  noShow: (id: string): Promise<Appointment> =>
    call(`/appointments/${id}/no-show`, { method: 'POST', body: {}, schema: appointmentOne }),
  /** `notify` tells the customer the new time. */
  reschedule(id: string, startsAt: string, notify: boolean): Promise<Appointment> {
    return call(`/appointments/${id}/reschedule`, {
      method: 'POST',
      body: { startsAt, notify },
      schema: appointmentOne,
    });
  },

  // booking types
  types(signal?: AbortSignal): Promise<BookingType[]> {
    return call('/booking-types', { schema: typeList, signal });
  },
  type(id: string, signal?: AbortSignal): Promise<BookingType> {
    return call(`/booking-types/${id}`, { schema: typeOne, signal });
  },
  createType(input: BookingTypeInput): Promise<BookingType> {
    return call('/booking-types', { method: 'POST', body: toTypeBody(input), schema: typeOne });
  },
  updateType(
    type: Pick<BookingType, 'id' | 'rowVersion'>,
    input: BookingTypeInput,
  ): Promise<BookingType> {
    return call(`/booking-types/${type.id}`, {
      method: 'PATCH',
      body: toTypeBody(input, type.rowVersion ?? 1),
      schema: typeOne,
    });
  },
  /** Pausing and activating are an update of `isActive` alone: the child lists stay as they are. */
  setTypeActive(
    type: Pick<BookingType, 'id' | 'rowVersion'>,
    isActive: boolean,
  ): Promise<BookingType> {
    return call(`/booking-types/${type.id}`, {
      method: 'PATCH',
      body: { isActive, rowVersion: type.rowVersion ?? 1 },
      schema: typeOne,
    });
  },
  /** The API has no duplicate route: the copy is a create from the original, paused, with its own questions. */
  async duplicateType(id: string): Promise<BookingType> {
    const original = await realAppointmentsApi.type(id);
    return realAppointmentsApi.createType(duplicateOf(original));
  },
  deleteType(id: string): Promise<void> {
    return call(`/booking-types/${id}`, { method: 'DELETE' });
  },
  /** Open times of a saved type, for the staff reschedule picker. */
  typeSlots(
    id: string,
    range: { from: string; to: string },
    signal?: AbortSignal,
  ): Promise<SlotList> {
    return call(`/booking-types/${id}/slots`, {
      query: slotQuery(range),
      schema: slotsResponseSchema.transform((r) => toSlotList(r, range)),
      signal,
    });
  },
  /** The editor's live preview of an unsaved draft. */
  previewSlots(draft: PreviewDraft, days: number, signal?: AbortSignal): Promise<SlotList> {
    return call('/booking-types/preview-slots', {
      method: 'POST',
      body: toPreviewBody(draft, days),
      schema: previewSlotsResponseSchema.transform((r) => toSlotList(r)),
      signal,
    });
  },

  // the workspace's Google Calendar (the platform operator supplies the OAuth client; the admin connects the account)
  calendar(signal?: AbortSignal): Promise<CalendarConnection> {
    return call('/appointments/calendar', { schema: calendarOne, signal });
  },
  /** Google's consent address, to send the browser to. Google then comes back to `returnTo` with `?calendar=<outcome>`. */
  async startCalendarConnect(returnTo: string): Promise<string> {
    const r = await call('/appointments/calendar/google/start', {
      method: 'POST',
      body: { returnTo },
      schema: calendarConnectStartResponseSchema,
    });
    return r.url;
  },
  calendars(signal?: AbortSignal): Promise<CalendarOption[]> {
    return call('/appointments/calendar/google/calendars', { schema: calendarOptions, signal });
  },
  selectCalendar(calendarId: string): Promise<CalendarConnection> {
    return call('/appointments/calendar/google/calendar', {
      method: 'PUT',
      body: { calendarId },
      schema: calendarOne,
    });
  },
  disconnectCalendar(): Promise<CalendarConnection> {
    return call('/appointments/calendar/google/disconnect', {
      method: 'POST',
      body: {},
      schema: calendarOne,
    });
  },

  // settings: the API keeps no workspace-level booking settings (the legacy single-calendar mode is replaced by booking types,
  // decision D-16 of the spec), so there is nothing to call: these fail as "not available" and the settings screen says so.
  settings(_signal?: AbortSignal): Promise<BookingSettings> {
    return Promise.reject(notAvailable());
  },
  saveSettings(
    _rowVersion: number | undefined,
    _input: BookingSettingsInput,
  ): Promise<BookingSettings> {
    return Promise.reject(notAvailable());
  },
};

const enc = encodeURIComponent;

/**
 * The server names a rejected answer by its question id (`answers.<uuid>`); the form knows answers by their place in the list it
 * sent (`answers.<n>`). Rewrites the error's field paths so the form puts each message on the right box.
 */
export function withAnswerIndexes(error: unknown, input: PublicBookInput): unknown {
  if (!(error instanceof ApiError) || error.fieldErrors.length === 0) return error;
  const fieldErrors = error.fieldErrors.map((f) => {
    const m = /^answers[.[/]([^\].]+)\]?$/.exec(f.path);
    const at = m ? input.answers.findIndex((a) => a.questionId === m[1]) : -1;
    return at >= 0 ? { ...f, path: `answers.${at}` } : f;
  });
  return new ApiError(error.status, error.code, error.message, error.requestId, fieldErrors);
}

/** The visitor's calls (`/v2/public/booking`, `/v2/public/booking-manage`): no session, the page address or the manage token is the credential. */
export const realPublicApi = {
  directory(org: string, signal?: AbortSignal): Promise<PublicDirectory> {
    return callPublic(`/booking/${enc(org)}`, {
      schema: publicBookingPageSchema.transform(toPublicDirectory),
      signal,
    });
  },
  type(org: string, slug: string, signal?: AbortSignal): Promise<PublicTypePage> {
    return callPublic(`/booking/${enc(org)}/${enc(slug)}`, {
      schema: z
        .object({
          organization: z.object({ name: z.string(), slug: z.string() }),
          service: publicBookingPageSchema.shape.services.element,
        })
        .transform(toPublicTypePage),
      signal,
    });
  },
  typeSlots(
    org: string,
    slug: string,
    range: { from: string; to: string },
    signal?: AbortSignal,
  ): Promise<SlotList> {
    return callPublic(`/booking/${enc(org)}/${enc(slug)}/slots`, {
      query: slotQuery(range),
      schema: slotsResponseSchema.transform((r) => toSlotList(r, range)),
      signal,
    });
  },
  /** `idempotencyKey` is one per attempt of the form, so a tap repeated or a send retried books once. */
  async book(org: string, slug: string, input: PublicBookInput, idempotencyKey?: string) {
    let made;
    try {
      made = await callPublic(`/booking/${enc(org)}/${enc(slug)}/book`, {
        method: 'POST',
        body: toBookBody(input),
        schema: publicBookResponseSchema,
        idempotencyKey,
      });
    } catch (e) {
      throw withAnswerIndexes(e, input);
    }
    // The answer holds the times and the manage link; the page's own service fills in what and where.
    const page = await realPublicApi.type(org, slug);
    return toPublicBooked(made, page.type, page.org);
  },
  manage(token: string, signal?: AbortSignal): Promise<PublicManage> {
    return callPublic(`/booking-manage/${enc(token)}`, {
      schema: publicManageViewSchema.transform((v) => toPublicManage(v, token)),
      signal,
    });
  },
  manageSlots(
    token: string,
    range: { from: string; to: string },
    signal?: AbortSignal,
  ): Promise<SlotList> {
    return callPublic(`/booking-manage/${enc(token)}/slots`, {
      query: slotQuery(range),
      schema: slotsResponseSchema.transform((r) => toSlotList(r, range)),
      signal,
    });
  },
  reschedule(token: string, startsAt: string): Promise<PublicManage> {
    return callPublic(`/booking-manage/${enc(token)}/reschedule`, {
      method: 'POST',
      body: { startsAt },
      schema: publicManageViewSchema.transform((v) => toPublicManage(v, token)),
    });
  },
  cancel(token: string): Promise<PublicManage> {
    return callPublic(`/booking-manage/${enc(token)}/cancel`, {
      method: 'POST',
      body: {},
      schema: publicManageViewSchema.transform((v) => toPublicManage(v, token)),
    });
  },
};
