// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import { loadMessages } from '@/i18n/messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NUMBER = '4f0c1f6e-5b0b-4a52-9d0a-0c4a1d0a6b11';
const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  settings: { autoEnableOnConnect: false, rowVersion: null as number | null, updatedAt: null },
  status: 'ready_to_enable',
  saveMutate: vi.fn(),
  toggleMutate: vi.fn(),
  checkMutate: vi.fn(),
}));

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('../api/calling', () => ({
  useCallingNumbers: () => ({
    isPending: false,
    isError: false,
    isSuccess: true,
    data: {
      rows: [
        {
          id: NUMBER,
          phoneNumber: '+919800000001',
          displayLabel: 'Support line',
          connectionStatus: 'connected',
          callingEnabled: false,
          callingEnabledAt: null,
        },
      ],
    },
  }),
  useToggleCalling: () => ({ mutate: state.toggleMutate, isPending: false }),
}));
vi.mock('../api/readiness', () => ({
  useCallingReadiness: () => ({
    data: {
      rows: [
        {
          numberId: NUMBER,
          phoneNumber: '+919800000001',
          displayLabel: 'Support line',
          connectionStatus: 'connected',
          status: state.status,
          callingEnabled: false,
          metaCallingStatus: 'DISABLED',
          checks: [],
          checkedAt: new Date().toISOString(),
          source: 'manual',
        },
      ],
    },
  }),
  useCheckReadiness: () => ({ mutate: state.checkMutate, isPending: false, isError: false }),
  useCallingSettings: () => ({ isError: false, data: state.settings }),
  useSaveCallingSettings: () => ({ mutate: state.saveMutate, isPending: false }),
}));
vi.mock('./calling-provider', () => ({
  CallingProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('./on-call-panel', () => ({ OnCallPanel: () => null }));
vi.mock('./recording-settings-panel', () => ({ RecordingSettingsPanel: () => null }));
vi.mock('./test-call-button', () => ({ TestCallButton: () => null }));

import { CallingSettingsScreen } from './calling-settings-screen';

let host: HTMLElement;
let root: Root;

function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider
        locale="en"
        messages={loadMessages('en')}
        timeZone="UTC"
        onError={(e) => {
          throw e;
        }}
      >
        <ToastProvider dismissLabel="Dismiss">
          <CallingSettingsScreen />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
  });
}

const switchEl = () => host.querySelector<HTMLButtonElement>('button[role="switch"]')!;

beforeEach(() => {
  state.perms = new Set(['call.calls.use', 'call.calling.manage']);
  state.settings = { autoEnableOnConnect: false, rowVersion: null, updatedAt: null };
  state.status = 'ready_to_enable';
  state.saveMutate.mockReset();
  state.toggleMutate.mockReset();
  state.checkMutate.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the automatic switch-on setting', () => {
  it('is off until someone turns it on, and the first save names no version', () => {
    mount();
    expect(switchEl().getAttribute('aria-checked')).toBe('false');
    act(() => switchEl().click());
    expect(state.saveMutate).toHaveBeenCalledWith(
      { autoEnableOnConnect: true },
      expect.any(Object),
    );
  });

  it('carries the version it read on a later save', () => {
    state.settings = { autoEnableOnConnect: true, rowVersion: 3, updatedAt: null };
    mount();
    expect(switchEl().getAttribute('aria-checked')).toBe('true');
    act(() => switchEl().click());
    expect(state.saveMutate).toHaveBeenCalledWith(
      { autoEnableOnConnect: false, rowVersion: 3 },
      expect.any(Object),
    );
  });

  it('can be read but not changed without the calling management right', () => {
    state.perms = new Set(['call.calls.use']);
    mount();
    expect(switchEl().disabled).toBe(true);
  });
});

describe('a number card', () => {
  it('shows its readiness card and, for a blocked number, why pressing Enable will most likely fail', () => {
    state.status = 'blocked';
    mount();
    expect(host.querySelector('[data-testid="readiness-card"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="blocked-hint"]')).toBeTruthy();
    state.status = 'ready_to_enable';
    act(() => root.unmount());
    host.remove();
    mount();
    expect(host.querySelector('[data-testid="blocked-hint"]')).toBeNull();
  });

  it('looks at the number again after a person turned calling on, so the card never says "off"', () => {
    state.toggleMutate.mockImplementation((_input: unknown, opts: { onSuccess: () => void }) =>
      opts.onSuccess(),
    );
    mount();
    const enable = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Enable calling',
    );
    act(() => enable!.click());
    expect(state.toggleMutate).toHaveBeenCalledWith(
      { id: NUMBER, enable: true },
      expect.any(Object),
    );
    expect(state.checkMutate).toHaveBeenCalledWith({ id: NUMBER, source: 'enable' });
  });
});
