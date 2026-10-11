import * as Sentry from '@sentry/react-native';
import { log } from './logger';
import { initObservability, identifyUser } from './sentry';

// The setup file replaces the logger for every other test; this one tests the real thing.
jest.unmock('@/lib/observability/logger');

afterEach(() => jest.clearAllMocks());

describe('log', () => {
  it('leaves a breadcrumb for every level and reports exceptions', () => {
    log.info('thing.happened', { count: 2 });
    log.warn('thing.slow');
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'thing.happened', level: 'info', data: { count: 2 } }),
    );
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning' }),
    );

    const boom = new Error('boom');
    log.exception(boom, 'thing.failed', { step: 'two' });
    expect(Sentry.captureException).toHaveBeenCalledWith(boom, {
      extra: { event: 'thing.failed', step: 'two' },
    });
  });
});

describe('observability', () => {
  it('stays off without a DSN', () => {
    initObservability();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('identifies a person by opaque id only, and clears on sign-out', () => {
    identifyUser('6f1c3f0e-6f5c-4d3a-9a4e-2f6f1b0d9a11');
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: '6f1c3f0e-6f5c-4d3a-9a4e-2f6f1b0d9a11' });
    identifyUser(null);
    expect(Sentry.setUser).toHaveBeenLastCalledWith(null);
  });
});
