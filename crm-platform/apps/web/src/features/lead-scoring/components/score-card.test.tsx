// @vitest-environment jsdom
import { ERROR_CODES, type LscRun } from '@crm/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { PlanFeaturesProvider } from '@/lib/plan-features';
import { click, mount, text, type Mounted } from '../testing';
import type { ScoreFields } from '../lib/score';

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  score: {} as Record<string, unknown>,
  runs: {} as Record<string, unknown>,
  mutate: vi.fn(),
  /** The workspace switch (`GET /lead-scoring/status`): on by default; the asked-for `enabled` is kept to see what is requested. */
  status: { data: { enabled: true } } as { data?: { enabled: boolean }; isError?: boolean },
  statusAsked: [] as boolean[],
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('../api/hooks', () => ({
  useScoreContact: () => state.score,
  useLscRuns: () => state.runs,
  useLscStatus: (enabled: boolean) => {
    state.statusAsked.push(enabled);
    return state.status;
  },
}));

import { ScoreCard } from './score-card';

const ID = '294dca7c-5806-4548-9035-dcca9befc7b1';
const NEVER: ScoreFields = {
  leadScore: null,
  leadScoreSource: null,
  leadScoreReasons: null,
  leadScoredAt: null,
  leadScoreModel: null,
};
const AI: ScoreFields = {
  leadScore: 72,
  leadScoreSource: 'ai',
  leadScoreReasons: ['Opened two deals this month', 'Replied within a day'],
  leadScoredAt: '2026-03-12T15:04:00.000Z',
  leadScoreModel: 'openai/gpt-4o-mini',
};
const MANUAL: ScoreFields = { ...NEVER, leadScore: 40, leadScoreSource: 'manual' };

let m: Mounted | null = null;
beforeEach(() => {
  state.perms = new Set(['lsc.contacts.score', 'lsc.runs.read']);
  state.mutate = vi.fn();
  state.status = { data: { enabled: true } };
  state.statusAsked = [];
  state.score = { mutate: state.mutate, isPending: false, isError: false, isSuccess: false };
  state.runs = {
    isPending: false,
    isError: false,
    items: [],
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  };
});
afterEach(async () => {
  await m?.unmount();
  m = null;
});
const show = async (contact: ScoreFields) => {
  m = await mount(<ScoreCard contactId={ID} contact={contact} />);
  return m.host;
};
const scoreButton = (host: HTMLElement) =>
  [...host.querySelectorAll('button')].find((b) =>
    [text('card.score'), text('card.rescore'), text('card.scoring')].includes(
      b.textContent?.trim() ?? '',
    ),
  );

describe('ScoreCard', () => {
  it('invites a first score when the contact was never scored', async () => {
    const host = await show(NEVER);
    expect(host.textContent).toContain(text('card.neverScored'));
    const b = scoreButton(host)!;
    expect(b.textContent?.trim()).toBe('Score with AI');
    expect(b.disabled).toBe(false);
    await click(b);
    expect(state.mutate).toHaveBeenCalledTimes(1);
  });

  it('shows an AI score with its source, date, model and reasons, and offers a re-score', async () => {
    const host = await show(AI);
    expect(host.querySelector('[data-testid="lsc-score"]')?.textContent).toBe('72');
    expect(host.textContent).toContain('Hot lead');
    expect(host.textContent).toContain('Scored by AI on Mar 12, 2026');
    expect(host.textContent).toContain('openai/gpt-4o-mini');
    const items = [...host.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual(['Opened two deals this month', 'Replied within a day']);
    expect(scoreButton(host)!.textContent?.trim()).toBe('Re-score');
  });

  it('disables the button for a manual score and explains how to clear it', async () => {
    const host = await show(MANUAL);
    const b = scoreButton(host)!;
    expect(b.disabled).toBe(true);
    expect(host.textContent).toContain('Manual');
    const why = host.querySelector(`#${CSS.escape(b.getAttribute('aria-describedby')!)}`)!;
    expect(why.textContent).toBe(text('card.manualWhy'));
    expect(why.textContent).toContain('clear the lead score');
    // No reasons are shown for a number a person typed.
    expect(host.querySelectorAll('li')).toHaveLength(0);
  });

  it('treats a score with no source (typed before AI scoring existed) as manual', async () => {
    const host = await show({ ...NEVER, leadScore: 55, leadScoreSource: null });
    expect(scoreButton(host)!.disabled).toBe(true);
  });

  it('has no button without lsc.contacts.score, and no history without lsc.runs.read', async () => {
    state.perms = new Set();
    const host = await show(AI);
    expect(scoreButton(host)).toBeUndefined();
    expect(host.textContent).not.toContain(text('card.showHistory'));
    // The manual note then does not promise a button that is not there.
    await m?.unmount();
    const manual = await show(MANUAL);
    expect(manual.textContent).toContain(text('card.manualNote'));
  });

  it('shows a spinner state and blocks a second click while scoring', async () => {
    state.score = { ...state.score, isPending: true };
    const host = await show(NEVER);
    const b = scoreButton(host)!;
    expect(b.textContent?.trim()).toBe(text('card.scoring'));
    expect(b.disabled).toBe(true);
    expect(host.textContent).toContain(text('card.scoringSlow'));
  });

  it('says what the last run cost, never rounding a small cost to zero', async () => {
    state.score = {
      ...state.score,
      isSuccess: true,
      data: { score: 72, costUsd: '0.00010000', promptTokens: 400, completionTokens: 30 },
    };
    const host = await show(AI);
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      'Scored 72. Cost $0.0001, 430 tokens.',
    );
  });

  describe('failures', () => {
    const fail = (code: string, status: number) => {
      state.score = {
        ...state.score,
        isError: true,
        error: new ApiError(status, code, 'server words', 'req-1'),
      };
    };
    it.each([
      [ERROR_CODES.LSC_NOT_ENABLED, 422, 'notEnabled'],
      [ERROR_CODES.LSC_NO_KEY, 422, 'noKey'],
      [ERROR_CODES.LSC_MANUAL_SCORE, 409, 'manualScore'],
      [ERROR_CODES.LSC_PROVIDER_FAILED, 502, 'providerFailed'],
      [ERROR_CODES.LSC_PLATFORM_DISABLED, 422, 'platformDisabled'],
      [ERROR_CODES.PLAN_LIMIT_REACHED, 402, 'planLimit'],
    ])('%s gets its own message, not the server wording', async (code, status, key) => {
      fail(code, status);
      const host = await show(NEVER);
      const alert = host.querySelector('[role="alert"]')!;
      expect(alert.textContent).toContain(text(`scoreErrors.${key}`));
      expect(alert.textContent).not.toContain('server words');
      expect(alert.textContent).not.toContain('Request req-1');
    });

    it('links LSC_NOT_ENABLED to the settings screen and LSC_NO_KEY to the AI keys screen', async () => {
      state.perms.add('aiadm.keys.read');
      fail(ERROR_CODES.LSC_NOT_ENABLED, 422);
      let host = await show(NEVER);
      expect(host.querySelector('a')?.getAttribute('href')).toBe('/lead-scoring');
      await m?.unmount();
      fail(ERROR_CODES.LSC_NO_KEY, 422);
      host = await show(NEVER);
      expect(host.querySelector('a')?.getAttribute('href')).toBe('/ai-keys');
    });

    it('does not offer a link the person cannot open', async () => {
      state.perms = new Set(['lsc.contacts.score']);
      fail(ERROR_CODES.LSC_NOT_ENABLED, 422);
      const host = await show(NEVER);
      expect(host.querySelector('a')).toBeNull();
    });

    it('reports an unreachable server as such', async () => {
      state.score = { ...state.score, isError: true, error: new TypeError('fetch failed') };
      const host = await show(NEVER);
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        text('scoreErrors.network'),
      );
    });
  });

  describe('history', () => {
    const run = (over: Partial<LscRun> = {}): LscRun => ({
      id: 'r1',
      createdAt: '2026-03-12T15:04:00.000Z',
      contactId: ID,
      contactName: 'Aarav',
      status: 'ok',
      trigger: 'manual',
      score: 72,
      previousScore: 40,
      reasons: [],
      model: 'm',
      promptTokens: 400,
      completionTokens: 30,
      costUsd: '0.00010400',
      costSource: 'vendor',
      billedAgainst: 'admin',
      durationMs: 900,
      error: null,
      ...over,
    });

    it('stays closed until asked, then lists the runs of the contact', async () => {
      state.runs = { ...state.runs, items: [run()] };
      const host = await show(AI);
      expect(host.querySelector('table')).toBeNull();
      const toggle = [...host.querySelectorAll('button')].find(
        (b) => b.textContent === text('card.showHistory'),
      )!;
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      await click(toggle);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      const cells = [...host.querySelectorAll('tbody td')].map((c) => c.textContent);
      expect(cells).toContain('40 → 72');
      expect(cells).toContain('Score button');
      expect(cells).toContain('430');
      expect(cells).toContain('$0.000104');
    });

    it('says when there is nothing yet', async () => {
      const host = await show(NEVER);
      await click(
        [...host.querySelectorAll('button')].find(
          (b) => b.textContent === text('card.showHistory'),
        )!,
      );
      expect(host.textContent).toContain(text('card.historyEmpty'));
    });
  });
});

describe('ScoreCard while lead scoring is off for the workspace', () => {
  /** Nothing of the card is drawn (the toast region the harness adds around it is not the card). */
  const drawsNothing = (host: HTMLElement) => {
    expect(host.querySelector('section')).toBeNull();
    expect(host.querySelector('[data-testid="lsc-score"]')).toBeNull();
    expect(host.querySelector('button')).toBeNull();
    expect(host.textContent).toBe('');
  };

  const showWith = async (contact: ScoreFields, features: string[] | null = ['lead_scoring']) => {
    m = await mount(
      <PlanFeaturesProvider features={features}>
        <ScoreCard contactId={ID} contact={contact} />
      </PlanFeaturesProvider>,
    );
    return m.host;
  };

  it('draws nothing when the workspace switch is off: no card, no number, a typed score included', async () => {
    state.status = { data: { enabled: false } };
    for (const contact of [MANUAL, AI, NEVER]) {
      drawsNothing(await showWith(contact));
      await m?.unmount();
    }
  });

  it('draws nothing in a workspace without the AI lead scoring app, and does not ask for the switch', async () => {
    drawsNothing(await showWith(MANUAL, ['marketplace']));
    expect(state.statusAsked.every((asked) => asked === false)).toBe(true);
  });

  it('draws nothing until the switch is known, and when it cannot be read', async () => {
    state.status = {};
    drawsNothing(await showWith(AI));
    await m?.unmount();
    state.status = { isError: true };
    drawsNothing(await showWith(AI));
  });

  it('shows the card and the button once the app is there and the switch is on, and brings a typed score back', async () => {
    const host = await showWith(MANUAL);
    expect(host.querySelector('[data-testid="lsc-score"]')?.textContent).toBe('40');
    await m?.unmount();
    const fresh = await showWith(NEVER, ['marketplace', 'lead_scoring']);
    expect(scoreButton(fresh)).toBeDefined();
    expect(state.statusAsked).toContain(true);
  });
});
