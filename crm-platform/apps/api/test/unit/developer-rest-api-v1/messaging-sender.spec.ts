import { describe, expect, it } from 'vitest';
import {
  parseDeviceId,
  resolveSender,
  type OtherChannel,
  type SenderCandidate,
} from '../../../src/modules/developer-rest-api-v1/resources/messaging/sender-resolution';

let seq = 0;
const device = (over: Partial<SenderCandidate> = {}): SenderCandidate => {
  const n = ++seq;
  return {
    id: `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    source: 'device',
    provider: 'baileys',
    channelUuid: `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    channelKind: 'whatsapp_qr',
    channelConnected: true,
    deviceStatus: 'connected',
    active: true,
    recency: n,
    isPrimary: false,
    connectedAt: null,
    ...over,
  };
};
const config = (over: Partial<SenderCandidate> = {}): SenderCandidate => {
  const n = ++seq;
  return {
    id: `f0000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    source: 'config',
    provider: 'waba',
    channelUuid: `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    channelKind: 'whatsapp_cloud',
    channelConnected: true,
    deviceStatus: null,
    active: true,
    recency: n,
    isPrimary: false,
    connectedAt: new Date(2026, 0, n),
    ...over,
  };
};
const channelOf = (c: SenderChoice) => (c.outcome === 'channel' ? c.channelUuid : c.outcome);
type SenderChoice = ReturnType<typeof resolveSender>;

describe('single-send sender resolution (TW-API-118)', () => {
  it('parses the id forms Reference took: cfg_<id>, cfg-<id>, cfg<id>, <engine>:<id>, bare', () => {
    expect(parseDeviceId('cfg_20')).toEqual({ engine: 'cfg', id: '20' });
    expect(parseDeviceId('CFG-20')).toEqual({ engine: 'cfg', id: '20' });
    expect(parseDeviceId('cfg20')).toEqual({ engine: 'cfg', id: '20' });
    expect(parseDeviceId('waba:20')).toEqual({ engine: 'waba', id: '20' });
    expect(parseDeviceId('baileys:57')).toEqual({ engine: 'baileys', id: '57' });
    expect(parseDeviceId('57')).toEqual({ engine: null, id: '57' });
  });

  it('with nothing explicit, prefers the newest connected unofficial number over a connection', () => {
    const older = device();
    const newer = device();
    const cloud = config({ isPrimary: true });
    expect(channelOf(resolveSender([older, newer, cloud], [], null))).toBe(newer.channelUuid);
  });

  it('puts active unofficial numbers ahead of inactive ones, whatever their age', () => {
    const active = device({ active: true });
    const newerInactive = device({ active: false });
    expect(channelOf(resolveSender([active, newerInactive], [], null))).toBe(active.channelUuid);
  });

  it('falls to the primary connection, then any connected one, when no unofficial number is connected', () => {
    const offline = device({ deviceStatus: 'disconnected', channelConnected: false });
    const primary = config({ isPrimary: true, channelConnected: false });
    const connected = config({ channelConnected: true });
    expect(channelOf(resolveSender([offline, connected, primary], [], null))).toBe(
      primary.channelUuid,
    );
    expect(channelOf(resolveSender([offline, connected], [], null))).toBe(connected.channelUuid);
  });

  it('uses a disconnected unofficial number only as the last resort, and answers none when there is nothing', () => {
    const offline = device({ deviceStatus: 'disconnected', channelConnected: false });
    expect(channelOf(resolveSender([offline], [], null))).toBe(offline.channelUuid);
    expect(resolveSender([], [], null)).toEqual({ outcome: 'none' });
    // a number that never got a channel cannot send
    expect(resolveSender([device({ channelUuid: null, channelKind: null })], [], null)).toEqual({
      outcome: 'none',
    });
  });

  it('an explicit pick stays the pick even when it is disconnected', () => {
    const offline = device({ deviceStatus: 'disconnected', channelConnected: false });
    const connected = device();
    expect(channelOf(resolveSender([offline, connected], [], offline.id))).toBe(
      offline.channelUuid,
    );
    expect(channelOf(resolveSender([offline, connected], [], `baileys:${offline.id}`))).toBe(
      offline.channelUuid,
    );
  });

  it('a connection is picked by cfg_<uuid> or <engine>:<uuid>, and the engine prefix must agree with the kind of number', () => {
    const d = device();
    const c = config();
    expect(channelOf(resolveSender([d, c], [], `cfg_${c.id}`))).toBe(c.channelUuid);
    expect(channelOf(resolveSender([d, c], [], `waba:${c.id}`))).toBe(c.channelUuid);
    expect(channelOf(resolveSender([d, c], [], `whatsapp_cloud:${c.id}`))).toBe(c.channelUuid);
    // `baileys:<a connection's id>` names nothing: the send falls through to the default sender
    expect(channelOf(resolveSender([d, c], [], `baileys:${c.id}`))).toBe(d.channelUuid);
  });

  it('an id that names nothing, or that belongs to another workspace, falls through to the default sender', () => {
    const d = device();
    expect(channelOf(resolveSender([d], [], '00000000-0000-4000-8000-00000000dead'))).toBe(
      d.channelUuid,
    );
    expect(channelOf(resolveSender([d], [], 'x'.repeat(40)))).toBe(d.channelUuid);
  });

  it('a connected channel of another kind, picked by its key, is wrong_channel; a disconnected one falls through', () => {
    const d = device();
    const telegram: OtherChannel = {
      uuid: 'a0000000-0000-4000-8000-000000000001',
      kind: 'telegram',
      connected: true,
    };
    const offlineLine: OtherChannel = {
      uuid: 'a0000000-0000-4000-8000-000000000002',
      kind: 'instagram',
      connected: false,
    };
    expect(resolveSender([d], [telegram, offlineLine], `telegram:${telegram.uuid}`)).toEqual({
      outcome: 'wrong_channel',
    });
    expect(
      channelOf(resolveSender([d], [telegram, offlineLine], `instagram:${offlineLine.uuid}`)),
    ).toBe(d.channelUuid);
  });

  it('a number that exists but has no channel yet is reported, not silently replaced', () => {
    const unlinked = device({ channelUuid: null, channelKind: null });
    expect(resolveSender([unlinked, device()], [], unlinked.id)).toEqual({ outcome: 'unlinked' });
  });

  it('the development simulator carries a send when nothing else can', () => {
    const sim: OtherChannel = {
      uuid: 'b0000000-0000-4000-8000-000000000001',
      kind: 'simulator',
      connected: true,
    };
    expect(resolveSender([], [sim], null)).toEqual({
      outcome: 'channel',
      channelUuid: sim.uuid,
      kind: 'simulator',
    });
  });
});
