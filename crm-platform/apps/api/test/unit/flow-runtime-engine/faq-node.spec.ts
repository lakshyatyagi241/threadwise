import { describe, expect, it, vi } from 'vitest';
import {
  runFaq,
  type FaqNodeDeps,
} from '../../../src/modules/flow-runtime-engine/runtime/nodes/ai/faq-node';
import type {
  NodeContext,
  SendOutcome,
} from '../../../src/modules/flow-runtime-engine/runtime/types';
import type { FlowFaqAnswer } from '../../../src/modules/faq-knowledge';

const matched = (
  over: Partial<Extract<FlowFaqAnswer, { status: 'matched' }>> = {},
): FlowFaqAnswer => ({
  status: 'matched',
  score: 0.71,
  faqUuid: '11111111-1111-4111-8111-111111111111',
  question: 'Where is my order?',
  answerType: 'text',
  answerText: 'Ships in 2 days.',
  flowId: null,
  flowNodeId: null,
  ...over,
});

function ctxOf(data: Record<string, unknown>, send: SendOutcome = { ok: true }) {
  const vars: Record<string, unknown> = { user_message: 'order status', typed: 'hi {{x}}' };
  const sent: unknown[] = [];
  const notes: string[] = [];
  const ctx = {
    run: { orgId: 7, conversationId: 3, channelId: 5, vars },
    node: { id: 'f', type: 'Faq', props: { data } },
    stepKey: 'flow:1:0:f',
    send: vi.fn(async (m: unknown) => {
      sent.push(m);
      return send;
    }),
    render: (t: unknown) =>
      String(t ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k) => String(vars[k] ?? '')),
    note: (t: string) => notes.push(t),
    now: () => new Date(),
  } as unknown as NodeContext;
  return { ctx, vars, sent, notes };
}

const deps = (a: FlowFaqAnswer | Error): FaqNodeDeps & { calls: unknown[] } => {
  const calls: unknown[] = [];
  return {
    calls,
    answer: async (_org, input) => {
      calls.push(input);
      if (a instanceof Error) throw a;
      return a;
    },
  };
};

describe('runFaq: the "Answer from FAQ" node', () => {
  it('a text FAQ is sent and the node leaves by matched, with the result in variables', async () => {
    const { ctx, vars, sent } = ctxOf({
      query: '{{user_message}}',
      sendAnswer: true,
      variable: 'faq',
    });
    const d = deps(matched());
    const r = await runFaq(ctx, d);
    expect(r).toEqual({ kind: 'advance', port: 1, branch: true });
    expect(sent).toEqual([{ kind: 'text', body: 'Ships in 2 days.' }]);
    expect(d.calls[0]).toEqual({
      query: 'order status',
      category: null,
      minScore: null,
      conversationId: 3,
      channelId: 5,
    });
    expect(vars).toMatchObject({
      'faq.matched': 'yes',
      'faq.score': 0.71,
      'faq.question': 'Where is my order?',
      'faq.answer': 'Ships in 2 days.',
      'faq.id': '11111111-1111-4111-8111-111111111111',
    });
  });

  it('"send the answer" off saves the answer without sending anything', async () => {
    const { ctx, vars, sent } = ctxOf({ query: 'x', sendAnswer: false });
    expect((await runFaq(ctx, deps(matched()))).kind).toBe('advance');
    expect(sent).toEqual([]);
    expect(vars['faq.answer']).toBe('Ships in 2 days.');
  });

  it('a miss leaves by no_match and says no', async () => {
    const { ctx, vars, sent } = ctxOf({ query: 'x' });
    const r = await runFaq(ctx, deps({ status: 'no_match', score: 0.2, reason: 'below' }));
    expect(r).toEqual({ kind: 'advance', port: 2, branch: true });
    expect(sent).toEqual([]);
    expect(vars).toMatchObject({ 'faq.matched': 'no', 'faq.score': 0.2, 'faq.answer': '' });
  });

  it('an unavailable engine and a thrown error both leave by no_match, never fail the run', async () => {
    for (const a of [
      { status: 'unavailable', reason: 'off' } as FlowFaqAnswer,
      new Error('db down'),
    ]) {
      const { ctx, vars, notes } = ctxOf({ query: 'x' });
      expect(await runFaq(ctx, deps(a))).toEqual({ kind: 'advance', port: 2, branch: true });
      expect(vars['faq.matched']).toBe('no');
      expect(notes.join(' ')).toContain('faq:');
    }
  });

  it('passes the category and a valid minimum score, and ignores a bad one', async () => {
    const a = ctxOf({ query: 'x', category: ' billing ', minScore: '0.6' });
    const da = deps({ status: 'no_match', score: null, reason: '' });
    await runFaq(a.ctx, da);
    expect(da.calls[0]).toMatchObject({ category: 'billing', minScore: 0.6 });
    const b = ctxOf({ query: 'x', minScore: 'abc' });
    const db = deps({ status: 'no_match', score: null, reason: '' });
    await runFaq(b.ctx, db);
    expect(db.calls[0]).toMatchObject({ category: null, minScore: null });
    const c = ctxOf({ query: 'x', minScore: '' });
    const dc = deps({ status: 'no_match', score: null, reason: '' });
    await runFaq(c.ctx, dc);
    expect(dc.calls[0]).toMatchObject({ minScore: null });
  });

  it('a flow FAQ hands the run to its flow at its step, falling back to no_match with matched = no', async () => {
    const { ctx } = ctxOf({ query: 'x', variable: 'hit' });
    const r = await runFaq(
      ctx,
      deps(matched({ answerType: 'flow', answerText: null, flowId: 42, flowNodeId: 'b' })),
    );
    expect(r).toEqual({
      kind: 'subflow',
      flowId: 42,
      startNodeId: 'b',
      missPort: 2,
      missVars: { 'hit.matched': 'no' },
    });
  });

  it('a flow FAQ without a chosen step starts the flow at its start, and one whose flow is gone is a miss', async () => {
    const { ctx } = ctxOf({ query: 'x' });
    const r = await runFaq(
      ctx,
      deps(matched({ answerType: 'flow', answerText: null, flowId: 42 })),
    );
    expect(r).toMatchObject({ kind: 'subflow', flowId: 42 });
    expect(r).not.toHaveProperty('startNodeId');
    const gone = ctxOf({ query: 'x' });
    expect(
      await runFaq(gone.ctx, deps(matched({ answerType: 'flow', answerText: null, flowId: null }))),
    ).toEqual({
      kind: 'advance',
      port: 2,
      branch: true,
    });
    expect(gone.vars['faq.matched']).toBe('no');
  });

  it('a channel that is down halts the run so it tries again; another refusal fails it', async () => {
    const down = ctxOf({ query: 'x' }, { ok: false, error: 'channel down', code: 'X', halt: true });
    expect((await runFaq(down.ctx, deps(matched()))).kind).toBe('halt');
    const refused = ctxOf(
      { query: 'x' },
      { ok: false, error: 'window closed', code: 'WINDOW', halt: false },
    );
    expect(await runFaq(refused.ctx, deps(matched()))).toMatchObject({
      kind: 'fail',
      code: 'WINDOW',
    });
  });

  it('a text FAQ with an empty answer sends nothing and still leaves by matched', async () => {
    const { ctx, sent } = ctxOf({ query: 'x' });
    expect(await runFaq(ctx, deps(matched({ answerText: '' })))).toEqual({
      kind: 'advance',
      port: 1,
      branch: true,
    });
    expect(sent).toEqual([]);
  });

  it('a blank query still asks the service (which answers no_match), and a missing variable name falls back to faq', async () => {
    const { ctx, vars } = ctxOf({ query: '', variable: '' });
    const d = deps({ status: 'no_match', score: null, reason: 'empty' });
    await runFaq(ctx, d);
    expect(d.calls[0]).toMatchObject({ query: '' });
    expect(vars['faq.matched']).toBe('no');
  });
});
