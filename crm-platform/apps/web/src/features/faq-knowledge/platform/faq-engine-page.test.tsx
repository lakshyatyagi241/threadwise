// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ERROR_CODES,
  FAQ_EMBEDDING_MODELS,
  FAQ_PLATFORM_DEFAULTS,
  faqRecommendedThreshold,
  type FaqPlatformOverview,
  type OperatorRole,
  type OperatorSessionResponse,
} from '@crm/contracts';
import { OperatorProvider } from '@/features/auth-registration-security/platform/operator-context';
import { ToastProvider } from '@/features/auth-registration-security/platform/ui/toast';
import { ApiError } from '@/lib/api/errors';
import { FaqEnginePage } from './faq-engine-page';

const fetchMock = vi.fn();
vi.mock('@/features/auth-registration-security/platform/operator-fetch', () => ({
  operatorFetch: (path: string, req?: unknown) => fetchMock(path, req),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'faq-knowledge-admin.json'), 'utf8'),
) as Record<string, unknown>;

const ws = {
  workspaceId: '00000000-0000-4000-8000-000000000001',
  name: 'Acme Retail',
  enabled: true,
  faqs: 4,
  variations: 20,
  pending: 2,
  failed: 1,
  matches30d: 10,
  answered30d: 5,
};

function overview(over: Partial<FaqPlatformOverview['stats']> = {}, platformKeyReady = true) {
  return {
    config: {
      ...FAQ_PLATFORM_DEFAULTS,
      defaultThreshold: faqRecommendedThreshold(FAQ_PLATFORM_DEFAULTS.embeddingModel),
      defaultThresholdCustom: false,
      allowedModels: FAQ_EMBEDDING_MODELS.map((m) => ({ ...m })),
    },
    platformKeyReady,
    stats: {
      workspacesEnabled: 2,
      faqs: 4,
      variations: 20,
      ready: 18,
      pending: 0,
      failed: 0,
      staleModel: 0,
      matches30d: 10,
      answered30d: 5,
      embeddingTokens30d: 1234,
      verified30d: 321,
      vetoed30d: 45,
      ...over,
    },
  } satisfies FaqPlatformOverview;
}

let root: Root;
let host: HTMLElement;
let current: FaqPlatformOverview;

/** Routes the mocked API: GET /faq, GET /faq/workspaces, PATCH /faq, POST /faq/reindex. */
function serve() {
  fetchMock.mockImplementation(async (path: string, req?: { method?: string; body?: unknown }) => {
    if (path === '/faq' && !req?.method) return current;
    if (path === '/faq/workspaces') return { data: [ws] };
    if (path === '/faq' && req?.method === 'PATCH') return current;
    if (path === '/faq/reindex') return { queued: 7 };
    throw new Error(`unexpected ${path}`);
  });
}

async function mount(role: OperatorRole = 'super_admin') {
  const session = {
    operator: { id: 'x', email: 'a@b.c', fullName: 'A', role, mfaEnabled: true },
    mfaEnrolmentRequired: false,
    sessionId: 'y',
  } as unknown as OperatorSessionResponse;
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <ToastProvider>
            <OperatorProvider session={session}>
              <FaqEnginePage />
            </OperatorProvider>
          </ToastProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
  await flush();
}

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const text = () => host.textContent ?? '';
const byLabel = (label: string) =>
  [...host.querySelectorAll<HTMLElement>('input,select,button')].find(
    (el) =>
      el.getAttribute('aria-label') === label ||
      (el.id && host.querySelector(`label[for="${el.id}"]`)?.textContent?.startsWith(label)),
  ) as HTMLInputElement;
const button = (name: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)!;
const click = (el: Element) => act(async () => void (el as HTMLElement).click());
async function type(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}
const callsTo = (path: string, method?: string) =>
  fetchMock.mock.calls.filter(
    ([p, r]) => p === path && (method ? r?.method === method : !r?.method),
  );

beforeAll(() => {
  // jsdom has no <dialog> modal support.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
beforeEach(() => {
  fetchMock.mockReset();
  current = overview();
  serve();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('FAQ engine admin page', () => {
  it('shows a no-access state and calls nothing for other operator roles', async () => {
    await mount('support');
    expect(text()).toContain('Only a super admin can see or change the FAQ engine.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the status strip, with the key warning and the stale-vector chip', async () => {
    current = overview({ staleModel: 5, failed: 2 }, false);
    await mount();
    expect(text()).toContain('Missing');
    expect(host.querySelector('a[href="/admin/api-keys"]')).not.toBeNull();
    expect(text()).toContain(
      '5 vectors belong to an older model and match nothing until they are re-embedded',
    );
    expect(text()).toContain('OpenAI text-embedding-3-large');
    expect(text()).toContain('50%');
    await flush();
    expect(text()).toContain('Acme Retail');
  });

  it('shows how many close calls were checked and how many answers were held back', async () => {
    await mount();
    const strip = host.querySelector('section[aria-label="Engine status"]')!.textContent!;
    expect(strip).toContain('Second checks');
    expect(strip).toContain('321');
    expect(strip).toContain('Answers withheld');
    expect(strip).toContain('45');
  });

  it('shows the second check settings as saved', async () => {
    await mount();
    expect(text()).toContain('Second check for close calls');
    expect(byLabel('Allow the second check').getAttribute('aria-checked')).toBe('true');
    expect(byLabel('Check model').value).toBe('openai/gpt-4o-mini');
    expect(byLabel('Second checks per workspace per hour').value).toBe('300');
  });

  it('sends only the second check fields that changed', async () => {
    await mount();
    await click(byLabel('Allow the second check'));
    await type(byLabel('Check model'), ' google/gemini-2.5-flash ');
    await type(byLabel('Second checks per workspace per hour'), '0');
    await click(button('Save changes'));
    const [[, req]] = callsTo('/faq', 'PATCH');
    expect((req as { body: unknown }).body).toEqual({
      verifyEnabled: false,
      verifyModel: 'google/gemini-2.5-flash',
      verifyPerHour: 0,
    });
  });

  it('refuses a bad check model or cap, marks the fields and sends nothing', async () => {
    await mount();
    await type(byLabel('Check model'), 'not a model!');
    await type(byLabel('Second checks per workspace per hour'), '100001');
    await click(button('Save changes'));
    expect(callsTo('/faq', 'PATCH')).toHaveLength(0);
    expect(byLabel('Check model').getAttribute('aria-invalid')).toBe('true');
    expect(byLabel('Second checks per workspace per hour').getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(text()).toContain('Use an OpenRouter model id such as openai/gpt-4o-mini.');
    expect(text()).toContain('Enter a value between 0 and 100,000.');
  });

  it('counts the second check edits as unsaved changes and discards them', async () => {
    await mount();
    expect(text()).toContain('No changes to save.');
    await click(byLabel('Allow the second check'));
    expect(text()).toContain('1 change ready to save');
    await click(button('Discard changes'));
    expect(byLabel('Allow the second check').getAttribute('aria-checked')).toBe('true');
    expect(text()).toContain('No changes to save.');
  });

  it('sends only the changed fields', async () => {
    await mount();
    expect(button('Save changes').disabled).toBe(true);
    await type(byLabel('Maximum FAQs per flow'), '900');
    await click(button('Save changes'));
    const [[, req]] = callsTo('/faq', 'PATCH');
    expect((req as { body: unknown }).body).toEqual({ maxFaqs: 900 });
  });

  it('marks a bad field and sends nothing', async () => {
    await mount();
    await type(byLabel('Maximum variations per FAQ'), '0');
    await click(button('Save changes'));
    expect(callsTo('/faq', 'PATCH')).toHaveLength(0);
    expect(text()).toContain('Enter a value between 1 and 500.');
  });

  it('warns before changing the embedding model and sends it only after the confirm', async () => {
    await mount();
    await type(byLabel('Embedding model'), 'google/gemini-embedding-2');
    await click(button('Save changes'));
    expect(callsTo('/faq', 'PATCH')).toHaveLength(0);
    expect(document.body.textContent).toContain('makes every stored vector again');
    expect(document.body.textContent).toContain('recommended 0.72');
    await click(
      [...document.querySelectorAll('dialog button')].find(
        (b) => b.textContent === 'Save changes',
      )!,
    );
    const [[, req]] = callsTo('/faq', 'PATCH');
    expect((req as { body: unknown }).body).toEqual({
      embeddingModel: 'google/gemini-embedding-2',
    });
  });

  it('asks before turning the engine off and can be cancelled', async () => {
    await mount();
    await click(byLabel('FAQ engine'));
    await click(button('Save changes'));
    expect(document.body.textContent).toContain('stops every workspace from answering');
    await click(button('Cancel'));
    expect(callsTo('/faq', 'PATCH')).toHaveLength(0);
  });

  it('turns the default threshold back to the model with null', async () => {
    current = {
      ...overview(),
      config: { ...overview().config, defaultThresholdCustom: true, defaultThreshold: 0.6 },
    };
    await mount();
    await click(byLabel('Follow the model'));
    await click(button('Save changes'));
    const [[, req]] = callsTo('/faq', 'PATCH');
    expect((req as { body: unknown }).body).toEqual({ defaultThreshold: null });
  });

  it('shows server field errors from errors[].path', async () => {
    await mount();
    fetchMock.mockImplementation(async (path: string, req?: { method?: string }) => {
      if (req?.method === 'PATCH') {
        throw new ApiError(422, ERROR_CODES.VALIDATION_FAILED, 'x', 'req-9', [
          { path: 'generationModel', message: 'bad' },
        ]);
      }
      return path === '/faq' ? current : { data: [ws] };
    });
    await type(byLabel('Generation model'), 'openai/gpt-4o');
    await click(button('Save changes'));
    await flush();
    expect(byLabel('Generation model').getAttribute('aria-invalid')).toBe('true');
  });

  it('confirms before re-indexing and reports the queued count', async () => {
    await mount();
    await click(button('Re-index everything'));
    expect(callsTo('/faq/reindex')).toHaveLength(0);
    await click(
      [...document.querySelectorAll('dialog button')].find(
        (b) => b.textContent === 'Re-index everything',
      )!,
    );
    const [[, req]] = callsTo('/faq/reindex', 'POST');
    expect((req as { body: unknown }).body).toEqual({ scope: 'all' });
    expect(document.body.textContent).toContain('7 vectors queued.');
  });

  it('retries only the failed vectors, and the button waits for something to retry', async () => {
    await mount();
    expect(button('Retry failed').disabled).toBe(true);
    await act(async () => root.unmount());
    root = createRoot(host);
    current = overview({ failed: 3 });
    await mount();
    await click(button('Retry failed'));
    await click(
      [...document.querySelectorAll('dialog button')].find(
        (b) => b.textContent === 'Retry failed',
      )!,
    );
    const [[, req]] = callsTo('/faq/reindex', 'POST');
    expect((req as { body: unknown }).body).toEqual({ scope: 'failed' });
  });

  it('polls every 5 s while vectors wait and stops when none do', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    current = overview({ ready: 10, pending: 10 });
    await mount();
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
    const reads = () => callsTo('/faq').length;
    const first = reads();
    await act(async () => void (await vi.advanceTimersByTimeAsync(5100)));
    expect(reads()).toBe(first + 1);
    current = overview({ ready: 20, pending: 0 });
    await act(async () => void (await vi.advanceTimersByTimeAsync(5100)));
    const settled = reads();
    expect(settled).toBe(first + 2);
    await act(async () => void (await vi.advanceTimersByTimeAsync(20000)));
    expect(reads()).toBe(settled);
    expect(text()).toContain('Nothing is waiting to be indexed.');
  });

  it('debounces the workspace search', async () => {
    await mount();
    const box = byLabel('Search workspaces');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await type(box, 'ac');
    await type(box, 'acm');
    expect(callsTo('/faq/workspaces').some(([, r]) => r.query.search === 'acm')).toBe(false);
    await act(async () => void (await vi.advanceTimersByTimeAsync(400)));
    const withSearch = callsTo('/faq/workspaces').filter(([, r]) => r.query.search);
    expect(withSearch).toHaveLength(1);
    expect(withSearch[0]![1].query).toEqual({ search: 'acm', limit: 25 });
  });

  it('shows the empty state for a search with no rows', async () => {
    await mount();
    fetchMock.mockImplementation(async (path: string) =>
      path === '/faq' ? current : { data: [] },
    );
    await type(byLabel('Rows'), '50');
    await flush();
    expect(text()).toContain('No workspaces yet');
  });

  it('shows an error block with a retry when the overview fails', async () => {
    fetchMock.mockImplementation(async () => {
      throw new ApiError(500, 'INTERNAL', 'x', 'req-7');
    });
    await mount();
    expect(text()).toContain('req-7');
    expect(button('Try again')).toBeDefined();
  });
});
