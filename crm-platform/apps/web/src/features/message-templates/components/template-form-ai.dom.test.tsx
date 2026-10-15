// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionResponse, TplAiDraft, WabaConnection } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { loadMessages } from '@/i18n/messages';
import { KEYS } from '../api/hooks';
import { aiApi } from '../api/service';
import { AI_DRAFT_STORAGE_KEY, stashAiDraft } from '../lib/ai-draft';
import { TemplateFormScreen } from './template-form-screen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute('open');
};
// The form reads the screen's own wiring only; the preview animates with this in a browser.
globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) => setTimeout(cb, 0)) as never;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/templates/new',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('../api/service', async (orig) => ({
  ...(await orig<typeof import('../api/service')>()),
  templatesApi: {
    get: vi.fn().mockRejectedValue(new Error('none')),
    lint: vi.fn().mockResolvedValue({ issues: [] }),
  },
  connectionsApi: { list: vi.fn() },
  aiApi: { models: vi.fn(), generate: vi.fn() },
}));
const generate = vi.mocked(aiApi.generate);

const CONN_A = '00000000-0000-4000-8000-0000000000a1';
const CONN_B = '00000000-0000-4000-8000-0000000000b2';
const conn = (id: string, label: string): WabaConnection =>
  ({
    id,
    status: 'connected',
    hasToken: true,
    isPrimary: id === CONN_A,
    displayLabel: label,
    phoneNumber: null,
    verifiedName: null,
  }) as unknown as WabaConnection;

const DRAFT: TplAiDraft = {
  name: 'spring_sale',
  header: 'Spring sale',
  body: 'Hi {{1}}, 20% off this week.',
  footer: 'Reply STOP',
  buttons: [
    { type: 'URL', text: 'Shop now', url: 'https://x.test' },
    { type: 'QUICK_REPLY', text: 'Later' },
  ],
};

let root: Root;
function mount(props: { connectionId?: string } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(KEYS.connections, { items: [conn(CONN_A, 'Acme'), conn(CONN_B, 'Acme 2')] });
  qc.setQueryData(KEYS.aiModels, {
    data: [
      { value: 'gpt-4o-mini', provider: 'openai', providerName: 'OpenAI', source: 'platform' },
    ],
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const session = {
    permissions: { 'tpl.templates.create': true },
    org: { name: 'Acme', timezone: 'UTC' },
    effectiveTimezone: 'UTC',
  } as unknown as SessionResponse;
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <QueryClientProvider client={qc}>
          <SessionProvider session={session}>
            <ToastProvider dismissLabel="Dismiss">
              <TemplateFormScreen {...props} />
            </ToastProvider>
          </SessionProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
}

const field = <T extends HTMLElement>(label: string) =>
  [...document.querySelectorAll('label')]
    .filter((l) => l.textContent?.trim().startsWith(label))
    .map((l) => document.getElementById(l.htmlFor) as T)[0]!;
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;
function setValue(el: HTMLElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}

beforeEach(() => {
  generate.mockReset();
  window.sessionStorage.clear();
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('the template form and Build with AI', () => {
  it('fills name, header, body, footer and buttons from the answer, with a review toast, and submits nothing', async () => {
    generate.mockResolvedValue({ template: DRAFT, model: 'gpt-4o-mini' });
    mount();
    await act(async () => button('Build with AI').click());
    setValue(document.getElementById('tpl-ai-model')!, 'openai:gpt-4o-mini');
    setValue(document.getElementById('tpl-ai-business')!, 'Acme');
    await act(async () => button('Generate template').click());

    // Language and category come from the form (Utility and en_US by default).
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ metaCategory: 'UTILITY', language: 'en_US' }),
    );
    expect(field<HTMLInputElement>('Template name').value).toBe('spring_sale');
    expect(document.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(DRAFT.body);
    expect(document.body.textContent).toContain(
      'Template draft filled from AI. Review it before you submit.',
    );
    const inputs = [...document.querySelectorAll('input')].map((i) => i.value);
    expect(inputs).toEqual(
      expect.arrayContaining(['Spring sale', 'Reply STOP', 'Shop now', 'Later']),
    );
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('is disabled for an Authentication template, with its hint', () => {
    mount();
    setValue(field<HTMLSelectElement>('Category'), 'AUTHENTICATION');
    expect(button('Build with AI').disabled).toBe(true);
    expect(document.body.textContent).toContain('Authentication templates have a fixed text');
  });

  it('picks up a draft the wizard left in this tab, once, with its language and category', () => {
    stashAiDraft({ draft: DRAFT, language: 'en_GB', metaCategory: 'MARKETING' });
    mount();
    expect(field<HTMLInputElement>('Template name').value).toBe('spring_sale');
    expect(field<HTMLSelectElement>('Category').value).toBe('MARKETING');
    expect(field<HTMLSelectElement>('Language').value).toBe('en_GB');
    expect(window.sessionStorage.getItem(AI_DRAFT_STORAGE_KEY)).toBeNull();
    expect(document.body.textContent).toContain('Template draft filled from AI.');
  });

  it('opens on the number the wizard sent from', () => {
    mount({ connectionId: CONN_B });
    expect(field<HTMLSelectElement>('WhatsApp number').value).toBe(CONN_B);
  });

  it('an empty tab starts with an empty form', () => {
    mount();
    expect(field<HTMLInputElement>('Template name').value).toBe('');
    expect(document.body.textContent).not.toContain('Template draft filled from AI.');
  });
});
