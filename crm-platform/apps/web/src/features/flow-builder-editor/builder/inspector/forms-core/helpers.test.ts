import { describe, expect, it } from 'vitest';
import {
  acceptFor,
  addConditionRow,
  agentLabel,
  changeCtaType,
  ctaActions,
  groupBySection,
  listItems,
  moveItem,
  removeConditionRow,
  resolveTriggerChannel,
  senderHint,
  senderLabel,
  senderNoneCopy,
  senderOptions,
  senderPickKey,
  subflowLabel,
  toggleId,
  withCurrent,
  type HelperT,
} from './helpers';

/** A translator that echoes the key and its values, so the tests assert which message is picked, not its wording. */
const t: HelperT = (key, values) => (values ? `${key}:${JSON.stringify(values)}` : key);

describe('moveItem', () => {
  it('swaps neighbours and ignores out-of-range moves', () => {
    expect(moveItem([1, 2, 3], 1, -1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
  });
});

describe('withCurrent', () => {
  it('keeps a stale saved value visible', () => {
    const opts = [{ v: '', l: 'pick' }];
    expect(withCurrent(opts, 'x', (v) => `${v} (gone)`)).toEqual([
      ...opts,
      { v: 'x', l: 'x (gone)' },
    ]);
    expect(withCurrent(opts, '', (v) => v)).toEqual(opts);
  });
});

describe('trigger sender', () => {
  it('resolves the channel from saved data, then the flow mode', () => {
    expect(resolveTriggerChannel('instagram', ['chat', 'instagram'], 'chat')).toBe('instagram');
    expect(resolveTriggerChannel('instagram', ['chat'], 'chat')).toBe('chat');
    expect(resolveTriggerChannel(undefined, ['chat', 'telegram'], 'telegram')).toBe('telegram');
    expect(resolveTriggerChannel(undefined, ['chat'], 'call')).toBe('chat');
  });

  it('labels the sender field by channel and trigger kind', () => {
    expect(senderLabel(t, 'instagram', 'keyword')).toBe('senderLabel.listen.instagram');
    expect(senderLabel(t, 'chat', 'tag_added')).toBe('senderLabel.send.chat');
    expect(senderLabel(t, 'email', 'keyword')).toBe('senderLabel.listen.email');
  });

  it('picks the "pick a sender" note by channel', () => {
    expect(senderPickKey('instagram')).toBe('senderPickNotice.instagram');
    expect(senderPickKey('telegram')).toBe('senderPickNotice.telegram');
    expect(senderPickKey('line')).toBe('senderPickNotice.number');
  });

  it('shows the "none connected" placeholder only when empty', () => {
    expect(senderOptions(t, 'chat', [])[0]?.l).toBe('senderEmpty.chat');
    const opts = senderOptions(t, 'chat', [
      { key: 'waba:1', label: '+1 555', engineLabel: 'WABA' },
    ]);
    expect(opts[0]?.l).toBe('senderPick.chat');
    expect(opts[1]).toEqual({
      v: 'waba:1',
      l: 'senderEngine:{"label":"+1 555","engine":"WABA"}',
    });
  });
});

describe('sender copy while the platform has unofficial WhatsApp off', () => {
  it('names only the official engines and links to the official WhatsApp connect flow', () => {
    const off = senderHint('chat');
    expect(off.key).toBe('senderHint.chatOfficial');
    expect(off.href).toBe('/channels/whatsapp');
    expect(senderNoneCopy('chat').href).toBe('/channels/whatsapp');
  });

  it('keeps the three-engine wording and the device page only while the switch is on', () => {
    expect(senderHint('chat', true).key).toBe('senderHint.chatUnofficial');
    expect(senderHint('chat', true).href).toBe('/devices');
    expect(senderNoneCopy('chat', true).href).toBe('/devices');
  });

  it('never sends Facebook or mailbox hints to the personal-number page', () => {
    for (const on of [false, true]) {
      expect(senderHint('facebook', on).href).toBe('/facebook');
      expect(senderNoneCopy('facebook', on).href).toBe('/facebook');
      expect(senderHint('email', on).href).toBe('/settings/channels');
      expect(senderNoneCopy('email', on).href).toBe('/settings/channels');
    }
  });

  it('does not touch the copy of the other channels', () => {
    expect(senderHint('instagram').href).toBe('/instagram');
    expect(senderHint('line').href).toBe(senderHint('line', true).href);
  });
});

describe('toggleId', () => {
  it('adds and removes', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('list items', () => {
  it('upgrades bare strings and groups by trimmed section in first-seen order', () => {
    const items = listItems([
      'One',
      { title: 'Two', section: ' S ' },
      { title: 'Three', section: 'S' },
      { title: 'Four' },
    ]);
    expect(items[0]).toEqual({ title: 'One', description: '', section: '' });
    expect(groupBySection(items).map((g) => [g.title, g.rows.length])).toEqual([
      ['', 2],
      ['S', 2],
    ]);
  });
});

describe('condition rows', () => {
  it('adds a joiner for every row after the first', () => {
    const first = addConditionRow([], []);
    expect(first.operators).toEqual([]);
    const second = addConditionRow(first.conditions, first.operators);
    expect(second.conditions).toHaveLength(2);
    expect(second.operators).toEqual(['AND']);
  });

  it('drops the joiner before the removed row', () => {
    const rows = [{}, {}, {}];
    expect(removeConditionRow(rows, ['AND', 'OR'], 1).operators).toEqual(['OR']);
    expect(removeConditionRow(rows, ['AND', 'OR'], 2).operators).toEqual(['AND']);
    expect(removeConditionRow(rows, ['AND', 'OR'], 0).operators).toEqual(['OR']);
  });
});

describe('cta', () => {
  it('migrates the legacy single-kind shape', () => {
    expect(ctaActions({ kind: 'phone', label: 'Ring', phone: '+1' })).toEqual([
      { type: 'phone', label: 'Ring', value: '+1' },
    ]);
    expect(ctaActions({ url: 'https://x' })).toEqual([
      { type: 'url', label: 'CTA', value: 'https://x' },
    ]);
    expect(ctaActions({ actions: [{ type: 'copy' }] })).toEqual([{ type: 'copy' }]);
  });

  it('keeps a custom label on type change and resets the value', () => {
    expect(changeCtaType(t, { type: 'url', label: 'ctaLabel.url', value: 'x' }, 'phone')).toEqual({
      type: 'phone',
      label: 'ctaLabel.phone',
      value: '',
    });
    expect(changeCtaType(t, { type: 'url', label: 'Shop now', value: 'x' }, 'copy').label).toBe(
      'Shop now',
    );
  });
});

describe('acceptFor', () => {
  it('maps a media kind to a file filter', () => {
    expect(acceptFor('video')).toBe('video/*');
    expect(acceptFor('document')).toBe('.pdf,.doc,.docx,.xls,.xlsx');
    expect(acceptFor('image')).toBe('image/*');
  });
});

describe('subflowLabel', () => {
  it("marks a flow live or draft like Reference's Sub-flow picker", () => {
    expect(subflowLabel(t, 'Welcome', true)).toBe('subflowLive:{"name":"Welcome"}');
    expect(subflowLabel(t, 'Welcome', false)).toBe('subflowDraft:{"name":"Welcome"}');
    expect(subflowLabel(t, '', false)).toBe('subflowDraft:{"name":"flowFallback"}');
  });
});

describe('agentLabel', () => {
  it('appends provider/model only when both are known', () => {
    expect(agentLabel(t, { name: 'Sales bot', provider: 'openai', model: 'gpt-4o-mini' })).toBe(
      'agentWithModel:{"name":"Sales bot","model":"openai/gpt-4o-mini"}',
    );
    expect(agentLabel(t, { name: 'Sales bot', provider: null, model: 'gpt-4o-mini' })).toBe(
      'Sales bot',
    );
    expect(agentLabel(t, { name: '', provider: 'openai', model: 'x' })).toBe(
      'agentWithModel:{"name":"agentFallback","model":"openai/x"}',
    );
  });
});
