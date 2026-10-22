import { describe, expect, it, vi } from 'vitest';
import { FaqNodes } from '../../../src/modules/flow-runtime-engine/runtime/nodes/ai/faq-node';
import type { NodeContext } from '../../../src/modules/flow-runtime-engine/runtime/types';

const UUID = '3f0c2a1e-9b7d-4c55-8a2e-1d6f0b9c7a42';

function setup(
  data: Record<string, unknown>,
  opts: {
    retrieval?: {
      grounded: boolean;
      hits?: number;
      passages: Array<{ label: string; text: string }>;
    };
    assistantRow?: number;
    send?: { ok: boolean; halt?: boolean; error?: string };
  } = {},
) {
  const vars: Record<string, unknown> = { 'faq.matched': 'yes', 'faq.answer': 'stale' };
  const notes: string[] = [];
  const sent: unknown[] = [];
  const ctx = {
    run: { orgId: 7, flowId: 41, conversationId: 3, channelId: 5, vars },
    node: { id: 'f', type: 'Faq', props: { data } },
    stepKey: 'flow:1:0:f',
    render: (t: unknown) => String(t ?? '').replace('{{user_message}}', 'what are your hours'),
    note: (t: string) => notes.push(t),
    send: async (m: unknown) => {
      sent.push(m);
      return opts.send ?? { ok: true };
    },
  } as unknown as NodeContext;
  const retrieve = vi.fn(async () => opts.retrieval ?? { grounded: true, passages: [] });
  const assistantId = vi.fn(async () => opts.assistantRow ?? 12);
  const node = new FaqNodes({ retrieve } as never, { assistantId } as never);
  return { node, ctx, vars, notes, sent, retrieve, assistantId };
}

describe('the "Answer from FAQ" step', () => {
  it('handles the Faq node type', () => {
    expect(setup({}).node.types).toEqual(['Faq']);
  });

  it('leaves by "No match" (port 2) when no AI agent is chosen, without searching', async () => {
    const t = setup({}, { assistantRow: 0 });
    await expect(t.node.execute(t.ctx)).resolves.toEqual({
      kind: 'advance',
      port: 2,
      branch: true,
    });
    expect(t.retrieve).not.toHaveBeenCalled();
    expect(t.vars['faq.matched']).toBe('no');
    expect(t.vars['faq.answer']).toBe('');
  });

  it('searches the chosen agent with the rendered query', async () => {
    const t = setup({ assistant: UUID, query: '{{user_message}}' });
    await t.node.execute(t.ctx);
    expect(t.assistantId).toHaveBeenCalledWith(7, { kind: 'uuid', uuid: UUID });
    expect(t.retrieve).toHaveBeenCalledWith(7, 12, 'what are your hours');
  });

  it('matches: sets the variables under the saved name, sends the answer and leaves by "Matched" (port 1)', async () => {
    const t = setup(
      { assistant: UUID, variable: 'kb' },
      {
        retrieval: {
          grounded: true,
          hits: 1,
          passages: [{ label: 'FAQ', text: 'Q: Opening hours?\nA: 9 to 5, Monday to Friday.' }],
        },
      },
    );
    await expect(t.node.execute(t.ctx)).resolves.toEqual({
      kind: 'advance',
      port: 1,
      branch: true,
    });
    expect(t.vars['kb.matched']).toBe('yes');
    expect(t.vars['kb.question']).toBe('Opening hours?');
    expect(t.vars['kb.answer']).toBe('9 to 5, Monday to Friday.');
    expect(t.sent).toEqual([{ kind: 'text', body: '9 to 5, Monday to Friday.' }]);
    // A different name does not touch the default one.
    expect(t.vars['faq.matched']).toBe('yes');
  });

  it('sends a text passage whole, with no question', async () => {
    const t = setup(
      { assistant: UUID },
      {
        retrieval: {
          grounded: true,
          hits: 1,
          passages: [{ label: 'Doc', text: 'We ship worldwide.' }],
        },
      },
    );
    await t.node.execute(t.ctx);
    expect(t.vars['faq.question']).toBe('');
    expect(t.vars['faq.answer']).toBe('We ship worldwide.');
  });

  it('does not send the answer when the step is set not to', async () => {
    const t = setup(
      { assistant: UUID, sendAnswer: false },
      {
        retrieval: {
          grounded: true,
          hits: 1,
          passages: [{ label: 'Doc', text: 'We ship worldwide.' }],
        },
      },
    );
    await expect(t.node.execute(t.ctx)).resolves.toMatchObject({ port: 1 });
    expect(t.sent).toEqual([]);
    expect(t.vars['faq.answer']).toBe('We ship worldwide.');
  });

  it('leaves by "No match" when nothing matched', async () => {
    const t = setup({ assistant: UUID });
    await expect(t.node.execute(t.ctx)).resolves.toMatchObject({ port: 2 });
    expect(t.vars['faq.matched']).toBe('no');
    expect(t.sent).toEqual([]);
  });

  it('leaves by "No match" when only text the search has not indexed yet came back', async () => {
    const t = setup(
      { assistant: UUID },
      { retrieval: { grounded: true, hits: 0, passages: [{ label: 'New', text: 'Unindexed.' }] } },
    );
    await expect(t.node.execute(t.ctx)).resolves.toMatchObject({ port: 2 });
    expect(t.sent).toEqual([]);
  });

  it('leaves by "No match" when the search could not run (the whole base is not an answer)', async () => {
    const t = setup(
      { assistant: UUID },
      { retrieval: { grounded: false, passages: [{ label: 'Doc', text: 'Everything we know.' }] } },
    );
    await expect(t.node.execute(t.ctx)).resolves.toMatchObject({ port: 2 });
    expect(t.vars['faq.answer']).toBe('');
    expect(t.sent).toEqual([]);
  });

  it('halts when the channel says the send must halt the flow, and carries on when it only failed', async () => {
    const found = { grounded: true, hits: 1, passages: [{ label: 'Doc', text: 'Yes.' }] };
    const halted = setup(
      { assistant: UUID },
      { retrieval: found, send: { ok: false, halt: true, error: 'window closed' } },
    );
    await expect(halted.node.execute(halted.ctx)).resolves.toEqual({
      kind: 'halt',
      reason: 'window closed',
    });
    const failed = setup(
      { assistant: UUID },
      { retrieval: found, send: { ok: false, halt: false, error: 'rate limited' } },
    );
    await expect(failed.node.execute(failed.ctx)).resolves.toMatchObject({ port: 1 });
    expect(failed.notes.some((n) => n.includes('rate limited'))).toBe(true);
  });
});
