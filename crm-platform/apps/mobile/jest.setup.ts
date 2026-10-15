/* eslint-disable @typescript-eslint/no-require-imports */
import { notifyManager } from '@tanstack/react-query';
import { configure } from '@testing-library/react-native';
import { initI18n } from '@/lib/i18n';

// A cold transform on a busy CI runner can take longer than the 1 s default to render the first screen.
configure({ asyncUtilTimeout: 5000 });

// The query library tells a screen that a request has finished one zero-delay timer later, which in a test lands outside act() and
// prints a warning. Delivering it in the same microtask turn keeps it inside the act() or waitFor() the test is already in.
notifyManager.setScheduler((callback) => queueMicrotask(callback));

// Every piece of text reads the app's language, so each test file starts with English ready. A test that needs another language
// switches to it and puts English back afterwards.
beforeAll(async () => {
  await initI18n('en');
});

// Native modules have no implementation under Node: replace each with the smallest honest fake.

const mockSecureStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => void mockSecureStore.set(key, value)),
  deleteItemAsync: jest.fn(async (key: string) => void mockSecureStore.delete(key)),
  __store: mockSecureStore,
}));

// The phone's notification permission: undecided until a test says otherwise. The channel call is what Android 13+ needs before it
// will show the prompt.
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: jest.fn(async () => ({
    status: 'undetermined',
    granted: false,
    canAskAgain: true,
  })),
  requestPermissionsAsync: jest.fn(async () => ({
    status: 'granted',
    granted: true,
    canAskAgain: true,
  })),
  setNotificationChannelAsync: jest.fn(async () => null),
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

// The icon fonts are loaded as assets, which have no registry under Node. An icon is a hidden, empty view here; the control around it
// carries the name a test looks for.
jest.mock('@expo/vector-icons', () => {
  const { createElement } = require('react');
  const { View } = require('react-native');
  const icon = () => createElement(View);
  return { Ionicons: icon, MaterialIcons: icon, MaterialCommunityIcons: icon };
});

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

// The gesture library's own buttons need its jest setup; the swipe row below is replaced by a simpler stand-in.
require('react-native-gesture-handler/jestSetup');

// The swipe library draws with native animation code that jest does not have. This stand-in draws a row with its left actions always
// shown, so a test can press them.
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Swipeable = React.forwardRef(
    (
      {
        children,
        renderLeftActions,
      }: { children: unknown; renderLeftActions?: (...a: unknown[]) => unknown },
      ref: unknown,
    ) => {
      const methods = { close: jest.fn(), open: jest.fn(), reset: jest.fn() };
      React.useImperativeHandle(ref, () => methods);
      return React.createElement(View, null, renderLeftActions?.({}, {}, methods), children);
    },
  );
  return { __esModule: true, default: Swipeable };
});

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
