// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { id } from '../lib/fixtures';

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
    isPending: false,
    isError: false,
  }),
}));

import { TagFilter, type TagFilterProps } from './tag-filter';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'team-inbox-conversations.json'), 'utf8'),
) as Record<string, unknown>;

let root: Root | null = null;
let host: HTMLElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
});
async function show(p: TagFilterProps) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <TagFilter {...p} />
      </NextIntlClientProvider>,
    );
  });
  return host;
}
const click = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

describe('the inbox tag filter', () => {
  it('offers a Conversation tags | Contact tags switch that reports the choice', async () => {
    const onScopeChange = vi.fn();
    const onChange = vi.fn();
    const h = await show({
      value: [],
      onChange,
      scope: 'conversation',
      onScopeChange,
    });
    expect(h.querySelector('[data-testid="inbox-tag-filter"]')!.textContent).toBe('Tags');
    await click(h.querySelector('[data-testid="inbox-tag-filter"]')!);
    const conversation = document.querySelector('[data-testid="inbox-tag-scope-conversation"]')!;
    const contact = document.querySelector('[data-testid="inbox-tag-scope-contact"]')!;
    expect(conversation.textContent).toBe('Conversation tags');
    expect(contact.textContent).toBe('Contact tags');
    expect(conversation.getAttribute('aria-pressed')).toBe('true');
    expect(contact.getAttribute('aria-pressed')).toBe('false');
    await click(contact);
    expect(onScopeChange).toHaveBeenCalledWith('contact');
  });

  it('shows the thread count only for conversation tags, where it is true', async () => {
    const h = await show({
      value: [id(41)],
      onChange: vi.fn(),
      scope: 'conversation',
      onScopeChange: vi.fn(),
    });
    expect(h.querySelector('[data-testid="inbox-tag-filter"]')!.textContent).toBe('1 tag');
    await click(h.querySelector('[data-testid="inbox-tag-filter"]')!);
    expect(document.body.textContent).toContain('3');
    await act(async () => root?.unmount());
    host.remove();

    await show({ value: [id(41)], onChange: vi.fn(), scope: 'contact', onScopeChange: vi.fn() });
    await click(host.querySelector('[data-testid="inbox-tag-filter"]')!);
    const list = document.querySelector('ul')!;
    expect(list.textContent).toContain('VIP');
    expect(list.textContent).not.toContain('3');
  });
});
