import * as IntentLauncher from 'expo-intent-launcher';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { placeCall } from './call';
import { startCallMonitor, stopCallMonitor } from './call-monitor';
import { forgetCall, rememberCall } from './pending-call';
import { canPlaceCalls } from './permissions';

jest.mock('./permissions');
jest.mock('./call-monitor');
jest.mock('./pending-call');
jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));

const launch = jest.mocked(IntentLauncher.startActivityAsync);
const open = jest.mocked(Linking.openURL);
const allowed = jest.mocked(canPlaceCalls);
const onPlatform = (os: 'android' | 'ios') =>
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });

beforeEach(() => jest.clearAllMocks());
afterEach(() => onPlatform('ios'));

describe('placeCall', () => {
  it('places the call straight away on Android when calls are allowed', async () => {
    onPlatform('android');
    allowed.mockResolvedValue(true);
    await placeCall('+919800000001');
    expect(launch).toHaveBeenCalledWith('android.intent.action.CALL', {
      data: 'tel:+919800000001',
    });
    expect(open).not.toHaveBeenCalled();
  });

  it('hands the number to the dialer on Android when calls are not allowed', async () => {
    onPlatform('android');
    allowed.mockResolvedValue(false);
    await placeCall('+919800000001');
    expect(launch).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith('tel:+919800000001');
  });

  it('falls back to the dialer when the direct call fails', async () => {
    onPlatform('android');
    allowed.mockResolvedValue(true);
    launch.mockRejectedValueOnce(new Error('no activity'));
    await placeCall('+919800000001');
    expect(open).toHaveBeenCalledWith('tel:+919800000001');
  });

  it('always uses the dialer on iOS', async () => {
    onPlatform('ios');
    await placeCall('+919800000001');
    expect(launch).not.toHaveBeenCalled();
    expect(allowed).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith('tel:+919800000001');
  });
});

describe('placeCall: following the call', () => {
  const party = { contactId: 'c1', name: 'Aarav', phone: '+919800000001' };
  const watch = jest.mocked(startCallMonitor);

  it('starts the watch before dialling and does not also remember the call', async () => {
    onPlatform('android');
    allowed.mockResolvedValue(true);
    watch.mockResolvedValue(true);
    await placeCall('+919800000001', party);
    expect(watch).toHaveBeenCalledWith(party);
    expect(watch.mock.invocationCallOrder[0]).toBeLessThan(launch.mock.invocationCallOrder[0]);
    expect(rememberCall).not.toHaveBeenCalled();
    expect(forgetCall).toHaveBeenCalled();
  });

  it('remembers the call for when the person comes back, where nothing can watch it', async () => {
    onPlatform('ios');
    watch.mockResolvedValue(false);
    await placeCall('+919800000001', party);
    expect(rememberCall).toHaveBeenCalledWith(party);
  });

  it('remembers nothing for a call with no contact to log it on', async () => {
    watch.mockResolvedValue(false);
    await placeCall('+919800000001', { ...party, contactId: null });
    expect(rememberCall).not.toHaveBeenCalled();
  });

  it('stops following when nothing could be dialled', async () => {
    watch.mockResolvedValue(true);
    open.mockRejectedValueOnce(new Error('no dialler'));
    await expect(placeCall('+919800000001', party)).rejects.toThrow('no dialler');
    expect(stopCallMonitor).toHaveBeenCalled();
    expect(forgetCall).toHaveBeenCalled();
  });

  it('follows nothing when it is not told who is called', async () => {
    await placeCall('+919800000001');
    expect(watch).not.toHaveBeenCalled();
  });
});
