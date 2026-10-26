import { requireOptionalNativeModule } from 'expo';
import { PermissionsAndroid, Platform } from 'react-native';
import { initI18n } from '@/lib/i18n';
import * as callerId from './caller-id';

const native = {
  configureCallerId: jest.fn(),
  setCallerDirectory: jest.fn((json: string) => (JSON.parse(json) as unknown[]).length),
  clearCallerId: jest.fn(),
  callerIdStatus: jest.fn(() => ({ enabled: true, count: 2, updatedAt: 1000 })),
};

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock('expo-linking', () => ({
  createURL: jest.fn((path: string) => `crm-dev://${path.slice(1)}`),
}));

const onPlatform = (os: 'android' | 'ios') =>
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });

function load(os: 'android' | 'ios', withNative: boolean, oldBuild = false) {
  onPlatform(os);
  const module = oldBuild ? {} : native;
  jest.mocked(requireOptionalNativeModule).mockReturnValue((withNative ? module : null) as never);
  return callerId;
}

const entries = [
  { id: 'c1', name: ' Aarav Sharma ', phone: ' +91 98000 00001 ' },
  { id: 'c2', name: 'Meera Nair', phone: '98000 00002' },
];

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  jest.restoreAllMocks();
  onPlatform('ios');
});

describe('callerIdAvailable', () => {
  it('is true only on Android, in a build that has the caller-ID part of the module', () => {
    expect(load('android', true).callerIdAvailable()).toBe(true);
    expect(load('android', true, true).callerIdAvailable()).toBe(false);
    expect(load('android', false).callerIdAvailable()).toBe(false);
    expect(load('ios', true).callerIdAvailable()).toBe(false);
  });
});

describe('callerEntriesJson', () => {
  it('trims names and numbers and drops rows with no name, no id, or a number too short to be one', () => {
    const { callerEntriesJson } = load('android', true);
    const json = callerEntriesJson([
      ...entries,
      { id: 'c3', name: '  ', phone: '98000 00003' },
      { id: '', name: 'No id', phone: '98000 00004' },
      { id: 'c5', name: 'Extension', phone: '1234' },
    ]);
    expect(JSON.parse(json)).toEqual([
      { id: 'c1', name: 'Aarav Sharma', phone: '+91 98000 00001' },
      { id: 'c2', name: 'Meera Nair', phone: '98000 00002' },
    ]);
  });
});

describe('enableCallerId and updateCallerId', () => {
  it('switches it on with the translated card and the contacts, and answers how many the phone can name', () => {
    const { enableCallerId } = load('android', true);
    expect(enableCallerId(entries)).toBe(2);
    expect(native.configureCallerId).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        appName: 'GetaApp',
        subtitle: 'Contact',
        closeLabel: 'Close',
        openUrl: 'crm-dev://contact/__ID__',
        summaryUrl: expect.stringContaining('call-summary'),
        primaryColor: expect.stringMatching(/^#[0-9A-F]{6}$/i),
        onPrimaryColor: expect.stringMatching(/^#[0-9A-F]{6}$/i),
      }),
    );
    expect(native.setCallerDirectory).toHaveBeenCalledTimes(1);
  });

  it('refreshes the contacts and the card but leaves the switch as it is', () => {
    const { updateCallerId } = load('android', true);
    native.callerIdStatus.mockReturnValueOnce({ enabled: false, count: 0, updatedAt: 0 });
    updateCallerId(entries);
    expect(native.configureCallerId).toHaveBeenCalledWith(false, expect.any(Object));
  });

  it('does nothing in a build without the module', () => {
    const { enableCallerId, updateCallerId } = load('android', false);
    expect(enableCallerId(entries)).toBe(0);
    expect(updateCallerId(entries)).toBe(0);
    expect(native.setCallerDirectory).not.toHaveBeenCalled();
  });
});

describe('disableCallerId and callerIdStatus', () => {
  it('makes the phone forget every contact', () => {
    load('android', true).disableCallerId();
    expect(native.clearCallerId).toHaveBeenCalledTimes(1);
  });

  it("reports the phone's state, or off and empty when there is no module", () => {
    expect(load('android', true).callerIdStatus()).toEqual({
      enabled: true,
      count: 2,
      updatedAt: 1000,
    });
    expect(load('ios', false).callerIdStatus()).toEqual({ enabled: false, count: 0, updatedAt: 0 });
  });
});

describe('permissions', () => {
  it('reads both permissions, and asks for both at once', async () => {
    const { callerIdPermissions, requestCallerIdPermissions } = load('android', true);
    jest
      .spyOn(PermissionsAndroid, 'check')
      .mockImplementation(async (name) => name.endsWith('PHONE_STATE'));
    await expect(callerIdPermissions()).resolves.toEqual({ phoneState: true, callLog: false });
    jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue({
      'android.permission.READ_PHONE_STATE': 'granted',
      'android.permission.READ_CALL_LOG': 'denied',
    } as never);
    await expect(requestCallerIdPermissions()).resolves.toBe(false);
  });

  it('is false everywhere but Android', async () => {
    const { callerIdPermissions, requestCallerIdPermissions } = load('ios', false);
    await expect(callerIdPermissions()).resolves.toEqual({ phoneState: false, callLog: false });
    await expect(requestCallerIdPermissions()).resolves.toBe(false);
  });
});
