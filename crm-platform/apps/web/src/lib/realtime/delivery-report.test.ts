import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REALTIME_CLIENT_EVENTS,
  REALTIME_DELIVERY_REPORT_MS,
  REALTIME_EVENT,
} from '@crm/contracts';
import { startDeliveryReport } from './delivery-report';
import { fakeSocketFactory } from './fake-socket';
import { RealtimeClient } from './realtime-client';

const flush = () => vi.advanceTimersByTimeAsync(0);
const SERVER_NOW = new Date('2026-10-18T12:00:00.000Z');
let seq = 0;
/** The server publishes an event to the org room at `at`; the tab receives it now. */
const DUP = '55555555-5555-4555-8555-555555555555';
const event = (at: Date, name: string) => ({
  type: REALTIME_EVENT.messageStatus,
  room: 'org' as const,
  seq: ++seq,
  id: name === 'dup' ? DUP : crypto.randomUUID(),
  at: at.toISOString(),
});

async function connected(serverClockSkewMs = 0) {
  const { factory, last } = fakeSocketFactory();
  const client = new RealtimeClient({
    url: 'http://api.test/realtime',
    mintTicket: async () => 'rtk_t',
    createSocket: factory,
  });
  client.start();
  await flush();
  last().accept();
  // The server's clock reads SERVER_NOW at the moment the tab's reads SERVER_NOW - skew.
  vi.setSystemTime(new Date(SERVER_NOW.getTime() - serverClockSkewMs));
  last().serverEmit('rt.ready', { v: 1, rooms: [], serverTime: SERVER_NOW.toISOString() });
  return { client, socket: last() };
}
const reports = (socket: { emitted: Array<{ event: string; args: unknown[] }> }) =>
  socket.emitted
    .filter((e) => e.event === REALTIME_CLIENT_EVENTS.deliveryLag)
    .map((e) => e.args[0]);

beforeEach(() => {
  seq = 0;
  vi.useFakeTimers();
  vi.setSystemTime(SERVER_NOW);
});
afterEach(() => vi.useRealTimers());

describe('delivery lag (EL-B23)', () => {
  it('reports the worst age of an event on arrival, and how many events that covers', async () => {
    const { client, socket } = await connected();
    socket.push(event(new Date(SERVER_NOW.getTime() - 120), 'a'));
    socket.push(event(new Date(SERVER_NOW.getTime() - 800), 'b'));
    socket.push(event(new Date(SERVER_NOW.getTime() - 30), 'c'));
    client.reportDelivery();
    expect(reports(socket)).toEqual([{ lagMs: 800, events: 3 }]);
  });

  it('measures against the server clock: a tab clock that is minutes off does not show as lag', async () => {
    const { client, socket } = await connected(5 * 60_000); // this tab runs 5 minutes behind the server
    // An event published 200 ms ago by the server's clock arrives now.
    const serverNow = Date.now() + 5 * 60_000;
    socket.push(event(new Date(serverNow - 200), 'a'));
    client.reportDelivery();
    expect(reports(socket)).toEqual([{ lagMs: 200, events: 1 }]);
  });

  it('counts an event stamped in the future as zero lag, not negative', async () => {
    const { client, socket } = await connected();
    socket.push(event(new Date(SERVER_NOW.getTime() + 5_000), 'a'));
    client.reportDelivery();
    expect(reports(socket)).toEqual([{ lagMs: 0, events: 1 }]);
  });

  it('sends nothing when no event arrived, and starts a fresh interval after a report', async () => {
    const { client, socket } = await connected();
    client.reportDelivery();
    expect(reports(socket)).toEqual([]);
    socket.push(event(new Date(SERVER_NOW.getTime() - 500), 'a'));
    client.reportDelivery();
    client.reportDelivery();
    socket.push(event(new Date(SERVER_NOW.getTime() - 40), 'b'));
    client.reportDelivery();
    expect(reports(socket)).toEqual([
      { lagMs: 500, events: 1 },
      { lagMs: 40, events: 1 },
    ]);
  });

  it('does not count an event delivered twice, and sends nothing while disconnected', async () => {
    const { client, socket } = await connected();
    const e = event(new Date(SERVER_NOW.getTime() - 100), 'dup');
    socket.push(e);
    socket.push(e);
    client.reportDelivery();
    expect(reports(socket)).toEqual([{ lagMs: 100, events: 1 }]);
    socket.push(event(new Date(SERVER_NOW.getTime() - 100), 'later'));
    socket.drop();
    client.reportDelivery();
    expect(reports(socket)).toHaveLength(1);
  });
});

describe('startDeliveryReport', () => {
  it('reports on the interval and stops when told', () => {
    let tick: (() => void) | undefined;
    let cleared = false;
    let every = 0;
    const sent: number[] = [];
    const stop = startDeliveryReport(
      { reportDelivery: () => void sent.push(1) },
      {
        setInterval: (fn, ms) => {
          tick = fn;
          every = ms;
          return 1;
        },
        clearInterval: () => {
          cleared = true;
        },
      },
    );
    expect(every).toBe(REALTIME_DELIVERY_REPORT_MS);
    tick?.();
    tick?.();
    expect(sent).toHaveLength(2);
    stop();
    expect(cleared).toBe(true);
  });
});
