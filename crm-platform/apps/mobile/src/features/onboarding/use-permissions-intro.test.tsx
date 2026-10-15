import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { getNotificationPermission } from '@/lib/device/notification-permission';
import { usePermissionsIntro } from './use-permissions-intro';

jest.mock('@/lib/device/notification-permission');

const permissionCall = jest.mocked(getNotificationPermission);
const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const KEY = 'crm.permissions-intro.v1';

beforeEach(() => {
  jest.clearAllMocks();
  store.clear();
  permissionCall.mockResolvedValue({ state: 'undetermined', canAskAgain: true });
});

describe('usePermissionsIntro', () => {
  it('shows the screen the first time, on a phone that has not answered', async () => {
    const { result } = await renderHook(() => usePermissionsIntro());
    await waitFor(() => expect(result.current.status).toBe('show'));
  });

  it('remembers that it was shown, so it never comes back', async () => {
    const first = await renderHook(() => usePermissionsIntro());
    await waitFor(() => expect(first.result.current.status).toBe('show'));
    await act(async () => first.result.current.finish());
    expect(first.result.current.status).toBe('done');
    await waitFor(() => expect(store.get(KEY)).toBe('1'));

    const second = await renderHook(() => usePermissionsIntro());
    await waitFor(() => expect(second.result.current.status).toBe('done'));
  });

  it('shows the screen on Android 13+, which calls a never-asked app "denied" but would still ask', async () => {
    permissionCall.mockResolvedValue({ state: 'denied', canAskAgain: true });
    const { result } = await renderHook(() => usePermissionsIntro());
    await waitFor(() => expect(result.current.status).toBe('show'));
    expect(store.has(KEY)).toBe(false);
  });

  it('skips the screen, and remembers, when notifications are already allowed', async () => {
    permissionCall.mockResolvedValue({ state: 'granted', canAskAgain: true });
    const { result } = await renderHook(() => usePermissionsIntro());
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(store.get(KEY)).toBe('1');
  });

  it('skips the screen, and remembers, when the phone has been refused for good', async () => {
    permissionCall.mockResolvedValue({ state: 'denied', canAskAgain: false });
    const { result } = await renderHook(() => usePermissionsIntro());
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(store.get(KEY)).toBe('1');
  });

  it('skips the screen when the phone cannot say, instead of keeping the person out', async () => {
    permissionCall.mockRejectedValue(new Error('boom'));
    const { result } = await renderHook(() => usePermissionsIntro());
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(store.has(KEY)).toBe(false);
  });
});
