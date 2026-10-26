import { screen, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { callerIdAvailable, callerIdStatus, updateCallerId } from '@/lib/device/caller-id';
import { fetchSession } from '@/lib/session/api';
import { session } from '@/test/dashboard-fixtures';
import { renderApp } from '@/test/render';
import { loadCallerEntries } from './caller-directory';
import { CALLER_REFRESH_MS, useCallerIdSync } from './use-caller-id';

jest.mock('@/lib/session/api');
jest.mock('@/lib/device/caller-id');
jest.mock('@/lib/device/call-monitor');
jest.mock('./caller-directory');

const entries = [{ id: 'c1', name: 'Asha', phone: '+919800000001' }];
let listeners: ((state: AppStateStatus) => void)[] = [];

function Mounted() {
  useCallerIdSync();
  return null;
}

async function mount(permissions: Record<string, 'all'> = { 'record.contacts.read': 'all' }) {
  jest.mocked(fetchSession).mockResolvedValue({ ...session, permissions });
  const view = await renderApp(<Mounted />);
  await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
  return view;
}
const status = (enabled: boolean, ageMs: number) =>
  jest.mocked(callerIdStatus).mockReturnValue({ enabled, count: 1, updatedAt: Date.now() - ageMs });

beforeEach(() => {
  jest.resetAllMocks();
  listeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _: string,
    listener: (state: AppStateStatus) => void,
  ) => {
    listeners.push(listener);
    return { remove: jest.fn() };
  }) as never);
  jest.mocked(callerIdAvailable).mockReturnValue(true);
  jest.mocked(loadCallerEntries).mockResolvedValue(entries);
});

describe('useCallerIdSync', () => {
  it('gives the phone a fresh list when caller ID is on and the list is old', async () => {
    status(true, CALLER_REFRESH_MS + 1000);
    await mount();
    await waitFor(() => expect(updateCallerId).toHaveBeenCalledWith(entries));
  });

  it('leaves a list that is recent, or caller ID that is off, alone', async () => {
    status(true, 1000);
    await mount();
    status(false, CALLER_REFRESH_MS * 2);
    listeners.forEach((listener) => listener('active'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(loadCallerEntries).not.toHaveBeenCalled();
    expect(updateCallerId).not.toHaveBeenCalled();
  });

  it('looks again each time the app comes back to the front', async () => {
    status(true, 1000);
    await mount();
    expect(loadCallerEntries).not.toHaveBeenCalled();
    status(true, CALLER_REFRESH_MS + 1000);
    listeners.forEach((listener) => listener('active'));
    await waitFor(() => expect(updateCallerId).toHaveBeenCalledTimes(1));
  });

  it('does nothing for a role that may not read contacts, or in a build without caller ID', async () => {
    status(true, CALLER_REFRESH_MS * 2);
    await mount({});
    jest.mocked(callerIdAvailable).mockReturnValue(false);
    await mount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(loadCallerEntries).not.toHaveBeenCalled();
    expect(screen.toJSON()).toBeNull();
  });

  it('keeps the list the phone has when the contacts cannot be read', async () => {
    status(true, CALLER_REFRESH_MS * 2);
    jest.mocked(loadCallerEntries).mockRejectedValue(new Error('offline'));
    await mount();
    await waitFor(() => expect(loadCallerEntries).toHaveBeenCalled());
    expect(updateCallerId).not.toHaveBeenCalled();
  });
});
