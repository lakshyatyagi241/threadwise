// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { id } from '../lib/fixtures';
import { DEFAULT_FILTERS } from '../lib/list';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../api/hooks', () => ({
  useTags: () => ({
    data: {
      data: [
        {
          id: id(41),
          name: 'VIP',
          color: null,
          description: null,
          conversationCount: 3,
          rowVersion: 1,
        },
      ],
    },
  }),
  useAssignees: () => ({
    data: { users: [{ id: id(51), name: 'Asha', email: 'asha@x.test', isMe: false }], teams: [] },
  }),
}));

import { FiltersDialog, type FiltersDialogProps } from './filters-dialog';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'team-inbox-conversations.json'), 'utf8'),
) as Record<string, unknown>;

beforeAll(() => {
  // jsdom has no native <dialog> methods.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

let root: Root | null = null;
let host: HTMLElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
});
async function show(p: Partial<FiltersDialogProps> = {}) {
  const props: FiltersDialogProps = {
    open: true,
    onClose: vi.fn(),
    filters: DEFAULT_FILTERS,
    onApply: vi.fn(),
    channels: [],
    ...p,
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <FiltersDialog {...props} />
      </NextIntlClientProvider>,
    );
  });
  return props;
}
const click = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
const q = (sel: string) => document.querySelector(sel)!;

describe('the inbox Filters window', () => {
  it('shows every section of the console window and hands the chosen filters to Apply', async () => {
    const p = await show();
    const text = document.body.textContent ?? '';
    for (const w of ['Chat status', 'Conversation', 'Tags', 'Agents', 'Sort by', 'Date range']) {
      expect(text).toContain(w);
    }
    await click(q('[data-testid="inbox-filters-status-snoozed"]'));
    await click(q('[data-testid="inbox-filters-status-pending"]'));
    await click(q('[data-testid="inbox-filters-sort-old"]'));
    await click(q('[data-testid="inbox-filters-conversation-unassigned"]'));
    await click(q('[data-testid="inbox-filters-agents"]'));
    await click(document.querySelector('[role="listbox"] input[type="checkbox"]')!);
    await click(q('[data-testid="inbox-filters-apply"]'));
    expect(p.onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        statuses: ['snoozed', 'pending'],
        sort: 'old',
        status: 'open',
        assignment: 'unassigned',
        agentIds: [id(51)],
        channelIds: [],
      }),
    );
    expect(p.onClose).toHaveBeenCalled();
  });

  it('starts from the filters already on, and Reset clears them', async () => {
    const p = await show({
      filters: { ...DEFAULT_FILTERS, statuses: ['snoozed'], agentIds: [id(51)], sort: 'old' },
    });
    expect(q('[data-testid="inbox-filters-status-snoozed"]').getAttribute('aria-pressed')).toBe(
      'true',
    );
    const reset = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Reset')!;
    await click(reset);
    expect(q('[data-testid="inbox-filters-status-snoozed"]').getAttribute('aria-pressed')).toBe(
      'false',
    );
    await click(q('[data-testid="inbox-filters-apply"]'));
    expect(p.onApply).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: [], agentIds: [], sort: 'recent' }),
    );
  });

  it('does not offer Spam: nothing in the inbox marks a thread as spam', async () => {
    await show();
    expect(document.querySelector('[data-testid="inbox-filters-status-spam"]')).toBeNull();
  });

  it('renders nothing while closed', async () => {
    await show({ open: false });
    expect(document.querySelector('[data-testid="inbox-filters-dialog"]')).toBeNull();
  });
});
