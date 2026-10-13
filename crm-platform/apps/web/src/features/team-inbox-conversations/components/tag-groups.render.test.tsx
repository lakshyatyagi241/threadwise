// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { contactSummary, detail, id } from '../lib/fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/link', () => ({
  default: (p: { href: string; children: React.ReactNode; [k: string]: unknown }) => {
    const { href, children, ...rest } = p;
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));
vi.mock('../api/hooks', () => ({
  useTags: () => ({
    data: { data: [] },
    isPending: false,
    isError: false,
  }),
}));

import { TagGroups, type TagGroupsProps } from './tag-groups';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'team-inbox-conversations.json'), 'utf8'),
) as Record<string, unknown>;

const vip = { id: id(31), name: 'VIP', color: '#7B5A14' };
const billing = { id: id(32), name: 'Billing', color: null };

const props = (over: Partial<TagGroupsProps> = {}): TagGroupsProps => ({
  detail: detail({
    contact: null,
    contactSummary: contactSummary({ contactTags: [vip] }),
    labels: [billing],
  }),
  contactId: id(700),
  canEditContact: true,
  tags: { busy: false, canCreate: false, onApply: vi.fn(), onWithdraw: vi.fn() },
  ...over,
});

let root: Root | null = null;
let host: HTMLElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
});
async function show(p: TagGroupsProps) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <TagGroups {...p} />
      </NextIntlClientProvider>,
    );
  });
  return host;
}
const click = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

describe('the two tag groups in the inbox side panel', () => {
  it('keeps contact tags and conversation tags apart, each with its own heading', async () => {
    const h = await show(props());
    const contact = h.querySelector('[data-testid="inbox-contact-tags"]')!;
    const conversation = h.querySelector('[data-testid="inbox-conversation-tags"]')!;
    expect(contact.querySelector('h4')!.textContent).toBe('Contact tags');
    expect(conversation.querySelector('h4')!.textContent).toBe('Conversation tags');
    expect(contact.textContent).toContain('VIP');
    expect(contact.textContent).not.toContain('Billing');
    expect(conversation.textContent).toContain('Billing');
    expect(conversation.textContent).not.toContain('VIP');
  });

  it('links the contact tags to the contact only for someone who may edit it, and never edits them here', async () => {
    const withRight = await show(props());
    const link = withRight.querySelector(
      '[data-testid="inbox-contact-tags-edit"]',
    ) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(`/contacts/${id(700)}`);
    expect(
      withRight.querySelector('[data-testid="inbox-contact-tags"] button[aria-label^="Remove"]'),
    ).toBeNull();
    await act(async () => root?.unmount());
    host.remove();

    const without = await show(props({ canEditContact: false }));
    expect(without.querySelector('[data-testid="inbox-contact-tags-edit"]')).toBeNull();
  });

  it('adds and removes conversation tags only when the person may tag, and says when a group is empty', async () => {
    const onWithdraw = vi.fn();
    const h = await show(
      props({ tags: { busy: false, canCreate: false, onApply: vi.fn(), onWithdraw } }),
    );
    const remove = h.querySelector('button[aria-label="Remove tag Billing"]')!;
    await click(remove);
    expect(onWithdraw).toHaveBeenCalledWith(billing.id);
    expect(h.querySelector('[data-testid="inbox-tag-menu"]')).not.toBeNull();
    await act(async () => root?.unmount());
    host.remove();

    const readOnly = await show(
      props({
        tags: undefined,
        detail: detail({ contact: null, contactSummary: contactSummary(), labels: [] }),
      }),
    );
    expect(readOnly.querySelector('[data-testid="inbox-tag-menu"]')).toBeNull();
    expect(readOnly.querySelector('button[aria-label^="Remove tag"]')).toBeNull();
    expect(readOnly.textContent).toContain('This contact has no tags.');
    expect(readOnly.textContent).toContain('No tags on this conversation yet.');
  });

  it('explains each group in one line from a help button', async () => {
    const h = await show(props());
    const help = h.querySelector(
      '[data-testid="inbox-contact-tags"] button[aria-label="About Contact tags"]',
    )!;
    expect(help.getAttribute('title')).toContain('describes the person');
    const other = h.querySelector(
      '[data-testid="inbox-conversation-tags"] button[aria-label="About Conversation tags"]',
    )!;
    expect(other.getAttribute('title')).toContain('describes this thread');
    expect(h.textContent).toContain('same workspace tag library');
  });
});
