// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserPush } from '../push/use-browser-push';
import { PUSH_ASKED_KEY } from '../push/support';
import { button, click, mount, text, type Mounted } from '../testing';
import { NotificationPermissionPrompt } from './notification-permission-prompt';

const state = vi.hoisted(() => ({
  configured: true,
  loading: false,
  push: null as BrowserPush | null,
  options: undefined as unknown,
}));

vi.mock('../push/use-browser-push', () => ({
  usePushDeployment: () => ({
    configured: state.configured,
    loading: state.loading,
    publicKey: 'k',
  }),
  useBrowserPush: (options?: unknown) => {
    state.options = options;
    return state.push;
  },
}));

const noop = async () => undefined;
const push = (over: Partial<BrowserPush>): BrowserPush => ({
  state: 'off',
  permission: 'default',
  devices: undefined,
  devicesFailed: false,
  thisDeviceId: null,
  busy: null,
  problem: null,
  testResult: null,
  testInApp: null,
  liveConnected: false,
  enable: noop,
  disable: noop,
  remove: noop,
  sendTest: noop,
  dismissProblem: () => undefined,
  ...over,
});

let mounted: Mounted | null = null;

beforeEach(() => {
  window.sessionStorage.clear();
  state.configured = true;
  state.loading = false;
  state.push = push({});
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

describe('the permission prompt on arrival', () => {
  it('reads only the permission on every page, not the device list', async () => {
    mounted = await mount(<NotificationPermissionPrompt />);

    expect(state.options).toEqual({ devices: false });
  });

  it('asks the browser once by itself and shows the banner until the person answers', async () => {
    const enable = vi.fn(noop);
    state.push = push({ enable });
    mounted = await mount(<NotificationPermissionPrompt />);

    expect(enable).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(PUSH_ASKED_KEY)).toBe('1');
    const banner = mounted.host.querySelector('[data-testid="notification-permission-prompt"]');
    expect(banner?.textContent).toContain(text('notifications.prefs.push.prompt.message'));
  });

  it('does not ask again on the next page of the same session, but keeps the button for the person', async () => {
    window.sessionStorage.setItem(PUSH_ASKED_KEY, '1');
    const enable = vi.fn(noop);
    state.push = push({ enable });
    mounted = await mount(<NotificationPermissionPrompt />);

    expect(enable).not.toHaveBeenCalled();
    await click(button(mounted.host, text('notifications.prefs.push.prompt.enable')));
    expect(enable).toHaveBeenCalledTimes(1);
  });

  it('asks once across two mounts in one session (onboarding, then the app layout)', async () => {
    const enable = vi.fn(noop);
    state.push = push({ enable });
    mounted = await mount(<NotificationPermissionPrompt />);
    await mounted.unmount();
    mounted = await mount(<NotificationPermissionPrompt />);

    expect(enable).toHaveBeenCalledTimes(1);
  });

  it('shows nothing once the browser is answered (granted or denied)', async () => {
    const enable = vi.fn(noop);
    state.push = push({ enable, state: 'blocked', permission: 'denied' });
    mounted = await mount(<NotificationPermissionPrompt />);

    expect(enable).not.toHaveBeenCalled();
    expect(mounted.host.querySelector('[data-testid="notification-permission-prompt"]')).toBeNull();
  });

  it('shows nothing when the deployment has no push keys', async () => {
    state.configured = false;
    const enable = vi.fn(noop);
    state.push = push({ enable });
    mounted = await mount(<NotificationPermissionPrompt />);

    expect(enable).not.toHaveBeenCalled();
    expect(mounted.host.innerHTML).toBe('');
  });
});
