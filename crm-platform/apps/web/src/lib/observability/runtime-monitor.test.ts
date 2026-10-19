import { getRuntimeMonitor, stopRuntimeMonitor } from '@crm/observability';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readMonitorConfig,
  startWebRuntimeMonitor,
  stopWebRequestMetrics,
} from './runtime-monitor';

afterEach(() => {
  stopWebRequestMetrics();
  stopRuntimeMonitor();
});

describe('readMonitorConfig', () => {
  it('uses the API defaults when nothing is set: on, 10 s window, no listener, loopback', () => {
    expect(readMonitorConfig({})).toEqual({
      enabled: true,
      intervalSeconds: 10,
      blockedLogThresholdMs: 250,
      metricsPort: 0,
      metricsHost: '127.0.0.1',
      metricsToken: undefined,
    });
  });

  it('reads the OBS_* variables the API and worker already use', () => {
    expect(
      readMonitorConfig({
        OBS_RUNTIME_INTERVAL_SECONDS: '5',
        OBS_BLOCKED_LOG_THRESHOLD_MS: '500',
        OBS_METRICS_PORT: '9464',
        OBS_METRICS_HOST: '0.0.0.0',
        OBS_METRICS_TOKEN: 'a-token-of-16-chars-or-more',
      }),
    ).toMatchObject({
      intervalSeconds: 5,
      blockedLogThresholdMs: 500,
      metricsPort: 9464,
      metricsHost: '0.0.0.0',
      metricsToken: 'a-token-of-16-chars-or-more',
    });
  });

  it('treats blank values as unset and turns off only for an explicit false', () => {
    expect(readMonitorConfig({ OBS_METRICS_PORT: '  ', OBS_METRICS_HOST: '' })).toMatchObject({
      metricsPort: 0,
      metricsHost: '127.0.0.1',
    });
    for (const off of ['false', 'FALSE', '0', 'no', 'off']) {
      expect(readMonitorConfig({ OBS_RUNTIME_MONITOR: off }).enabled).toBe(false);
    }
    expect(readMonitorConfig({ OBS_RUNTIME_MONITOR: 'true' }).enabled).toBe(true);
    expect(readMonitorConfig({ OBS_RUNTIME_MONITOR: 'garbage' }).enabled).toBe(true);
  });

  it('falls back to the default for a value out of range, never to "off" or to a surprising port', () => {
    const c = readMonitorConfig({
      OBS_RUNTIME_INTERVAL_SECONDS: '0',
      OBS_BLOCKED_LOG_THRESHOLD_MS: '5',
      OBS_METRICS_PORT: '70000',
    });
    expect(c).toMatchObject({ intervalSeconds: 10, blockedLogThresholdMs: 250, metricsPort: 0 });
    expect(readMonitorConfig({ OBS_METRICS_PORT: '94.5' }).metricsPort).toBe(0);
    expect(readMonitorConfig({ OBS_METRICS_PORT: 'abc' }).metricsPort).toBe(0);
  });

  it('ignores a token shorter than 16 characters, so a non-loopback listener stays closed', () => {
    expect(readMonitorConfig({ OBS_METRICS_TOKEN: 'short' }).metricsToken).toBeUndefined();
  });
});

describe('startWebRuntimeMonitor', () => {
  it('starts nothing when switched off', () => {
    startWebRuntimeMonitor({ OBS_RUNTIME_MONITOR: 'false' });
    expect(getRuntimeMonitor()).toBeUndefined();
  });

  it('starts one monitor labelled service="web", and a second call reuses it', () => {
    startWebRuntimeMonitor({});
    const first = getRuntimeMonitor();
    expect(first).toBeDefined();
    expect(first?.render()).toContain('service="web"');
    startWebRuntimeMonitor({});
    expect(getRuntimeMonitor()).toBe(first);
  });
});
