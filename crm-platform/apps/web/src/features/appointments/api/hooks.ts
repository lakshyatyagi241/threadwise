'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  type QueryClient,
} from '@tanstack/react-query';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { browserZone, safeZone } from '../lib/zone';
import { configureMock, mockEnabled } from './http';
import { appointmentsApi, type AppointmentSource } from './service';
import type { Appointment } from './schemas';

export const KEYS = {
  all: ['appointments'] as const,
  list: ['appointments', 'list'] as const,
  range: ['appointments', 'range'] as const,
  counts: ['appointments', 'counts'] as const,
  one: (id: string) => ['appointments', 'one', id] as const,
  types: ['appointments', 'types'] as const,
  type: (id: string) => ['appointments', 'type', id] as const,
  settings: ['appointments', 'settings'] as const,
  calendar: ['appointments', 'calendar'] as const,
  calendars: ['appointments', 'calendar', 'list'] as const,
};

/** Keeps the development stand-in (when it is on) in step with who is signed in. Call it once near the top of a screen. */
export function useAppointmentsSetup(): void {
  const session = useSession();
  if (mockEnabled()) {
    configureMock(
      { id: session.user.id, name: session.user.displayName ?? session.user.fullName },
      {
        slug: session.org.slug,
        name: session.org.name,
        timezone: safeZone(session.org.timezone, browserZone()),
        currency: session.org.currency ?? 'USD',
      },
    );
  }
}

/** The zone times are shown in on staff screens: the workspace's, or the viewer's when the workspace has none. */
export function useDisplayZone(): string {
  const session = useSession();
  return safeZone(session.org.timezone, browserZone());
}

export const PAGE_SIZE = 25;
/** The most bookings one calendar page loads; a busier range says so instead of silently dropping the rest. */
export const RANGE_LIMIT = 200;

type Query = Record<string, string | number | boolean | undefined>;

/** The list: every appointment of the source that passes the query, "load more" by cursor. */
export function useAppointmentsList(
  source: AppointmentSource,
  query: Query,
  opts: { enabled?: boolean; limit?: number } = {},
) {
  const q = useInfiniteQuery({
    queryKey: [...KEYS.list, source, query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      appointmentsApi.list(
        source,
        { limit: opts.limit ?? PAGE_SIZE, ...query, cursor: pageParam },
        signal,
      ),
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
    enabled: opts.enabled ?? true,
    placeholderData: keepPreviousData,
    retry: false,
  });
  return { ...q, items: q.data?.pages.flatMap((p) => p.appointments) ?? [] };
}

/** Everything inside a range of instants, for the week and month views (one request, no paging). */
export function useAppointmentsInRange(query: Query, enabled: boolean) {
  const q = useQuery({
    queryKey: [...KEYS.range, query],
    queryFn: async ({ signal }) => {
      const page = await appointmentsApi.list(
        { kind: 'all' },
        { limit: RANGE_LIMIT, ...query },
        signal,
      );
      return { appointments: page.appointments, truncated: page.hasMore };
    },
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });
  return q;
}

/** Tab badges. A failure only hides the badges: the lists work without them. */
export function useAppointmentCounts(query: Query) {
  return useQuery({
    queryKey: [...KEYS.counts, query],
    queryFn: ({ signal }) => appointmentsApi.counts(query, signal),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 15_000,
  });
}

export function useAppointment(id: string | null) {
  return useQuery({
    queryKey: KEYS.one(id ?? ''),
    queryFn: ({ signal }) => appointmentsApi.get(id!, signal),
    enabled: id !== null && id !== '',
    retry: false,
  });
}

export function useBookingTypes() {
  return useQuery({
    queryKey: KEYS.types,
    queryFn: ({ signal }) => appointmentsApi.types(signal),
    retry: false,
    staleTime: 30_000,
  });
}

export function useBookingType(id: string | null) {
  return useQuery({
    queryKey: KEYS.type(id ?? ''),
    queryFn: ({ signal }) => appointmentsApi.type(id!, signal),
    enabled: id !== null,
    retry: false,
  });
}

export function useBookingSettings() {
  return useQuery({
    queryKey: KEYS.settings,
    queryFn: ({ signal }) => appointmentsApi.settings(signal),
    retry: false,
    staleTime: 30_000,
  });
}

/** After any change to a booking: every list, calendar range and badge reloads; the changed one is replaced at once. */
export async function invalidateAppointments(
  qc: QueryClient,
  changed?: Appointment,
): Promise<void> {
  if (changed) qc.setQueryData(KEYS.one(changed.id), changed);
  await Promise.all([
    qc.invalidateQueries({ queryKey: KEYS.list }),
    qc.invalidateQueries({ queryKey: KEYS.range }),
    qc.invalidateQueries({ queryKey: KEYS.counts }),
  ]);
}

export async function invalidateBookingTypes(qc: QueryClient): Promise<void> {
  await qc.invalidateQueries({ queryKey: KEYS.types });
}

/** The workspace's Google Calendar link: whether it can be connected, is connected (which account and calendar) or needs reconnecting. */
export function useCalendarConnection() {
  return useQuery({
    queryKey: KEYS.calendar,
    queryFn: ({ signal }) => appointmentsApi.calendar(signal),
    retry: false,
    staleTime: 15_000,
  });
}

/** The writable calendars of the connected account (only asked for while one is connected). */
export function useCalendarOptions(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.calendars,
    queryFn: ({ signal }) => appointmentsApi.calendars(signal),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}
