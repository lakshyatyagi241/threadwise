import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REALTIME_EVENT } from '@crm/contracts';
import { fakeSocketFactory } from '@/lib/realtime/fake-socket';
import { RealtimeClient } from '@/lib/realtime/realtime-client';
import { GROUP_KEYS } from '../api/groups-hooks';
import { GROUPS_LIVE_DEBOUNCE_MS, subscribeGroupsLive } from './use-groups-live';

const DEVICE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const GROUP = '33333333-3333-4333-8333-333333333333';
const GROUP2 = '44444444-4444-4444-8444-444444444444';

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

const seed = (qc: QueryClient, device: string) => {
  qc.setQueryData(GROUP_KEYS.list(device, { status: 'all' }), { pages: [], pageParams: [] });
  qc.setQueryData(GROUP_KEYS.state(device), { connected: true });
  qc.setQueryData(GROUP_KEYS.members(GROUP), { pages: [], pageParams: [] });
  qc.setQueryData(GROUP_KEYS.requests(GROUP), { requests: [] });
  qc.setQueryData(GROUP_KEYS.invite(GROUP), { code: 'x', url: 'https://chat.whatsapp.com/x' });
  qc.setQueryData(GROUP_KEYS.members(GROUP2), { pages: [], pageParams: [] });
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
  socket().push({ type: REALTIME_EVENT.deviceGroupChanged, room: 'user', seq, payload });

describe('the Groups tab follows whatsapp.device_group.changed', () => {
  it('refetches the list and the limits of the number after a hint, and leaves the open lists of other groups and the invite link alone', async () => {
    const qc = new QueryClient();
    seed(qc, DEVICE);
    const { client, socket } = await connected();
    subscribeGroupsLive(client, qc, DEVICE);
    push(socket, { groupId: GROUP, deviceId: DEVICE, kind: 'updated' });
    expect(stale(qc, GROUP_KEYS.lists(DEVICE))).toBe(false);
    await vi.advanceTimersByTimeAsync(GROUPS_LIVE_DEBOUNCE_MS);
    expect(stale(qc, GROUP_KEYS.list(DEVICE, { status: 'all' }))).toBe(true);
    expect(stale(qc, GROUP_KEYS.state(DEVICE))).toBe(true);
    expect(stale(qc, GROUP_KEYS.members(GROUP))).toBe(false);
    expect(stale(qc, GROUP_KEYS.requests(GROUP))).toBe(false);
    // The invite link is a secret read when its panel opens: a hint never re-reads it.
    expect(stale(qc, GROUP_KEYS.invite(GROUP))).toBe(false);
  });

  it("a join request also refreshes that group's queue; new members or leaving refresh its member list", async () => {
    const qc = new QueryClient();
    seed(qc, DEVICE);
    const { client, socket } = await connected();
    subscribeGroupsLive(client, qc, DEVICE);
    push(socket, { groupId: GROUP, deviceId: DEVICE, kind: 'join_request' });
    await vi.advanceTimersByTimeAsync(GROUPS_LIVE_DEBOUNCE_MS);
    expect(stale(qc, GROUP_KEYS.requests(GROUP))).toBe(true);
    expect(stale(qc, GROUP_KEYS.members(GROUP))).toBe(false);
    push(socket, { groupId: GROUP, deviceId: DEVICE, kind: 'participants_changed' }, 2);
    await vi.advanceTimersByTimeAsync(GROUPS_LIVE_DEBOUNCE_MS);
    expect(stale(qc, GROUP_KEYS.members(GROUP))).toBe(true);
    expect(stale(qc, GROUP_KEYS.members(GROUP2))).toBe(false);
  });

  it('turns a burst of ten hints into one refetch', async () => {
    const qc = new QueryClient();
    seed(qc, DEVICE);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { client, socket } = await connected();
    subscribeGroupsLive(client, qc, DEVICE);
    for (let i = 0; i < 10; i++) {
      push(socket, { groupId: GROUP, deviceId: DEVICE, kind: 'join_request' }, i + 1);
    }
    await vi.advanceTimersByTimeAsync(GROUPS_LIVE_DEBOUNCE_MS * 3);
    const lists = spy.mock.calls.filter(
      (c) => JSON.stringify(c[0]?.queryKey) === JSON.stringify(GROUP_KEYS.lists(DEVICE)),
    );
    expect(lists).toHaveLength(1);
  });

  it("refetches the number the hint names, not the one on screen, and ignores another number's rows", async () => {
    const qc = new QueryClient();
    seed(qc, DEVICE);
    seed(qc, OTHER);
    const { client, socket } = await connected();
    subscribeGroupsLive(client, qc, DEVICE);
    push(socket, { groupId: GROUP, deviceId: OTHER, kind: 'created' });
    await vi.advanceTimersByTimeAsync(GROUPS_LIVE_DEBOUNCE_MS);
    expect(stale(qc, GROUP_KEYS.list(OTHER, { status: 'all' }))).toBe(true);
    expect(stale(qc, GROUP_KEYS.list(DEVICE, { status: 'all' }))).toBe(false);
  });

  it('a payload this build does not understand still refreshes the number on screen', async () => {
    const qc = new QueryClient();
    seed(qc, DEVICE);
    const { client, socket } = await connected();
    subscribeGroupsLive(client, qc, DEVICE);
    push(socket, { something: 'new' });
    await vi.advanceTimersByTimeAsync(GROUPS_LIVE_DEBOUNCE_MS);
    expect(stale(qc, GROUP_KEYS.list(DEVICE, { status: 'all' }))).toBe(true);
  });

  it('stops after unsubscribing', async () => {
    const qc = new QueryClient();
    seed(qc, DEVICE);
    const { client, socket } = await connected();
    const off = subscribeGroupsLive(client, qc, DEVICE);
    off();
    push(socket, { groupId: GROUP, deviceId: DEVICE, kind: 'updated' });
    await vi.advanceTimersByTimeAsync(GROUPS_LIVE_DEBOUNCE_MS * 2);
    expect(stale(qc, GROUP_KEYS.list(DEVICE, { status: 'all' }))).toBe(false);
  });
});
