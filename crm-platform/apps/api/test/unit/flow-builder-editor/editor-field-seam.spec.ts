import { describe, expect, it } from 'vitest';
import { flbDefaultNodeData, flbNormalizeGraph } from '@crm/contracts';
import { compileGraph } from '../../../src/modules/flow-runtime-engine/graph/compile-graph';

/**
 * The FIELD seam between the editor and the runtime (WD-FLB-030..050, 061 + WD-FLR-013): the data keys the inspector forms save
 * (WaDesk's builder vocabulary) against the keys the runtime reads after `compileGraph`. WaDesk's FlowNormalizer renamed them on
 * the way (save -> variable, lat/lng -> latitude/longitude, multi -> allowMultiple, ...); `compileGraph` does that for the core
 * nodes it shapes, and for the rest it hands the executors the raw `data`, which several of them read under the normalised name.
 *
 * Cases marked `it.fails` are KNOWN MISMATCHES owned by the runtime domain (FLR): the editor saves the right WaDesk field, the
 * runtime reads another. They pass today because they fail; when FLR maps the field, they start failing, and the marker must go.
 */

function compiled(type: string, overrides: Record<string, unknown> = {}) {
  const node = { id: 'n1', type, x: 0, y: 0, data: { ...flbDefaultNodeData(type), ...overrides } };
  const trigger = { id: 't', type: 'trigger', x: 0, y: 0, data: flbDefaultNodeData('trigger'), isStart: true };
  const g = flbNormalizeGraph({
    flowNodes: [trigger, node],
    flowEdges: [{ id: 'e', source: 't', sourceHandle: 'out', target: 'n1' }],
  });
  const n = compileGraph(g).nodes.find((x) => x.id === 'n1')!;
  const raw = (n.props.data ?? {}) as Record<string, unknown>;
  // an executor reads either the shaped props or, for unshaped types, the raw data bag (merged flat)
  return { props: n.props, read: { ...n.props, ...raw } as Record<string, unknown> };
}

describe('editor fields the runtime reads (matching)', () => {
  it('message: the text becomes the single Text reply', () => {
    expect(compiled('message', { text: 'Hi' }).props.replies).toEqual([{ type: 'Text', data: 'Hi' }]);
  });

  it('sequence: every reply keeps its kind, url, filename and caption', () => {
    const r = compiled('sequence', {
      replies: [
        { type: 'text', text: 'a' },
        { type: 'image', url: 'https://x/y.png', filename: 'y.png', caption: 'c' },
      ],
    }).props.replies;
    expect(r).toEqual([
      { type: 'Text', data: 'a' },
      { type: 'Image', data: 'https://x/y.png', filename: 'y.png', caption: 'c' },
    ]);
  });

  it('media: kind, url, caption and filename', () => {
    expect(
      compiled('media', { kind: 'document', url: 'https://x/a.pdf', filename: 'a.pdf', caption: 'c' })
        .props,
    ).toMatchObject({ mediaKind: 'document', mediaUrl: 'https://x/a.pdf', filename: 'a.pdf', caption: 'c' });
  });

  it('buttons and list: the prompt, the options and the save variable', () => {
    expect(compiled('buttons').props).toMatchObject({
      bodyText: 'Pick one',
      variable: 'choice',
      buttons: [
        { id: 'p0', title: 'Option A' },
        { id: 'p1', title: 'Option B' },
      ],
    });
    const list = compiled('list', {
      options: [{ title: 'A'.repeat(40), description: 'd', section: 'S' }],
    }).props;
    expect(list).toMatchObject({ bodyText: 'Pick from list', buttonText: 'View options', variable: 'choice' });
    expect((list.items as Array<{ title: string }>)[0]!.title).toHaveLength(24);
  });

  it('ask: the prompt, the cleaned variable, the upload flag and the expected answers', () => {
    expect(
      compiled('ask', { var: '{{email}}', acceptMedia: true, options: ['yes', ' ', 'no'] }).props,
    ).toMatchObject({
      question: "What's your name?",
      variable: 'email',
      acceptMedia: true,
      expectedAnswers: ['yes', 'no'],
    });
  });

  it('condition: rules and the AND/OR joiners', () => {
    expect(
      compiled('condition', {
        conditions: [
          { variable: 'plan', operator: 'equals', value: 'pro' },
          { variable: 'age', operator: 'gt', value: '18' },
        ],
        operators: ['or'],
      }).props,
    ).toMatchObject({ logicOperators: ['OR'] });
  });

  it('delay: amount and unit become seconds', () => {
    expect(compiled('delay', { amount: 2, unit: 'hour' }).props.delaySeconds).toBe(7200);
    expect(compiled('delay', { amount: 3, unit: 'day' }).props.delaySeconds).toBe(259200);
  });

  it('cta: the actions array', () => {
    expect(
      (compiled('cta').props.actions as Array<{ type: string; value: string }>)[0],
    ).toMatchObject({ type: 'url', value: 'https://example.com' });
  });

  it('template: the name and the template id the picker stamps', () => {
    expect(compiled('template', { tpl: 'welcome', tplId: 'u' }).props).toMatchObject({
      templateName: 'welcome',
    });
  });

  it('copy to number, tag and assign: read from the raw data under the editor names', () => {
    expect(compiled('notify_number').read).toMatchObject({ copyNumber: '', source: 'mirror' });
    expect(compiled('tag', { action: 'remove', tagId: 'x', tag: 't' }).read).toMatchObject({
      action: 'remove',
      tagId: 'x',
      tag: 't',
    });
    expect(compiled('assign', { team: 'a', userId: 'b', message: 'm' }).read).toMatchObject({
      team: 'a',
      userId: 'b',
      message: 'm',
    });
  });
});

describe('KNOWN MISMATCHES: the editor saves the WaDesk field, the runtime reads another name', () => {
  it.fails('poll: the form saves `multi`, the runtime reads `allowMultiple`', () => {
    expect(compiled('poll', { multi: true }).props.allowMultiple).toBe(true);
  });

  it.fails('location: the form saves `lat` / `lng`, the runtime reads `latitude` / `longitude`', () => {
    const p = compiled('location', { lat: '12.97', lng: '77.59' }).props;
    expect([p.latitude, p.longitude]).toEqual([12.97, 77.59]);
  });

  it.fails('ai: the form saves `save`, the runtime reads `variable`', () => {
    expect(compiled('ai', { save: 'answer' }).read.variable).toBe('answer');
  });

  it.fails('ai: the form saves `assistant`, the runtime reads `assistant_id`', () => {
    expect(compiled('ai', { assistant: '7' }).read.assistant_id).toBe(7);
  });

  it.fails('ai: the form saves `fields` as a comma string, the runtime reads an array', () => {
    expect(compiled('ai', { extract: true, fields: 'A, B' }).read.fields).toEqual(['A', 'B']);
  });

  it.fails('chatbot: the form saves `bot`, the runtime reads `agentId` / `botId`', () => {
    expect(compiled('chatbot', { bot: 'agent-1' }).read.agentId).toBe('agent-1');
  });

  it.fails('subflow: the form saves `flow`, the runtime reads `selectedFlowId` / `flowId`', () => {
    expect(compiled('subflow', { flow: 'flow-1' }).read.flowId).toBe('flow-1');
  });

  it.fails('webhook: the form saves `save`, the runtime reads `variable`', () => {
    expect(compiled('webhook', { save: 'api' }).read.variable).toBe('api');
  });

  it.fails('code: the form saves `save`, the runtime reads `variable`', () => {
    expect(compiled('code', { save: 'out' }).read.variable).toBe('out');
  });

  it.fails('mysql: the form saves `save`, the runtime reads `variable`', () => {
    expect(compiled('mysql', { save: 'r' }).read.variable).toBe('r');
  });
});
