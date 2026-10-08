import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const registered: Array<Record<string, unknown>> = [];
vi.mock('@copilotkit/react-core/v2', () => ({
  ToolCallStatus: { InProgress: 'inProgress', Executing: 'executing', Complete: 'complete' },
  useFrontendTool: (tool: Record<string, unknown>) => {
    registered.push(tool);
  },
}));

import { BlockToolCard, useBlockTools, type BlockContext } from './block-tools';
import { html } from './test-utils';
import type { Block } from '../lib/blocks';

function Harness({ onBlock }: { onBlock: (b: Block, c: BlockContext) => void }) {
  useBlockTools(onBlock);
  return null;
}
function setup() {
  registered.length = 0;
  const seen: Array<{ block: Block; ctx: BlockContext }> = [];
  renderToStaticMarkup(<Harness onBlock={(block, ctx) => seen.push({ block, ctx })} />);
  return { seen };
}
const tool = (name: string) =>
  registered.find((t) => t.name === name) as {
    name: string;
    description: string;
    followUp: boolean;
    parameters: { safeParse: (v: unknown) => { success: boolean } };
    handler: (args: unknown, ctx: unknown) => Promise<string>;
  };
const ctx = (id: string, messages: unknown[] = [{ role: 'user', content: 'Make a report' }]) => ({
  toolCall: { id },
  agent: { messages },
});

describe('block tools', () => {
  it('registers the four report blocks as tools the assistant can call', () => {
    setup();
    expect(registered.map((t) => t.name)).toEqual([
      'show_summary',
      'show_kpis',
      'show_chart',
      'show_table',
    ]);
    for (const t of registered) {
      expect(String(t.description).length).toBeGreaterThan(40);
      expect(t.followUp).toBe(false);
    }
    expect(tool('show_chart').description).toContain('sources');
  });

  it('hands a valid block to the page with its turn and the question, and tells the model it worked', async () => {
    const { seen } = setup();
    const out = await tool('show_summary').handler({ title: 'T', markdown: 'x' }, ctx('call-1'));
    expect(JSON.parse(out)).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.block).toMatchObject({ id: 'call-1', tool: 'show_summary' });
    expect(seen[0]!.ctx).toEqual({ turn: '1', prompt: 'Make a report' });
  });

  it('refuses an invalid block: nothing is added to the report and the model is told what to fix', async () => {
    const { seen } = setup();
    const out = JSON.parse(
      await tool('show_chart').handler({ type: 'bar', series: [] }, ctx('call-2')),
    );
    expect(out.ok).toBe(false);
    expect(out.issues.length).toBeGreaterThan(0);
    expect(seen).toHaveLength(0);
  });

  it('groups the blocks of one question into one turn', async () => {
    const { seen } = setup();
    const c = ctx('a', [{ role: 'user', content: 'Q' }]);
    await tool('show_summary').handler({ markdown: 'x' }, c);
    await tool('show_table').handler(
      { columns: ['A'], rows: [['1']] },
      { ...c, toolCall: { id: 'b' } },
    );
    expect(seen.map((s) => s.ctx.turn)).toEqual(['1', '1']);
  });
});

describe('BlockToolCard', () => {
  const args = {
    type: 'pie',
    series: [{ name: 'S', points: [{ label: 'A', value: 2 }] }],
    source: 'x.pdf',
  };
  it('shows a placeholder while the model is still writing the block', () => {
    expect(
      html(
        <BlockToolCard name="show_chart" toolCallId="1" args={{}} status={'inProgress' as never} />,
      ),
    ).toContain('Drawing your report…');
  });
  it('draws the block in the message once it is whole', () => {
    const out = html(
      <BlockToolCard name="show_chart" toolCallId="1" args={args} status={'complete' as never} />,
    );
    expect(out).toContain('Source: x.pdf');
    expect(out).toContain('var(--rc-1)');
  });
  it('says the block could not be drawn instead of drawing a broken one', () => {
    const out = html(
      <BlockToolCard
        name="show_chart"
        toolCallId="1"
        args={{ type: 'pie' }}
        status={'complete' as never}
      />,
    );
    expect(out).toContain('The assistant sent a block we could not draw.');
  });
});
