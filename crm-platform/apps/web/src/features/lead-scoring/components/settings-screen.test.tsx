// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { ERROR_CODES, type LscSettings } from '@crm/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { button, byText, click, mount, text, type Mounted } from '../testing';

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  settings: {} as Record<string, unknown>,
  runs: {} as Record<string, unknown>,
  backfill: {} as Record<string, unknown>,
  suggestions: {} as Record<string, unknown>,
  decide: {} as Record<string, unknown>,
  save: vi.fn(),
  backfillMutate: vi.fn(),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('../api/hooks', () => ({
  KEYS: {
    all: ['lead-scoring'],
    settings: ['lead-scoring', 'settings'],
    runs: ['lead-scoring', 'runs'],
  },
  useLscSettings: () => state.settings,
  useLscRuns: () => state.runs,
  useBackfill: () => state.backfill,
  useLscSuggestions: () => state.suggestions,
  useDecideSuggestions: () => state.decide,
}));
vi.mock('../api/service', () => ({ lscApi: { saveSettings: (i: unknown) => state.save(i) } }));

import { SettingsScreen } from './settings-screen';

const settings = (over: Partial<LscSettings> = {}): LscSettings => ({
  enabled: false,
  autoScore: false,
  chatDigest: false,
  stageSuggestions: false,
  chatDigestAvailable: false,
  pendingSuggestions: 0,
  platformEnabled: true,
  model: 'openai/gpt-4o-mini',
  keySource: 'admin',
  eligibleContacts: 120,
  scoredContacts: 20,
  last30d: {
    scores: 20,
    failed: 2,
    promptTokens: 8000,
    completionTokens: 600,
    costUsd: '0.00210000',
    avgCostPerScoreUsd: '0.00010500',
    platformCostUsd: '0.00210000',
  },
  rowVersion: null,
  updatedAt: null,
  ...over,
});
const ok = (data: unknown) => ({
  isPending: false,
  isError: false,
  error: null,
  data,
  refetch: vi.fn(),
});

let m: Mounted | null = null;
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient();
  state.perms = new Set(['lsc.runs.read', 'lsc.settings.manage', 'lsc.contacts.score']);
  state.settings = ok(settings());
  state.runs = {
    isPending: false,
    isError: false,
    items: [],
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetching: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  };
  state.save = vi.fn().mockResolvedValue(settings({ enabled: true, rowVersion: 1 }));
  state.suggestions = {
    isPending: false,
    isError: false,
    isSuccess: true,
    items: [],
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  };
  state.decide = { mutate: vi.fn(), isPending: false, isError: false, isSuccess: false };
  state.backfillMutate = vi.fn();
  state.backfill = {
    mutate: state.backfillMutate,
    isPending: false,
    isError: false,
    isSuccess: false,
  };
});
afterEach(async () => {
  await m?.unmount();
  m = null;
});
const show = async () => {
  m = await mount(<SettingsScreen />, client);
  return m.host;
};
const sw = (host: HTMLElement, id: string) => host.querySelector<HTMLButtonElement>(`#${id}`)!;
const saveButton = (host: HTMLElement) => button(host, text('settings.save'));

describe('banners', () => {
  it('says the platform is off, whatever is set here', async () => {
    state.settings = ok(settings({ platformEnabled: false }));
    const host = await show();
    expect(host.textContent).toContain(text('settings.banner.platformOff'));
  });
  it('says no key is available and links to AI keys for a role that may open it', async () => {
    state.perms.add('aiadm.keys.read');
    state.settings = ok(settings({ keySource: 'none' }));
    const host = await show();
    expect(host.textContent).toContain(text('settings.banner.noKey'));
    expect(host.querySelector('a[href="/ai-keys"]')).not.toBeNull();
  });
  it('says it is off, and then that it is ready with the model and the key', async () => {
    let host = await show();
    expect(host.textContent).toContain(text('settings.banner.off'));
    await m?.unmount();
    state.settings = ok(settings({ enabled: true, keySource: 'workspace', rowVersion: 2 }));
    host = await show();
    expect(host.textContent).toContain(
      "Ready. Contacts are scored with openai/gpt-4o-mini using your workspace's own OpenRouter key.",
    );
  });
});

describe('what is sent', () => {
  it('lists the anonymised facts and says name, email and phone never leave', async () => {
    const host = await show();
    const t = host.textContent ?? '';
    for (const k of ['stage', 'source', 'tags', 'deals', 'activity', 'engagement', 'company'])
      expect(t).toContain(text(`settings.sent.${k}`));
    for (const k of ['name', 'email', 'phone', 'messages'])
      expect(t).toContain(text(`settings.notSent.${k}`));
    expect(t).toContain(text('settings.manualRule'));
  });
});

describe('saving', () => {
  it('sends the first save without a rowVersion, after the opt-in is confirmed', async () => {
    const host = await show();
    expect(sw(host, 'lsc-enabled').getAttribute('aria-checked')).toBe('false');
    expect(saveButton(host).disabled).toBe(true);
    await click(sw(host, 'lsc-enabled'));
    await click(saveButton(host));
    // Turning it on asks first: nothing is sent yet.
    expect(state.save).not.toHaveBeenCalled();
    await click(byText(host, 'dialog button', text('settings.confirm.yes')));
    expect(state.save).toHaveBeenCalledTimes(1);
    const body = state.save.mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toEqual({ enabled: true, autoScore: false });
    // A workspace that is not in the pilot never sends the conversation switches.
    expect('chatDigest' in body).toBe(false);
    expect('rowVersion' in body).toBe(false);
  });

  it('sends the version it read on a later save, and needs no confirmation to turn it off', async () => {
    state.settings = ok(settings({ enabled: true, autoScore: true, rowVersion: 3 }));
    const host = await show();
    await click(sw(host, 'lsc-enabled'));
    await click(saveButton(host));
    expect(state.save).toHaveBeenCalledWith({ enabled: false, autoScore: true, rowVersion: 3 });
  });

  it('saves the automatic switch on its own', async () => {
    state.settings = ok(settings({ enabled: true, rowVersion: 5 }));
    const host = await show();
    await click(sw(host, 'lsc-auto'));
    await click(saveButton(host));
    expect(state.save).toHaveBeenCalledWith({ enabled: true, autoScore: true, rowVersion: 5 });
  });

  it('reloads and tells the person when someone else saved first (409)', async () => {
    state.settings = ok(settings({ enabled: true, rowVersion: 3 }));
    state.save = vi
      .fn()
      .mockRejectedValue(new ApiError(409, ERROR_CODES.ROW_VERSION_CONFLICT, 'stale'));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const host = await show();
    await click(sw(host, 'lsc-auto'));
    await click(saveButton(host));
    expect(host.textContent).toContain(text('settings.conflict'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['lead-scoring', 'settings'] });
  });

  it('shows another failure in words', async () => {
    state.settings = ok(settings({ enabled: true, rowVersion: 3 }));
    state.save = vi.fn().mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
    const host = await show();
    await click(sw(host, 'lsc-auto'));
    await click(saveButton(host));
    expect(host.textContent).toContain(text('errors.unexpected'));
    expect(host.textContent).not.toContain(text('settings.conflict'));
  });

  it('disables every control, and says why, without lsc.settings.manage', async () => {
    state.perms = new Set(['lsc.runs.read']);
    const host = await show();
    expect(sw(host, 'lsc-enabled').disabled).toBe(true);
    expect(sw(host, 'lsc-auto').disabled).toBe(true);
    expect(
      [...host.querySelectorAll('button')].some((b) => b.textContent === text('settings.save')),
    ).toBe(false);
    expect(host.textContent).toContain(text('settings.readOnly'));
  });

  it('shows no access without lsc.runs.read', async () => {
    state.perms = new Set();
    const host = await show();
    expect(host.textContent).toContain(text('common.noAccessTitle'));
  });
});

describe('score unscored contacts', () => {
  const ready = () => {
    state.settings = ok(settings({ enabled: true, rowVersion: 2 }));
  };
  it('shows the counts', async () => {
    const host = await show();
    const t = host.textContent ?? '';
    expect(t).toContain('120');
    expect(t).toContain('20');
    // waiting = eligible - scored
    expect(t).toContain('100');
  });
  it('queues a batch of 500', async () => {
    ready();
    const host = await show();
    const b = button(host, text('settings.backfill.button'));
    expect(b.disabled).toBe(false);
    await click(b);
    expect(state.backfillMutate).toHaveBeenCalledWith(500);
  });
  it('is blocked, with the reason, until it is on', async () => {
    const host = await show();
    const b = button(host, text('settings.backfill.button'));
    expect(b.disabled).toBe(true);
    expect(host.textContent).toContain(text('settings.backfill.notReady'));
  });
  it('is blocked without lsc.contacts.score', async () => {
    ready();
    state.perms.delete('lsc.contacts.score');
    const host = await show();
    expect(button(host, text('settings.backfill.button')).disabled).toBe(true);
    expect(host.textContent).toContain(text('settings.backfill.noRight'));
  });
  it('reports how many were queued, or that there was nothing to do', async () => {
    ready();
    state.backfill = { ...state.backfill, isSuccess: true, data: { queued: 1 } };
    let host = await show();
    expect(host.textContent).toContain('1 contact is queued');
    await m?.unmount();
    state.backfill = { ...state.backfill, data: { queued: 37 } };
    host = await show();
    expect(host.textContent).toContain('37 contacts are queued');
    await m?.unmount();
    state.backfill = { ...state.backfill, data: { queued: 0 } };
    host = await show();
    expect(host.textContent).toContain(text('settings.backfill.nothingToScore'));
  });
});

describe('cost summary', () => {
  it('shows scores, tokens, total, average and who pays, without rounding to zero', async () => {
    state.settings = ok(settings({ keySource: 'workspace', rowVersion: 1, enabled: true }));
    const host = await show();
    const t = host.textContent ?? '';
    expect(t).toContain('8,600');
    expect(t).toContain('$0.0021');
    expect(t).toContain('$0.000105');
    expect(t).toContain(text('settings.cost.payerBy.workspace'));
    expect(t).not.toContain('$0.00 ');
  });
  it('shows a dash for the average when nothing was scored', async () => {
    state.settings = ok(
      settings({
        last30d: {
          scores: 0,
          failed: 0,
          promptTokens: 0,
          completionTokens: 0,
          costUsd: '0',
          avgCostPerScoreUsd: null,
          platformCostUsd: '0',
        },
      }),
    );
    const host = await show();
    const tile = byText(host, 'div', text('settings.cost.average')).parentElement!;
    expect(tile.textContent).toContain('—');
  });
});

describe('reading conversations (a pilot)', () => {
  const pilot = (over: Partial<LscSettings> = {}) =>
    ok(
      settings({
        enabled: true,
        autoScore: true,
        chatDigestAvailable: true,
        rowVersion: 2,
        ...over,
      }),
    );

  it('is not even shown to a workspace outside the pilot, and says plainly that no message text is sent', async () => {
    const host = await show();
    expect(host.querySelector('#lsc-chat-digest')).toBeNull();
    expect(host.textContent).toContain(text('settings.notSent.messages'));
    expect(host.textContent).not.toContain(text('settings.chat.title'));
  });

  it('shows the two switches and how data is masked, and drops the "never sent" claim for messages', async () => {
    state.settings = pilot();
    const host = await show();
    expect(sw(host, 'lsc-chat-digest').getAttribute('aria-checked')).toBe('false');
    // Stage suggestions need the chat reading.
    expect(sw(host, 'lsc-stage-suggestions').disabled).toBe(true);
    for (const k of ['phone', 'email', 'card', 'name'])
      expect(host.textContent).toContain(text(`settings.chat.masked.${k}`));
    expect(host.textContent).toContain(text('settings.notSent.messagesChat'));
    // The plain "never sent" line is replaced, not repeated next to the one that mentions the pilot.
    expect([...host.querySelectorAll('li')].map((li) => li.textContent)).not.toContain(
      text('settings.notSent.messages'),
    );
  });

  it('asks before the first conversation is sent, and saves both switches with the version it read', async () => {
    state.settings = pilot();
    state.save = vi.fn().mockResolvedValue(settings({ rowVersion: 3 }));
    const host = await show();
    await click(sw(host, 'lsc-chat-digest'));
    await click(sw(host, 'lsc-stage-suggestions'));
    await click(saveButton(host));
    expect(state.save).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(text('settings.chat.confirm.title'));
    const open = document.querySelector<HTMLElement>('dialog[open]')!;
    await click(byText(open, 'button', text('settings.chat.confirm.yes')));
    expect(state.save).toHaveBeenCalledWith({
      enabled: true,
      autoScore: true,
      chatDigest: true,
      stageSuggestions: true,
      rowVersion: 2,
    });
  });

  it('turning it off needs no question, and takes the stage suggestions with it', async () => {
    state.settings = pilot({ chatDigest: true, stageSuggestions: true });
    const host = await show();
    await click(sw(host, 'lsc-chat-digest'));
    expect(sw(host, 'lsc-stage-suggestions').getAttribute('aria-checked')).toBe('false');
    await click(saveButton(host));
    expect(state.save).toHaveBeenCalledWith({
      enabled: true,
      autoScore: true,
      chatDigest: false,
      stageSuggestions: false,
      rowVersion: 2,
    });
  });

  it('lists the waiting stage suggestions and decides them', async () => {
    state.settings = pilot({ chatDigest: true, stageSuggestions: true, pendingSuggestions: 1 });
    const mutate = vi.fn();
    state.decide = { mutate, isPending: false, isError: false, isSuccess: false };
    state.perms.add('lsc.stage.review');
    state.suggestions = {
      ...(state.suggestions as object),
      items: [
        {
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
          createdAt: '2026-10-12T10:00:00.000Z',
          decidedAt: null,
        },
      ],
    };
    const host = await show();
    expect(host.textContent).toContain('Priya');
    expect(host.textContent).toContain('Move from Lead to Qualified');
    await click(byText(host, 'li button', text('suggestions.accept')));
    expect(mutate).toHaveBeenCalledWith({ action: 'accept', ids: ['s1'] }, expect.anything());
    await click(byText(host, 'button', 'Accept the 1 above 85%'));
    expect(mutate).toHaveBeenLastCalledWith({ action: 'accept', ids: ['s1'] }, expect.anything());
  });
});
