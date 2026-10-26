// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { ToastProvider } from '@crm/ui';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandoffSettings, QueueTimers } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';
import { PlanFeaturesProvider } from '@/lib/plan-features';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const calls = vi.hoisted(() => [] as unknown[]);
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../api/routing', () => ({
  useUpdateHandoffSettings: () => ({
    isPending: false,
    mutate: (input: unknown, o?: { onSuccess?: () => void }) => {
      calls.push(input);
      o?.onSuccess?.();
    },
  }),
}));

import { WaitingQueueSection } from './waiting-queue-section';

const OFF: QueueTimers = {
  remindMinutes: null,
  overflowMinutes: null,
  overflowTeamId: null,
  unclaimedMinutes: null,
  unclaimedAction: 'keep',
  unclaimedMessage: '',
};
const settings = (queueTimers = OFF, available = true): HandoffSettings =>
  ({
    autoAssign: true,
    claimSetsOwner: false,
    ownerMode: 'independent',
    continuityDays: null,
    promptOwnerOnReassign: false,
    notifyQueue: true,
    queueTimers,
    away: { returnUnanswered: false, autoOfflineMinutes: null },
    available: {
      away: available,
      autoAssign: true,
      ownerFirst: true,
      keepInSync: true,
      continuityWindow: true,
      promptOwnerOnReassign: true,
      queueTimers: available,
    },
  }) as HandoffSettings;

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  calls.length = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = (s: HandoffSettings, canManage = true, features: string[] | null = null) =>
  act(() => {
    root.render(
      <PlanFeaturesProvider features={features}>
        <QueryClientProvider client={new QueryClient()}>
          <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
            <ToastProvider>
              <WaitingQueueSection
                settings={s}
                teams={[{ id: 't1', name: 'Desk B' }]}
                canManage={canManage}
              />
            </ToastProvider>
          </NextIntlClientProvider>
        </QueryClientProvider>
      </PlanFeaturesProvider>,
    );
  });
const click = (el: Element | null) => act(() => (el as HTMLElement).click());
const switchOf = (id: string) =>
  host.querySelector(`[data-testid="wq-${id}"] button[role="switch"]`);

describe('the Waiting queue section', () => {
  it('shows every step off by default, with nothing to fill in', () => {
    render(settings());
    expect(host.textContent).toContain('Waiting queue');
    for (const id of ['remind', 'overflow', 'final', 'away', 'offline'])
      expect(switchOf(id)!.getAttribute('aria-checked')).toBe('false');
    expect(host.querySelector('input[type="number"]')).toBeNull();
  });

  it('without Smart routing keeps the note on where unclaimed chats wait and draws none of the steps', () => {
    render(settings(OFF, false));
    expect(host.textContent).toContain('Waiting queue');
    expect(host.querySelector('[data-testid="waiting-queue-note"]')!.textContent).toContain(
      'wait in the Waiting tab until someone claims them',
    );
    for (const id of ['remind', 'overflow', 'final', 'away', 'offline'])
      expect(switchOf(id)).toBeNull();
    expect(host.textContent).not.toContain('Save');
  });

  it('a plan known to lack inbox_routing hides the steps even before the server says so', () => {
    render(settings(), true, ['inbox_sla']);
    expect(switchOf('remind')).toBeNull();
    expect(switchOf('away')).toBeNull();
    expect(host.querySelector('[data-testid="waiting-queue-note"]')).not.toBeNull();
  });

  it('with Smart routing shows every step', () => {
    render(settings(), true, ['inbox_routing']);
    for (const id of ['remind', 'overflow', 'final', 'away', 'offline'])
      expect(switchOf(id)).not.toBeNull();
  });

  it('refuses an incomplete step instead of sending it, then saves a complete one', () => {
    render(settings());
    click(switchOf('overflow'));
    click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Save') ?? null);
    expect(calls).toHaveLength(0);
    expect(host.textContent).toContain('Choose a team.');
    const select = host.querySelector('[data-testid="wq-overflow"] select') as HTMLSelectElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
        select,
        't1',
      );
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Save') ?? null);
    expect(calls).toEqual([
      {
        queueTimers: { ...OFF, overflowMinutes: 20, overflowTeamId: 't1' },
        away: { returnUnanswered: false, autoOfflineMinutes: null },
      },
    ]);
  });

  it('saves the away rules together with the steps', () => {
    render(settings());
    click(switchOf('away'));
    click(switchOf('offline'));
    click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Save') ?? null);
    expect(calls).toEqual([
      { queueTimers: OFF, away: { returnUnanswered: true, autoOfflineMinutes: 30 } },
    ]);
  });

  it('a reader sees the saved steps but cannot change them', () => {
    render(settings({ ...OFF, remindMinutes: 5 }), false);
    expect((switchOf('remind') as HTMLButtonElement).disabled).toBe(true);
    expect((host.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('5');
    expect(host.textContent).toContain('You can see these settings');
  });
});
