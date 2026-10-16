import { renderHook } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { AppState } from 'react-native';
import { takeEndedCall } from '@/lib/device/call-monitor';
import { forgetCall, rememberCall } from '@/lib/device/pending-call';
import { useCallReturn } from './use-call-return';

jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('@/lib/device/call-monitor', () => ({ takeEndedCall: jest.fn(() => null) }));

const router = { push: jest.fn() };
let change: (state: string) => void = () => undefined;
const remove = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    listener: (state: string) => void,
  ) => {
    change = listener;
    return { remove };
  }) as never);
});
afterEach(() => {
  forgetCall();
  jest.restoreAllMocks();
});

describe('useCallReturn', () => {
  it('opens the log sheet when the person comes back from a call placed from the app', async () => {
    await renderHook(() => useCallReturn());
    rememberCall({ contactId: 'c1', name: 'Aarav', phone: '+91' }, Date.now() - 60_000);
    change('background');
    change('active');
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/call-summary',
      params: expect.objectContaining({ contactId: 'c1', name: 'Aarav', durationSec: '60' }),
    });
  });

  it('does nothing when no call was placed, or when the app was not left', async () => {
    await renderHook(() => useCallReturn());
    change('background');
    change('active');
    rememberCall({ contactId: 'c1', name: 'Aarav', phone: '+91' });
    change('active');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('opens the log sheet for a call the service heard end but could not open the screen for', async () => {
    jest.useFakeTimers();
    jest
      .mocked(takeEndedCall)
      .mockReturnValueOnce(
        'crm-dev:///call-summary?contactId=c1&name=Aarav&startedAt=5&durationSec=42',
      );
    await renderHook(() => useCallReturn());
    change('background');
    change('active');
    expect(router.push).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/call-summary',
      params: { contactId: 'c1', name: 'Aarav', startedAt: '5', durationSec: '42' },
    });
    jest.useRealTimers();
  });

  it('opens nothing when the service left no ended call (the screen is already up)', async () => {
    jest.useFakeTimers();
    await renderHook(() => useCallReturn());
    change('background');
    change('active');
    jest.advanceTimersByTime(1000);
    expect(router.push).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('stops listening when it goes away', async () => {
    const view = await renderHook(() => useCallReturn());
    await view.unmount();
    expect(remove).toHaveBeenCalled();
  });
});
