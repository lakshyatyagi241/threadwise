import * as IntentLauncher from 'expo-intent-launcher';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { placeCall } from './call';
import { canPlaceCalls } from './permissions';

jest.mock('./permissions');
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
