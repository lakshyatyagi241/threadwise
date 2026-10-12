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
  LSC_MODELS,
  LSC_PLATFORM_DEFAULTS,
  type LscPlatformOverview,
  type LscPlatformRun,
  type OperatorRole,
  type OperatorSessionResponse,
} from '@crm/contracts';
import { OperatorProvider } from '@/features/auth-registration-security/platform/operator-context';
import { ToastProvider } from '@/features/auth-registration-security/platform/ui/toast';
import { ApiError } from '@/lib/api/errors';
import { LeadScoringPage } from './lead-scoring-page';

const fetchMock = vi.fn();
vi.mock('@/features/auth-registration-security/platform/operator-fetch', () => ({
  operatorFetch: (path: string, req?: unknown) => fetchMock(path, req),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'lead-scoring-admin.json'), 'utf8'),
) as Record<string, unknown>;

const WS1 = '00000000-0000-4000-8000-000000000001';
const ws = {
  workspaceId: WS1,
  name: 'Acme Retail',
  enabled: true,
  contactsScored: 12,
  scores30d: 40,
  costUsd30d: '0.00480000',
};

const totals = (over: Partial<LscPlatformOverview['last24h']> = {}) => ({
  scores: 5,
  failed: 1,
  promptTokens: 4000,
  completionTokens: 500,
  costUsd: '0.00060000',
  avgCostPerScoreUsd: '0.00012000',
  platformCostUsd: '0.00040000',
  ...over,
});

function overview(platformKeyReady = true, enabled = false): LscPlatformOverview {
  return {
    config: {
      ...LSC_PLATFORM_DEFAULTS,
      platformEnabled: enabled,
      models: LSC_MODELS.map((m) => ({ ...m })),
    },
    platformKeyReady,
    workspacesEnabled: 2,
    contactsScored: 31,
    last24h: totals(),
    last30d: totals({
      scores: 0,
      costUsd: '0.00000000',
      avgCostPerScoreUsd: null,
      platformCostUsd: '0.00000000',
    }),
  };
}

function run(n: number, over: Partial<LscPlatformRun> = {}): LscPlatformRun {
  return {
    id: `run-${n}`,
    createdAt: '2026-10-12T10:00:00.000Z',
    contactId: `c${n}`,
    contactName: `Contact ${n}`,
    status: 'ok',
    trigger: 'created',
    score: 72,
    previousScore: 65,
    reasons: [],
    model: 'openai/gpt-6-luna-pro',
    promptTokens: 900,
    completionTokens: 100,
    costUsd: '0.00012000',
    costSource: 'vendor',
    billedAgainst: 'admin',
    durationMs: 1500,
    error: null,
    workspaceId: WS1,
    workspaceName: 'Acme Retail',
    ...over,
  };
}

let root: Root;
let host: HTMLElement;
let current: LscPlatformOverview;
let runPages: Record<
  string,
  { data: LscPlatformRun[]; page: { nextCursor: string | null; hasMore: boolean; limit: number } }
>;

/** Routes the mocked API: GET/PATCH /lead-scoring, GET /lead-scoring/workspaces, GET /lead-scoring/runs. */
function serve() {
  fetchMock.mockImplementation(
    async (path: string, req?: { method?: string; query?: { cursor?: string } }) => {
      if (path === '/lead-scoring' && !req?.method) return current;
      if (path === '/lead-scoring' && req?.method === 'PATCH') return current;
      if (path === '/lead-scoring/workspaces') return { data: [ws] };
      if (path === '/lead-scoring/runs') return runPages[req?.query?.cursor ?? 'first'];
      throw new Error(`unexpected ${path}`);
    },
  );
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
              <LeadScoringPage />
            </OperatorProvider>
          </ToastProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
  await flush();
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
const bodyOfPatch = () => (callsTo('/lead-scoring', 'PATCH')[0]![1] as { body: unknown }).body;

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
  runPages = {
    first: { data: [run(1)], page: { nextCursor: null, hasMore: false, limit: 25 } },
  };
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

describe('AI lead scoring admin page', () => {
  it('shows a no-access state and calls nothing for other operator roles', async () => {
    await mount('support');
    expect(text()).toContain('Only a super admin can see or change AI lead scoring.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the status strip, with the missing key warning and a link to AI keys', async () => {
    current = overview(false);
    await mount();
    const strip = host.querySelector('section[aria-label="Lead scoring status"]')!.textContent!;
    expect(strip).toContain('Off');
    expect(strip).toContain('OpenAI GPT-6 Luna Pro');
    expect(strip).toContain('Missing');
    expect(strip).toContain('31');
    expect(host.querySelector('a[href="/admin/api-keys"]')).not.toBeNull();
  });

  it('shows small costs with enough decimals and never as $0.00', async () => {
    await mount();
    expect(text()).toContain('$0.000120');
    expect(text()).toContain('$0.000600');
    expect(text()).not.toContain('$0.00 ');
    // the 30 day window has no scores: average shows a dash, total is plain zero
    expect(text()).toContain('$0.00');
  });

  it('keeps the settings off by default and sends only what changed', async () => {
    await mount();
    expect(byLabel('AI lead scoring').getAttribute('aria-checked')).toBe('false');
    expect(button('Save changes').disabled).toBe(true);
    await type(byLabel('Scores per workspace per hour'), '50');
    await click(button('Save changes'));
    expect(bodyOfPatch()).toEqual({ scoresPerHour: 50 });
  });

  it('asks before turning scoring on, explains what is sent, and sends it after the confirm', async () => {
    await mount();
    await click(byLabel('AI lead scoring'));
    await click(button('Save changes'));
    expect(callsTo('/lead-scoring', 'PATCH')).toHaveLength(0);
    expect(document.body.textContent).toContain('send anonymised contact facts to OpenRouter');
    await click(
      [...document.querySelectorAll('dialog button')].find(
        (b) => b.textContent === 'Save changes',
      )!,
    );
    expect(bodyOfPatch()).toEqual({ platformEnabled: true });
  });

  it('asks before turning scoring off and can be cancelled', async () => {
    current = overview(true, true);
    await mount();
    await click(byLabel('AI lead scoring'));
    await click(button('Save changes'));
    expect(document.body.textContent).toContain('stops all AI lead scoring');
    await click(button('Cancel'));
    expect(callsTo('/lead-scoring', 'PATCH')).toHaveLength(0);
  });

  it('shows price per million tokens and the note for the picked model, and sends a model change', async () => {
    await mount();
    expect(text()).toContain('$0.10 per million input tokens, $0.50 per million output tokens.');
    await type(byLabel('Model'), 'inception/mercury-2.5');
    expect(text()).toContain('Cheapest and fastest');
    await click(button('Save changes'));
    expect(bodyOfPatch()).toEqual({ model: 'inception/mercury-2.5' });
  });

  it('takes another OpenRouter model id, validated, and sends it trimmed', async () => {
    await mount();
    await type(byLabel('Model'), '__other__');
    await type(byLabel('OpenRouter model id'), 'not a model!');
    await click(button('Save changes'));
    expect(callsTo('/lead-scoring', 'PATCH')).toHaveLength(0);
    expect(byLabel('OpenRouter model id').getAttribute('aria-invalid')).toBe('true');
    expect(text()).toContain('Use an OpenRouter model id such as openai/gpt-6-luna.');
    await type(byLabel('OpenRouter model id'), ' acme/model-x ');
    await click(button('Save changes'));
    expect(bodyOfPatch()).toEqual({ model: 'acme/model-x' });
  });

  it('marks a bad limit and sends nothing', async () => {
    await mount();
    await type(byLabel('Keep the log for (days)'), '3');
    await click(button('Save changes'));
    expect(callsTo('/lead-scoring', 'PATCH')).toHaveLength(0);
    expect(text()).toContain('Enter a value between 7 and 730.');
  });

  it('counts edits as unsaved changes and discards them', async () => {
    await mount();
    expect(text()).toContain('No changes to save.');
    await type(byLabel('Scores per workspace per hour'), '10');
    expect(text()).toContain('1 change ready to save');
    await click(button('Discard changes'));
    expect(byLabel('Scores per workspace per hour').value).toBe('300');
  });

  it('shows server field errors from errors[].path', async () => {
    await mount();
    fetchMock.mockImplementation(async (path: string, req?: { method?: string }) => {
      if (req?.method === 'PATCH') {
        throw new ApiError(422, ERROR_CODES.VALIDATION_FAILED, 'x', 'req-9', [
          { path: 'scoresPerHour', message: 'bad' },
        ]);
      }
      return path === '/lead-scoring' ? current : { data: [] };
    });
    await type(byLabel('Scores per workspace per hour'), '5');
    await click(button('Save changes'));
    await flush();
    expect(byLabel('Scores per workspace per hour').getAttribute('aria-invalid')).toBe('true');
  });

  it('lists workspaces by cost and debounces the search', async () => {
    await mount();
    expect(text()).toContain('Acme Retail');
    const box = byLabel('Search workspaces');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await type(box, 'ac');
    await type(box, 'acm');
    expect(callsTo('/lead-scoring/workspaces').some(([, r]) => r.query.search === 'acm')).toBe(
      false,
    );
    await act(async () => void (await vi.advanceTimersByTimeAsync(400)));
    const withSearch = callsTo('/lead-scoring/workspaces').filter(([, r]) => r.query.search);
    expect(withSearch).toHaveLength(1);
    expect(withSearch[0]![1].query).toEqual({ search: 'acm', limit: 25 });
  });

  it('shows the runs log with score, previous score, cost source, who paid and the duration', async () => {
    runPages.first = {
      data: [
        run(1),
        run(2, {
          status: 'failed',
          score: null,
          previousScore: null,
          costSource: 'estimate',
          billedAgainst: 'workspace',
          error: 'timeout',
          durationMs: 300,
        }),
      ],
      page: { nextCursor: null, hasMore: false, limit: 25 },
    };
    await mount();
    const table = host.querySelector('table[aria-label="Scoring runs"]')!;
    const rows = [...table.querySelectorAll('tbody tr')].map((r) => r.textContent!);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('72 (was 65)');
    expect(rows[0]).toContain('Reported');
    expect(rows[0]).toContain('Platform');
    expect(rows[0]).toContain('1.5 s');
    expect(rows[1]).toContain('Failed');
    expect(rows[1]).toContain('~$0.000120');
    expect(rows[1]).toContain('Estimate');
    expect(rows[1]).toContain('Workspace');
    expect(rows[1]).toContain('OpenRouter timed out');
    expect(rows[1]).toContain('300 ms');
  });

  it('pages the runs log by cursor with Load more', async () => {
    runPages.first = {
      data: [run(1)],
      page: { nextCursor: 'cur-2', hasMore: true, limit: 25 },
    };
    runPages['cur-2'] = { data: [run(2)], page: { nextCursor: null, hasMore: false, limit: 25 } };
    await mount();
    expect(text()).toContain('Contact 1');
    expect(text()).not.toContain('Contact 2');
    await click(button('Load more'));
    await flush();
    expect(text()).toContain('Contact 1');
    expect(text()).toContain('Contact 2');
    expect(callsTo('/lead-scoring/runs').pop()![1].query.cursor).toBe('cur-2');
    expect(button('Load more')).toBeUndefined();
  });

  it('filters the runs by status and workspace and resets to the first page', async () => {
    await mount();
    await type(byLabel('Status'), 'failed');
    await flush();
    await type(byLabel('Workspace'), WS1);
    await flush();
    const last = callsTo('/lead-scoring/runs').pop()![1].query;
    expect(last).toEqual({ status: 'failed', workspaceId: WS1, cursor: undefined, limit: 25 });
  });

  it('shows empty states for the runs log, plain and filtered', async () => {
    runPages.first = { data: [], page: { nextCursor: null, hasMore: false, limit: 25 } };
    await mount();
    expect(text()).toContain('No runs yet');
    await type(byLabel('Status'), 'failed');
    await flush();
    expect(text()).toContain('No runs match');
  });

  it('shows an error block with a retry when the overview fails', async () => {
    fetchMock.mockImplementation(async () => {
      throw new ApiError(500, 'INTERNAL', 'x', 'req-7');
    });
    await mount();
    expect(text()).toContain('req-7');
    expect(button('Try again')).toBeDefined();
  });

  it('shows an error inside the runs card without hiding the rest of the page', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/lead-scoring/runs') throw new ApiError(500, 'INTERNAL', 'x', 'req-8');
      if (path === '/lead-scoring/workspaces') return { data: [ws] };
      return current;
    });
    await mount();
    expect(text()).toContain('req-8');
    expect(text()).toContain('Acme Retail');
    expect(text()).toContain('Platform switch');
  });
});
