// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BulkConversationAction } from '@crm/contracts';
import { summary } from '../lib/fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../api/hooks', () => ({
  useTags: () => ({
    data: {
      data: [
        {
          id: 'l-1',
          name: 'VIP',
          color: '#5B3D8A',
          description: null,
          conversationCount: 2,
          rowVersion: 1,
        },
      ],
    },
  }),
  useAssignees: () => ({
    data: {
      users: [
        {
          id: 'u-me',
          name: 'Me',
          email: 'me@x.test',
          availability: 'online',
          openConversations: 0,
          isMe: true,
          onLeave: null,
        },
        {
          id: 'u-2',
          name: 'Dana',
          email: 'd@x.test',
          availability: 'online',
          openConversations: 2,
          isMe: false,
          onLeave: null,
        },
      ],
      teams: [
        { id: 't-1', name: 'Sales', color: null, memberCount: 3, assignmentStrategy: 'manual' },
      ],
    },
  }),
}));

import { BulkBar, type BulkBarProps } from './bulk-bar';
import { ConversationRow } from './conversation-row';

const messages = (locale: string) =>
  JSON.parse(
    readFileSync(
      join(__dirname, `../../../../messages/${locale}/team-inbox-conversations.json`),
      'utf8',
    ),
  ) as Record<string, unknown>;

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (ui: React.ReactNode, locale = 'en') =>
  act(() => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={messages(locale)}>
        {ui}
      </NextIntlClientProvider>,
    );
  });

const props = (over: Partial<BulkBarProps> = {}): BulkBarProps => ({
  count: 3,
  inView: 30,
  allInViewSelected: false,
  busy: false,
  can: { resolve: true, assign: true, assignSelf: true, priority: true, snooze: true, tag: true },
  meId: 'u-me',
  onSelectAll: vi.fn(),
  onClear: vi.fn(),
  onRun: vi.fn(),
  ...over,
});

const click = (testId: string) =>
  act(() => {
    (host.querySelector(`[data-testid="${testId}"]`) as HTMLElement).click();
  });

const choose = (testId: string, value: string) =>
  act(() => {
    const el = host.querySelector(`[data-testid="${testId}"]`) as HTMLSelectElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

describe('the bulk bar', () => {
  it('says how many are selected and offers select all in view', () => {
    const p = props();
    render(<BulkBar {...p} />);
    expect(host.querySelector('[data-testid="inbox-bulk-count"]')?.textContent).toBe(
      '3 conversations selected',
    );
    expect(host.querySelector('[data-testid="inbox-bulk-all"]')?.textContent).toBe(
      'Select all 30 in view',
    );
    click('inbox-bulk-all');
    expect(p.onSelectAll).toHaveBeenCalledOnce();
    click('inbox-bulk-clear');
    expect(p.onClear).toHaveBeenCalledOnce();
  });

  it('runs the action named on the button', () => {
    const p = props();
    render(<BulkBar {...p} />);
    const ran = () => (p.onRun as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    click('inbox-bulk-read');
    click('inbox-bulk-resolve');
    click('inbox-bulk-close');
    click('inbox-bulk-reopen');
    expect(ran()).toEqual<BulkConversationAction[]>([
      { type: 'mark_read' },
      { type: 'status', status: 'resolved' },
      { type: 'status', status: 'closed' },
      { type: 'status', status: 'open' },
    ]);
  });

  it('assigns to me, to a person, to a team, and unassigns', () => {
    const p = props();
    render(<BulkBar {...p} />);
    choose('inbox-bulk-assign', 'me');
    choose('inbox-bulk-assign', 'u:u-2');
    choose('inbox-bulk-assign', 't:t-1');
    choose('inbox-bulk-assign', 'none');
    expect((p.onRun as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([
      { type: 'assign', userId: 'u-me' },
      { type: 'assign', userId: 'u-2' },
      { type: 'assign', teamId: 't-1' },
      { type: 'assign', userId: null },
    ]);
  });

  it('sets a priority and snoozes to a time in the future', () => {
    const p = props();
    render(<BulkBar {...p} />);
    choose('inbox-bulk-priority', 'urgent');
    choose('inbox-bulk-snooze', 'oneHour');
    const [prio, snooze] = (p.onRun as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(prio).toEqual({ type: 'priority', priority: 'urgent' });
    expect(snooze.type).toBe('snooze');
    expect(Date.parse(snooze.until)).toBeGreaterThan(Date.now() + 3_000_000);
  });

  it('adds or removes a tag on the whole selection', () => {
    const p = props();
    render(<BulkBar {...p} />);
    choose('inbox-bulk-tag', 'add:l-1');
    choose('inbox-bulk-tag', 'remove:l-1');
    expect((p.onRun as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([
      { type: 'tag', mode: 'add', tagId: 'l-1' },
      { type: 'tag', mode: 'remove', tagId: 'l-1' },
    ]);
  });

  it('shows only what the caller may do: a claim-only agent has no resolve, priority or snooze, and can only assign to self', () => {
    const p = props({
      can: {
        resolve: false,
        assign: false,
        assignSelf: true,
        priority: false,
        snooze: false,
        tag: false,
      },
    });
    render(<BulkBar {...p} />);
    expect(host.querySelector('[data-testid="inbox-bulk-resolve"]')).toBeNull();
    expect(host.querySelector('[data-testid="inbox-bulk-priority"]')).toBeNull();
    expect(host.querySelector('[data-testid="inbox-bulk-snooze"]')).toBeNull();
    const options = [...host.querySelectorAll('[data-testid="inbox-bulk-assign"] option')].map(
      (o) => o.textContent,
    );
    expect(options).toEqual(['Assign', 'Assign to me']);
    expect(host.querySelector('[data-testid="inbox-bulk-read"]')).not.toBeNull();
  });

  it('disables every action while a call runs or nothing is selected', () => {
    render(<BulkBar {...props({ busy: true })} />);
    expect(
      (host.querySelector('[data-testid="inbox-bulk-read"]') as HTMLButtonElement).disabled,
    ).toBe(true);
    render(<BulkBar {...props({ count: 0 })} />);
    expect(
      (host.querySelector('[data-testid="inbox-bulk-resolve"]') as HTMLButtonElement).disabled,
    ).toBe(true);
    for (const name of ['assign', 'priority', 'snooze', 'tag']) {
      const select = host.querySelector(`[data-testid="inbox-bulk-${name}"]`) as HTMLSelectElement;
      expect(select.disabled).toBe(true);
      expect(select.className).toContain('disabled:opacity-50');
    }
  });

  it('reads in Arabic, not in English', () => {
    render(<BulkBar {...props()} />, 'ar');
    const text = host.textContent ?? '';
    expect(text).not.toContain('selected');
    expect(text).not.toContain('Mark as read');
    expect(/[؀-ۿ]/.test(host.querySelector('[data-testid="inbox-bulk-count"]')!.textContent!)).toBe(
      true,
    );
  });
});

describe('a conversation row in select mode', () => {
  const row = summary({});

  it('is a checkbox that reports the click and the shift key instead of opening the thread', () => {
    const onOpen = vi.fn();
    const onSelect = vi.fn();
    render(
      <ul>
        <ConversationRow
          row={row}
          active={false}
          nowMs={0}
          showChannel={false}
          onOpen={onOpen}
          selecting
          selected={false}
          onSelect={onSelect}
        />
      </ul>,
    );
    const button = host.querySelector('[data-testid="inbox-row"]') as HTMLElement;
    expect(button.getAttribute('role')).toBe('checkbox');
    expect(button.getAttribute('aria-checked')).toBe('false');
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    });
    expect(onSelect).toHaveBeenCalledWith(row.id, true);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens the thread when not selecting, and is not a checkbox', () => {
    const onOpen = vi.fn();
    render(
      <ul>
        <ConversationRow row={row} active={false} nowMs={0} showChannel={false} onOpen={onOpen} />
      </ul>,
    );
    const button = host.querySelector('[data-testid="inbox-row"]') as HTMLElement;
    expect(button.getAttribute('role')).toBeNull();
    act(() => button.click());
    expect(onOpen).toHaveBeenCalledWith(row.id);
  });
});
