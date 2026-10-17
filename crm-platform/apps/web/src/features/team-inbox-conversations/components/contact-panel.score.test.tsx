// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contactSummary, detail, id } from '../lib/fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  score: vi.fn(),
  insight: vi.fn(),
  notes: vi.fn(),
}));
vi.mock('@/features/contacts-attributes-tags', () => ({
  ContactNotesSection: (p: { contact: { id: string } }) => {
    state.notes(p);
    return <div data-testid="contact-notes" data-contact={p.contact.id} />;
  },
}));
vi.mock('@/features/lead-scoring', () => ({
  ScoreCard: (p: { contactId: string; contact: unknown; onScored?: () => unknown }) => {
    state.score(p);
    return (
      <button type="button" data-testid="score-card" onClick={() => void p.onScored?.()}>
        score card
      </button>
    );
  },
  ChatInsightCard: (p: { contactId: string; onChanged?: () => unknown }) => {
    state.insight(p);
    return (
      <button type="button" data-testid="insight-card" onClick={() => void p.onChanged?.()}>
        insight card
      </button>
    );
  },
}));
vi.mock('@/features/appointments', () => ({ LinkedAppointments: () => null }));
vi.mock('@/features/tasks', () => ({ LinkedTasks: () => null }));
vi.mock('../api/hooks', () => ({
  KEYS: { conversation: (c: string) => ['inbox', 'conversation', c] },
  useAssignees: () => ({ data: undefined, isPending: false, isError: false }),
  useTimeline: () => ({ data: undefined, isPending: false, isError: false, refetch: vi.fn() }),
}));

import { ContactPanel, type ContactPanelProps } from './contact-panel';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'team-inbox-conversations.json'), 'utf8'),
) as Record<string, unknown>;

const props = (over: Partial<ContactPanelProps> = {}): ContactPanelProps => ({
  detail: detail({ contact: null, contactSummary: contactSummary() }),
  meId: id(5),
  can: { assign: false, assignSelf: false, resolve: false },
  presence: new Map(),
  nowMs: Date.now(),
  assigning: false,
  resolving: false,
  onAssign: vi.fn(),
  onToggleResolved: vi.fn(),
  onOpenConversation: vi.fn(),
  ...over,
});

let root: Root | null = null;
let host: HTMLElement;
let client: QueryClient;
beforeEach(() => {
  state.score = vi.fn();
  state.insight = vi.fn();
  state.notes = vi.fn();
  client = new QueryClient();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
});
async function show(p: ContactPanelProps) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <QueryClientProvider client={client}>
          <ContactPanel {...p} />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
  return host;
}
const click = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

describe('the lead score in the inbox contact panel', () => {
  it('shows the contact\u2019s score card and the conversation reading, for the contact of the thread', async () => {
    const summary = contactSummary({
      leadScore: 81,
      leadScoreSource: 'ai',
      leadScoreReasons: ['Asked about price'],
      leadScoredAt: '2026-10-12T10:00:00.000Z',
      leadScoreModel: 'openai/gpt-6-luna-pro',
    });
    const el = await show(props({ detail: detail({ contactSummary: summary }) }));
    expect(el.querySelector('[data-testid="inbox-lead-score"]')).not.toBeNull();
    const cardProps = state.score.mock.calls[0]![0] as { contactId: string; contact: unknown };
    expect(cardProps.contactId).toBe(summary.id);
    expect(cardProps.contact).toMatchObject({
      leadScore: 81,
      leadScoreSource: 'ai',
      leadScoreReasons: ['Asked about price'],
      leadScoreModel: 'openai/gpt-6-luna-pro',
    });
    expect((state.insight.mock.calls[0]![0] as { contactId: string }).contactId).toBe(summary.id);
  });

  it('shows nothing when the caller may not read the contact (the summary is empty) or the thread has no contact', async () => {
    const el = await show(props({ detail: detail({ contactSummary: null }) }));
    expect(el.querySelector('[data-testid="inbox-lead-score"]')).toBeNull();
    expect(state.score).not.toHaveBeenCalled();
    expect(state.insight).not.toHaveBeenCalled();
  });

  it('refreshes the conversation after a score or a decided suggestion, so the panel and the score agree', async () => {
    const spy = vi.spyOn(client, 'invalidateQueries');
    const d = detail({ contactSummary: contactSummary() });
    const el = await show(props({ detail: d }));
    await click(el.querySelector('[data-testid="score-card"]')!);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['inbox', 'conversation', d.id] });
    spy.mockClear();
    await click(el.querySelector('[data-testid="insight-card"]')!);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['inbox', 'conversation', d.id] });
  });
});

describe('the notes tab of the inbox contact panel', () => {
  it('lists the contact\u2019s own notes, not the conversation\u2019s internal notes', async () => {
    const summary = contactSummary();
    const el = await show(props({ detail: detail({ contactSummary: summary }) }));
    expect(el.querySelector('[data-testid="contact-notes"]')?.getAttribute('data-contact')).toBe(
      summary.id,
    );
    expect(el.querySelector('[data-testid="inbox-note-input"]')).toBeNull();
    expect(el.textContent).toContain('Contact notes');
  });

  it('says there is no contact to attach notes to when the thread has none', async () => {
    const el = await show(props({ detail: detail({ contact: null, contactSummary: null }) }));
    expect(el.querySelector('[data-testid="contact-notes"]')).toBeNull();
    expect(el.textContent).toContain('no contact to attach notes to');
  });
});
