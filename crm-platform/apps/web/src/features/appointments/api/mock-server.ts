import type { ApiRequest } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { rulesFromWeek, defaultWeek } from '../lib/availability';
import { generateSlots, type BusyInterval } from '../lib/slot-engine';
import { isOpen } from '../lib/status';
import { addDays, dayKeyOf } from '../lib/zone';
import { mockState } from './http';
import type {
  Appointment,
  AppointmentStatus,
  BookingSettings,
  BookingType,
  BookingTypeInput,
  PreviewDraft,
  PublicBooking,
  PublicType,
} from './schemas';

/**
 * An in-memory stand-in for the appointments API, used only when the real endpoints are unreachable on purpose (see
 * `http.ts`). It answers in the wire format of `./schemas` on the routes the controller is expected to serve and applies the
 * rules of Reference: the five statuses and their transitions (a cancelled, completed or no-show booking answers 410), a time
 * that was just taken is a 409, a shared slot counts seats, reminders follow the type's offsets, the manage link is a secret
 * token. State is kept in this browser (localStorage) so the public pages, which are separate page loads, see the same data.
 */

const KEY = 'appointments:mock:state:v1';
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

interface State {
  types: BookingType[];
  appts: Appointment[];
  settings: BookingSettings;
  tokens: Record<string, string>;
  seq: number;
}

let state: State | null = null;

const uid = () => crypto.randomUUID();
const token = () => `${uid().replaceAll('-', '')}${uid().replaceAll('-', '').slice(0, 16)}`;
const origin = () => (typeof window === 'undefined' ? '' : window.location.origin);

function load(): State {
  if (state) return state;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      state = JSON.parse(raw) as State;
      return state;
    }
  } catch {
    /* seed below */
  }
  state = seed();
  save();
  return state;
}

function save(): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* the stand-in then lives for this page only */
  }
}

/** Forgets the stand-in's data (the next call seeds it again). */
export function resetMock(): void {
  state = null;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
}

const emptyType = (
  over: Partial<BookingType> & Pick<BookingType, 'id' | 'name' | 'slug'>,
): BookingType => {
  const tz = mockState.org.timezone;
  return {
    description: null,
    locationType: 'address',
    locationValue: null,
    color: '#075E54',
    durationMinutes: 30,
    incrementMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minNoticeMinutes: 240,
    maxAdvanceDays: 30,
    maxPerDay: null,
    capacity: 1,
    requiresApproval: false,
    timezone: tz,
    introMessage: null,
    isActive: true,
    sortOrder: 0,
    rowVersion: 1,
    price: {
      currency: mockState.org.currency,
      feeMinor: 0,
      taxPct: 0,
      depositMode: 'none',
      depositValueMinor: 0,
      gatewaySlug: null,
      autoSendLink: true,
      cancelFeeMinor: 0,
      noShowFeeMinor: 0,
      cancelWindowMinutes: 1440,
    },
    integration: {
      calendarId: null,
      createMeet: false,
      spreadsheetId: null,
      sheetRange: 'Sheet1!A1',
    },
    availability: rulesFromWeek(defaultWeek()),
    overrides: [],
    templates: [],
    reminders: [
      { offsetMinutes: 1440, label: '24h' },
      { offsetMinutes: 180, label: '3h' },
    ],
    questions: [],
    appointmentsCount: 0,
    publicUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
};

function seed(): State {
  const now = Date.now();
  const types: BookingType[] = [
    emptyType({
      id: uid(),
      name: 'Discovery call',
      slug: 'discovery-call',
      description: 'A 30-minute call to understand what you need.',
      locationType: 'virtual',
      color: '#2563EB',
      introMessage: 'Tell us a little about your project before we talk.',
      questions: [
        {
          label: 'Company name',
          type: 'text',
          options: [],
          required: true,
          mapToContactField: null,
        },
        {
          label: 'What would you like to cover?',
          type: 'textarea',
          options: [],
          required: false,
          mapToContactField: null,
        },
        {
          label: 'Team size',
          type: 'select',
          options: ['1-10', '11-50', '51-200', '200+'],
          required: true,
          mapToContactField: null,
        },
      ],
      integration: {
        calendarId: null,
        createMeet: true,
        spreadsheetId: null,
        sheetRange: 'Sheet1!A1',
      },
    }),
    emptyType({
      id: uid(),
      name: 'Site visit',
      slug: 'site-visit',
      description: 'We come to your premises and measure up.',
      locationType: 'address',
      locationValue: '12 MG Road, Bengaluru',
      color: '#C2410C',
      durationMinutes: 60,
      incrementMinutes: 60,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
      requiresApproval: true,
      price: {
        currency: mockState.org.currency,
        feeMinor: 150000,
        taxPct: 18,
        depositMode: 'partial',
        depositValueMinor: 50000,
        gatewaySlug: null,
        autoSendLink: true,
        cancelFeeMinor: 20000,
        noShowFeeMinor: 0,
        cancelWindowMinutes: 1440,
      },
      questions: [
        {
          label: 'Email address',
          type: 'email',
          options: [],
          required: true,
          mapToContactField: 'email',
        },
      ],
    }),
    emptyType({
      id: uid(),
      name: 'Group workshop',
      slug: 'group-workshop',
      description: 'Hands-on session for up to 8 people.',
      locationType: 'address',
      locationValue: 'Training room, 3rd floor',
      color: '#7C3AED',
      durationMinutes: 90,
      incrementMinutes: 90,
      capacity: 8,
      availability: [
        { weekday: 3, from: '10:00', to: '15:00' },
        { weekday: 5, from: '10:00', to: '15:00' },
      ],
      isActive: false,
    }),
  ];
  for (const t of types)
    t.publicUrl = t.isActive ? `${origin()}/book/${mockState.org.slug}/${t.slug}` : null;

  const people = [
    { name: 'Ana Lopez', phone: '+34 600 111 222', email: 'ana@acme.test' },
    { name: 'Hassan Al-Farsi', phone: '+971 50 123 4567', email: 'hassan@alfarsi.test' },
    { name: 'Priya Nair', phone: '+91 98450 12345', email: null },
    { name: 'Marco Bellini', phone: '+39 333 123 4567', email: 'marco@bellini.test' },
    { name: 'Layla Haddad', phone: '+962 79 555 0101', email: 'layla@haddad.test' },
  ];
  const appts: Appointment[] = [];
  const tokens: Record<string, string> = {};
  let seq = 0;
  const add = (
    typeIdx: number,
    personIdx: number,
    startsInHours: number,
    status: AppointmentStatus,
    extra: Partial<Appointment> = {},
  ) => {
    const type = types[typeIdx]!;
    const p = people[personIdx]!;
    const startsAt = new Date(Math.round((now + startsInHours * HOUR) / (15 * MIN)) * 15 * MIN);
    const endsAt = new Date(startsAt.getTime() + type.durationMinutes * MIN);
    const id = uid();
    const tok = token();
    tokens[tok] = id;
    seq += 1;
    appts.push({
      id,
      rowVersion: 1,
      status,
      title: `${type.name} — ${p.name}`,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      timezone: type.timezone ?? 'UTC',
      inviteeTimezone: personIdx === 1 ? 'Asia/Dubai' : personIdx === 3 ? 'Europe/Rome' : null,
      bookingType: {
        id: type.id,
        name: type.name,
        color: type.color,
        durationMinutes: type.durationMinutes,
      },
      contact:
        personIdx < 4
          ? {
              id: `00000000-0000-4000-8000-0000000000c${personIdx + 1}`,
              name: p.name,
              phone: p.phone,
              email: p.email,
            }
          : null,
      customer: { name: p.name, phone: p.phone, email: p.email },
      location: type.locationValue,
      meetUrl:
        type.locationType === 'virtual' ? `https://meet.example.test/${tok.slice(0, 10)}` : null,
      answers: [],
      notes: null,
      source: personIdx % 2 === 0 ? 'chat' : 'link',
      paymentStatus: type.price.feeMinor > 0 ? (status === 'pending' ? 'pending' : 'paid') : 'none',
      depositPaidMinor:
        type.price.feeMinor > 0 && status !== 'pending' ? type.price.depositValueMinor : 0,
      currency: type.price.feeMinor > 0 ? type.price.currency : null,
      manageUrl: `${origin()}/b/manage/${tok}`,
      checkedInAt: null,
      createdAt: new Date(now - 3 * DAY).toISOString(),
      updatedAt: new Date(now - 2 * DAY).toISOString(),
      ...extra,
    });
  };
  add(0, 0, 3, 'confirmed', {
    answers: [
      { label: 'Company name', answer: 'Acme Industries' },
      {
        label: 'What would you like to cover?',
        answer: 'Pricing for the enterprise plan and the WhatsApp integration timeline.',
      },
      { label: 'Team size', answer: '51-200' },
    ],
    notes: 'Send the pricing sheet before the call.',
  });
  add(1, 1, 26, 'pending');
  add(0, 2, 27, 'confirmed');
  add(2, 3, 50, 'confirmed');
  add(0, 4, 74, 'confirmed');
  add(1, 0, 6 * 24 + 4, 'pending');
  add(0, 3, 9 * 24 + 2, 'confirmed');
  add(0, 1, 12 * 24, 'cancelled');
  add(0, 0, -26, 'completed');
  add(1, 2, -50, 'completed', { notes: 'Measured the lobby; quote to follow.' });
  add(0, 4, -75, 'no_show');
  add(0, 3, -100, 'cancelled');
  add(1, 1, -148, 'completed');
  add(0, 2, -240, 'completed');
  // appointments on the same afternoon to show side-by-side columns
  add(0, 4, 3.25, 'confirmed');
  const s = {
    types,
    appts,
    tokens,
    seq,
    settings: {
      timezone: mockState.org.timezone,
      slotDurationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      maxPerDay: 16,
      advanceDays: 14,
      reminderMinutesBefore: 60,
      defaultLocation: '',
      businessHours: rulesFromWeek(defaultWeek()),
      templates: {
        confirmation:
          'Hi {{name}}, your {{type}} is booked for {{slot}}. Manage it here: {{manage_link}}',
        reminder: 'Reminder: your {{type}} is on {{slot}}.',
        cancellation:
          'Your appointment "{{type}}" on {{slot}} has been cancelled. Contact us to rebook.',
        reschedule: 'Your {{type}} has been moved to {{slot}}.',
      },
      calendar: {
        provider: 'google',
        status: 'disconnected',
        account: null,
        calendarId: null,
        calendarName: null,
        connectedAt: null,
      },
      rowVersion: 1,
    } satisfies BookingSettings,
  };
  return s;
}

function problem(status: number, code: string, message: string): ApiError {
  return new ApiError(status, code, message);
}

const notFound = () => problem(404, 'NOT_FOUND', 'Not found');

function typeOf(s: State, id: string): BookingType {
  const t = s.types.find((x) => x.id === id);
  if (!t) throw notFound();
  return t;
}

function withCounts(s: State, t: BookingType): BookingType {
  return { ...t, appointmentsCount: s.appts.filter((a) => a.bookingType?.id === t.id).length };
}

function busyOf(s: State, typeId: string, ignoreId?: string): BusyInterval[] {
  return s.appts
    .filter((a) => a.bookingType?.id === typeId && isOpen(a.status) && a.id !== ignoreId)
    .map((a) => ({ start: Date.parse(a.startsAt), end: Date.parse(a.endsAt), seats: 1 }));
}

function draftOf(t: BookingType): PreviewDraft {
  return {
    timezone: t.timezone ?? mockState.org.timezone,
    durationMinutes: t.durationMinutes,
    incrementMinutes: t.incrementMinutes,
    bufferBeforeMinutes: t.bufferBeforeMinutes,
    bufferAfterMinutes: t.bufferAfterMinutes,
    minNoticeMinutes: t.minNoticeMinutes,
    maxAdvanceDays: t.maxAdvanceDays,
    maxPerDay: t.maxPerDay,
    capacity: t.capacity,
    availability: t.availability,
    overrides: t.overrides,
  };
}

function slotsOf(
  s: State,
  t: BookingType,
  from: string | undefined,
  to: string | undefined,
  ignoreId?: string,
) {
  const f = from ? new Date(from) : new Date();
  const e = to ? new Date(to) : new Date(f.getTime() + 14 * DAY);
  if (Number.isNaN(f.getTime()) || Number.isNaN(e.getTime()))
    throw problem(422, 'VALIDATION_FAILED', 'Bad range');
  const capped = new Date(Math.min(e.getTime(), f.getTime() + 62 * DAY));
  return {
    timezone: t.timezone ?? mockState.org.timezone,
    slots: generateSlots({
      draft: draftOf(t),
      now: new Date(),
      from: f,
      to: capped,
      busy: busyOf(s, t.id, ignoreId),
    }),
  };
}

type Q = Record<string, string | number | boolean | undefined>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined ? '' : String(v));

function matchesQuery(a: Appointment, q: Q): boolean {
  const term = str(q.q).trim().toLowerCase();
  if (term) {
    const hay = [a.title, a.customer.name, a.customer.phone, a.customer.email, a.bookingType?.name]
      .join(' ')
      .toLowerCase();
    if (!hay.includes(term)) return false;
  }
  if (str(q.typeId) && a.bookingType?.id !== q.typeId) return false;
  return true;
}

function page<T>(
  rows: T[],
  q: Q,
): { data: T[]; page: { nextCursor: string | null; hasMore: boolean; limit: number } } {
  const limit = Math.min(200, Number(q.limit) || 25);
  const offset = Number(str(q.cursor)) || 0;
  const slice = rows.slice(offset, offset + limit);
  const more = offset + limit < rows.length;
  return {
    data: slice,
    page: { nextCursor: more ? String(offset + limit) : null, hasMore: more, limit },
  };
}

const fresh = (a: Appointment, _s: State): Appointment => ({ ...a });

function touch(a: Appointment): void {
  a.rowVersion = (a.rowVersion ?? 1) + 1;
  a.updatedAt = new Date().toISOString();
}

function apptOf(s: State, id: string): Appointment {
  const a = s.appts.find((x) => x.id === id);
  if (!a) throw notFound();
  return a;
}

function setStatus(a: Appointment, status: AppointmentStatus): void {
  a.status = status;
  touch(a);
}

function publicBooking(s: State, a: Appointment): PublicBooking {
  const type = s.types.find((t) => t.id === a.bookingType?.id);
  const tok = Object.entries(s.tokens).find(([, id]) => id === a.id)?.[0] ?? '';
  const open = isOpen(a.status) && Date.parse(a.startsAt) > Date.now();
  return {
    status: a.status,
    typeName: a.bookingType?.name ?? a.title,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    timezone: a.timezone,
    location: type?.locationType === 'address' ? type.locationValue : a.location,
    locationType: type?.locationType ?? null,
    meetUrl: a.meetUrl,
    description: type?.description ?? null,
    manageToken: tok,
    manageUrl: `${origin()}/b/manage/${tok}`,
    canReschedule: open,
    canCancel: open,
  };
}

function publicTypeOf(t: BookingType): PublicType {
  const tax = Math.round((t.price.feeMinor * t.price.taxPct) / 100);
  const total = t.price.feeMinor + tax;
  return {
    slug: t.slug,
    name: t.name,
    description: t.description,
    locationType: t.locationType,
    locationValue: t.locationValue,
    color: t.color,
    durationMinutes: t.durationMinutes,
    introMessage: t.introMessage,
    timezone: t.timezone ?? mockState.org.timezone,
    maxAdvanceDays: t.maxAdvanceDays,
    requiresApproval: t.requiresApproval,
    currency: t.price.feeMinor > 0 ? t.price.currency : null,
    feeMinor: t.price.feeMinor,
    taxPct: t.price.taxPct,
    dueNowMinor:
      t.price.depositMode === 'full'
        ? total
        : t.price.depositMode === 'partial'
          ? Math.min(total, t.price.depositValueMinor)
          : 0,
    questions: t.questions,
    consent: null,
  };
}

function orgOf(slug: string) {
  if (slug !== mockState.org.slug) throw notFound();
  return { name: mockState.org.name, slug: mockState.org.slug };
}

function inputToType(s: State, input: BookingTypeInput, base?: BookingType): BookingType {
  const name = input.name.trim();
  let slug =
    input.slug ||
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') ||
    `type-${s.seq}`;
  const taken = (x: string) => s.types.some((t) => t.slug === x && t.id !== base?.id);
  const root = slug;
  for (let n = 2; taken(slug); n++) slug = `${root}-${n}`;
  const t: BookingType = {
    ...(base ?? emptyType({ id: uid(), name, slug })),
    ...input,
    id: base?.id ?? uid(),
    name,
    slug,
    appointmentsCount: base?.appointmentsCount ?? 0,
    sortOrder: base?.sortOrder ?? 0,
    rowVersion: (base?.rowVersion ?? 0) + 1,
    updatedAt: new Date().toISOString(),
    createdAt: base?.createdAt ?? new Date().toISOString(),
  };
  t.publicUrl = t.isActive ? `${origin()}/book/${mockState.org.slug}/${t.slug}` : null;
  return t;
}

/** The stand-in's router. Paths are the ones `service.ts` calls (`/public/...` for the visitor's). */
export async function mockCall<T>(path: string, req: ApiRequest<T>): Promise<T> {
  const s = load();
  const method = req.method ?? 'GET';
  const q = (req.query ?? {}) as Q;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parts = path.split('/').filter(Boolean);
  const out = route(s, method, parts, q, body);
  save();
  await new Promise((r) => setTimeout(r, 120));
  const json: unknown = out === undefined ? undefined : JSON.parse(JSON.stringify(out));
  return (req.schema ? req.schema.parse(json) : (undefined as T)) as T;
}

function route(
  s: State,
  method: string,
  p: string[],
  q: Q,
  body: Record<string, unknown>,
): unknown {
  const [a, b, c, d] = p;

  // ---- the visitor's calls ---------------------------------------------------------------------------------------
  if (a === 'public') {
    if (b === 'org') {
      const org = orgOf(c ?? '');
      if (!d) {
        if (method !== 'GET') throw problem(405, 'METHOD_NOT_ALLOWED', 'No');
        return { org, types: s.types.filter((t) => t.isActive).map(publicTypeOf) };
      }
      const t = s.types.find((x) => x.slug === d && x.isActive);
      if (!t) throw notFound();
      const action = p[4];
      if (!action) return { org, type: publicTypeOf(t) };
      if (action === 'slots')
        return slotsOf(s, t, str(q.from) || undefined, str(q.to) || undefined);
      if (action === 'book' && method === 'POST') return book(s, t, org, body);
      throw notFound();
    }
    if (b === 'manage' && c) {
      const id = s.tokens[c];
      const appt = id ? s.appts.find((x) => x.id === id) : undefined;
      if (!appt) throw notFound();
      const org = { name: mockState.org.name, slug: mockState.org.slug };
      const view = () => ({ org, booking: publicBooking(s, appt) });
      if (!d) return view();
      const closed = !isOpen(appt.status);
      if (d === 'slots') {
        if (closed) throw problem(410, 'GONE', 'Gone');
        return slotsOf(
          s,
          typeOf(s, appt.bookingType?.id ?? ''),
          str(q.from) || undefined,
          str(q.to) || undefined,
          appt.id,
        );
      }
      if (method !== 'POST') throw problem(405, 'METHOD_NOT_ALLOWED', 'No');
      if (closed) throw problem(410, 'GONE', 'Gone');
      if (d === 'cancel') {
        setStatus(appt, 'cancelled');
        return view();
      }
      if (d === 'reschedule') {
        moveTo(s, appt, str(body.startsAt));
        return view();
      }
      throw notFound();
    }
    throw notFound();
  }

  // ---- staff: Google Calendar ------------------------------------------------------------------------------------
  if (a === 'appointments' && b === 'calendar') {
    const cal = s.settings.calendar;
    if (c === undefined) return cal;
    if (c === 'google' && d === 'start') {
      // The stand-in has no Google: it connects at once and "returns" to the page the admin came from.
      s.settings.calendar = {
        ...cal,
        status: 'connected',
        account: 'you@example.com',
        calendarId: 'primary',
        calendarName: null,
        connectedAt: new Date().toISOString(),
      };
      const returnTo = typeof body.returnTo === 'string' ? body.returnTo : '/appointments/settings';
      return { url: `${returnTo}?calendar=connected`, expiresInSeconds: 600 };
    }
    if (c === 'google' && d === 'calendars') {
      return [
        { id: 'primary', name: 'you@example.com', primary: true, timezone: 'UTC' },
        { id: 'team@example.com', name: 'Team calendar', primary: false, timezone: 'UTC' },
      ];
    }
    if (c === 'google' && d === 'calendar' && method === 'PUT') {
      const id = String(body.calendarId ?? 'primary');
      s.settings.calendar = {
        ...cal,
        calendarId: id,
        calendarName: id === 'primary' ? null : 'Team calendar',
      };
      return s.settings.calendar;
    }
    if (c === 'google' && d === 'disconnect') {
      s.settings.calendar = {
        ...cal,
        status: 'disconnected',
        account: null,
        calendarId: null,
        calendarName: null,
        connectedAt: null,
      };
      return s.settings.calendar;
    }
  }

  // ---- staff: settings --------------------------------------------------------------------------------------------
  if (a === 'appointments' && b === 'settings') {
    if (method === 'PUT') {
      const next = body as Partial<BookingSettings>;
      if (next.rowVersion !== undefined && next.rowVersion !== s.settings.rowVersion) {
        throw problem(409, 'ROW_VERSION_CONFLICT', 'Changed elsewhere');
      }
      s.settings = {
        ...s.settings,
        ...next,
        calendar: s.settings.calendar,
        rowVersion: (s.settings.rowVersion ?? 1) + 1,
      };
    }
    return s.settings;
  }

  // ---- staff: booking types ---------------------------------------------------------------------------------------
  if (a === 'booking-types') {
    if (!b) {
      if (method === 'POST') {
        const t = inputToType(s, body as unknown as BookingTypeInput);
        s.seq += 1;
        s.types.push(t);
        return withCounts(s, t);
      }
      return {
        data: [...s.types]
          .sort((x, y) => x.sortOrder - y.sortOrder || (x.createdAt < y.createdAt ? 1 : -1))
          .map((t) => withCounts(s, t)),
      };
    }
    if (b === 'preview-slots' && method === 'POST') {
      const draft = body.draft as PreviewDraft;
      const days = Math.max(1, Math.min(14, Number(body.days) || 7));
      const from = new Date();
      return {
        timezone: draft.timezone,
        slots: generateSlots({
          draft,
          now: from,
          from,
          to: new Date(from.getTime() + days * DAY),
          limit: 400,
        }),
      };
    }
    const t = typeOf(s, b);
    if (!c) {
      if (method === 'DELETE') {
        s.types = s.types.filter((x) => x.id !== t.id);
        return undefined;
      }
      if (method === 'PUT') {
        if (body.rowVersion !== undefined && body.rowVersion !== t.rowVersion)
          throw problem(409, 'ROW_VERSION_CONFLICT', 'Changed elsewhere');
        const next = inputToType(s, body as unknown as BookingTypeInput, t);
        s.types = s.types.map((x) => (x.id === t.id ? next : x));
        return withCounts(s, next);
      }
      return withCounts(s, t);
    }
    if (c === 'activate' || c === 'pause') {
      t.isActive = c === 'activate';
      t.publicUrl = t.isActive ? `${origin()}/book/${mockState.org.slug}/${t.slug}` : null;
      t.rowVersion = (t.rowVersion ?? 1) + 1;
      return withCounts(s, t);
    }
    if (c === 'duplicate') {
      const copy = inputToType(s, {
        ...(t as unknown as BookingTypeInput),
        name: `${t.name} (copy)`,
        slug: `${t.slug}-copy`,
        isActive: false,
      });
      s.types.push(copy);
      return withCounts(s, copy);
    }
    if (c === 'slots') return slotsOf(s, t, str(q.from) || undefined, str(q.to) || undefined);
    throw notFound();
  }

  // ---- staff: appointments ----------------------------------------------------------------------------------------
  if (
    (a === 'appointments' || (a === 'contacts' && c === 'appointments')) &&
    !(a === 'contacts' && !b)
  ) {
    const contactId = a === 'contacts' ? b : undefined;
    const id = a === 'appointments' ? b : undefined;
    if (!id || id === 'counts') {
      const mine = s.appts.filter((x) => (contactId ? x.contact?.id === contactId : true));
      if (id === 'counts') {
        const base = mine.filter((x) => matchesQuery(x, q));
        const now = Date.now();
        return {
          upcoming: base.filter((x) => Date.parse(x.startsAt) >= now && isOpen(x.status)).length,
          past: base.filter((x) => Date.parse(x.startsAt) < now).length,
        };
      }
      const now = Date.now();
      let rows = mine.filter((x) => matchesQuery(x, q));
      const status = str(q.status);
      if (str(q.from)) {
        const from = Date.parse(str(q.from));
        const to = Date.parse(str(q.to));
        const set = new Set(status.split(',').filter(Boolean));
        rows = rows.filter(
          (x) =>
            Date.parse(x.startsAt) < to &&
            Date.parse(x.endsAt) > from &&
            (set.size === 0 || set.has(x.status)),
        );
        rows.sort((x, y) => Date.parse(x.startsAt) - Date.parse(y.startsAt));
        return {
          data: rows.map((x) => fresh(x, s)),
          page: { nextCursor: null, hasMore: false, limit: rows.length },
        };
      }
      if (q.tab === 'past') {
        rows = rows.filter((x) => Date.parse(x.startsAt) < now && (!status || x.status === status));
        rows.sort((x, y) => Date.parse(y.startsAt) - Date.parse(x.startsAt));
      } else {
        rows = rows.filter(
          (x) => Date.parse(x.startsAt) >= now && (status ? x.status === status : isOpen(x.status)),
        );
        rows.sort((x, y) => Date.parse(x.startsAt) - Date.parse(y.startsAt));
      }
      const res = page(rows, q);
      return { ...res, data: res.data.map((x) => fresh(x, s)) };
    }
    const appt = apptOf(s, id);
    if (!c) {
      if (method === 'PATCH') {
        if (body.rowVersion !== undefined && body.rowVersion !== appt.rowVersion)
          throw problem(409, 'ROW_VERSION_CONFLICT', 'Changed elsewhere');
        appt.notes =
          typeof body.notes === 'string' && body.notes.trim()
            ? body.notes.trim().slice(0, 2000)
            : null;
        touch(appt);
      }
      return fresh(appt, s);
    }
    if (method !== 'POST') throw problem(405, 'METHOD_NOT_ALLOWED', 'No');
    if (c === 'confirm') {
      if (appt.status !== 'pending') throw problem(409, 'CONFLICT', 'Not pending');
      setStatus(appt, 'confirmed');
    } else if (c === 'decline') {
      if (appt.status !== 'pending') throw problem(409, 'APPT_INVALID_TRANSITION', 'Not pending');
      setStatus(appt, 'declined');
    } else if (c === 'cancel') {
      if (!isOpen(appt.status)) throw problem(410, 'GONE', 'Gone');
      setStatus(appt, 'cancelled');
    } else if (c === 'complete') {
      if (appt.status !== 'confirmed') throw problem(409, 'CONFLICT', 'Not confirmed');
      setStatus(appt, 'completed');
    } else if (c === 'no-show') {
      if (appt.status !== 'confirmed') throw problem(409, 'CONFLICT', 'Not confirmed');
      setStatus(appt, 'no_show');
    } else if (c === 'reschedule') {
      if (!isOpen(appt.status)) throw problem(410, 'GONE', 'Gone');
      moveTo(s, appt, str(body.startsAt));
    } else throw notFound();
    return fresh(appt, s);
  }
  throw notFound();
}

/** Moves a booking to a new start, refusing a time that is not on offer (a 409, like a taken slot). */
function moveTo(s: State, appt: Appointment, startsAt: string): void {
  const start = Date.parse(startsAt);
  if (Number.isNaN(start)) throw problem(422, 'VALIDATION_FAILED', 'Bad time');
  const type = typeOf(s, appt.bookingType?.id ?? '');
  const day = dayKeyOf(start, type.timezone ?? mockState.org.timezone);
  const range = slotsOf(
    s,
    type,
    new Date(start - DAY).toISOString(),
    new Date(Date.parse(`${addDays(day, 2)}T00:00:00Z`) + DAY).toISOString(),
    appt.id,
  );
  const hit = range.slots.find((x) => Date.parse(x.start) === start);
  if (!hit) throw problem(409, 'APPT_SLOT_TAKEN', 'That time was just taken');
  appt.startsAt = hit.start;
  appt.endsAt = hit.end;
  if (appt.status === 'pending' && !type.requiresApproval) appt.status = 'confirmed';
  touch(appt);
}

function book(
  s: State,
  t: BookingType,
  org: { name: string; slug: string },
  body: Record<string, unknown>,
) {
  const start = Date.parse(str(body.startsAt));
  const name = str(body.name).trim();
  const email = str(body.email).trim();
  if (Number.isNaN(start) || !name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'Invalid', undefined, [
      ...(name ? [] : [{ path: 'name', message: 'required' }]),
      ...(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? [] : [{ path: 'email', message: 'invalid' }]),
    ]);
  }
  const slots = slotsOf(
    s,
    t,
    new Date(start - HOUR).toISOString(),
    new Date(start + HOUR).toISOString(),
  );
  const hit = slots.slots.find((x) => Date.parse(x.start) === start);
  if (!hit) throw problem(409, 'APPT_SLOT_TAKEN', 'That time was just taken');
  const id = uid();
  const tok = token();
  s.tokens[tok] = id;
  const answers = Array.isArray(body.answers)
    ? (body.answers as Array<{ label: string; answer: string }>)
    : [];
  const now = new Date().toISOString();
  const a: Appointment = {
    id,
    rowVersion: 1,
    status: t.requiresApproval ? 'pending' : 'confirmed',
    title: `${t.name} — ${name}`,
    startsAt: hit.start,
    endsAt: hit.end,
    timezone: t.timezone ?? mockState.org.timezone,
    inviteeTimezone: str(body.inviteeTimezone) || null,
    bookingType: { id: t.id, name: t.name, color: t.color, durationMinutes: t.durationMinutes },
    contact: null,
    customer: { name, phone: str(body.phone) || null, email },
    location: t.locationValue,
    meetUrl: t.locationType === 'virtual' ? `https://meet.example.test/${tok.slice(0, 10)}` : null,
    answers,
    notes: null,
    source: 'link',
    paymentStatus: t.price.feeMinor > 0 ? 'pending' : 'none',
    depositPaidMinor: 0,
    currency: t.price.feeMinor > 0 ? t.price.currency : null,
    manageUrl: `${origin()}/b/manage/${tok}`,
    checkedInAt: null,
    createdAt: now,
    updatedAt: now,
  };
  s.appts.push(a);
  return { org, booking: publicBooking(s, a) };
}
