import { describe, expect, it } from 'vitest';
import { filterPalette } from './palette';

const ids = (mode: Parameters<typeof filterPalette>[0], q = '') =>
  filterPalette(mode, q).flatMap(([, items]) => items.map((d) => d.id));

describe('palette (WD-FLB-016)', () => {
  it('a WhatsApp flow lists 35 nodes in WaDesk group order, Template / List / Sequence / MySQL / Google included', () => {
    const groups = filterPalette('chat', '');
    expect(groups.reduce((a, [, items]) => a + items.length, 0)).toBe(35);
    expect(groups.map(([g]) => g)).toEqual([
      'Start',
      'Send',
      'Engage',
      'Listen',
      'Logic',
      'AI',
      'Contact',
      'Commerce',
      'Integrations',
      'CRM',
    ]);
    const all = ids('chat');
    for (const id of [
      'template',
      'list',
      'sequence',
      'mysql',
      'google_sheets',
      'google_docs',
      'google_form',
    ])
      expect(all).toContain(id);
    expect(all).not.toContain('cf_say');
  });

  it('a call flow shows the eight call nodes plus Trigger, Condition, Wait, Webhook, Run code and End only', () => {
    expect(ids('call').sort()).toEqual(
      [
        'trigger',
        'condition',
        'delay',
        'webhook',
        'code',
        'end',
        'cf_say',
        'cf_listen',
        'cf_ai',
        'cf_assistant',
        'cf_menu',
        'cf_search',
        'cf_transfer',
        'cf_hangup',
      ].sort(),
    );
  });

  it('a Facebook flow lists the shared nodes and the five fb_* nodes, never the template or list nodes', () => {
    const all = ids('facebook');
    expect(all).toEqual(
      expect.arrayContaining([
        'message',
        'media',
        'buttons',
        'ask',
        'condition',
        'delay',
        'webhook',
        'ai',
        'end',
        'fb_gallery',
        'fb_products',
        'fb_lead',
        'fb_reply_comment',
        'fb_to_whatsapp',
      ]),
    );
    expect(all).not.toContain('template');
    expect(all).not.toContain('list');
  });

  it('legacy (hidden) Instagram nodes are never offered', () => {
    const all = ids('instagram');
    for (const id of ['ig_send_dm', 'ig_quick', 'ig_ai', 'ig_ask']) expect(all).not.toContain(id);
    expect(all).toContain('ig_buttons');
  });

  it('search matches label, description and group, case-insensitively', () => {
    expect(ids('chat', 'SHEET')).toEqual(['google_sheets']);
    expect(ids('chat', 'tap-to-pick')).toEqual(['buttons']);
    expect(ids('chat', 'integrations').sort()).toEqual([
      'google_docs',
      'google_form',
      'google_sheets',
    ]);
    expect(ids('chat', 'zzzz')).toEqual([]);
  });
});
