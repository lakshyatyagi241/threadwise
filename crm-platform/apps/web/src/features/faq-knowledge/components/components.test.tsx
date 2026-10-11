import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FaqEntrySummary, FaqMatchDecision, FaqSettings } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  list: {} as Record<string, unknown>,
  settings: {} as Record<string, unknown>,
  entry: {} as Record<string, unknown>,
  log: {} as Record<string, unknown>,
  summary: {} as Record<string, unknown>,
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
  },
  refreshFaqs: () => undefined,
  useFaqList: () => state.list,
  useFaqSettings: () => state.settings,
  useFaqEntry: () => state.entry,
  useFaqLog: () => state.log,
  useFaqSummary: () => state.summary,
  useFaqCategories: () => ({ data: ['Billing'] }),
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
