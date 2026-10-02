import { z } from 'zod';
import type { ApiRequest } from './http';
import {
  appointmentCountsSchema,
  appointmentPageSchema,
  appointmentSchema,
  bookingSettingsSchema,
  bookingTypeListSchema,
  bookingTypeSchema,
  publicBookedSchema,
  publicDirectorySchema,
  publicManageSchema,
  publicTypePageSchema,
  slotListSchema,
  type Appointment,
  type AppointmentCounts,
  type BookingSettings,
  type BookingSettingsInput,
  type BookingType,
  type BookingTypeInput,
  type PreviewDraft,
  type PublicBookInput,
  type PublicDirectory,
  type PublicManage,
  type PublicTypePage,
  type SlotList,
} from './schemas';

type Query = Record<string, string | number | boolean | undefined>;

/** The stand-in is loaded only when it is used, so it is not part of a production page. */
async function call<T = void>(path: string, req: ApiRequest<T> = {}): Promise<T> {
  const { mockCall } = await import('./mock-server');
  return mockCall(path, req as never) as Promise<T>;
}
const callPublic = <T>(path: string, req: ApiRequest<T> = {}): Promise<T> =>
  call(`/public${path}`, req);

export interface AppointmentPageResult {
  appointments: Appointment[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Where a list of appointments comes from: the whole workspace, or the bookings of one contact. */
export type AppointmentSource = { kind: 'all' } | { kind: 'contact'; id: string };

const pathOf = (s: AppointmentSource) =>
  s.kind === 'all' ? '/appointments' : `/contacts/${s.id}/appointments`;

/** The development stand-in's staff calls (see `mock-server.ts`): same functions as the real service, in-memory data. */
export const mockAppointmentsApi = {
  async list(
    source: AppointmentSource,
    query: Query,
    signal?: AbortSignal,
  ): Promise<AppointmentPageResult> {
    const res = await call(pathOf(source), { query, schema: appointmentPageSchema, signal });
    return { appointments: res.data, nextCursor: res.page.nextCursor, hasMore: res.page.hasMore };
  },
  counts(query: Query, signal?: AbortSignal): Promise<AppointmentCounts> {
    return call('/appointments/counts', { query, schema: appointmentCountsSchema, signal });
  },
  get(id: string, signal?: AbortSignal): Promise<Appointment> {
    return call(`/appointments/${id}`, { schema: appointmentSchema, signal });
  },
  /** Notes are the only free edit; everything else is an action below. Needs the `rowVersion` that was read. */
  saveNotes(a: Pick<Appointment, 'id' | 'rowVersion'>, notes: string | null): Promise<Appointment> {
    return call(`/appointments/${a.id}`, {
      method: 'PATCH',
      body: { notes, rowVersion: a.rowVersion },
      schema: appointmentSchema,
    });
  },
  /** Pending to confirmed. */
  confirm: (id: string): Promise<Appointment> =>
    call(`/appointments/${id}/confirm`, { method: 'POST', body: {}, schema: appointmentSchema }),
  /** Pending to declined. */
  decline: (id: string): Promise<Appointment> =>
    call(`/appointments/${id}/decline`, { method: 'POST', body: {}, schema: appointmentSchema }),
  cancel: (id: string): Promise<Appointment> =>
    call(`/appointments/${id}/cancel`, { method: 'POST', body: {}, schema: appointmentSchema }),
  complete: (id: string): Promise<Appointment> =>
    call(`/appointments/${id}/complete`, { method: 'POST', body: {}, schema: appointmentSchema }),
  noShow: (id: string): Promise<Appointment> =>
    call(`/appointments/${id}/no-show`, { method: 'POST', body: {}, schema: appointmentSchema }),
  /** Reference's `notify` (default true) tells the customer the new time. */
  reschedule(id: string, startsAt: string, notify: boolean): Promise<Appointment> {
    return call(`/appointments/${id}/reschedule`, {
      method: 'POST',
      body: { startsAt, notify },
      schema: appointmentSchema,
    });
  },

  // booking types
  async types(signal?: AbortSignal): Promise<BookingType[]> {
    return (await call('/booking-types', { schema: bookingTypeListSchema, signal })).data;
  },
  type(id: string, signal?: AbortSignal): Promise<BookingType> {
    return call(`/booking-types/${id}`, { schema: bookingTypeSchema, signal });
  },
  createType(input: BookingTypeInput): Promise<BookingType> {
    return call('/booking-types', { method: 'POST', body: input, schema: bookingTypeSchema });
  },
  updateType(
    type: Pick<BookingType, 'id' | 'rowVersion'>,
    input: BookingTypeInput,
  ): Promise<BookingType> {
    return call(`/booking-types/${type.id}`, {
      method: 'PUT',
      body: { ...input, rowVersion: type.rowVersion },
      schema: bookingTypeSchema,
    });
  },
  setTypeActive(
    type: Pick<BookingType, 'id' | 'rowVersion'>,
    isActive: boolean,
  ): Promise<BookingType> {
    return call(`/booking-types/${type.id}/${isActive ? 'activate' : 'pause'}`, {
      method: 'POST',
      body: {},
      schema: bookingTypeSchema,
    });
  },
  duplicateType(id: string): Promise<BookingType> {
    return call(`/booking-types/${id}/duplicate`, {
      method: 'POST',
      body: {},
      schema: bookingTypeSchema,
    });
  },
  deleteType(id: string): Promise<void> {
    return call(`/booking-types/${id}`, { method: 'DELETE' });
  },
  /** The editor's live preview and the staff reschedule picker: open times of a saved type, or of an unsaved draft. */
  typeSlots(
    id: string,
    range: { from: string; to: string },
    signal?: AbortSignal,
  ): Promise<SlotList> {
    return call(`/booking-types/${id}/slots`, { query: range, schema: slotListSchema, signal });
  },
  previewSlots(draft: PreviewDraft, days: number, signal?: AbortSignal): Promise<SlotList> {
    return call('/booking-types/preview-slots', {
      method: 'POST',
      body: { draft, days },
      schema: slotListSchema,
      signal,
    });
  },

  // settings
  settings(signal?: AbortSignal): Promise<BookingSettings> {
    return call('/appointments/settings', { schema: bookingSettingsSchema, signal });
  },
  saveSettings(
    rowVersion: number | undefined,
    input: BookingSettingsInput,
  ): Promise<BookingSettings> {
    return call('/appointments/settings', {
      method: 'PUT',
      body: { ...input, rowVersion },
      schema: bookingSettingsSchema,
    });
  },
};

/** The visitor's calls: no session, the page address or the manage link's secret is the credential. */
export const mockPublicApi = {
  directory(org: string, signal?: AbortSignal): Promise<PublicDirectory> {
    return callPublic(`/org/${encodeURIComponent(org)}`, { schema: publicDirectorySchema, signal });
  },
  type(org: string, slug: string, signal?: AbortSignal): Promise<PublicTypePage> {
    return callPublic(`/org/${encodeURIComponent(org)}/${encodeURIComponent(slug)}`, {
      schema: publicTypePageSchema,
      signal,
    });
  },
  typeSlots(
    org: string,
    slug: string,
    range: { from: string; to: string },
    signal?: AbortSignal,
  ): Promise<SlotList> {
    return callPublic(`/org/${encodeURIComponent(org)}/${encodeURIComponent(slug)}/slots`, {
      query: range,
      schema: slotListSchema,
      signal,
    });
  },
  /** `idempotencyKey` is one per attempt of the form, so a tap repeated or a send retried books once. */
  book(
    org: string,
    slug: string,
    input: PublicBookInput,
    idempotencyKey?: string,
  ): Promise<z.infer<typeof publicBookedSchema>> {
    return callPublic(`/org/${encodeURIComponent(org)}/${encodeURIComponent(slug)}/book`, {
      method: 'POST',
      body: input,
      schema: publicBookedSchema,
      idempotencyKey,
    });
  },
  manage(token: string, signal?: AbortSignal): Promise<PublicManage> {
    return callPublic(`/manage/${encodeURIComponent(token)}`, {
      schema: publicManageSchema,
      signal,
    });
  },
  manageSlots(
    token: string,
    range: { from: string; to: string },
    signal?: AbortSignal,
  ): Promise<SlotList> {
    return callPublic(`/manage/${encodeURIComponent(token)}/slots`, {
      query: range,
      schema: slotListSchema,
      signal,
    });
  },
  reschedule(token: string, startsAt: string): Promise<PublicManage> {
    return callPublic(`/manage/${encodeURIComponent(token)}/reschedule`, {
      method: 'POST',
      body: { startsAt },
      schema: publicManageSchema,
    });
  },
  cancel(token: string): Promise<PublicManage> {
    return callPublic(`/manage/${encodeURIComponent(token)}/cancel`, {
      method: 'POST',
      body: {},
      schema: publicManageSchema,
    });
  },
};
