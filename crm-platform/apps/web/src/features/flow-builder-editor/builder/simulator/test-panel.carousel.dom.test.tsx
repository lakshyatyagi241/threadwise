// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry } from './simulator';
import { LogBubble } from './test-panel';

vi.mock('../../api/flows', () => ({ flowsApi: { testWebhook: vi.fn() } }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const carousel: LogEntry = {
  kind: 'bot',
  text: '',
  cards: [
    {
      image: null,
      title: 'Card',
      text: 'Text',
      buttons: [
        { label: 'Pick', exit: 1, href: null },
        { label: 'Site', exit: null, href: 'https://example.com' },
      ],
    },
  ],
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const mount = async (ui: ReactElement) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(ui);
  });
  return host;
};

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('carousel buttons in the test chat', () => {
  it('a reply button reports its label and exit when the run is waiting', async () => {
    const onCardTap = vi.fn();
    const el = await mount(<LogBubble entry={carousel} live onCardTap={onCardTap} />);
    const pick = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Pick');
    expect(pick).toBeDefined();
    expect(pick!.disabled).toBe(false);
    await act(async () => {
      pick!.click();
    });
    expect(onCardTap).toHaveBeenCalledWith('Pick', 1);
  });

  it('a reply button is disabled when the run is not waiting and the entry cannot be rewound', async () => {
    const el = await mount(<LogBubble entry={carousel} onCardTap={vi.fn()} />);
    const pick = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Pick');
    expect(pick!.disabled).toBe(true);
  });

  it('a link button stays a link to its address', async () => {
    const el = await mount(<LogBubble entry={carousel} live onCardTap={vi.fn()} />);
    const link = el.querySelector('a[href="https://example.com"]');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('target')).toBe('_blank');
  });
});
