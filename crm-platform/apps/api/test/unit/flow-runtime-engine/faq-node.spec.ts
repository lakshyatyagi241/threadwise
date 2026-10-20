import { describe, expect, it } from 'vitest';
import { FaqNodes } from '../../../src/modules/flow-runtime-engine/runtime/nodes/ai/faq-node';
import type { NodeContext } from '../../../src/modules/flow-runtime-engine/runtime/types';

function ctxOf(data: Record<string, unknown>) {
  const vars: Record<string, unknown> = { 'faq.matched': 'yes', 'faq.answer': 'stale' };
  const notes: string[] = [];
  const ctx = {
    run: { orgId: 7, flowId: 41, conversationId: 3, channelId: 5, vars },
    node: { id: 'f', type: 'Faq', props: { data } },
    stepKey: 'flow:1:0:f',
    render: (t: unknown) => String(t ?? ''),
    note: (t: string) => notes.push(t),
  } as unknown as NodeContext;
  return { ctx, vars, notes };
}

describe('the retired "Answer from FAQ" step', () => {
  const node = new FaqNodes();

  it('handles the Faq node type', () => {
    expect(node.types).toEqual(['Faq']);
  });

  it('leaves by "No match" (port 2) so a flow saved with the old step keeps running', async () => {
    const { ctx, notes } = ctxOf({});
    await expect(node.execute(ctx)).resolves.toEqual({ kind: 'advance', port: 2, branch: true });
    expect(notes[0]).toMatch(/retired/);
  });

  it('clears the variables it used to fill, under the name the step saved them as', async () => {
    const { ctx, vars } = ctxOf({ variable: 'answer1' });
    await node.execute(ctx);
    expect(vars['answer1.matched']).toBe('no');
    expect(vars['answer1.answer']).toBe('');
    expect(vars['answer1.id']).toBe('');
    // A different name does not touch the default one.
    expect(vars['faq.matched']).toBe('yes');
  });
});
