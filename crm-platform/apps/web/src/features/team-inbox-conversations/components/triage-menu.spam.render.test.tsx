// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TriageMenu, type TriageMenuProps } from './triage-menu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

async function show(p: Partial<TriageMenuProps> = {}) {
  const props: TriageMenuProps = {
    priority: 'normal',
    snoozed: false,
    spam: false,
    canPriority: false,
    canSnooze: false,
    canWake: false,
    canSpam: true,
    busy: false,
    onPriority: vi.fn(),
    onSnooze: vi.fn(),
    onWake: vi.fn(),
    onSpam: vi.fn(),
    ...p,
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <TriageMenu {...props} />
      </NextIntlClientProvider>,
    );
  });
  return props;
}
const q = (sel: string) => document.querySelector(sel);
const click = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

describe('the thread header spam control', () => {
  it('offers Mark as spam on a live thread, and it calls onSpam', async () => {
    const p = await show();
    expect(q('[data-testid="inbox-not-spam"]')).toBeNull();
    await click(q('[data-testid="inbox-spam"]')!);
    expect(p.onSpam).toHaveBeenCalledTimes(1);
    expect(p.onWake).not.toHaveBeenCalled();
  });

  it('offers Not spam on a spam thread, and it returns the thread to open through onWake', async () => {
    const p = await show({ spam: true });
    expect(q('[data-testid="inbox-spam"]')).toBeNull();
    await click(q('[data-testid="inbox-not-spam"]')!);
    expect(p.onWake).toHaveBeenCalledTimes(1);
    expect(p.onSpam).not.toHaveBeenCalled();
  });

  it('shows neither without the resolve right', async () => {
    await show({ canSpam: false });
    expect(q('[data-testid="inbox-spam"]')).toBeNull();
    expect(q('[data-testid="inbox-not-spam"]')).toBeNull();
  });
});
