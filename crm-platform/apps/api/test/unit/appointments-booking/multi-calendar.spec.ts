import { describe, expect, it, vi } from 'vitest';
import type {
  CalendarBusyInterval,
  CalendarEventRequest,
  CalendarSyncPort,
} from '../../../src/infra/providers/appointments-booking';
import { eventProviderOf } from '../../../src/infra/providers/appointments-booking';
import { CalendarProviders } from '../../../src/modules/appointments-booking/calendar-providers.service';
import { MultiCalendarAdapter } from '../../../src/modules/appointments-booking/multi-calendar.adapter';

/** Which calendar a booking's event goes to, and how busy time is joined (BL-035). */
const at = (iso: string): Date => new Date(iso);
const block = (from: string, to: string): CalendarBusyInterval => ({
  start: at(from),
  end: at(to),
});

function fakeProvider(name: string, over: Partial<Record<string, unknown>> = {}) {
  const state = { connected: true, busy: [] as CalendarBusyInterval[], fail: false, ...over };
  const port = {
    provider: name,
    forget: vi.fn(),
    status: vi.fn(async () => ({
      connected: state.connected,
      account: state.connected ? `${name}@example.com` : null,
    })),
    freeBusy: vi.fn(async (..._args: unknown[]) => {
      if (state.fail) throw new Error(`${name} is down`);
      return state.busy;
    }),
    upsertEvent: vi.fn(async () => ({
      eventId: `${name}-1`,
      calendarId: null,
      meetUrl: null,
      provider: name,
    })),
    deleteEvent: vi.fn(async () => undefined),
    readEvent: vi.fn(async () => ({ kind: 'missing' as const })),
    calendarExists: vi.fn(async () => true),
  };
  return {
    port: port as unknown as CalendarSyncPort & { forget(orgId: number): void },
    state,
    spy: port,
  };
}

function setup(preference: 'google' | 'microsoft' | null = null) {
  const g = fakeProvider('google');
  const m = fakeProvider('microsoft');
  const db = { txAs: vi.fn(async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn({})) };
  const providers = new CalendarProviders(db as never, g.port as never, m.port as never);
  vi.spyOn(providers, 'readPreference').mockResolvedValue(preference);
  const ics = { busy: vi.fn(async () => [] as CalendarBusyInterval[]), fail: false };
  const source = {
    busy: async (...a: unknown[]) =>
      ics.fail ? Promise.reject(new Error('feeds are down')) : ics.busy(...(a as [])),
  };
  return { g, m, providers, ics, multi: new MultiCalendarAdapter(providers, source as never) };
}

const REQUEST = { orgId: 1, appointmentId: 'a' } as CalendarEventRequest;

describe('which provider receives a booking', () => {
  it('Google when it is usable, so a workspace that only ever had Google behaves as before', async () => {
    const { providers } = setup();
    expect(await providers.writeProvider(1)).toBe('google');
  });

  it('Microsoft when Google is not usable', async () => {
    const { providers, g } = setup();
    g.state.connected = false;
    expect(await providers.writeProvider(1)).toBe('microsoft');
  });

  it("an admin's choice wins while that provider is usable, and falls back when it is not", async () => {
    const { providers, m } = setup('microsoft');
    expect(await providers.writeProvider(1)).toBe('microsoft');
    m.state.connected = false;
    expect(await providers.writeProvider(1)).toBe('google');
  });

  it('nothing when nothing is usable', async () => {
    const { providers, g, m } = setup();
    g.state.connected = false;
    m.state.connected = false;
    expect(await providers.writeProvider(1)).toBeNull();
  });
});

describe('the multi-provider calendar port', () => {
  it('writes an event to the chosen provider only', async () => {
    const { multi, g, m } = setup('microsoft');
    const out = await multi.upsertEvent(REQUEST);
    expect(out?.provider).toBe('microsoft');
    expect(m.spy.upsertEvent).toHaveBeenCalledTimes(1);
    expect(g.spy.upsertEvent).not.toHaveBeenCalled();
    expect(await multi.writeTarget(1)).toBe('microsoft');
  });

  it('writes nothing, and says so, when no provider is usable', async () => {
    const { multi, g, m } = setup();
    g.state.connected = false;
    m.state.connected = false;
    expect(await multi.upsertEvent(REQUEST)).toBeNull();
    expect(await multi.status(1)).toEqual({ connected: false, account: null });
  });

  it('busy time is the union of every connected calendar', async () => {
    const { multi, g, m } = setup();
    g.state.busy = [block('2026-10-05T09:00:00Z', '2026-10-05T10:00:00Z')];
    m.state.busy = [block('2026-10-05T11:00:00Z', '2026-10-05T12:00:00Z')];
    const busy = await multi.freeBusy(
      1,
      null,
      at('2026-10-05T00:00:00Z'),
      at('2026-10-06T00:00:00Z'),
    );
    expect(busy.map((b) => b.start.toISOString())).toEqual([
      '2026-10-05T09:00:00.000Z',
      '2026-10-05T11:00:00.000Z',
    ]);
  });

  it('a calendar id a booking type names goes to the provider bookings are written to, not to the other', async () => {
    const { multi, g, m } = setup();
    await multi.freeBusy(
      1,
      'team@example.com',
      at('2026-10-05T00:00:00Z'),
      at('2026-10-06T00:00:00Z'),
    );
    expect((g.spy.freeBusy.mock.calls[0] as unknown[])[1]).toBe('team@example.com');
    expect((m.spy.freeBusy.mock.calls[0] as unknown[])[1]).toBeNull();
  });

  it("one calendar failing leaves the other's busy time; all failing throws, so the caller offers slots without calendar data", async () => {
    const { multi, g, m, ics } = setup();
    g.state.fail = true;
    m.state.busy = [block('2026-10-05T11:00:00Z', '2026-10-05T12:00:00Z')];
    const partial = await multi.freeBusy(
      1,
      null,
      at('2026-10-05T00:00:00Z'),
      at('2026-10-06T00:00:00Z'),
    );
    expect(partial).toHaveLength(1);
    m.state.fail = true;
    ics.fail = true;
    await expect(
      multi.freeBusy(1, null, at('2026-10-05T00:00:00Z'), at('2026-10-06T00:00:00Z')),
    ).rejects.toThrow(/is down/);
  });

  it('iCal feeds are one more source: they close slots with no calendar connected, and a failing feed leaves the others', async () => {
    const { multi, g, m, ics } = setup();
    g.state.connected = false;
    m.state.connected = false;
    ics.busy.mockResolvedValueOnce([block('2026-10-05T09:00:00Z', '2026-10-05T10:00:00Z')]);
    expect(
      await multi.freeBusy(1, null, at('2026-10-05T00:00:00Z'), at('2026-10-06T00:00:00Z')),
    ).toHaveLength(1);
    // Everything failing (the feed too) is the only case that throws.
    g.state.connected = true;
    m.state.connected = true;
    m.state.busy = [block('2026-10-05T11:00:00Z', '2026-10-05T12:00:00Z')];
    ics.fail = true;
    g.state.fail = true;
    expect(
      await multi.freeBusy(1, null, at('2026-10-05T00:00:00Z'), at('2026-10-06T00:00:00Z')),
    ).toHaveLength(1);
  });

  it('nothing connected means nothing busy, without asking any calendar', async () => {
    const { multi, g, m } = setup();
    g.state.connected = false;
    m.state.connected = false;
    expect(
      await multi.freeBusy(1, null, at('2026-10-05T00:00:00Z'), at('2026-10-06T00:00:00Z')),
    ).toEqual([]);
    expect(g.spy.freeBusy).not.toHaveBeenCalled();
    expect(m.spy.freeBusy).not.toHaveBeenCalled();
  });

  it('reads, deletes and checks calendars at the provider that holds the event', async () => {
    const { multi, g, m } = setup('microsoft');
    await multi.deleteEvent(1, null, 'e1', 'google');
    await multi.readEvent(1, null, 'e1', 'google');
    await multi.calendarExists(1, null, 'google');
    expect(g.spy.deleteEvent).toHaveBeenCalledTimes(1);
    expect(g.spy.readEvent).toHaveBeenCalledTimes(1);
    expect(g.spy.calendarExists).toHaveBeenCalledTimes(1);
    expect(m.spy.deleteEvent).not.toHaveBeenCalled();
    // With no provider named, the one bookings go to now.
    await multi.deleteEvent(1, null, 'e2');
    expect(m.spy.deleteEvent).toHaveBeenCalledTimes(1);
  });
});

describe('eventProviderOf', () => {
  it('an event with no provider recorded was written to Google', () => {
    expect(eventProviderOf(null)).toBe('google');
    expect(eventProviderOf(undefined)).toBe('google');
    expect(eventProviderOf('google')).toBe('google');
    expect(eventProviderOf('microsoft')).toBe('microsoft');
    expect(eventProviderOf('carrier-pigeon')).toBe('google');
  });
});
