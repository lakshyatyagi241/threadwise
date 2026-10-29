import { EventEmitter } from 'node:events';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const scope = { setTag: vi.fn(), setExtra: vi.fn() };
const captureException = vi.fn();
const logInfo = vi.fn();
const logWarn = vi.fn();
vi.mock('@sentry/node', () => ({
  logger: {
    info: (m: string, a: unknown) => logInfo(m, a),
    warn: (m: string, a: unknown) => logWarn(m, a),
  },
  init: vi.fn(),
  captureException: (e: unknown) => captureException(e),
  withScope: (cb: (s: typeof scope) => void) => cb(scope),
}));

import { attachJobFailureReporting } from '../../../src/modules/platform-infrastructure/observability/event-loop/job-metrics';
import {
  createThrottle,
  initSentry,
  moduleFromPath,
  reportClientError,
  reportServerError,
  scrubSentryLog,
  throttleKey,
} from '../../../src/modules/platform-infrastructure/observability/sentry';

describe('moduleFromPath', () => {
  it.each([
    ['/v2/contacts/pql', 'contacts'],
    ['/api/v2/Help-Agent/chat/completions', 'help-agent'],
    ['/v2/public/webhooks/whatsapp?x=1', 'public'],
    ['/v2', undefined],
    ['/v2/%00bad', undefined],
    [undefined, undefined],
  ])('%s -> %s', (path, expected) => {
    expect(moduleFromPath(path)).toBe(expected);
  });
});

describe('error reporting tags', () => {
  beforeAll(() => {
    initSentry('worker', { SENTRY_DSN: 'https://k@example.ingest.sentry.io/1' });
  });
  beforeEach(() => vi.clearAllMocks());

  it('tags an HTTP error with its module', () => {
    const err = new Error('boom');
    reportServerError(err, { requestId: 'r1', path: '/v2/contacts/abc?token=s' });
    expect(captureException).toHaveBeenCalledWith(err);
    expect(scope.setTag).toHaveBeenCalledWith('module', 'contacts');
  });

  it('reports a final job failure with its queue and never the job data', () => {
    const worker = Object.assign(new EventEmitter(), { name: 'broadcast-send' });
    attachJobFailureReporting(worker as never);
    const err = new Error('provider down');
    worker.emit(
      'failed',
      { name: 'send', attemptsMade: 3, finishedOn: 1, data: { phone: '+910000000000' } },
      err,
    );

    expect(captureException).toHaveBeenCalledWith(err);
    expect(scope.setTag).toHaveBeenCalledWith('queue', 'broadcast-send');
    expect(scope.setTag).toHaveBeenCalledWith('module', 'broadcast-send');
    expect(scope.setTag).toHaveBeenCalledWith('job', 'send');
    expect(JSON.stringify([scope.setTag.mock.calls, scope.setExtra.mock.calls])).not.toContain(
      '+9100',
    );
  });

  it('does not report an attempt that BullMQ will retry', () => {
    const worker = Object.assign(new EventEmitter(), { name: 'broadcast-send' });
    attachJobFailureReporting(worker as never);
    worker.emit('failed', { name: 'send', attemptsMade: 1 }, new Error('transient'));
    expect(captureException).not.toHaveBeenCalled();
  });

  it('records a refused request as a warn log with its module, never as an issue', () => {
    reportClientError(422, {
      code: 'VALIDATION',
      path: '/v2/contacts/abc?token=s',
      requestId: 'r2',
    });
    expect(captureException).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledWith('handled response 422', {
      status: 422,
      code: 'VALIDATION',
      module: 'contacts',
      path: '/v2/contacts/abc',
      requestId: 'r2',
    });
  });

  it.each([
    [401, false],
    [404, false],
    [503, true],
  ])('records a %s (expected: %s) as an info log', (status, expected) => {
    reportClientError(status, { path: '/v2/x', expected });
    expect(logInfo).toHaveBeenCalledTimes(1);
    expect(logWarn).not.toHaveBeenCalled();
  });
});

describe('createThrottle (a failing dependency must not flood Sentry)', () => {
  it('lets the first `limit` of one key through in a window, refuses the rest, then starts fresh', () => {
    let t = 0;
    const allow = createThrottle(3, 1000, () => t);
    expect([1, 2, 3, 4, 5, 6].map(() => allow('fetch failed'))).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    t = 999;
    expect(allow('fetch failed')).toBe(false);
    t = 1000;
    expect(allow('fetch failed')).toBe(true);
  });

  it('keeps a separate budget per error, so a noisy one cannot hide a new one', () => {
    const allow = createThrottle(1, 1000, () => 0);
    expect(allow('a')).toBe(true);
    expect(allow('a')).toBe(false);
    expect(allow('b')).toBe(true);
  });

  it('stays bounded when every key is different', () => {
    let t = 0;
    const allow = createThrottle(1, 1000, () => t, 3);
    for (const k of ['a', 'b', 'c', 'd', 'e']) expect(allow(k)).toBe(true);
    t = 5000;
    expect(allow('a')).toBe(true);
  });

  it('keys an event by exception type and the start of its text, else by its message', () => {
    expect(
      throttleKey({ exception: { values: [{ type: 'TypeError', value: 'fetch failed' }] } }),
    ).toBe('TypeError:fetch failed');
    expect(throttleKey({ message: 'x'.repeat(500) })).toBe(`:${'x'.repeat(120)}`);
    expect(throttleKey({})).toBe(':');
  });
});

describe('scrubSentryLog', () => {
  it('cuts bound SQL values and masks a secret in an address, in the message and the string attributes', () => {
    const log = scrubSentryLog({
      message: 'Failed query: SELECT 1 params: 15,10.0.1.208',
      attributes: {
        url: 'https://desk.example/v2/shopify/webhook/s3cr3t',
        count: 3,
        nested: { a: 1 },
      },
    });
    expect(log.message).toBe('Failed query: SELECT 1 params: [removed]');
    expect(log.attributes).toEqual({
      url: 'https://desk.example/v2/shopify/webhook/[secret]',
      count: 3,
      nested: { a: 1 },
    });
  });
});
