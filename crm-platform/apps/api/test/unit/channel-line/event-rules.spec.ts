import { describe, expect, it } from 'vitest';
import {
  eventsOf,
  extractMessage,
  readEvent,
  sourceOf,
} from '../../../src/modules/channel-line/event-rules';

const user = { type: 'user', userId: 'Uabc123' };

describe('eventsOf', () => {
  it('lists the events and tolerates any other shape', () => {
    expect(eventsOf({ events: [{ type: 'message' }, 'junk', null] })).toEqual([
      { type: 'message' },
    ]);
    expect(eventsOf(null)).toEqual([]);
    expect(eventsOf({ events: 'x' })).toEqual([]);
    expect(eventsOf([])).toEqual([]);
  });
});

describe('sourceOf', () => {
  it('a 1:1 chat is the user, a group or a room is its own thread whoever wrote', () => {
    expect(sourceOf({ source: user })).toEqual({ type: 'user', id: 'Uabc123', userId: 'Uabc123' });
    expect(sourceOf({ source: { type: 'group', groupId: 'Cg1', userId: 'Uwho' } })).toEqual({
      type: 'group',
      id: 'Cg1',
      userId: 'Uwho',
    });
    expect(sourceOf({ source: { type: 'group', groupId: 'Cg1' } })).toEqual({
      type: 'group',
      id: 'Cg1',
      userId: null,
    });
    expect(sourceOf({ source: { type: 'room', roomId: 'Rr1' } })?.id).toBe('Rr1');
  });

  it('has nothing to key on without an id of the right kind', () => {
    expect(sourceOf({ source: { type: 'group', userId: 'Uwho' } })).toBeNull();
    expect(sourceOf({ source: { type: 'user', groupId: 'C1' } })).toBeNull();
    expect(sourceOf({ source: {} })).toBeNull();
    expect(sourceOf({})).toBeNull();
  });
});

describe('extractMessage', () => {
  it('reads each message type the way Reference does', () => {
    const of = (message: object) => extractMessage({ message });
    expect(of({ type: 'text', text: 'hello' })).toMatchObject({ text: 'hello', mediaType: null });
    expect(of({ type: 'image', id: '11' })).toEqual({
      text: '',
      mediaType: 'image',
      messageId: '11',
      fileName: null,
    });
    expect(of({ type: 'video', id: '12' }).mediaType).toBe('video');
    expect(of({ type: 'audio', id: '13' }).mediaType).toBe('audio');
    expect(of({ type: 'file', id: '14', fileName: 'a.pdf' })).toEqual({
      text: 'a.pdf',
      mediaType: 'document',
      messageId: '14',
      fileName: 'a.pdf',
    });
    expect(of({ type: 'file', id: '15' }).text).toBe('[file]');
    expect(of({ type: 'location', latitude: 35.1, longitude: 139.2 }).text).toBe('📍 35.1, 139.2');
    expect(of({ type: 'sticker', packageId: '1' }).text).toBe('[sticker]');
    expect(of({ type: 'sticker', text: 'wave' }).text).toBe('wave');
    expect(of({ type: 'flex' }).text).toBe('[message]');
  });
});

describe('readEvent', () => {
  it('a message carries its source, text and the ids a reply and a dedup need', () => {
    const r = readEvent({
      type: 'message',
      source: user,
      replyToken: 'rt-1',
      webhookEventId: 'we-1',
      message: { type: 'text', id: '99', text: 'hi' },
    });
    expect(r).toMatchObject({
      kind: 'message',
      source: { id: 'Uabc123' },
      extracted: { text: 'hi' },
      meta: { messageId: '99', replyToken: 'rt-1', webhookEventId: 'we-1' },
    });
  });

  it('a postback is replayed as its data', () => {
    expect(
      readEvent({ type: 'postback', source: user, postback: { data: 'action=buy' } }),
    ).toMatchObject({ kind: 'postback', data: 'action=buy' });
    expect(readEvent({ type: 'postback', source: user, postback: {} })).toEqual({
      kind: 'ignore',
      type: 'postback',
    });
  });

  it('follow, unfollow, join and an event without a source are ignored', () => {
    expect(readEvent({ type: 'follow', source: user })).toEqual({ kind: 'ignore', type: 'follow' });
    expect(readEvent({ type: 'unfollow', source: user }).kind).toBe('ignore');
    expect(readEvent({ type: 'join', source: { type: 'group', groupId: 'C1' } }).kind).toBe(
      'ignore',
    );
    expect(readEvent({ type: 'message', message: { type: 'text' } }).kind).toBe('ignore');
    expect(readEvent({}).kind).toBe('ignore');
  });
});
