import { requireOptionalNativeModule } from 'expo';
import { PermissionsAndroid, Platform } from 'react-native';
import * as callMonitor from './call-monitor';

const native = {
  canDrawOverlays: jest.fn(() => true),
  openOverlaySettings: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
};

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock('expo-linking', () => ({
  createURL: jest.fn(
    (path: string, options: { queryParams: Record<string, string> }) =>
      `crm-dev://${path.slice(1)}?${new URLSearchParams(options.queryParams).toString()}`,
  ),
}));

const onPlatform = (os: 'android' | 'ios') =>
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });

/** The module as it behaves on the given platform, with or without the native module and the phone-state permission. */
function load(os: 'android' | 'ios', withNative: boolean, phoneState = true) {
  onPlatform(os);
  jest.mocked(requireOptionalNativeModule).mockReturnValue((withNative ? native : null) as never);
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(phoneState);
  jest.spyOn(PermissionsAndroid, 'request').mockImplementation(ask);
  return callMonitor;
}

const ask = jest.fn(async () => 'denied' as const);
const party = { contactId: 'c1', name: 'Aarav Sharma', phone: '+919800000001' };

beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  jest.restoreAllMocks();
  onPlatform('ios');
});

describe('startCallMonitor', () => {
  it('starts the watch with the contact, the words and a link back to the log screen', async () => {
    const { startCallMonitor } = load('android', true);
    await expect(startCallMonitor(party)).resolves.toBe(true);
    expect(native.start).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Aarav Sharma',
        phone: '+919800000001',
        subtitle: 'Contact',
        appName: 'GetaDesk',
        returnUrl: 'crm-dev://call-summary?contactId=c1&name=Aarav+Sharma',
        primaryColor: expect.stringMatching(/^#[0-9A-F]{6}$/i),
      }),
    );
  });

  it('leaves the return link empty for a call with no contact to log it on', async () => {
    const { startCallMonitor } = load('android', true);
    await startCallMonitor({ ...party, contactId: null });
    expect(native.start).toHaveBeenCalledWith(expect.objectContaining({ returnUrl: '' }));
  });

  it('asks for the phone-state permission once, and does not start when it is refused', async () => {
    const { startCallMonitor } = load('android', true, false);
    await expect(startCallMonitor(party)).resolves.toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(native.start).not.toHaveBeenCalled();
  });

  it('does nothing without the native module (iOS, an old build)', async () => {
    const { startCallMonitor, callMonitorAvailable, overlayAllowed } = load('ios', false);
    await expect(startCallMonitor(party)).resolves.toBe(false);
    expect(callMonitorAvailable()).toBe(false);
    expect(overlayAllowed()).toBe(false);
  });

  it('answers false when the service cannot start', async () => {
    native.start.mockImplementationOnce(() => {
      throw new Error('not allowed to start');
    });
    const { startCallMonitor } = load('android', true);
    await expect(startCallMonitor(party)).resolves.toBe(false);
  });
});

describe('overlay and stop', () => {
  it('reports the overlay switch and opens its settings page', () => {
    const { overlayAllowed, openOverlaySettings, stopCallMonitor } = load('android', true);
    expect(overlayAllowed()).toBe(true);
    openOverlaySettings();
    expect(native.openOverlaySettings).toHaveBeenCalledTimes(1);
    stopCallMonitor();
    expect(native.stop).toHaveBeenCalledTimes(1);
  });
});
