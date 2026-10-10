/* eslint-disable @typescript-eslint/no-require-imports */
import { configure } from '@testing-library/react-native';

// A cold transform on a busy CI runner can take longer than the 1 s default to render the first screen.
configure({ asyncUtilTimeout: 5000 });

// Native modules have no implementation under Node: replace each with the smallest honest fake.

const mockSecureStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => void mockSecureStore.set(key, value)),
  deleteItemAsync: jest.fn(async (key: string) => void mockSecureStore.delete(key)),
  __store: mockSecureStore,
}));

// The library ships its own fake: a provider that renders its children and insets of zero. Its two hooks are jest.fn()s, which the
// `jest.resetAllMocks()` that several test files call would empty (and then `insets` is undefined), so they are plain functions here.
jest.mock('react-native-safe-area-context', () => {
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 320, height: 640 };
  return {
    ...require('react-native-safe-area-context/jest/mock').default,
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
  };
});

let mockUuidCounter = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuidCounter).padStart(12, '0')}`,
}));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.2.3',
  nativeBuildVersion: '45',
}));

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'en-US', textDirection: 'ltr' }]),
}));

jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
  captureException: jest.fn(),
  setUser: jest.fn(),
  init: jest.fn(),
  // A spy that hands the component straight back, so a test can assert whether the root was wrapped.
  wrap: jest.fn(<T>(c: T) => c),
}));

jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

beforeEach(() => {
  mockSecureStore.clear();
});

// The logger writes to the console in development; tests assert on the calls instead of printing them.
jest.mock('@/lib/observability/logger', () => ({
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    exception: jest.fn(),
  },
}));
