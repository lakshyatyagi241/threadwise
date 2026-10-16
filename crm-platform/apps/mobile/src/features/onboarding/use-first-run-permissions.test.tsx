import { renderHook, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { openOverlaySettings, phoneStateAllowed } from '@/lib/device/call-monitor';
import { askForPermissions } from '@/lib/device/permissions';
import { useFirstRunPermissions } from './use-first-run-permissions';

jest.mock('@/lib/device/permissions');
jest.mock('@/lib/device/call-monitor');

const ask = jest.mocked(askForPermissions);
const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const KEY = 'crm.permissions-asked.v3';

beforeEach(() => {
  jest.clearAllMocks();
  store.clear();
  ask.mockResolvedValue([]);
  jest.mocked(phoneStateAllowed).mockResolvedValue(true);
});

describe('useFirstRunPermissions', () => {
  it("shows the phone's prompts the first time, and remembers it", async () => {
    await renderHook(() => useFirstRunPermissions(true));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    expect(ask).toHaveBeenCalledWith({ channelName: expect.any(String) });
    expect(store.get(KEY)).toBe('1');
  });

  it('opens the phone page for "display over other apps" when that is what is left off', async () => {
    ask.mockResolvedValue(['callPopup']);
    await renderHook(() => useFirstRunPermissions(true));
    await waitFor(() => expect(openOverlaySettings).toHaveBeenCalledTimes(1));
  });

  it('opens no settings page when the phone-state permission itself was refused, or for other permissions', async () => {
    ask.mockResolvedValue(['callPopup', 'camera']);
    jest.mocked(phoneStateAllowed).mockResolvedValue(false);
    await renderHook(() => useFirstRunPermissions(true));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(openOverlaySettings).not.toHaveBeenCalled();
  });

  it('asks nothing until the app is on screen', async () => {
    const view = await renderHook(({ on }: { on: boolean }) => useFirstRunPermissions(on), {
      initialProps: { on: false },
    });
    expect(ask).not.toHaveBeenCalled();
    await view.rerender({ on: true });
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
  });

  it('never asks twice, not even on the next start', async () => {
    await renderHook(() => useFirstRunPermissions(true));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    await renderHook(() => useFirstRunPermissions(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('marks it before asking, so a close in the middle of the prompts does not bring them back', async () => {
    ask.mockImplementation(async () => {
      expect(store.get(KEY)).toBe('1');
      return [];
    });
    await renderHook(() => useFirstRunPermissions(true));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
  });

  it('does not break the app when the phone cannot be asked', async () => {
    ask.mockRejectedValue(new Error('boom'));
    await renderHook(() => useFirstRunPermissions(true));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
  });
});
