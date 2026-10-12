import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FaqEntrySummary, FaqMatchDecision, FaqSettings, FaqVerifyInfo } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  list: {} as Record<string, unknown>,
  settings: {} as Record<string, unknown>,
  entry: {} as Record<string, unknown>,
  log: {} as Record<string, unknown>,
  summary: {} as Record<string, unknown>,
  nodes: {} as Record<string, unknown>,
}));

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/faq',
}));
vi.mock('../api/hooks', () => ({
  KEYS: {
    all: ['faq'],
    settings: ['faq', 'settings'],
    log: ['faq', 'log'],
    entry: (id: string) => ['faq', id],
    flowNodes: (id: string) => ['faq', 'flow-nodes', id],
  },
  refreshFaqs: () => undefined,
  useFaqList: () => state.list,
  useFaqSettings: () => state.settings,
  useFaqEntry: () => state.entry,
  useFaqLog: () => state.log,
  useFaqSummary: () => state.summary,
  useFaqCategories: () => ({ data: ['Billing'] }),
  useFlowNodes: () => state.nodes,
  useFlowOptions: () => ({ isPending: false, isError: false, data: { data: [] } }),
}));

import { DecisionView } from './decision-view';
import { FaqEditorScreen } from './editor-screen';
import { InsightsScreen } from './insights-screen';
import { FaqListScreen } from './list-screen';
import { SettingsScreen } from './settings-screen';
import { UnansweredScreen } from './unanswered-screen';

const en = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'faq-knowledge.json'), 'utf8'),
) as Record<string, unknown>;
const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider
      locale="en"
      messages={en}
      timeZone="UTC"
      onError={(e) => {
        throw e;
      }}
    >
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

const ok = (data: unknown, over: Record<string, unknown> = {}) => ({
  isPending: false,
  isError: false,
  error: null,
  data,
  refetch: () => undefined,
  ...over,
});
const stats = {
  total: 0,
  active: 0,
  paused: 0,
  variations: 0,
  pending: 0,
  failed: 0,
  categories: [],
};
const faq = (over: Partial<FaqEntrySummary> = {}): FaqEntrySummary => ({
  id: '00000000-0000-4000-8000-000000000001',
  question: 'Where is my order?',
  answerType: 'text',
  answerPreview: 'It ships in two days',
  flowId: null,
  flowName: null,
  flowNodeId: null,
  flowNodeLabel: null,
  category: 'Shipping',
  status: 'active',
  thresholdOverride: null,
  hitCount: 3,
  lastHitAt: null,
  variationCount: 4,
  readyCount: 2,
  pendingCount: 1,
  failedCount: 1,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  rowVersion: 1,
  ...over,
});
const settings = (over: Partial<FaqSettings> = {}): FaqSettings => ({
  enabled: true,
  threshold: 0.45,
  minMargin: 0,
  logQueries: true,
  verifyMode: 'off',
  verifyBand: 0.1,
  verifyAvailable: true,
  verifyModel: 'openai/gpt-4o-mini',
  isDefault: false,
  engineEnabled: true,
  embeddingModel: 'openai/text-embedding-3-large',
  recommendedThreshold: 0.45,
  tunedForModel: 'openai/text-embedding-3-large',
  modelChanged: false,
  limits: { maxFaqs: 500, maxVariationsPerFaq: 60 },
  usage: { faqs: 3, variations: 9 },
  rowVersion: 2,
  updatedAt: '2026-10-01T00:00:00Z',
  ...over,
});
const STEPS = [
  { id: 'trig-1', type: 'trigger', label: '' },
  { id: 'n-msg', type: 'message', label: 'Welcome' },
  { id: 'n-ask', type: 'ask', label: '' },
];
const listState = (items: FaqEntrySummary[], s = stats) => ({
  ...ok(undefined),
  items,
  stats: s,
  hasNextPage: false,
  isFetchingNextPage: false,
  isPlaceholderData: false,
  isPending: false,
});

beforeEach(() => {
  state.perms = new Set([
    'faq.entries.read',
    'faq.entries.create',
    'faq.entries.update',
    'faq.entries.delete',
    'faq.insights.read',
    'faq.settings.manage',
  ]);
  state.list = listState([]);
  state.settings = ok(settings());
  state.entry = ok(undefined, { isPending: true });
  state.log = { ...ok(undefined), items: [], hasNextPage: false };
  state.summary = ok(undefined, { isPending: true });
  state.nodes = ok({ data: STEPS });
});

describe('FaqListScreen', () => {
  it('teaches the feature and offers the first FAQ when there are none', () => {
    const out = html(<FaqListScreen />);
    expect(out).toContain('Teach your bot the answers to common questions');
    expect(out).toContain('Add your first FAQ');
  });
  it('shows a no-access state without the read permission', () => {
    state.perms = new Set();
    expect(html(<FaqListScreen />)).toContain('You do not have access to this screen');
  });
  it('shows rows with indexing health, a failed filter link and a missing-flow warning', () => {
    state.list = listState(
      [
        faq(),
        faq({
          id: '00000000-0000-4000-8000-000000000002',
          question: 'Refunds',
          answerType: 'flow',
          flowId: 'f',
          flowName: null,
        }),
      ],
      { ...stats, total: 2, active: 2, variations: 8, pending: 1, failed: 1 },
    );
    const out = html(<FaqListScreen />);
    expect(out).toContain('Where is my order?');
    expect(out).toContain('2 live');
    expect(out).toContain('1 failed');
    expect(out).toContain('Flow missing');
    expect(out).toContain('Show FAQs with failures');
  });
  it('shows the step a flow FAQ starts at next to the flow, and warns when that step is gone', () => {
    const flow = {
      answerType: 'flow' as const,
      answerPreview: null,
      flowId: 'f',
      flowName: 'Refunds',
    };
    state.list = listState(
      [
        faq({ ...flow, flowNodeId: 'n-msg', flowNodeLabel: 'message' }),
        faq({
          ...flow,
          id: '00000000-0000-4000-8000-000000000002',
          question: 'Returns',
          flowNodeId: 'n-old',
          flowNodeLabel: null,
        }),
        faq({
          ...flow,
          id: '00000000-0000-4000-8000-000000000003',
          question: 'Shipping times',
        }),
      ],
      { ...stats, total: 3 },
    );
    const out = html(<FaqListScreen />);
    expect(out).toContain('Starts at: Send message');
    expect(out).toContain('Step missing');
    // The flow itself is fine, so only the step is flagged and the flow name stays visible.
    expect(out).not.toContain('Flow missing');
    expect(out.match(/Refunds/g)).toHaveLength(3);
    expect(out.match(/Starts at:/g)).toHaveLength(1);
  });
  it('hides row delete without the delete permission', () => {
    state.perms.delete('faq.entries.delete');
    state.list = listState([faq()], { ...stats, total: 1 });
    expect(html(<FaqListScreen />)).not.toContain('Delete Where is my order?');
  });
  it('explains a load failure by its code, with the request id', async () => {
    const { ApiError } = await import('@/lib/api/errors');
    state.list = {
      ...listState([]),
      isError: true,
      isPending: false,
      error: new ApiError(403, 'FORBIDDEN', 'x', 'req-9'),
    };
    const out = html(<FaqListScreen />);
    expect(out).toContain('Your role is not allowed to do this.');
    expect(out).toContain('req-9');
  });
});

const decision = (over: Partial<FaqMatchDecision> = {}): FaqMatchDecision => ({
  outcome: 'below_threshold',
  tier: 'trigram',
  faqId: null,
  score: 0.31,
  secondScore: 0.2,
  threshold: 0.45,
  minMargin: 0.05,
  candidates: [
    {
      faqId: '00000000-0000-4000-8000-000000000001',
      question: 'Track my order',
      score: 0.31,
      matchedText: 'where is parcel',
      status: 'active',
    },
  ],
  embeddingModel: null,
  latencyMs: 12,
  note: 'The AI provider timed out.',
  verify: null,
  ...over,
});

describe('DecisionView', () => {
  it('shows the outcome, tier explanation, numbers, candidates and the fallback note', () => {
    const out = html(<DecisionView decision={decision()} query="where is parcel" />);
    expect(out).toContain('Below threshold');
    expect(out).toContain('Spelling fallback');
    expect(out).toContain('31%');
    expect(out).toContain('45%');
    expect(out).toContain('Track my order');
    expect(out).toContain('where is parcel');
    expect(out).toContain('The AI provider timed out.');
    expect(out).toContain('Add this phrase as a variation to Track my order');
  });
  it('shows the answer of the winning FAQ and no add action in the compact box', () => {
    state.entry = ok({
      id: 'x',
      question: 'Track my order',
      answerType: 'text',
      answerText: 'Check your email',
      flowName: null,
    });
    const out = html(
      <DecisionView
        compact
        query="q"
        decision={decision({
          outcome: 'answered',
          tier: 'semantic',
          faqId: '00000000-0000-4000-8000-000000000001',
          score: 0.7,
          embeddingModel: 'openai/text-embedding-3-large',
          note: null,
        })}
      />,
    );
    expect(out).toContain('Would answer');
    expect(out).toContain('Check your email');
    expect(out).toContain('Meaning match');
    expect(out).not.toContain('Add this phrase as a variation');
  });
  it('says so when ambiguity stopped the answer', () => {
    expect(
      html(
        <DecisionView
          decision={decision({
            outcome: 'low_margin',
            tier: 'semantic',
            score: 0.6,
            secondScore: 0.58,
          })}
          query="q"
        />,
      ),
    ).toContain('Ambiguous');
  });
});

describe('DecisionView and the second check', () => {
  const verify = (over: Partial<FaqVerifyInfo>): FaqVerifyInfo => ({
    verdict: 'confirmed',
    model: 'openai/gpt-4o-mini',
    reason: null,
    ...over,
  });
  const answered = (v: FaqVerifyInfo) =>
    decision({
      outcome: 'answered',
      tier: 'semantic',
      faqId: '00000000-0000-4000-8000-000000000001',
      score: 0.52,
      note: null,
      verify: v,
    });
  beforeEach(() => {
    state.entry = ok({
      id: 'x',
      question: 'Track my order',
      answerType: 'text',
      answerText: 'Check your email',
      flowName: null,
    });
  });

  it('shows nothing about a check that did not look at the match', () => {
    const out = html(<DecisionView decision={decision()} query="q" />);
    expect(out).not.toContain('Second check');
  });
  it('confirmed: the chip, the model and the reason, and the answer still goes out', () => {
    const out = html(
      <DecisionView
        query="q"
        decision={answered(verify({ reason: 'The FAQ covers delivery times.' }))}
      />,
    );
    expect(out).toContain('Second check: yes');
    expect(out).toContain('openai/gpt-4o-mini');
    expect(out).toContain('agreed the answer fits');
    expect(out).toContain('The FAQ covers delivery times.');
    expect(out).toContain('Would answer');
    expect(out).toContain('Check your email');
  });
  it('a veto says the answer was withheld and why, and is not called "below threshold"', () => {
    const out = html(
      <DecisionView
        query="q"
        decision={decision({
          outcome: 'below_threshold',
          tier: 'semantic',
          score: 0.52,
          note: null,
          verify: verify({ verdict: 'rejected', reason: 'It is about refunds, not delivery.' }),
        })}
      />,
    );
    expect(out).toContain('Answer withheld');
    expect(out).toContain('Second check: no');
    expect(out).toContain(
      'The answer was withheld, nothing was sent, and the message appears under Unanswered.',
    );
    expect(out).toContain('It is about refunds, not delivery.');
    expect(out).not.toContain('Below threshold');
    expect(out).not.toContain('What the customer would get');
  });
  it('a failed check says the match stood and the answer was sent', () => {
    const out = html(
      <DecisionView
        query="q"
        decision={answered(verify({ verdict: 'error', model: null, reason: 'Timed out.' }))}
      />,
    );
    expect(out).toContain('Second check failed');
    expect(out).toContain('the match stood and the answer was sent');
    expect(out).toContain('Would answer');
    expect(out).toContain('Timed out.');
    expect(out).not.toContain('Checked by');
  });
  it('a skipped check says why it did not run', () => {
    const out = html(
      <DecisionView
        query="q"
        decision={answered(
          verify({ verdict: 'skipped', model: null, reason: 'Hourly limit reached.' }),
        )}
      />,
    );
    expect(out).toContain('Second check skipped');
    expect(out).toContain('did not run for this match');
    expect(out).toContain('Hourly limit reached.');
  });
});

describe('SettingsScreen', () => {
  it('is read-only for someone who cannot manage and says who can', () => {
    state.perms.delete('faq.settings.manage');
    const out = html(<SettingsScreen />);
    expect(out).toContain('faq.settings.manage');
    expect(out).toContain('disabled');
  });
  it('asks to review the threshold when the platform changed the model, with a one-click recommended value', () => {
    state.settings = ok(
      settings({ modelChanged: true, threshold: 0.6, recommendedThreshold: 0.7 }),
    );
    const out = html(<SettingsScreen />);
    expect(out).toContain('The platform changed the AI model after you tuned this threshold');
    expect(out).toContain('Use the recommended value (70%)');
    expect(out).toContain('Strict (80%)');
    expect(out).toContain('Forgiving (60%)');
  });
  const verifySwitch = (out: string) => /<button[^>]*id="faq-verify"[^>]*>/.exec(out)?.[0] ?? '';
  it('explains the second check in numbers: which scores, which model, what a no means', () => {
    state.settings = ok(settings({ threshold: 0.5, verifyMode: 'borderline', verifyBand: 0.1 }));
    const out = html(<SettingsScreen />);
    expect(out).toContain('Second check for close calls');
    expect(out).toContain('Matches scoring from 50% up to 60% are checked by openai/gpt-4o-mini.');
    expect(out).toContain('no answer is sent and the message appears under Unanswered');
    expect(out).toContain('a few hundred tokens');
    expect(out).toContain('about a second');
    expect(out).toContain('+10%');
    expect(verifySwitch(out)).toContain('aria-checked="true"');
    expect(verifySwitch(out)).not.toContain('disabled=""');
    expect(out).toContain('id="faq-verify-band"');
    expect(out).toContain('Second check (optional)');
  });
  it('when the check is off, says every match at the bar is answered', () => {
    state.settings = ok(settings({ threshold: 0.45, verifyMode: 'off' }));
    const out = html(<SettingsScreen />);
    expect(out).toContain('Every match scoring 45% or more is answered.');
    expect(out).not.toContain('are checked by');
    expect(verifySwitch(out)).toContain('aria-checked="false"');
  });
  it('is disabled with a note when the platform switched the check off', () => {
    state.settings = ok(settings({ verifyMode: 'borderline', verifyAvailable: false }));
    const out = html(<SettingsScreen />);
    expect(out).toContain('The platform has switched the second check off');
    expect(verifySwitch(out)).toContain('disabled=""');
    expect(/<input[^>]*id="faq-verify-band"[^>]*>/.exec(out)?.[0]).toContain('disabled=""');
    expect(out).not.toContain('Second check (optional)');
  });
  it('shows the band at both edges and caps the top at 100%', () => {
    state.settings = ok(settings({ threshold: 0.99, verifyMode: 'borderline', verifyBand: 0.3 }));
    let out = html(<SettingsScreen />);
    expect(out).toContain('+30%');
    expect(out).toContain('from 99% up to 100%');
    expect(out).toMatch(/<input[^>]*max="0.3"[^>]*id="faq-verify-band"/);
    state.settings = ok(settings({ verifyMode: 'borderline', verifyBand: 0.01 }));
    out = html(<SettingsScreen />);
    expect(out).toContain('+1%');
    expect(out).toContain('from 45% up to 46%');
    expect(out).toMatch(/<input[^>]*min="0.01"[^>]*id="faq-verify-band"/);
  });
  it('lets a viewer without the manage permission see but not change the check', () => {
    state.perms.delete('faq.settings.manage');
    const out = html(<SettingsScreen />);
    expect(verifySwitch(out)).toContain('disabled=""');
  });
  it('shows the model, usage and the explainer', () => {
    const out = html(<SettingsScreen />);
    expect(out).toContain('openai/text-embedding-3-large');
    expect(out).toContain('3 of 500');
    expect(out).toContain('How matching works');
  });
});

describe('UnansweredScreen', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'l1',
    createdAt: '2026-10-01T00:00:00Z',
    origin: 'inbound',
    query: 'where is parcel',
    queryLength: 15,
    outcome: 'below_threshold',
    tier: 'semantic',
    faqId: null,
    faqQuestion: null,
    score: 0.31,
    secondScore: 0.2,
    matchedText: null,
    candidates: [
      { faqId: 'f1', question: 'Track my order', score: 0.31, matchedText: 'x', status: 'active' },
    ],
    embeddingModel: null,
    latencyMs: 4,
    error: null,
    verify: null,
    resolved: false,
    ...over,
  });
  it('lists messages with the closest FAQ, the reason and the three actions', () => {
    state.log = { ...ok(undefined), items: [row()], hasNextPage: false };
    const out = html(<UnansweredScreen />);
    expect(out).toContain('where is parcel');
    expect(out).toContain('Track my order');
    expect(out).toContain('Add to an FAQ');
    expect(out).toContain('Create FAQ from this');
    expect(out).toContain('Dismiss');
  });
  it('shows the second check on a message it held back, with the reason and the right sentence', () => {
    state.log = {
      ...ok(undefined),
      items: [
        row({
          score: 0.52,
          verify: { verdict: 'rejected', model: 'openai/gpt-4o-mini', reason: 'Wrong topic.' },
        }),
      ],
      hasNextPage: false,
    };
    state.settings = ok(settings({ threshold: 0.5 }));
    const out = html(<UnansweredScreen />);
    expect(out).toContain('Second check: no');
    expect(out).toContain('Wrong topic.');
    expect(out).toContain('openai/gpt-4o-mini');
    expect(out).toContain('52%, above the 50% bar');
    expect(out).not.toContain('below the 50% bar');
  });
  it('labels a match that a flow ran', () => {
    state.log = { ...ok(undefined), items: [row({ origin: 'flow' })], hasNextPage: false };
    expect(html(<UnansweredScreen />)).toContain('(from a flow)');
  });
  it('marks a message that was not kept and offers only dismiss', () => {
    state.log = { ...ok(undefined), items: [row({ query: null })], hasNextPage: false };
    const out = html(<UnansweredScreen />);
    expect(out).toContain('Message text not kept');
    expect(out).not.toContain('Add to an FAQ');
    expect(out).toContain('Dismiss');
  });
  it('is empty and calm when nothing is waiting, and gated by faq.insights.read', () => {
    expect(html(<UnansweredScreen />)).toContain('Nothing waiting');
    state.perms.delete('faq.insights.read');
    expect(html(<UnansweredScreen />)).toContain('faq.insights.read');
  });
});

describe('InsightsScreen', () => {
  it('explains the empty state before any message has been checked', () => {
    state.summary = ok({ totals: { messages: 0 } });
    expect(html(<InsightsScreen />)).toContain('No messages yet');
  });
  it('shows the key numbers and the tuning hint', () => {
    state.summary = ok({
      days: 30,
      totals: {
        messages: 100,
        answered: 70,
        flowStarted: 10,
        unanswered: 15,
        providerErrors: 5,
        notSent: 0,
      },
      answerRate: 0.8,
      avgAnsweredScore: 0.62,
      scoreHistogram: Array.from({ length: 10 }, (_, i) => ({
        from: i / 10,
        to: (i + 1) / 10,
        answered: i,
        unanswered: 10 - i,
      })),
      daily: [{ day: '2026-10-01', answered: 3, unanswered: 1 }],
      topFaqs: [{ faqId: 'f1', question: 'Track my order', hits: 9 }],
      neverMatched: 2,
      unresolvedUnanswered: 4,
    });
    const out = html(<InsightsScreen />);
    expect(out).toContain('80%');
    expect(out).toContain('Raise the threshold if wrong answers slip in');
    expect(out).toContain('Track my order');
    expect(out).toContain('Threshold 45%');
  });
});

describe('InsightsScreen log rows', () => {
  const summary = {
    days: 30,
    totals: {
      messages: 3,
      answered: 1,
      flowStarted: 0,
      unanswered: 2,
      providerErrors: 0,
      notSent: 0,
    },
    answerRate: 0.33,
    avgAnsweredScore: 0.6,
    scoreHistogram: Array.from({ length: 10 }, (_, i) => ({
      from: i / 10,
      to: (i + 1) / 10,
      answered: 0,
      unanswered: 0,
    })),
    daily: [],
    topFaqs: [],
    neverMatched: 0,
    unresolvedUnanswered: 0,
  };
  const logRow = (id: string, over: Record<string, unknown>) => ({
    id,
    createdAt: '2026-10-01T00:00:00Z',
    origin: 'inbound',
    query: `message ${id}`,
    queryLength: 9,
    outcome: 'answered',
    tier: 'semantic',
    faqId: 'f1',
    faqQuestion: 'Track my order',
    score: 0.6,
    secondScore: null,
    matchedText: null,
    candidates: [],
    embeddingModel: null,
    latencyMs: 4,
    error: null,
    verify: null,
    resolved: false,
    ...over,
  });
  it('puts the check chip beside the outcome, calls a veto "withheld" and labels flow rows', () => {
    state.summary = ok(summary);
    state.log = {
      ...ok(undefined),
      items: [
        logRow('a', { verify: { verdict: 'confirmed', model: 'm', reason: null } }),
        logRow('b', {
          outcome: 'below_threshold',
          faqId: null,
          verify: { verdict: 'rejected', model: 'm', reason: null },
        }),
        logRow('c', { origin: 'flow', verify: { verdict: 'error', model: null, reason: null } }),
        logRow('d', { origin: 'test' }),
      ],
      hasNextPage: false,
    };
    const out = html(<InsightsScreen />);
    expect(out).toContain('Second check: yes');
    expect(out).toContain('Second check: no');
    expect(out).toContain('Second check failed');
    expect(out).toContain('Answer withheld');
    expect(out).toContain('(from a flow)');
    expect(out).toContain('(test)');
    expect(out.match(/Second check/g)).toHaveLength(3);
  });
});

describe('FaqEditorScreen', () => {
  it('renders the two panels with the locked question and the counter against the limit', () => {
    const out = html(<FaqEditorScreen />);
    expect(out).toContain('Question variations');
    expect(out).toContain('Text answer');
    expect(out).toContain('Start a flow');
    expect(out).toContain('1 / 60');
    expect(out).toContain('0 / 4096 characters');
    expect(out).toContain('Suggest with AI');
    expect(out).toContain('Save the FAQ first');
  });
  it('needs the create permission for a new FAQ', () => {
    state.perms.delete('faq.entries.create');
    expect(html(<FaqEditorScreen />)).toContain('faq.entries.create');
  });
  it('shows each phrasing with its indexing state for a saved FAQ', () => {
    state.entry = ok({
      id: '00000000-0000-4000-8000-000000000001',
      question: 'Where is my order?',
      answerType: 'text',
      answerText: 'Soon',
      flowId: null,
      flowName: null,
      category: null,
      status: 'active',
      thresholdOverride: null,
      rowVersion: 3,
      hitCount: 0,
      lastHitAt: null,
      variationCount: 3,
      readyCount: 1,
      pendingCount: 1,
      failedCount: 1,
      createdAt: '',
      updatedAt: '',
      variations: [
        {
          id: 'v0',
          text: 'Where is my order?',
          source: 'question',
          embedState: 'ready',
          embedError: null,
          createdAt: '',
          rowVersion: 1,
        },
        {
          id: 'v1',
          text: 'track parcel',
          source: 'manual',
          embedState: 'pending',
          embedError: null,
          createdAt: '',
          rowVersion: 1,
        },
        {
          id: 'v2',
          text: 'wheres my stuff',
          source: 'ai',
          embedState: 'failed',
          embedError: 'Provider refused',
          createdAt: '',
          rowVersion: 1,
        },
      ],
    });
    const out = html(<FaqEditorScreen id="00000000-0000-4000-8000-000000000001" />);
    expect(out).toContain('Indexing');
    expect(out).toContain('Live');
    expect(out).toContain('Provider refused');
    expect(out).toContain('3 / 60');
    expect(out).toContain('Try it');
  });
});

describe('FaqEditorScreen: where a flow answer starts', () => {
  const ID = '00000000-0000-4000-8000-000000000001';
  const FLOW = '00000000-0000-4000-8000-0000000000f1';
  const plain = (out: string) => out.replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
  const flowEntry = (over: Record<string, unknown> = {}) =>
    ok({
      id: ID,
      question: 'Refund?',
      answerType: 'flow',
      answerText: null,
      flowId: FLOW,
      flowName: 'Refunds',
      flowNodeId: null,
      flowNodeLabel: null,
      category: null,
      status: 'active',
      thresholdOverride: null,
      rowVersion: 3,
      hitCount: 0,
      lastHitAt: null,
      variationCount: 1,
      readyCount: 1,
      pendingCount: 0,
      failedCount: 0,
      createdAt: '',
      updatedAt: '',
      variations: [],
      ...over,
    });
  const render = () => plain(html(<FaqEditorScreen id={ID} />));
  // The status select is on the page too: the step select is the one whose id ends in "-select".
  const selectTag = (out: string) => /<select[^>]*-select"[^>]*>/.exec(out)?.[0] ?? '';
  beforeEach(() => {
    state.perms.add('flb.flows.read');
  });

  it('lists the flow start first, then the steps by type and name, never the trigger twice', () => {
    state.entry = flowEntry({ flowNodeId: 'n-msg', flowNodeLabel: 'Welcome' });
    const out = render();
    expect(out).toContain('Start at');
    expect(out).toContain("The flow's start");
    expect(out).toContain('Send message · Welcome');
    expect(out).toContain('Ask question · #n-ask');
    expect(out).not.toContain('Trigger ·');
    expect(out).toMatch(/<option value="n-msg" selected="">/);
    expect(out).not.toContain('The step this FAQ starts at is gone');
  });
  it('selects the flow start when no step was chosen', () => {
    state.entry = flowEntry();
    expect(render()).toMatch(/<option value="" selected="">The flow's start<\/option>/);
  });
  it('waits for the steps with the select off and a loading note', () => {
    state.nodes = ok(undefined, { isPending: true, data: undefined });
    state.entry = flowEntry();
    const out = render();
    expect(out).toContain('Loading the steps of this flow');
    expect(selectTag(out)).toContain('disabled=""');
    expect(selectTag(out)).toContain('aria-busy="true"');
  });
  it('says so when the flow has no step besides its start', () => {
    state.nodes = ok({ data: [{ id: 'trig-1', type: 'trigger', label: '' }] });
    state.entry = flowEntry();
    const out = render();
    expect(out).toContain('This flow has no other steps, so it starts at its beginning.');
    expect(out).not.toContain('<option value="trig-1"');
  });
  it('explains a failed load by its code and offers to try again', async () => {
    const { ApiError } = await import('@/lib/api/errors');
    state.nodes = ok(undefined, {
      isError: true,
      data: undefined,
      error: new ApiError(422, 'FAQ_FLOW_NOT_FOUND', 'x', 'req-1'),
    });
    state.entry = flowEntry();
    const out = render();
    expect(out).toContain('The chosen flow no longer exists in this workspace.');
    expect(out).toContain('Try again');
    expect(selectTag(out)).toBe('');
  });
  it('warns, with the way to fix it, when the chosen step was deleted from the flow', () => {
    state.entry = flowEntry({ flowNodeId: 'n-old', flowNodeLabel: null });
    const out = render();
    expect(out).toContain('The step this FAQ starts at is gone');
    expect(out).toContain('customers who match this FAQ get no answer');
    expect(out).toContain("Start at the flow's start");
    expect(out).toContain('Deleted step (choose another)');
    expect(out).toMatch(/<option value="n-old" selected="">/);
  });
  it('warns from the saved entry alone while the steps are still loading', () => {
    state.nodes = ok(undefined, { isPending: true, data: undefined });
    state.entry = flowEntry({ flowNodeId: 'n-old', flowNodeLabel: null });
    expect(render()).toContain('The step this FAQ starts at is gone');
  });
  it('does not offer steps for a flow that no longer exists', () => {
    state.entry = flowEntry({ flowName: null, flowNodeId: 'n-old' });
    const out = render();
    expect(out).toContain('The flow this FAQ started no longer exists');
    expect(out).not.toContain('Loading the steps');
    expect(selectTag(out)).toBe('');
  });
  it('shows a read-only viewer the step as text, and the gone step as a problem', () => {
    state.perms.delete('faq.entries.update');
    state.entry = flowEntry({ flowNodeId: 'n-msg', flowNodeLabel: 'message' });
    let out = render();
    expect(out).toContain('Starts at step: Send message');
    expect(out).not.toContain('Loading the steps');
    state.entry = flowEntry({ flowNodeId: 'n-old', flowNodeLabel: null });
    out = render();
    expect(out).toContain('no longer exists, so customers get no answer');
  });
});
