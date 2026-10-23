import { EventEmitter } from 'node:events';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const scope = { setTag: vi.fn(), setExtra: vi.fn() };
const captureException = vi.fn();
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: (e: unknown) => captureException(e),
  withScope: (cb: (s: typeof scope) => void) => cb(scope),
}));

import { attachJobFailureReporting } from '../../../src/modules/platform-infrastructure/observability/event-loop/job-metrics';
import {
  initSentry,
  moduleFromPath,
  reportServerError,
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
    worker.emit('failed', { name: 'send', attemptsMade: 3, data: { phone: '+910000000000' } }, err);

    expect(captureException).toHaveBeenCalledWith(err);
    expect(scope.setTag).toHaveBeenCalledWith('queue', 'broadcast-send');
    expect(scope.setTag).toHaveBeenCalledWith('module', 'broadcast-send');
    expect(scope.setTag).toHaveBeenCalledWith('job', 'send');
    expect(JSON.stringify([scope.setTag.mock.calls, scope.setExtra.mock.calls])).not.toContain(
      '+9100',
    );
  });
});
