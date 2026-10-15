import { fireEvent, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { openSettingsFor } from '@/lib/device/permissions';
import { renderApp } from '@/test/render';
import { PermissionGuide } from './permission-guide';

jest.mock('@/lib/device/permissions');

const open = jest.mocked(openSettingsFor);
const onPlatform = (os: 'android' | 'ios') =>
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });

beforeEach(() => {
  jest.clearAllMocks();
  open.mockResolvedValue();
});
afterEach(() => onPlatform('ios'));

describe('PermissionGuide', () => {
  it('shows nothing while no permission is off', async () => {
    await renderApp(<PermissionGuide off={[]} onClose={jest.fn()} />);
    expect(screen.queryByText('Turn on permissions')).toBeNull();
  });

  it('names what is off and which row to tap on Android, then opens settings', async () => {
    onPlatform('android');
    const onClose = jest.fn();
    await renderApp(<PermissionGuide off={['calls', 'camera']} onClose={onClose} />);
    expect(screen.getByText(/Phone calls, Camera/)).toBeTruthy();
    expect(screen.getByText(/tap Permissions/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Open settings' }));
    expect(open).toHaveBeenCalledWith(['calls', 'camera']);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks for the switch alone when only notifications are off', async () => {
    onPlatform('android');
    await renderApp(<PermissionGuide off={['notifications']} onClose={jest.fn()} />);
    expect(screen.getByText('Notifications are off. Next, switch them on.')).toBeTruthy();
  });

  it('says to switch each one on, on iOS', async () => {
    onPlatform('ios');
    await renderApp(<PermissionGuide off={['camera']} onClose={jest.fn()} />);
    expect(screen.getByText('Switched off: Camera. Next, switch each one on.')).toBeTruthy();
  });

  it('opens nothing when the person says not now', async () => {
    const onClose = jest.fn();
    await renderApp(<PermissionGuide off={['camera']} onClose={onClose} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });
});
