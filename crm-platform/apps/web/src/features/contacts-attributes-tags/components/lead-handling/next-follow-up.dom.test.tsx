// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import { loadMessages } from '@/i18n/messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  perms: new Set<string>(),
  done: vi.fn(),
  snooze: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => api.perms.has(p),
  useSession: () => ({ org: { timezone: 'UTC' }, permissions: {} }),
}));
vi.mock('../../api/lead-handling', () => ({
  completeFollowUp: (id: string) => api.done(id),
  snoozeFollowUp: (id: string, preset: string) => api.snooze(id, preset),
  setFollowUp: (id: string, dueAt: string | null) => api.set(id, dueAt),
  clearFollowUp: (id: string) => api.clear(id),
}));

import { FollowUpCell, isOverdue, NextFollowUpRow } from './next-follow-up';

const ID = '294dca7c-5806-4548-9035-dcca9befc7b1';
const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
const past = new Date(Date.now() - 2 * 86_400_000).toISOString();

let host: HTMLElement;
let root: Root;
const en = loadMessages('en') as unknown as Record<string, Record<string, unknown>>;
const fu = (key: string): string =>
  (
    (en['contacts-attributes-tags']!.leadHandling as Record<string, Record<string, string>>)
      .followUp as Record<string, string>
  )[key]!;

function mount(ui: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider dismissLabel="Dismiss">{ui}</ToastProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
}
const btn = (name: string) =>
  [...host.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find(
    (b) => b.textContent?.trim() === name,
  );
const click = (el: Element | undefined) =>
  act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

beforeEach(() => {
  api.perms = new Set(['record.contacts.update']);
  api.done.mockReset().mockResolvedValue({ nextFollowUp: null });
  api.snooze
    .mockReset()
    .mockResolvedValue({ nextFollowUp: { id: 'x', dueAt: future, assigneeId: null } });
  api.set.mockReset();
  api.clear.mockReset();
});
afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
});

describe('isOverdue', () => {
  it('is true for a dated follow-up in the past only; someday is never overdue', () => {
    expect(isOverdue({ id: 'a', dueAt: past, assigneeId: null })).toBe(true);
    expect(isOverdue({ id: 'a', dueAt: future, assigneeId: null })).toBe(false);
    expect(isOverdue({ id: 'a', dueAt: null, assigneeId: null })).toBe(false);
  });
});

describe('the next follow-up row', () => {
  it('draws nothing for a contact without a follow-up, so a workspace that does not use them sees no chrome', () => {
    mount(<NextFollowUpRow contactId={ID} followUp={null} />);
    expect(host.textContent).toBe('');
  });

  it('shows the date, flags an overdue one, and says "Someday" for a follow-up without a date', () => {
    mount(<NextFollowUpRow contactId={ID} followUp={{ id: 'a', dueAt: past, assigneeId: null }} />);
    expect(host.textContent).toContain(fu('title'));
    expect(host.textContent).toContain(fu('overdue'));
    act(() => root.unmount());
    host.remove();
    mount(<NextFollowUpRow contactId={ID} followUp={{ id: 'a', dueAt: null, assigneeId: null }} />);
    expect(host.textContent).toContain(fu('somedayLabel'));
    expect(host.textContent).not.toContain(fu('overdue'));
  });

  it('Done completes it', async () => {
    mount(
      <NextFollowUpRow contactId={ID} followUp={{ id: 'a', dueAt: future, assigneeId: null }} />,
    );
    await click(btn(fu('done')));
    expect(api.done).toHaveBeenCalledWith(ID);
  });

  it('Snooze offers 1 day, 3 days and next week', async () => {
    mount(
      <NextFollowUpRow contactId={ID} followUp={{ id: 'a', dueAt: future, assigneeId: null }} />,
    );
    await click(btn(fu('snooze')));
    await click(btn(fu('snoozeThreeDays')));
    expect(api.snooze).toHaveBeenCalledWith(ID, 'three_days');
  });

  it('shows no actions to a person who cannot edit the contact', () => {
    api.perms = new Set();
    mount(
      <NextFollowUpRow contactId={ID} followUp={{ id: 'a', dueAt: future, assigneeId: null }} />,
    );
    expect(btn(fu('done'))).toBeUndefined();
    expect(host.textContent).toContain(fu('title'));
  });
});

describe('the list cell', () => {
  it('is a dash without a follow-up, "Someday" without a date, and red when overdue', () => {
    mount(<FollowUpCell followUp={null} locale="en" timeZone="UTC" />);
    expect(host.textContent).toBe('-');
    act(() => root.unmount());
    host.remove();
    mount(<FollowUpCell followUp={{ id: 'a', dueAt: null }} locale="en" timeZone="UTC" />);
    expect(host.textContent).toBe(fu('somedayLabel'));
    act(() => root.unmount());
    host.remove();
    mount(<FollowUpCell followUp={{ id: 'a', dueAt: past }} locale="en" timeZone="UTC" />);
    expect(host.querySelector('.text-danger')).not.toBeNull();
  });
});
