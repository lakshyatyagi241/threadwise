import { describe, expect, it } from 'vitest';
import {
  FLOW_TYPES,
  FLB_NODE_TYPE_LIST,
  FLB_NODE_TYPES,
  flbDefaultNodeData,
  flbHandleToPort,
  flbIsMultiPort,
  flbListOption,
  flbNodeInMode,
  flbPaletteFor,
  flbPortsFor,
  type FlowType,
} from '@crm/contracts';

const ids = (mode: FlowType) => flbPaletteFor(mode).map((d) => d.id);

describe('node catalogue: palette and per-channel availability (TW-FLB-016)', () => {
  it('a WhatsApp flow lists the 35 nodes Reference lists plus the Ask for file / location additions and the five CRM additions and the API Library node and the FAQ node, including Template, List, Sequence, MySQL and the Google nodes', () => {
    const chat = ids('chat');
    expect(chat).toHaveLength(46);
    for (const t of [
      'template',
      'list',
      'sequence',
      'mysql',
      'google_sheets',
      'google_docs',
      'google_form',
      'deal',
      'api_library',
      'faq',
    ]) {
      expect(chat).toContain(t);
    }
    expect(
      chat.some((t) => t.startsWith('cf_') || t.startsWith('ig_') || t.startsWith('fb_')),
    ).toBe(false);
  });

  it('a Facebook flow lists exactly the shared nodes plus the five fb_ nodes', () => {
    expect(ids('facebook').sort()).toEqual(
      [
        'trigger',
        'message',
        'media',
        'buttons',
        'ask',
        'condition',
        'delay',
        'webhook',
        'ai',
        'faq',
        'end',
        'update_contact',
        'list_member',
        'in_list',
        'in_segment',
        'fb_gallery',
        'fb_products',
        'fb_lead',
        'fb_reply_comment',
        'fb_to_whatsapp',
      ].sort(),
    );
  });

  it('a call flow lists the eight voice nodes plus Trigger, Condition, Wait, Webhook, Run code and End only', () => {
    expect(ids('call').sort()).toEqual(
      [
        'cf_say',
        'cf_listen',
        'cf_ai',
        'cf_assistant',
        'cf_menu',
        'cf_search',
        'cf_transfer',
        'cf_hangup',
        'trigger',
        'condition',
        'delay',
        'webhook',
        'code',
        'end',
      ].sort(),
    );
  });

  it('Run code is not offered on Instagram (the Instagram runner is not the Node VM)', () => {
    expect(ids('instagram')).not.toContain('code');
    expect(ids('chat')).toContain('code');
  });

  it('legacy Instagram types stay out of the palette but are still known (old flows render)', () => {
    for (const t of ['ig_send_dm', 'ig_quick', 'ig_ai', 'ig_ask']) {
      expect(ids('instagram')).not.toContain(t);
      expect(FLB_NODE_TYPES[t]?.hidden).toBe(true);
    }
    expect(ids('instagram')).toEqual(
      expect.arrayContaining([
        'ig_buttons',
        'ig_reply_comment',
        'ig_products',
        'ig_lead',
        'ig_to_whatsapp',
      ]),
    );
  });

  it('the Trigger and End run on every channel and the Trigger is a singleton', () => {
    for (const mode of FLOW_TYPES) {
      expect(flbNodeInMode(FLB_NODE_TYPES.trigger!, mode)).toBe(true);
      expect(flbNodeInMode(FLB_NODE_TYPES.end!, mode)).toBe(true);
    }
    expect(FLB_NODE_TYPES.trigger?.singleton).toBe(true);
  });

  it('a Website chat flow offers only what the widget renders: text, quick replies, a question and the AI reply, plus the logic nodes', () => {
    const web = ids('web');
    for (const t of [
      'trigger',
      'message',
      'buttons',
      'ask',
      'ai',
      'condition',
      'delay',
      'webhook',
      'end',
    ])
      expect(web).toContain(t);
    // Rich WhatsApp components stay off the web channel until the widget can show them.
    for (const t of ['media', 'list', 'template', 'sequence', 'cta', 'ask_file', 'ask_location'])
      expect(web).not.toContain(t);
  });

  it('searching "sheet" matches only the Google Sheets nodes by label, description and group (case-insensitive)', () => {
    const q = 'sheet';
    const hit = flbPaletteFor('chat').filter(
      (d) =>
        d.label.toLowerCase().includes(q) ||
        d.desc.toLowerCase().includes(q) ||
        d.group.toLowerCase().includes(q),
    );
    expect(hit.map((d) => d.id)).toEqual(['google_sheets', 'sheet_check', 'sheet_contact']);
  });

  it('every type has a unique id and at least one mode', () => {
    expect(new Set(FLB_NODE_TYPE_LIST.map((d) => d.id)).size).toBe(FLB_NODE_TYPE_LIST.length);
    for (const d of FLB_NODE_TYPE_LIST) expect(d.modes.length).toBeGreaterThan(0);
  });
});

describe('node catalogue: ports and handle naming (TW-FLB-017)', () => {
  const p = (type: string, data: Record<string, unknown> = {}) =>
    flbPortsFor({ type, data }).map((x) => x.id);

  it('a Buttons node with options A, B, C exposes ports p0, p1, p2', () => {
    expect(p('buttons', { options: ['A', 'B', 'C'] })).toEqual(['p0', 'p1', 'p2']);
  });

  it('an Ask node has `out` with no expected answers, else p0..pN plus else', () => {
    expect(p('ask', { options: [] })).toEqual(['out']);
    expect(p('ask', { options: ['yes', 'no'] })).toEqual(['p0', 'p1', 'else']);
  });

  it('a Condition node uses yes and no, normalised to ports 1 and 2', () => {
    expect(p('condition')).toEqual(['yes', 'no']);
    expect(flbHandleToPort('condition', 'yes')).toBe(1);
    expect(flbHandleToPort('condition', 'no')).toBe(2);
  });

  it('renders EVERY declared port, including the ones Reference drew as a single dot (defect not ported)', () => {
    expect(p('book_appointment')).toEqual(['booked', 'no_slots']);
    expect(p('shopify')).toEqual(['purchased', 'abandoned']);
    expect(p('whatsapp_shop')).toEqual(['purchased', 'abandoned']);
    expect(p('woocommerce')).toEqual(['purchased', 'abandoned']);
    expect(p('deal')).toEqual(['created', 'error']);
    expect(p('cf_menu', { options: [{ match: 'a' }, { match: 'b' }] })).toEqual([
      'p0',
      'p1',
      'nomatch',
    ]);
    for (const t of ['book_appointment', 'shopify', 'deal', 'cf_menu']) {
      expect(flbIsMultiPort({ type: t, data: {} })).toBe(true);
    }
  });

  it('terminal nodes have no output', () => {
    expect(p('end')).toEqual([]);
    expect(p('cf_hangup')).toEqual([]);
  });

  it('a template with quick-reply buttons gets one port per button; without, a single out', () => {
    const ctx = { templateButtons: () => [{ label: 'Yes' }, { label: 'No' }] };
    expect(flbPortsFor({ type: 'template', data: { tpl: 't' } }, ctx).map((x) => x.id)).toEqual([
      'p0',
      'p1',
    ]);
    expect(flbPortsFor({ type: 'template', data: { tpl: 't' } }).map((x) => x.id)).toEqual(['out']);
  });

  it('labels follow the node data: the trigger kind, sheets mode, deal action, telegram wait', () => {
    expect(flbPortsFor({ type: 'trigger', data: { kind: 'tag_added' } })[0]!.label).toBe(
      'on tag added',
    );
    expect(flbPortsFor({ type: 'google_sheets', data: { mode: 'read' } })[0]!.label).toBe(
      'row loaded',
    );
    expect(flbPortsFor({ type: 'deal', data: { action: 'move' } })[0]!.label).toBe('moved');
    expect(flbPortsFor({ type: 'tg_payment', data: { wait: true } })[0]!.label).toBe('after paid');
  });

  it('handle -> runtime port numbers: p<i> is i+1, else is 0, named pairs map, anything else is 1', () => {
    expect(flbHandleToPort('buttons', 'p0')).toBe(1);
    expect(flbHandleToPort('buttons', 'p2')).toBe(3);
    expect(flbHandleToPort('ask', 'else')).toBe(0);
    expect(flbHandleToPort('book_appointment', 'no_slots')).toBe(2);
    expect(flbHandleToPort('shopify', 'abandoned')).toBe(2);
    expect(flbHandleToPort('google_form', 'timeout')).toBe(2);
    expect(flbHandleToPort('deal', 'error')).toBe(2);
    expect(flbHandleToPort('message', 'out')).toBe(1);
  });

  it('list items given as bare strings (older flows) read as {title}', () => {
    expect(flbListOption('Hello', 0)).toEqual({ title: 'Hello', description: '', section: '' });
    expect(flbListOption({}, 2).title).toBe('Item 3');
  });
});

describe('node catalogue: defaults', () => {
  it('a fresh node carries Reference defaults', () => {
    expect(flbDefaultNodeData('message')).toEqual({ text: 'Type your message…' });
    expect(flbDefaultNodeData('delay')).toEqual({ amount: 5, unit: 'min' });
    expect(flbDefaultNodeData('buttons')).toMatchObject({
      prompt: 'Pick one',
      options: ['Option A', 'Option B'],
      var: 'choice',
    });
    expect(flbDefaultNodeData('trigger')).toMatchObject({
      kind: 'keyword',
      keywordMode: 'keywords',
      keywords: 'price, pricing, cost',
    });
    expect(flbDefaultNodeData('end')).toEqual({});
    expect(flbDefaultNodeData('unknown_type')).toEqual({});
  });

  it('every catalogue type has a default (or is intentionally empty) and flbPortsFor never throws on it', () => {
    for (const d of FLB_NODE_TYPE_LIST) {
      const data = flbDefaultNodeData(d.id);
      expect(() => flbPortsFor({ type: d.id, data })).not.toThrow();
    }
  });
});
