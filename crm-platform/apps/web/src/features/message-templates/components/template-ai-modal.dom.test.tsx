// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiModelOption, TplAiDraft } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { loadMessages } from '@/i18n/messages';
import { KEYS } from '../api/hooks';
import { aiApi } from '../api/service';
import { TemplateAiModal } from './template-ai-modal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no modal <dialog>: open and close it by its attribute, which is all the dialog needs.
HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute('open');
};

vi.mock('../api/service', async (orig) => ({
  ...(await orig<typeof import('../api/service')>()),
  aiApi: { models: vi.fn(), generate: vi.fn() },
}));
const generate = vi.mocked(aiApi.generate);

const model = (over: Partial<AiModelOption> = {}): AiModelOption => ({
  value: 'gpt-4o-mini',
  provider: 'openai',
  providerName: 'OpenAI',
  source: 'platform',
  ...over,
});
const DRAFT: TplAiDraft = {
  name: 'spring_sale',
  header: 'Spring sale',
  body: 'Hi {{1}}, 20% off.',
  footer: null,
  buttons: [{ type: 'QUICK_REPLY', text: 'Yes' }],
};

let root: Root;
const onDraft = vi.fn();
const onClose = vi.fn();

function mount(models: AiModelOption[] | 'error' | 'pending', props: { note?: string } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (models !== 'error' && models !== 'pending') qc.setQueryData(KEYS.aiModels, { data: models });
  if (models === 'error') {
    qc.setQueryDefaults(KEYS.aiModels, { queryFn: () => Promise.reject(new Error('x')) });
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <QueryClientProvider client={qc}>
          <TemplateAiModal
            open
            onClose={onClose}
            language="en_US"
            metaCategory="MARKETING"
            onDraft={onDraft}
            note={props.note}
          />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
function type(el: HTMLElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}
const generateButton = () =>
  [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Generate template'),
  )!;
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}
const alertText = () => document.querySelector('[role="alert"]')?.textContent ?? '';

beforeEach(() => {
  generate.mockReset();
  onDraft.mockReset();
  onClose.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('Build with AI for a template', () => {
  it('lists the workspace models the writer can call and not the others', () => {
    mount([
      model(),
      model({ provider: 'mistral', providerName: 'Mistral', value: 'large' }),
      model({
        provider: 'anthropic',
        providerName: 'Anthropic',
        value: 'claude-x',
        source: 'workspace',
      }),
    ]);
    const options = [...$('#tpl-ai-model').querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toEqual([
      'Select a model',
      'OpenAI · gpt-4o-mini',
      'Anthropic · claude-x (your key)',
    ]);
  });

  it('shows the empty state and keeps Generate off when no provider is enabled', () => {
    mount([]);
    expect(document.body.textContent).toContain('No AI provider is enabled for this workspace.');
    expect($<HTMLSelectElement>('#tpl-ai-model').disabled).toBe(true);
    expect(generateButton().disabled).toBe(true);
  });

  it('offers every brief field and shows the language read-only', () => {
    mount([model()]);
    expect($<HTMLSelectElement>('#tpl-ai-industry').options).toHaveLength(13);
    expect($<HTMLSelectElement>('#tpl-ai-occasion').options).toHaveLength(13);
    expect($<HTMLSelectElement>('#tpl-ai-purpose').options).toHaveLength(9);
    expect($<HTMLSelectElement>('#tpl-ai-action').options).toHaveLength(8);
    expect($<HTMLSelectElement>('#tpl-ai-tone').options).toHaveLength(7);
    expect($<HTMLInputElement>('#tpl-ai-business').maxLength).toBe(120);
    expect($<HTMLTextAreaElement>('#tpl-ai-notes').maxLength).toBe(2000);
    const lang = $<HTMLInputElement>('#tpl-ai-language');
    expect(lang.readOnly).toBe(true);
    expect(lang.value).toContain('en_US');
  });

  it('says the template still goes to Meta when the caller passes that note', () => {
    mount([model()], { note: 'Meta reviews it first' });
    expect(document.body.textContent).toContain('Meta reviews it first');
  });

  it('needs a model before Generate, and a business name before it calls the server', async () => {
    mount([model()]);
    expect(generateButton().disabled).toBe(true);
    type($('#tpl-ai-model'), 'openai:gpt-4o-mini');
    expect(generateButton().disabled).toBe(false);
    await click(generateButton());
    expect(generate).not.toHaveBeenCalled();
    expect(alertText()).toBe('Business name is required.');
    expect($('#tpl-ai-business').getAttribute('aria-invalid')).toBe('true');
  });

  it('sends the brief, hands the draft over and closes', async () => {
    generate.mockResolvedValue({ template: DRAFT, model: 'gpt-4o-mini' });
    mount([model()]);
    type($('#tpl-ai-model'), 'openai:gpt-4o-mini');
    type($('#tpl-ai-business'), '  Bloomly Florals ');
    type($('#tpl-ai-industry'), 'retail');
    type($('#tpl-ai-tone'), 'friendly');
    type($('#tpl-ai-notes'), 'mention the weekend');
    await click(generateButton());
    expect(generate).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-4o-mini',
      metaCategory: 'MARKETING',
      language: 'en_US',
      businessName: 'Bloomly Florals',
      industry: 'Retail / E-commerce',
      occasion: undefined,
      purpose: undefined,
      action: undefined,
      tone: 'Friendly',
      customPrompt: 'mention the weekend',
    });
    expect(onDraft).toHaveBeenCalledWith(DRAFT);
    expect(onClose).toHaveBeenCalled();
  });

  it.each([
    ['CAMP_AI_NO_KEY', 'No AI provider is enabled for this workspace. Ask an admin to add a key.'],
    ['CAMP_AI_LIMIT_REACHED', 'This workspace has used its AI allowance for the month.'],
    ['CAMP_AI_PROVIDER_FAILED', 'The AI provider did not answer. Try again in a moment.'],
    [
      'CAMP_AI_BAD_JSON',
      "The model's answer was not a usable template. Try again or refine the brief.",
    ],
    [
      'VALIDATION_FAILED',
      'Check the brief: the business name is required and some fields are too long.',
    ],
    ['FORBIDDEN', 'You do not have permission to create templates.'],
    ['SOMETHING_ELSE', 'Could not generate the template. Try again.'],
  ])('%s shows its own sentence and keeps the dialog open', async (code, text) => {
    generate.mockRejectedValue(
      new ApiError(code === 'FORBIDDEN' ? 403 : 422, code, 'server words'),
    );
    mount([model()]);
    type($('#tpl-ai-model'), 'openai:gpt-4o-mini');
    type($('#tpl-ai-business'), 'Acme');
    await click(generateButton());
    expect(alertText()).toBe(text);
    expect(onDraft).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(generateButton().disabled).toBe(false);
  });

  it('a network failure reads as one too', async () => {
    generate.mockRejectedValue(new TypeError('Failed to fetch'));
    mount([model()]);
    type($('#tpl-ai-model'), 'openai:gpt-4o-mini');
    type($('#tpl-ai-business'), 'Acme');
    await click(generateButton());
    expect(alertText()).toContain('Could not reach the server');
  });
});
