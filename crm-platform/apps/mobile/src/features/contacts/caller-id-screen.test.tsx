import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { initI18n } from '@/lib/i18n';
import {
  callerIdAvailable,
  callerIdPermissions,
  callerIdStatus,
  disableCallerId,
  enableCallerId,
  requestCallerIdPermissions,
  updateCallerId,
} from '@/lib/device/caller-id';
import { openOverlaySettings, overlayAllowed } from '@/lib/device/call-monitor';
import { fetchSession } from '@/lib/session/api';
import { session } from '@/test/dashboard-fixtures';
import { renderApp } from '@/test/render';
import { loadCallerEntries } from './caller-directory';
import { CallerIdScreen } from './caller-id-screen';

const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: () => true }),
}));
jest.mock('@/lib/session/api');
jest.mock('@/lib/device/caller-id');
jest.mock('@/lib/device/call-monitor');
jest.mock('./caller-directory');

const sessionCall = jest.mocked(fetchSession);
const entries = [{ id: 'c1', name: 'Asha', phone: '+919800000001' }];
const OFF = { enabled: false, count: 0, updatedAt: 0 };
const ON = { enabled: true, count: 2, updatedAt: Date.UTC(2026, 9, 26, 10, 0) };

function setup(
  over: {
    available?: boolean;
    status?: typeof OFF;
    granted?: boolean;
    overlay?: boolean;
    permissions?: Record<string, 'all'>;
  } = {},
) {
  const granted = over.granted ?? true;
  jest.mocked(callerIdAvailable).mockReturnValue(over.available ?? true);
  jest.mocked(callerIdStatus).mockReturnValue(over.status ?? OFF);
  jest.mocked(callerIdPermissions).mockResolvedValue({ phoneState: granted, callLog: granted });
  jest.mocked(overlayAllowed).mockReturnValue(over.overlay ?? true);
  sessionCall.mockResolvedValue({
    ...session,
    permissions: over.permissions ?? { 'record.contacts.read': 'all' },
  });
}

async function show() {
  const view = await renderApp(<CallerIdScreen />);
  await screen.findByRole('header', { name: 'Caller ID' });
  await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
  await screen.findAllByRole('button', { name: 'Back' });
}
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.resetAllMocks();
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((() => ({ remove: jest.fn() })) as never);
  jest.mocked(loadCallerEntries).mockResolvedValue(entries);
});

describe('CallerIdScreen', () => {
  it('says what it does and keeps, and what it needs, while it is off', async () => {
    setup({ granted: false, overlay: false });
    await show();
    expect(screen.getByText(/shows their name over the call screen/)).toBeTruthy();
    expect(screen.getByText(/kept on this phone only/)).toBeTruthy();
    expect(screen.getByText('Caller ID is off')).toBeTruthy();
    for (const need of [
      'Know when the phone rings',
      'Read the number that is calling',
      'Display over other apps',
    ]) {
      expect(screen.getByText(need)).toBeTruthy();
    }
    expect(screen.getAllByText('Not allowed')).toHaveLength(3);
  });

  it('asks for the phone permissions first, without reading any contact yet', async () => {
    setup({ granted: false });
    await show();
    await press('Turn on');
    await waitFor(() => expect(requestCallerIdPermissions).toHaveBeenCalled());
    expect(loadCallerEntries).not.toHaveBeenCalled();
    expect(enableCallerId).not.toHaveBeenCalled();
  });

  it('then sends the person to the phone\'s "display over other apps" page', async () => {
    setup({ overlay: false });
    await show();
    await press('Turn on');
    await waitFor(() => expect(openOverlaySettings).toHaveBeenCalled());
    expect(enableCallerId).not.toHaveBeenCalled();
  });

  it('turns on with the contacts once everything is allowed', async () => {
    setup();
    await show();
    await press('Turn on');
    await waitFor(() => expect(enableCallerId).toHaveBeenCalledWith(entries));
    expect(loadCallerEntries).toHaveBeenCalledTimes(1);
  });

  it('says so, and stays off, when the contacts cannot be read', async () => {
    setup();
    jest.mocked(loadCallerEntries).mockRejectedValue(new Error('offline'));
    await show();
    await press('Turn on');
    expect(await screen.findByText('Could not read the contacts. Try again.')).toBeTruthy();
    expect(enableCallerId).not.toHaveBeenCalled();
  });

  it('shows how many contacts the phone can name when it is on, and refreshes or turns off', async () => {
    setup({ status: ON });
    await show();
    expect(screen.getByText('Caller ID is on')).toBeTruthy();
    expect(screen.getByText('Contacts ready: 2')).toBeTruthy();
    expect(screen.queryByText('Know when the phone rings')).toBeNull();
    await press('Update now');
    await waitFor(() => expect(updateCallerId).toHaveBeenCalledWith(entries));
    await press('Turn off');
    expect(disableCallerId).toHaveBeenCalledTimes(1);
  });

  it('cannot be turned on by a role that may not read contacts', async () => {
    setup({ permissions: {} });
    await show();
    expect(await screen.findByText(/cannot read contacts/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Turn on' }).props.accessibilityState.disabled).toBe(
      true,
    );
  });

  it('says that a build without caller ID cannot show callers', async () => {
    setup({ available: false });
    await show();
    expect(screen.getByText(/cannot show callers/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull();
  });
});
