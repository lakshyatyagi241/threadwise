// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallingReadiness } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { loadMessages } from '@/i18n/messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  rows: [] as unknown[],
  mutate: vi.fn(),
  isPending: false,
}));

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('../api/readiness', () => ({
  useCallingReadiness: () => ({ data: { rows: state.rows } }),
  useCheckReadiness: () => ({
    mutate: state.mutate,
    isPending: state.isPending,
    isError: false,
  }),
}));
vi.mock('./test-call-button', () => ({ TestCallButton: () => null }));

import { ReadinessCard } from './readiness-card';

const NUMBER = '4f0c1f6e-5b0b-4a52-9d0a-0c4a1d0a6b11';
let host: HTMLElement;
let root: Root;

const row = (checkedAt: string | null): CallingReadiness => ({
  numberId: NUMBER,
  phoneNumber: '+919800000001',
  displayLabel: null,
  connectionStatus: 'connected',
  status: 'ready_to_enable',
  callingEnabled: false,
  metaCallingStatus: 'DISABLED',
  checkedAt,
  source: 'manual',
  checks: [{ key: 'calling_enabled', state: 'fail', code: 'calling_off' }],
});

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
          <ReadinessCard numberId={NUMBER} />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  state.perms = new Set(['call.calls.use', 'call.calling.manage']);
  state.isPending = false;
  state.mutate.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the readiness card checks for itself', () => {
  it('looks again, once, when the result has never been taken or is old, as a health check (the one the server shares)', () => {
    state.rows = [row(null)];
    mount();
    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(state.mutate).toHaveBeenCalledWith({ id: NUMBER, source: 'health' });
  });

  it('leaves a fresh result alone', () => {
    state.rows = [row(new Date().toISOString())];
    mount();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('does not check for someone who may not change calling', () => {
    state.perms = new Set(['call.calls.use']);
    state.rows = [row(null)];
    mount();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('Check again asks for a manual check', () => {
    state.rows = [row(new Date().toISOString())];
    mount();
    const button = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Check again',
    );
    expect(button).toBeTruthy();
    act(() => button!.click());
    expect(state.mutate).toHaveBeenCalledWith({ id: NUMBER, source: 'manual' }, expect.any(Object));
  });

  it('is busy while the check runs', () => {
    state.isPending = true;
    state.rows = [row(new Date().toISOString())];
    mount();
    const button = host.querySelector('button')!;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });
});
