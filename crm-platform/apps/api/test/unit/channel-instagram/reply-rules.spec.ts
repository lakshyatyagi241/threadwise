import { describe, expect, it } from 'vitest';
import {
  engineThreadId,
  noEngineThread,
  notConnected,
  sendFailure,
  shapeReply,
} from '../../../src/modules/channel-instagram/reply-rules';
import { toFlows } from '../../../src/infra/providers/channel-instagram/http-instagram-bridge.client';

describe('the engine thread id (WD-IG-010)', () => {
  it('is what follows ig:, or the key itself when it has no prefix, or nothing for no key', () => {
    expect(engineThreadId('ig:A1_555')).toBe('A1_555');
    expect(engineThreadId('A1_555')).toBe('A1_555');
    expect(engineThreadId('ig:')).toBe('');
    expect(engineThreadId('')).toBe('');
    expect(engineThreadId(null)).toBe('');
  });
});

describe('how a reply is shaped', () => {
  it('plain text is a text reply; an empty text is left out', () => {
    expect(shapeReply({ text: 'hi' })).toEqual({
      type: 'text',
      text: 'hi',
      mediaUrl: null,
      quickReplies: [],
      buttons: [],
    });
    expect(shapeReply({ text: '', media: { type: null, url: 'https://x/p.jpg' } })).toMatchObject({
      type: 'image',
      text: null,
      mediaUrl: 'https://x/p.jpg',
    });
  });

  it('media keeps its own type, and a media message never carries buttons', () => {
    const r = shapeReply({
      text: 'look',
      media: { type: 'video', url: 'https://x/v.mp4' },
      buttons: [{ text: 'Yes' }],
    });
    expect(r).toMatchObject({ type: 'video', mediaUrl: 'https://x/v.mp4', text: 'look' });
    expect(r.quickReplies).toEqual([]);
    expect(r.buttons).toEqual([]);
  });

  it('plain buttons become quick-reply chips, at most 13', () => {
    const buttons = Array.from({ length: 20 }, (_, i) => ({ text: `B${i}` }));
    const r = shapeReply({ text: 'pick', buttons });
    expect(r.type).toBe('quick_replies');
    expect(r.quickReplies).toHaveLength(13);
    expect(r.quickReplies[0]).toEqual({ title: 'B0', payload: 'B0' });
    expect(r.buttons).toEqual([]);
  });

  it('any link button makes a button card of link and postback buttons, at most 3', () => {
    const r = shapeReply({
      text: 'pick',
      buttons: [
        { text: 'Yes' },
        { text: 'Site', url: 'https://x.test' },
        { title: 'Type URL', type: 'URL', value: 'https://y.test' },
        { text: 'Fourth' },
      ],
    });
    expect(r.type).toBe('buttons');
    expect(r.quickReplies).toEqual([]);
    expect(r.buttons).toEqual([
      { type: 'postback', title: 'Yes', payload: 'Yes' },
      { type: 'web_url', title: 'Site', url: 'https://x.test' },
      { type: 'web_url', title: 'Type URL', url: 'https://y.test' },
    ]);
  });

  it('a per-send address wins over the template’s, and a link button with no address is a plain one', () => {
    const r = shapeReply({
      text: 'x',
      buttons: [
        { text: 'Go', url: 'https://old.test', value: 'https://new.test' },
        { text: 'No address', type: 'URL' },
      ],
    });
    expect(r.buttons[0]).toEqual({ type: 'web_url', title: 'Go', url: 'https://new.test' });
    expect(r.buttons[1]).toEqual({ type: 'postback', title: 'No address', payload: 'No address' });
  });

  it('buttons with no label and junk entries are dropped; none left means plain text', () => {
    expect(
      shapeReply({ text: 'x', buttons: [{ text: '' }, { url: 'https://x.test' }, 'junk', null] }),
    ).toMatchObject({
      type: 'text',
      quickReplies: [],
      buttons: [],
    });
  });
});

describe('how a failure is worded', () => {
  it('names the engine by its saved name, never by the product', () => {
    expect(noEngineThread('IgDesk')).toBe('This Instagram thread has no IgDesk conversation id.');
    expect(notConnected('IgDesk')).toContain('connect IgDesk in Admin');
  });

  it('shows the engine’s status and reason, or that it could not be reached', () => {
    expect(sendFailure('IgDesk', 502, 'Meta says no')).toBe('IgDesk HTTP 502: Meta says no');
    expect(sendFailure('IgDesk', 500, null)).toBe('IgDesk HTTP 500: no details');
    expect(sendFailure('IgDesk', null, 'timed out')).toBe('timed out');
    expect(sendFailure('IgDesk', null, null)).toBe('Could not reach IgDesk.');
  });
});

describe('reading the engine’s flow list', () => {
  it('accepts id or flow_id and name or flow_name, and drops what has no positive whole id', () => {
    expect(
      toFlows({
        flows: [
          { id: 3, name: 'Welcome' },
          { flow_id: '4', flow_name: 'Promo' },
          { id: 0, name: 'zero' },
          { id: 1.5, name: 'half' },
          { id: 'abc' },
          { name: 'no id' },
        ],
      }),
    ).toEqual([
      { id: 3, name: 'Welcome' },
      { id: 4, name: 'Promo' },
    ]);
    expect(toFlows({})).toEqual([]);
    expect(toFlows([])).toEqual([]);
  });
});
