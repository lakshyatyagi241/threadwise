// @vitest-environment jsdom
import type { LscInsight } from '@crm/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanFeaturesProvider } from '@/lib/plan-features';
import { button, click, mount, text, type Mounted } from '../testing';

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  insight: {} as Record<string, unknown>,
  asked: [] as boolean[],
  read: vi.fn(),
  decide: vi.fn(),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('../api/hooks', () => ({
  useLscInsight: (_id: string, enabled: boolean) => {
    state.asked.push(enabled);
    return state.insight;
  },
  useDigestContact: () => ({ mutate: state.read, isPending: false, isError: false }),
  useDecideSuggestions: () => ({
    mutate: state.decide,
    isPending: false,
    isError: false,
    isSuccess: false,
  }),
}));

import { ChatInsightCard } from './insight-card';

const digest: NonNullable<LscInsight['digest']> = {
  id: 'd1',
  createdAt: '2026-10-12T10:00:00.000Z',
  contactId: 'c1',
  source: 'ai',
  intent: 'ready_to_buy',
  signals: { askedPrice: true, readyToBuy: true, objection: false, urgent: false },
  summary: 'Wants the steel model today.',
  score: 82,
  reasons: ['Wants to buy today'],
  suggestedStage: 'qualified',
  stageConfidence: 0.9,
  messagesRead: 5,
  inboundRead: 3,
  model: 'openai/gpt-6-luna-pro',
  costUsd: '0.00010000',
  trigger: 'chat',
  language: 'en',
  issue: null,
};
const suggestion: NonNullable<LscInsight['suggestion']> = {
  id: 's1',
  contactId: 'c1',
  contactName: 'Priya',
  fromStage: 'lead',
  fromStageLabel: 'Lead',
  toStage: 'qualified',
  toStageLabel: 'Qualified',
  confidence: 0.9,
  reasons: ['Wants to buy today'],
  status: 'pending',
  source: 'chat',
  createdAt: '2026-10-12T10:00:00.000Z',
  decidedAt: null,
};
const loaded = (data: Partial<LscInsight>) => ({
  data: { active: true, digest: null, suggestion: null, ...data },
});

let m: Mounted | null = null;
beforeEach(() => {
  state.perms = new Set(['lsc.runs.read', 'lsc.contacts.score', 'lsc.stage.review']);
  state.read = vi.fn();
  state.decide = vi.fn();
  state.insight = loaded({});
  state.asked = [];
});
afterEach(async () => {
  await m?.unmount();
  m = null;
});
const show = async () => {
  m = await mount(<ChatInsightCard contactId="c1" />);
  return m.host;
};

describe('when it appears', () => {
  it('shows nothing in a workspace that does not have the chat reading on', async () => {
    state.insight = loaded({ active: false, digest });
    const host = await show();
    expect(host.textContent).toBe('');
  });

  it('shows nothing while it loads, and nothing without the right to read the log', async () => {
    state.insight = { data: undefined };
    expect((await show()).textContent).toBe('');
  });
});

describe('a contact that was not read yet', () => {
  it('says so, and reads the chat now on request', async () => {
    const host = await show();
    expect(host.textContent).toContain(text('insight.empty'));
    await click(button(host, text('insight.analyze')));
    expect(state.read).toHaveBeenCalledTimes(1);
  });

  it('offers no button without the right to score contacts', async () => {
    state.perms = new Set(['lsc.runs.read']);
    const host = await show();
    expect(
      [...host.querySelectorAll('button')].some((b) => b.textContent === text('insight.analyze')),
    ).toBe(false);
  });
});

describe('a contact that was read', () => {
  it('shows the intent, what it signalled, the summary, when it was read and the masking note', async () => {
    state.insight = loaded({ digest });
    const host = await show();
    expect(host.querySelector('[data-testid="lsc-intent"]')?.textContent).toBe(
      text('insight.intent.ready_to_buy'),
    );
    expect(host.textContent).toContain(text('insight.signal.askedPrice'));
    expect(host.textContent).toContain(text('insight.signal.readyToBuy'));
    expect(host.textContent).not.toContain(text('insight.signal.objection'));
    expect(host.textContent).toContain('Wants the steel model today.');
    expect(host.textContent).toContain('5 messages');
    expect(host.textContent).toContain(text('insight.sourceAi'));
    expect(host.textContent).toContain(text('insight.privacy'));
  });

  it('says that button taps were matched, when no AI read it', async () => {
    state.insight = loaded({
      digest: { ...digest, source: 'rules', summary: null, intent: 'post_purchase' },
    });
    const host = await show();
    expect(host.textContent).toContain(text('insight.sourceRules'));
    expect(host.textContent).toContain(text('insight.intent.post_purchase'));
  });
});

describe('the suggested stage', () => {
  it('shows the move, how sure the AI is, and lets a reviewer accept or dismiss it', async () => {
    state.insight = loaded({ digest, suggestion });
    const host = await show();
    expect(host.textContent).toContain('Move from Lead to Qualified');
    expect(host.textContent).toContain('90% sure');
    await click(button(host, text('insight.suggestion.accept')));
    expect(state.decide).toHaveBeenCalledWith({ action: 'accept', ids: ['s1'] }, expect.anything());
    await click(button(host, text('insight.suggestion.dismiss')));
    expect(state.decide).toHaveBeenLastCalledWith(
      { action: 'dismiss', ids: ['s1'] },
      expect.anything(),
    );
  });

  it('only describes it, and says why there are no buttons, without the review permission', async () => {
    state.perms = new Set(['lsc.runs.read']);
    state.insight = loaded({ digest, suggestion });
    const host = await show();
    expect(host.textContent).toContain('Move from Lead to Qualified');
    expect(
      [...host.querySelectorAll('button')].some(
        (b) => b.textContent === text('insight.suggestion.accept'),
      ),
    ).toBe(false);
    expect(host.textContent).toContain(text('insight.suggestion.noRight'));
  });
});

describe('in a workspace that does not have the AI lead scoring app', () => {
  it('does not even ask the API, and shows nothing', async () => {
    m = await mount(
      <PlanFeaturesProvider features={['marketplace']}>
        <ChatInsightCard contactId="c1" />
      </PlanFeaturesProvider>,
    );
    expect(state.asked.every((asked) => asked === false)).toBe(true);
    expect(state.asked.length).toBeGreaterThan(0);
  });

  it('asks as usual when the workspace has it', async () => {
    m = await mount(
      <PlanFeaturesProvider features={['marketplace', 'lead_scoring']}>
        <ChatInsightCard contactId="c1" />
      </PlanFeaturesProvider>,
    );
    expect(state.asked.every((asked) => asked === true)).toBe(true);
  });
});
