import { describe, expect, it, vi } from 'vitest';
import { KbUnavailableError } from '../../../src/modules/knowledge-base/kb-embedding.service';
import { KbRetrievalService } from '../../../src/modules/knowledge-base/kb-retrieval.service';

interface Setup {
  engineEnabled?: boolean;
  ready?: number;
  near?: Array<{ label: string; text: string; score: number }>;
  unindexed?: Array<{ label: string; text: string }>;
  whole?: Array<{
    label: string;
    kind: string;
    content: string | null;
    question: string | null;
    answer: string | null;
  }>;
  embedError?: Error;
}

function build(s: Setup = {}) {
  const db = { txAs: async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn({}) };
  const config = {
    get: async () => ({
      engineEnabled: s.engineEnabled ?? true,
      embeddingModel: 'openai/text-embedding-3-large',
    }),
  };
  const embedQuery = vi.fn(async () => {
    if (s.embedError) throw s.embedError;
    return { vector: [0.1, 0.2], model: 'openai/text-embedding-3-large', cached: false };
  });
  const chunks = {
    readyCount: async () => s.ready ?? 5,
    nearest: vi.fn(async () => s.near ?? []),
    unindexedPassages: async () => s.unindexed ?? [],
    wholeBase: async () =>
      s.whole ?? [
        {
          label: 'Handbook',
          kind: 'text',
          content: 'Whole base text',
          question: null,
          answer: null,
        },
      ],
  };
  const svc = new KbRetrievalService(
    db as never,
    config as never,
    { embedQuery } as never,
    chunks as never,
  );
  return { svc, embedQuery, chunks };
}

describe('KbRetrievalService', () => {
  it('reads the best few passages and tells the agent to stay inside them', async () => {
    const { svc, chunks } = build({
      near: [
        { label: 'FAQ', text: 'Q: Returns?\nA: 30 days.', score: 0.62 },
        { label: 'Policy', text: 'Refunds take 5 days.', score: 0.58 },
        { label: 'Weak', text: 'unrelated', score: 0.31 },
      ],
    });
    const out = await svc.retrieve(1, 7, 'can I return my order?');
    expect(out.grounded).toBe(true);
    expect(out.passages.map((p) => p.label)).toEqual(['FAQ', 'Policy']);
    // The search is limited to this agent.
    expect((chunks.nearest.mock.calls[0] as unknown[])[2]).toBe(7);
  });

  it('is grounded with no passages when nothing reaches the floor (the agent must say it does not know)', async () => {
    const { svc } = build({ near: [{ label: 'x', text: 'y', score: 0.1 }] });
    expect(await svc.retrieve(1, 7, 'something unrelated entirely')).toEqual({
      grounded: true,
      passages: [],
    });
  });

  it('adds text the vectors do not cover yet, so a new entry answers at once', async () => {
    const { svc } = build({
      near: [{ label: 'FAQ', text: 'old', score: 0.6 }],
      unindexed: [{ label: 'New entry', text: 'just added' }],
    });
    const out = await svc.retrieve(1, 7, 'hello there');
    expect(out.passages.map((p) => p.label)).toEqual(['FAQ', 'New entry']);
  });

  it('falls back to the whole base when the search is switched off', async () => {
    const { svc, embedQuery } = build({ engineEnabled: false });
    const out = await svc.retrieve(1, 7, 'hello there');
    expect(out).toEqual({
      grounded: false,
      passages: [{ label: 'Handbook', text: 'Whole base text' }],
    });
    expect(embedQuery).not.toHaveBeenCalled();
  });

  it('falls back to the whole base when nothing is indexed yet', async () => {
    const { svc, embedQuery } = build({ ready: 0 });
    expect((await svc.retrieve(1, 7, 'hello there')).grounded).toBe(false);
    expect(embedQuery).not.toHaveBeenCalled();
  });

  it('falls back to the whole base for a message that is not a question (an emoji)', async () => {
    const { svc, embedQuery } = build();
    expect((await svc.retrieve(1, 7, '👍')).grounded).toBe(false);
    expect(embedQuery).not.toHaveBeenCalled();
  });

  it('falls back to the whole base when the embedding vendor is unavailable', async () => {
    const { svc } = build({ embedError: new KbUnavailableError('no_key', 'No key') });
    expect((await svc.retrieve(1, 7, 'hello there')).grounded).toBe(false);
  });

  it('never throws, even on an unexpected failure', async () => {
    const { svc } = build({ embedError: new Error('boom') });
    expect((await svc.retrieve(1, 7, 'hello there')).grounded).toBe(false);
  });

  it('reads a Q&A entry of the whole base as a question and its answer', async () => {
    const { svc } = build({
      engineEnabled: false,
      whole: [{ label: 'q', kind: 'qa', content: null, question: 'Hours?', answer: '9 to 5' }],
    });
    expect((await svc.retrieve(1, 7, 'hello there')).passages).toEqual([
      { label: 'q', text: 'Q: Hours?\nA: 9 to 5' },
    ]);
  });
});
