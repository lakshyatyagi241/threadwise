import { describe, expect, it } from 'vitest';
import { compileGraph } from '../../../src/modules/flow-runtime-engine/graph/compile-graph';
import {
  profileOf,
  renderForChannel,
  threadTextOf,
} from '../../../src/modules/flow-runtime-engine/runtime/channel-render';
import {
  EMPTY_PARAMETER,
  fillText,
  quickReplies,
  templateComponents,
  templateText,
  templateValues,
} from '../../../src/modules/flow-runtime-engine/runtime/nodes/commerce/template-rules';
import { TemplateNode } from '../../../src/modules/flow-runtime-engine/runtime/nodes/commerce/template-node';
import { FlowRefResolver } from '../../../src/modules/flow-runtime-engine/runtime/nodes/flow-refs';
import type { FlowTemplate } from '../../../src/modules/message-templates';
import type {
  NodeContext,
  OutboundMessage,
} from '../../../src/modules/flow-runtime-engine/runtime/types';

const tpl = (over: Partial<FlowTemplate> = {}): FlowTemplate => ({
  id: 5,
  uuid: 'u',
  name: 'order_update',
  language: 'en_US',
  status: 'approved',
  header: 'Hi {{1}}',
  body: 'Your order {{1}} ships on {{2}}.',
  footer: 'Thanks',
  buttons: [
    { type: 'QUICK_REPLY', text: 'Track' },
    { type: 'URL', text: 'Site', url: 'https://x.y' },
    { type: 'QUICK_REPLY', text: 'Cancel' },
  ],
  variableMap: {
    header: [{ num: 1, key: 'name' }],
    body: [
      { num: 1, key: 'order_id' },
      { num: 2, key: 'ship_date' },
    ],
  },
  parameterFormat: 'POSITIONAL',
  ...over,
});

const render = (vars: Record<string, string>) => (t: string) =>
  t.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_m, k: string) => vars[k] ?? '');

describe('template rules (TW-FLR-026)', () => {
  it('fills slots from the run variables and sends an empty one as a dash', () => {
    const v = templateValues(tpl(), 'body', render({ order_id: 'A12' }));
    expect(v).toEqual({ '1': 'A12', '2': EMPTY_PARAMETER });
  });

  it('keys named templates by parameter name', () => {
    const t = tpl({
      parameterFormat: 'NAMED',
      variableMap: { body: [{ num: 1, key: 'first_name' }] },
      body: 'Hi {{first_name}}',
    });
    expect(templateValues(t, 'body', render({ first_name: 'Asha' }))).toEqual({
      first_name: 'Asha',
    });
    expect(fillText('Hi {{first_name}} {{other}}', { first_name: 'Asha' })).toBe(
      'Hi Asha {{other}}',
    );
  });

  it('stacks header, body and footer as the customer reads them', () => {
    const r = render({ name: 'Asha', order_id: 'A12', ship_date: 'Fri' });
    const text = templateText(
      tpl(),
      templateValues(tpl(), 'header', r),
      templateValues(tpl(), 'body', r),
    );
    expect(text).toBe('Hi Asha\n\nYour order A12 ships on Fri.\n\n_Thanks_');
  });

  it('builds components only when the header has placeholders', () => {
    const r = render({ name: 'Asha', order_id: 'A12', ship_date: 'Fri' });
    const header = templateValues(tpl(), 'header', r);
    const body = templateValues(tpl(), 'body', r);
    expect(templateComponents(tpl(), header, body)).toEqual([
      { type: 'header', parameters: [{ type: 'text', text: 'Asha' }] },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'A12' },
          { type: 'text', text: 'Fri' },
        ],
      },
    ]);
    expect(templateComponents(tpl({ header: null, variableMap: { body: [] } }), {}, {})).toBeNull();
  });

  it('only quick replies can branch; url, call and copy buttons never reply', () => {
    expect(quickReplies(tpl(), 'n1').map((b) => b.text)).toEqual(['Track', 'Cancel']);
  });
});

describe('a template on each channel', () => {
  const msg: OutboundMessage = {
    kind: 'template',
    name: 'order_update',
    language: 'en_US',
    variables: { '1': 'A12' },
    text: 'Your order A12 ships.',
    buttons: [
      { id: 'a', text: 'Track' },
      { id: 'b', text: 'Cancel' },
    ],
  };

  it('goes out as a template envelope where the channel has them', () => {
    const r = renderForChannel(msg, profileOf('whatsapp_cloud'));
    expect(r).toMatchObject({
      kind: 'template',
      template: { name: 'order_update', variables: { '1': 'A12' } },
    });
    expect(threadTextOf(r)).toBe('Your order A12 ships.');
  });

  it('degrades to numbered text elsewhere', () => {
    const r = renderForChannel(msg, profileOf('telegram'));
    expect(r).toEqual({
      kind: 'text',
      body: 'Your order A12 ships.\n\n1. Track\n2. Cancel\n\nReply with the number (1-2):',
    });
  });

  it('a form is a flow message on WhatsApp Cloud and plain text elsewhere', () => {
    const form: OutboundMessage = {
      kind: 'form',
      body: 'Fill in',
      flowId: 'f1',
      flowToken: 'form-1-r',
      cta: 'Open form',
    };
    expect(renderForChannel(form, profileOf('whatsapp_cloud'))).toMatchObject({
      kind: 'interactive',
      interactive: { type: 'flow', flowId: 'f1', cta: 'Open form' },
    });
    expect(renderForChannel(form, profileOf('telegram'))).toEqual({
      kind: 'text',
      body: 'Fill in',
    });
  });
});

describe('compileGraph for the template node', () => {
  const g = (edges: unknown[]) =>
    compileGraph({
      flowNodes: [
        { id: 't', type: 'template', data: { tpl: 'order_update', tplId: 5 } },
        { id: 'x', type: 'end' },
      ],
      flowEdges: edges,
    });

  it('shapes the node and marks quick replies as wired only when a pN edge leaves it', () => {
    const wired = g([{ source: 't', sourceHandle: 'p0', target: 'x' }]);
    expect(wired.nodes[0]).toMatchObject({
      type: 'Template',
      props: { templateName: 'order_update', templateId: 5, buttonsWired: true },
    });
    expect(
      g([{ source: 't', sourceHandle: 'out', target: 'x' }]).nodes[0]!.props.buttonsWired,
    ).toBe(false);
  });
});

describe('the Template node', () => {
  const ctxOf = (props: Record<string, unknown>, sent: OutboundMessage[], ok = true): NodeContext =>
    ({
      run: {
        orgId: 1,
        menus: { latest: null, byNode: {} },
        lastOut: null,
      },
      stepKey: 'k',
      node: { id: 'n', type: 'Template', props },
      send: async (m: OutboundMessage) => {
        sent.push(m);
        return ok ? { ok: true } : { ok: false, error: 'nope', code: 'X', halt: false };
      },
      render: render({ name: 'Asha', order_id: 'A12', ship_date: 'Fri' }),
      note: () => undefined,
      now: () => new Date(),
    }) as unknown as NodeContext;
  const nodeWith = (found: FlowTemplate | null) =>
    new TemplateNode({ findForFlow: async () => found } as never, new FlowRefResolver({} as never));

  it('sends an approved template and moves on', async () => {
    const sent: OutboundMessage[] = [];
    const r = await nodeWith(tpl()).execute(ctxOf({ templateName: 'order_update' }, sent));
    expect(r).toEqual({ kind: 'advance', port: 1 });
    expect(sent[0]).toMatchObject({
      kind: 'template',
      name: 'order_update',
      variables: { '1': 'A12', '2': 'Fri' },
    });
  });

  it('skips a template that is missing or not approved, and sends nothing', async () => {
    const sent: OutboundMessage[] = [];
    expect(await nodeWith(null).execute(ctxOf({ templateName: 'gone' }, sent))).toEqual({
      kind: 'advance',
      port: 1,
    });
    expect(
      await nodeWith(tpl({ status: 'pending' })).execute(
        ctxOf({ templateName: 'order_update' }, sent),
      ),
    ).toEqual({ kind: 'advance', port: 1 });
    expect(sent).toEqual([]);
  });

  it('waits for the tap when the quick replies are wired, and keeps the menu open', async () => {
    const sent: OutboundMessage[] = [];
    const r = await nodeWith(tpl()).execute(
      ctxOf({ templateName: 'order_update', buttonsWired: true }, sent),
    );
    expect(r).toMatchObject({
      kind: 'wait',
      wait: {
        kind: 'Question',
        persistent: true,
        answerItems: [{ text: 'Track' }, { text: 'Cancel' }],
      },
    });
  });

  it('a refused send is skipped, or ends the run when a tap was awaited', async () => {
    const sent: OutboundMessage[] = [];
    expect(
      await nodeWith(tpl()).execute(ctxOf({ templateName: 'order_update' }, sent, false)),
    ).toEqual({
      kind: 'advance',
      port: 1,
    });
    expect(
      await nodeWith(tpl()).execute(
        ctxOf({ templateName: 'order_update', buttonsWired: true }, sent, false),
      ),
    ).toMatchObject({ kind: 'fail', code: 'X' });
  });
});
