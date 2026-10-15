// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ToastProvider } from '@crm/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  view: null as string | null,
  perms: new Set<string>(),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () =>
    new URLSearchParams(state.view ? `tab=faqs&view=${state.view}` : 'tab=faqs'),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('../api/hooks', () => ({
  KEYS: { flowNodes: (id: string) => ['faq', 'flow-nodes', id] },
  useFaqSummary: () => ({ data: { unresolvedUnanswered: 4 } }),
  useFaqSettings: () => ({ data: undefined }),
}));
const screen = vi.hoisted(() => (name: string) => () => <p>screen:{name}</p>);
vi.mock('./list-screen', () => ({ FaqListScreen: screen('list') }));
vi.mock('./editor-screen', () => ({
  FaqEditorScreen: ({ id }: { id?: string }) => <p>screen:editor:{id ?? 'new'}</p>,
}));
vi.mock('./playground-screen', () => ({ PlaygroundScreen: screen('test') }));
vi.mock('./unanswered-screen', () => ({ UnansweredScreen: screen('unanswered') }));
vi.mock('./insights-screen', () => ({ InsightsScreen: screen('insights') }));
vi.mock('./settings-screen', () => ({ SettingsScreen: screen('settings') }));

import { FaqPanel } from './faq-panel';

const en = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'faq-knowledge.json'), 'utf8'),
) as Record<string, unknown>;
const FLOW = '00000000-0000-4000-8000-0000000000aa';
const FAQ = '11111111-2222-4333-8444-555555555555';

let host: HTMLElement;
let root: Root;
async function mount() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider dismissLabel="Dismiss">
            <FaqPanel flowId={FLOW} flowName="Support bot" />
          </ToastProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
}
const links = () =>
  [...host.querySelectorAll<HTMLAnchorElement>('nav a')].map((a) => [
    a.textContent,
    a.getAttribute('href'),
    a.getAttribute('aria-current'),
  ]);

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  state.view = null;
  state.perms = new Set(['faq.entries.read', 'faq.insights.read']);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('the FAQs tab panel', () => {
  it('opens the list when the address has no view, with the five screens as links into this flow', async () => {
    await mount();
    expect(host.textContent).toContain('screen:list');
    expect(links()).toEqual([
      ['FAQs', `/flows/simple/${FLOW}?tab=faqs`, 'page'],
      ['Test', `/flows/simple/${FLOW}?tab=faqs&view=test`, null],
      ['Unanswered4', `/flows/simple/${FLOW}?tab=faqs&view=unanswered`, null],
      ['Insights', `/flows/simple/${FLOW}?tab=faqs&view=insights`, null],
      ['Settings', `/flows/simple/${FLOW}?tab=faqs&view=settings`, null],
    ]);
  });

  it.each([
    ['new', 'screen:editor:new', 'FAQs'],
    [FAQ, `screen:editor:${FAQ}`, 'FAQs'],
    ['test', 'screen:test', 'Test'],
    ['unanswered', 'screen:unanswered', 'Unanswered4'],
    ['insights', 'screen:insights', 'Insights'],
    ['settings', 'screen:settings', 'Settings'],
  ])('?view=%s shows its screen and marks its tab', async (view, shown, tab) => {
    state.view = view;
    await mount();
    expect(host.textContent).toContain(shown);
    expect(
      links()
        .filter((l) => l[2] === 'page')
        .map((l) => l[0]),
    ).toEqual([tab]);
  });

  it('falls back to the list for an unknown view', async () => {
    state.view = 'bogus';
    await mount();
    expect(host.textContent).toContain('screen:list');
  });

  it('hides the screens a role cannot read', async () => {
    state.perms = new Set(['faq.entries.read']);
    await mount();
    expect(links().map((l) => l[0])).toEqual(['FAQs', 'Test', 'Settings']);
  });
});
