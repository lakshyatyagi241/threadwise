// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TplAiDraft } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { KEYS as TPL_KEYS } from '@/features/message-templates/api/hooks';
import { aiApi } from '@/features/message-templates/api/service';
import { AI_DRAFT_STORAGE_KEY } from '@/features/message-templates/lib/ai-draft';
import { loadMessages } from '@/i18n/messages';
import { ALL_PERMISSIONS, ready, sender, session, templates, uuid } from '../testing';
import { StepTemplate, wabaConnectionOf } from './step-template';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute('open');
};

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/campaigns/wizard',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/features/message-templates/api/service', async (orig) => ({
  ...(await orig<typeof import('@/features/message-templates/api/service')>()),
  aiApi: { models: vi.fn(), generate: vi.fn() },
}));
const generate = vi.mocked(aiApi.generate);

const DRAFT: TplAiDraft = {
  name: 'spring_sale',
  header: null,
  body: 'Hello {{1}}',
  footer: null,
  buttons: [],
};
const SENDER = sender({ key: `waba:${uuid(31)}` });

let root: Root;
function mount(perms: string[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(TPL_KEYS.aiModels, {
    data: [
      { value: 'gpt-4o-mini', provider: 'openai', providerName: 'OpenAI', source: 'platform' },
    ],
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <QueryClientProvider client={qc}>
          <SessionProvider session={session(perms)}>
            <ToastProvider dismissLabel="Dismiss">
              <StepTemplate
                name="Spring"
                templateId={null}
                senderKey={SENDER.key}
                senders={[SENDER]}
                templates={ready({ data: templates() })}
                issues={[]}
                onName={() => undefined}
                onTemplate={() => undefined}
                onSender={() => undefined}
              />
            </ToastProvider>
          </SessionProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
}
const buttonByText = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

function setValue(el: Element, value: string, event: 'input' | 'change') {
  const proto =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(event, { bubbles: true }));
  });
}

beforeEach(() => {
  push.mockReset();
  generate.mockReset();
  window.sessionStorage.clear();
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('Build with AI next to the template picker', () => {
  it('is hidden without the permission to create templates', () => {
    mount(ALL_PERMISSIONS);
    expect(buttonByText('Build with AI')).toBeUndefined();
    expect(document.getElementById('tpl-ai-model')).toBeNull();
  });

  it('is there with the permission, and the dialog says Meta reviews the template first', () => {
    mount([...ALL_PERMISSIONS, 'tpl.templates.create']);
    expect(buttonByText('Build with AI')).toBeDefined();
    expect(document.body.textContent).toContain('Meta then reviews it before it can be sent');
  });

  it('keeps the draft in this tab and opens the new-template form on the sender number', async () => {
    generate.mockResolvedValue({ template: DRAFT, model: 'gpt-4o-mini' });
    mount([...ALL_PERMISSIONS, 'tpl.templates.create']);
    await act(async () => buttonByText('Build with AI')!.click());
    setValue(document.getElementById('tpl-ai-model')!, 'openai:gpt-4o-mini', 'change');
    setValue(document.getElementById('tpl-ai-business')!, 'Acme', 'input');
    await act(async () => buttonByText('Generate template')!.click());

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        metaCategory: 'MARKETING',
        language: 'en_US',
        businessName: 'Acme',
      }),
    );
    const stored = JSON.parse(window.sessionStorage.getItem(AI_DRAFT_STORAGE_KEY)!) as Record<
      string,
      unknown
    >;
    expect(stored).toMatchObject({ draft: DRAFT, language: 'en_US', metaCategory: 'MARKETING' });
    expect(push).toHaveBeenCalledWith(`/templates/new?connection=${uuid(31)}`);
  });

  it('a failed generation stores nothing and goes nowhere', async () => {
    generate.mockRejectedValue(new Error('boom'));
    mount([...ALL_PERMISSIONS, 'tpl.templates.create']);
    await act(async () => buttonByText('Build with AI')!.click());
    setValue(document.getElementById('tpl-ai-model')!, 'openai:gpt-4o-mini', 'change');
    setValue(document.getElementById('tpl-ai-business')!, 'Acme', 'input');
    await act(async () => buttonByText('Generate template')!.click());
    expect(window.sessionStorage.getItem(AI_DRAFT_STORAGE_KEY)).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('wabaConnectionOf', () => {
  it('reads the connection of a Meta number and nothing else', () => {
    expect(wabaConnectionOf(`waba:${uuid(7)}`)).toBe(uuid(7));
    expect(wabaConnectionOf(`twilio:${uuid(7)}`)).toBeNull();
    expect(wabaConnectionOf(null)).toBeNull();
  });
});
