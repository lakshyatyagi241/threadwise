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
  initSentry,
  moduleFromPath,
  reportClientError,
  reportServerError,
  scrubSentryLog,
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
