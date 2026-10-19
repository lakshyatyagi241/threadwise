import {
  getRuntimeMonitor,
  releaseFromEnv,
  startRuntimeMonitorWith,
  stopRuntimeMonitor,
} from '@crm/observability';
import { REALTIME_EVENT } from '@crm/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RealtimeEmitter } from '../../../src/realtime/realtime-emitter.service';
import { acceptDeliveryReport, realtimeMetrics } from '../../../src/realtime/realtime-metrics';
import { FakeRedis } from './fake-redis';

// EL-B18: what the realtime path exports, and what carries the release label. The monitor is the real one; the assertions read the same
// text a Prometheus scrape would.
const CONV = '33333333-3333-4333-8333-333333333333';
const text = () => getRuntimeMonitor()!.render();
const line = (re: RegExp) =>
  text()
    .split('\n')
    .find((l) => re.test(l));
const value = (re: RegExp) => Number(line(re)?.split(' ').pop());

beforeEach(() => {
  startRuntimeMonitorWith('api', {
    enabled: true,
    intervalSeconds: 60,
    blockedLogThresholdMs: 250,
    metricsPort: 0,
    metricsHost: '127.0.0.1',
    release: 'v1.2.3',
  });
});
afterEach(() => stopRuntimeMonitor());

describe('realtime metrics', () => {
  it('are no-ops without a monitor (tests, CLIs)', () => {
    stopRuntimeMonitor();
    expect(() => {
      realtimeMetrics.setSockets(3);
      realtimeMetrics.connection('accepted');
      realtimeMetrics.disconnect();
      realtimeMetrics.join('ok');
      realtimeMetrics.published('x', 2, 0.01);
      realtimeMetrics.publishFailed('x');
    }).not.toThrow();
  });

  it('count sockets, handshakes, disconnects and joins', () => {
    realtimeMetrics.setSockets(5);
    realtimeMetrics.connection('accepted');
    realtimeMetrics.connection('accepted');
    realtimeMetrics.connection('refused');
    realtimeMetrics.disconnect();
    realtimeMetrics.join('ok');
    realtimeMetrics.join('forbidden');
    expect(value(/^crm_realtime_sockets\{/)).toBe(5);
    expect(value(/^crm_realtime_connections_total\{.*outcome="accepted"/)).toBe(2);
    expect(value(/^crm_realtime_connections_total\{.*outcome="refused"/)).toBe(1);
    expect(value(/^crm_realtime_disconnects_total\{/)).toBe(1);
    expect(value(/^crm_realtime_room_joins_total\{.*result="ok"/)).toBe(1);
    expect(value(/^crm_realtime_room_joins_total\{.*result="forbidden"/)).toBe(1);
  });

  it('count what the emitter really publishes, by type, with rooms and a duration', async () => {
    const emitter = new RealtimeEmitter(new FakeRedis() as never);
    const status = {
      conversationId: CONV,
      messageId: '44444444-4444-4444-8444-444444444444',
      clientMessageId: null,
      status: 'sent' as const,
      at: new Date(0).toISOString(),
    };
    await emitter.emit(
      3,
      [{ kind: 'conv', id: CONV }, { kind: 'org' }],
      REALTIME_EVENT.messageStatus,
      status,
    );
    await emitter.emit(3, [{ kind: 'conv', id: CONV }], REALTIME_EVENT.messageStatus, status);
    expect(
      value(
        new RegExp(
          `^crm_realtime_events_published_total\\{.*type="${REALTIME_EVENT.messageStatus}"`,
        ),
      ),
    ).toBe(2);
    expect(value(/^crm_realtime_rooms_published_total\{/)).toBe(3);
    expect(value(/^crm_realtime_publish_duration_seconds_count\{/)).toBe(2);
    expect(text()).not.toContain('crm_realtime_publish_failures_total');
  });

  it('count a publish that failed, and the emitter still never throws', async () => {
    const broken = new FakeRedis();
    (broken as unknown as { pipeline: () => never }).pipeline = () => {
      throw new Error('redis down');
    };
    const emitter = new RealtimeEmitter(broken as never);
    const report = await emitter.emit(
      3,
      [{ kind: 'conv', id: CONV }],
      REALTIME_EVENT.messageStatus,
      {
        conversationId: CONV,
        messageId: CONV,
        clientMessageId: null,
        status: 'sent',
        at: new Date(0).toISOString(),
      },
    );
    expect(report).toEqual({ rooms: [] });
    expect(
      value(
        new RegExp(
          `^crm_realtime_publish_failures_total\\{.*type="${REALTIME_EVENT.messageStatus}"`,
        ),
      ),
    ).toBe(1);
  });

  it('registers each family once however often it is used', () => {
    for (let i = 0; i < 5; i++) realtimeMetrics.connection('accepted');
    expect(
      text()
        .split('\n')
        .filter((l) => l.startsWith('# TYPE crm_realtime_connections_total')),
    ).toHaveLength(1);
  });
});

describe('delivery lag reports (EL-B23)', () => {
  it('accepts a well-formed report and returns seconds', () => {
    expect(acceptDeliveryReport({ lagMs: 1500, events: 4 }, {}, 1_000_000)).toBe(1.5);
    expect(acceptDeliveryReport({ lagMs: 0, events: 1 }, {}, 1_000_000)).toBe(0);
  });

  it('refuses anything outside the contract: strings, negatives, huge values, zero events, extra shapes', () => {
    for (const bad of [
      null,
      undefined,
      'x',
      42,
      {},
      { lagMs: '12', events: 1 },
      { lagMs: -1, events: 1 },
      { lagMs: 300_001, events: 1 },
      { lagMs: 10, events: 0 },
      { lagMs: 10, events: 1.5 },
      { lagMs: Number.NaN, events: 1 },
      { lagMs: Infinity, events: 1 },
    ]) {
      expect(acceptDeliveryReport(bad, {}, 1_000_000), JSON.stringify(bad)).toBeNull();
    }
  });

  it('counts one report per connection per 20 seconds, so a loop of reports cannot skew the histogram', () => {
    const state: { lastDeliveryReportAt?: number } = {};
    const body = { lagMs: 100, events: 1 };
    expect(acceptDeliveryReport(body, state, 1_000_000)).toBe(0.1);
    expect(acceptDeliveryReport(body, state, 1_005_000)).toBeNull();
    expect(acceptDeliveryReport(body, state, 1_019_999)).toBeNull();
    expect(acceptDeliveryReport(body, state, 1_020_000)).toBe(0.1);
    // a refused report does not push the window out
    expect(acceptDeliveryReport({ lagMs: -1, events: 1 }, state, 1_030_000)).toBeNull();
    expect(acceptDeliveryReport(body, state, 1_040_000)).toBe(0.1);
  });

  it('records the lag and the rooms held as series', () => {
    realtimeMetrics.deliveryLag(0.4);
    realtimeMetrics.deliveryLag(3);
    realtimeMetrics.setRooms(17);
    expect(value(/^crm_realtime_delivery_lag_seconds_count\{/)).toBe(2);
    expect(value(/^crm_realtime_delivery_lag_seconds_bucket\{.*le="0.5"/)).toBe(1);
    expect(value(/^crm_realtime_rooms\{/)).toBe(17);
  });
});

describe('release label', () => {
  it('is on every series of the process', () => {
    realtimeMetrics.setSockets(1);
    const series = text()
      .split('\n')
      .filter((l) => l !== '' && !l.startsWith('#'));
    expect(series.length).toBeGreaterThanOrEqual(2); // before the first window only the start time and what was set
    expect(series.every((l) => l.includes('release="v1.2.3"'))).toBe(true);
    expect(series.every((l) => l.includes('service="api"'))).toBe(true);
  });

  it('is derived from the environment as a short, safe value', () => {
    expect(releaseFromEnv({ OBS_RELEASE: ' 2026.10.18-rc1 ' })).toBe('2026.10.18-rc1');
    expect(releaseFromEnv({ GIT_SHA: 'A'.repeat(40) })).toBe('a'.repeat(12));
    expect(releaseFromEnv({ IMAGE_TAG: 'local' })).toBe('local');
    expect(releaseFromEnv({ OBS_RELEASE: 'v1', GIT_SHA: 'abc' })).toBe('v1'); // OBS_RELEASE wins
    expect(releaseFromEnv({ OBS_RELEASE: 'bad "label"\n{x}' })).toBe('bad__label___x_');
    expect(releaseFromEnv({ OBS_RELEASE: 'x'.repeat(100) })).toHaveLength(40);
    expect(releaseFromEnv({})).toBeUndefined();
    expect(releaseFromEnv({ OBS_RELEASE: '   ' })).toBeUndefined();
  });

  it('is absent, not empty, when no release is known', () => {
    stopRuntimeMonitor();
    startRuntimeMonitorWith('worker', {
      enabled: true,
      intervalSeconds: 60,
      blockedLogThresholdMs: 250,
      metricsPort: 0,
      metricsHost: '127.0.0.1',
    });
    expect(text()).not.toContain('release=');
  });
});
