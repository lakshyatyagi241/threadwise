import * as Sentry from '@sentry/react-native';
import { log } from './logger';
import { initObservability, identifyUser, withObservability } from './sentry';

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

describe('withObservability', () => {
  const Root = () => null;
  type Observability = {
    initObservability: typeof initObservability;
    withObservability: typeof withObservability;
  };

  /** A fresh copy of the module: the DSN is read when the config loads, so each case needs its own copy. */
  function load(dsn?: string): Observability {
    let mod!: Observability;
    jest.isolateModules(() => {
      if (dsn) process.env.EXPO_PUBLIC_SENTRY_DSN = dsn;
      else delete process.env.EXPO_PUBLIC_SENTRY_DSN;
      mod = jest.requireActual<Observability>('./sentry');
    });
    return mod;
  }

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  });

  it('leaves the root component alone without a DSN, because Sentry.wrap would warn that init never ran', () => {
    const mod = load();
    expect(mod.withObservability(Root)).toBe(Root);
    expect(Sentry.wrap).not.toHaveBeenCalled();
  });

  it('wraps the root component once a DSN is set, after Sentry was started', () => {
    const mod = load('https://public@example.ingest.sentry.io/1');
    mod.initObservability();
    expect(mod.withObservability(Root)).toBe(Root); // the mock hands the component straight back
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.wrap).toHaveBeenCalledWith(Root);
  });
});
