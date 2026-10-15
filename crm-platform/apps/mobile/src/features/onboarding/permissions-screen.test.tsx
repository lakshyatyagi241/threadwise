import { fireEvent, screen } from '@testing-library/react-native';
import { requestNotificationPermission } from '@/lib/device/notification-permission';
import { renderApp } from '@/test/render';
import { PermissionsScreen } from './permissions-screen';

jest.mock('@/lib/device/notification-permission');

const requestCall = jest.mocked(requestNotificationPermission);
const onDone = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  requestCall.mockResolvedValue({ state: 'granted', canAskAgain: true });
});

describe('PermissionsScreen', () => {
  it('explains the permission in words before the phone asks', async () => {
    await renderApp(<PermissionsScreen onDone={onDone} />);
    expect(screen.getByRole('header', { name: 'Allow a few things to get started' })).toBeTruthy();
    expect(screen.getByText('Notifications')).toBeTruthy();
    expect(
      screen.getByText(/Hear about new messages and conversations assigned to you/),
    ).toBeTruthy();
    // Nothing is asked until the person presses the button.
    expect(requestCall).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('asks the phone for the permission on Continue, naming the channel, and then goes on', async () => {
    await renderApp(<PermissionsScreen onDone={onDone} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(requestCall).toHaveBeenCalledWith('Messages and updates');
    await screen.findByRole('button', { name: 'Continue' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('goes on after the person says no in the phone prompt', async () => {
    requestCall.mockResolvedValue({ state: 'denied', canAskAgain: false });
    await renderApp(<PermissionsScreen onDone={onDone} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('button', { name: 'Not now' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('goes on even when the phone fails to answer', async () => {
    requestCall.mockRejectedValue(new Error('no channel'));
    await renderApp(<PermissionsScreen onDone={onDone} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('button', { name: 'Not now' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('asks the phone nothing on Not now', async () => {
    await renderApp(<PermissionsScreen onDone={onDone} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(requestCall).not.toHaveBeenCalled();
  });
});
