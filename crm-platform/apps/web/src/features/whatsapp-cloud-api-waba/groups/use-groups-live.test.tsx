import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REALTIME_EVENT } from '@crm/contracts';
import { fakeSocketFactory } from '@/lib/realtime/fake-socket';
import { RealtimeClient } from '@/lib/realtime/realtime-client';
import { GROUP_KEYS } from '../api/groups-hooks';
import { GROUPS_LIVE_DEBOUNCE_MS, subscribeGroupsLive } from './use-groups-live';

const NUMBER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const GROUP = '33333333-3333-4333-8333-333333333333';

let tickets = 0;
async function connected() {
  const { factory, last } = fakeSocketFactory();
  const client = new RealtimeClient({
    url: 'http://api.test/realtime',
    mintTicket: async () => `rtk_${++tickets}`,
    createSocket: factory,
  });
  client.start();
  await vi.advanceTimersByTimeAsync(0);
  last().accept();
  last().serverEmit('rt.ready', {
    v: 1,
    rooms: [
      { room: 'org', seq: 0 },
      { room: 'user', seq: 0 },
    ],
    serverTime: new Date(0).toISOString(),
  });
  return { client, socket: last };
}

const seed = (qc: QueryClient, number: string) => {
  qc.setQueryData(GROUP_KEYS.list(number), { pages: [], pageParams: [] });
  qc.setQueryData(GROUP_KEYS.state(number), { reason: null });
  qc.setQueryData(GROUP_KEYS.members(number, GROUP), { items: [] });
};
const stale = (qc: QueryClient, key: readonly unknown[]) =>
  qc.getQueryState(key)?.isInvalidated === true;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const push = (socket: ReturnType<typeof fakeSocketFactory>['last'], payload: unknown, seq = 1) =>
  socket().push({ type: REALTIME_EVENT.wabaGroupChanged, room: 'user', seq, payload });

describe('the Groups screen follows whatsapp.group.changed (BL-099)', () => {
  it('refetches the list of the number after a hint, and leaves the eligibility check and the member list alone', async () => {
    const qc = new QueryClient();
    seed(qc, NUMBER);
    const { client, socket } = await connected();
    subscribeGroupsLive(client, qc, NUMBER);
    push(socket, { groupId: GROUP, connectionId: NUMBER, kind: 'join_request' });
    expect(stale(qc, GROUP_KEYS.list(NUMBER))).toBe(false);
    await vi.advanceTimersByTimeAsync(GROUPS_LIVE_DEBOUNCE_MS);
    expect(stale(qc, GROUP_KEYS.list(NUMBER))).toBe(true);
    expect(stale(qc, GROUP_KEYS.state(NUMBER))).toBe(false);
    expect(stale(qc, GROUP_KEYS.members(NUMBER, GROUP))).toBe(false);
  });

  it('turns a burst of ten hints into one refetch', async () => {
    const qc = new QueryClient();
    seed(qc, NUMBER);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { client, socket } = await connected();
    subscribeGroupsLive(client, qc, NUMBER);
    for (let i = 0; i < 10; i += 1) {
      push(socket, { groupId: GROUP, connectionId: NUMBER, kind: 'join_request' }, i + 1);
    }
    await vi.advanceTimersByTimeAsync(GROUPS_LIVE_DEBOUNCE_MS * 3);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('marks the list of another number stale too, so it is fresh when the person switches to it', async () => {
    const qc = new QueryClient();
    seed(qc, NUMBER);
    seed(qc, OTHER);
    const { client, socket } = await connected();
    subscribeGroupsLive(client, qc, NUMBER);
    push(socket, { groupId: GROUP, connectionId: OTHER, kind: 'created' });
    await vi.advanceTimersByTimeAsync(GROUPS_LIVE_DEBOUNCE_MS);
    expect(stale(qc, GROUP_KEYS.list(OTHER))).toBe(true);
    expect(stale(qc, GROUP_KEYS.list(NUMBER))).toBe(false);
  });

  it('refetches the number on show rather than trusting a payload that does not match the contract', async () => {
    const qc = new QueryClient();
    seed(qc, NUMBER);
    const { client, socket } = await connected();
    subscribeGroupsLive(client, qc, NUMBER);
    push(socket, { kind: 'whatever' });
    await vi.advanceTimersByTimeAsync(GROUPS_LIVE_DEBOUNCE_MS);
    expect(stale(qc, GROUP_KEYS.list(NUMBER))).toBe(true);
  });

  it('refetches after a sequence gap on the person room, and ignores other rooms', async () => {
    const qc = new QueryClient();
    seed(qc, NUMBER);
    const { client, socket } = await connected();
    subscribeGroupsLive(client, qc, NUMBER);
    // A gap on the workspace room is not the business of this screen.
    socket().push({ type: 'inbox.unread', room: 'org', seq: 5, payload: {} });
    await vi.advanceTimersByTimeAsync(GROUPS_LIVE_DEBOUNCE_MS);
    expect(stale(qc, GROUP_KEYS.list(NUMBER))).toBe(false);
    // The room of the person skipped from 0 to 7.
    socket().push({ type: 'inbox.unread', room: 'user', seq: 7, payload: {} });
    await vi.advanceTimersByTimeAsync(GROUPS_LIVE_DEBOUNCE_MS);
    expect(stale(qc, GROUP_KEYS.list(NUMBER))).toBe(true);
  });

  it('stops on unsubscribe: no timer fires and later hints do nothing', async () => {
    const qc = new QueryClient();
    seed(qc, NUMBER);
    const { client, socket } = await connected();
    const off = subscribeGroupsLive(client, qc, NUMBER);
    push(socket, { groupId: GROUP, connectionId: NUMBER, kind: 'updated' });
    off();
    push(socket, { groupId: GROUP, connectionId: NUMBER, kind: 'updated' }, 2);
    await vi.advanceTimersByTimeAsync(GROUPS_LIVE_DEBOUNCE_MS * 3);
    expect(stale(qc, GROUP_KEYS.list(NUMBER))).toBe(false);
  });
});
