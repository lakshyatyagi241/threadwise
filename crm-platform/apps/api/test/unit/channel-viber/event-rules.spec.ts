import { describe, expect, it } from 'vitest';
import { readBody, readEvent } from '../../../src/modules/channel-viber/event-rules';

const sender = { id: 'u/Ab+1==', name: 'Asha', avatar: 'https://cdn.viber.com/a.jpg' };

describe('the events Viber sends (TW-VIB-003, 004, 005)', () => {
  it('the validation ping is only acknowledged', () => {
    expect(readEvent({ event: 'webhook', timestamp: 1 })).toEqual({ kind: 'ping' });
  });

  it('a text message carries the user, the token and the text; the user id keeps its case', () => {
    const e = readEvent({
      event: 'message',
      message_token: '5098034272017990123',
      sender,
      message: { type: 'text', text: 'hello' },
    });
    expect(e).toMatchObject({
      kind: 'message',
      message: {
        user: { id: 'u/Ab+1==', name: 'Asha' },
        token: '5098034272017990123',
        msgType: 'text',
        body: { kind: 'text', text: 'hello' },
      },
    });
  });

  it('a message without a sender is ignored', () => {
    expect(readEvent({ event: 'message', message: { type: 'text', text: 'x' } }).kind).toBe(
      'ignore',
    );
  });

  it('subscribed is a confirmed subscribe; conversation_started is not', () => {
    expect(readEvent({ event: 'subscribed', user: sender })).toMatchObject({
      kind: 'subscribe',
      confirmed: true,
    });
    expect(readEvent({ event: 'conversation_started', user: sender })).toMatchObject({
      kind: 'subscribe',
      confirmed: false,
    });
    expect(readEvent({ event: 'subscribed', user: {} }).kind).toBe('ignore');
  });

  it('unsubscribed names the user', () => {
    expect(readEvent({ event: 'unsubscribed', user_id: 'u1' })).toEqual({
      kind: 'unsubscribe',
      userId: 'u1',
    });
    expect(readEvent({ event: 'unsubscribed' }).kind).toBe('ignore');
  });

  it('delivered, seen and failed are receipts on a token and a user; seen is read', () => {
    expect(readEvent({ event: 'delivered', message_token: '12', user_id: 'u1' })).toMatchObject({
      kind: 'receipt',
      status: 'delivered',
      token: '12',
      userId: 'u1',
    });
    expect(readEvent({ event: 'seen', message_token: '12', user_id: 'u1' })).toMatchObject({
      status: 'read',
    });
    expect(
      readEvent({ event: 'failed', message_token: '12', user_id: 'u1', desc: 'blocked' }),
    ).toMatchObject({ status: 'failed', desc: 'blocked' });
    expect(readEvent({ event: 'seen', user_id: 'u1' }).kind).toBe('ignore');
  });

  it('an unknown event, junk and nothing are ignored without throwing', () => {
    expect(readEvent({ event: 'client_status' }).kind).toBe('ignore');
    expect(readEvent(null).kind).toBe('ignore');
    expect(readEvent('x').kind).toBe('ignore');
    expect(readEvent([]).kind).toBe('ignore');
  });
});

describe('what a user message looks like in the inbox (Reference extract)', () => {
  it('a picture carries its caption, a video and a file their address', () => {
    expect(
      readBody({ type: 'picture', text: ' look ', media: 'https://dl.viber.com/p.jpg' }),
    ).toEqual({
      kind: 'media',
      mediaKind: 'image',
      url: 'https://dl.viber.com/p.jpg',
      text: 'look',
      name: null,
    });
    expect(readBody({ type: 'video', media: 'https://dl.viber.com/v.mp4' })).toMatchObject({
      kind: 'media',
      mediaKind: 'video',
    });
    expect(
      readBody({ type: 'file', media: 'https://dl.viber.com/f', file_name: 'plan.pdf' }),
    ).toMatchObject({ kind: 'media', mediaKind: 'document', text: 'plan.pdf', name: 'plan.pdf' });
  });

  it('a picture without an address is the placeholder text', () => {
    expect(readBody({ type: 'picture' })).toEqual({ kind: 'unsupported', label: '[image]' });
    expect(readBody({ type: 'file' })).toEqual({ kind: 'unsupported', label: '[file]' });
  });

  it('a location has coordinates, a contact a name and a number, a sticker and the rest a label', () => {
    expect(readBody({ type: 'location', location: { lat: '12.5', lon: 77.25 } })).toEqual({
      kind: 'location',
      latitude: 12.5,
      longitude: 77.25,
    });
    expect(readBody({ type: 'location', location: {} })).toEqual({
      kind: 'unsupported',
      label: '[location]',
    });
    expect(readBody({ type: 'contact', contact: { name: 'Ravi', phone_number: '+9199' } })).toEqual(
      { kind: 'contact', name: 'Ravi', phone: '+9199' },
    );
    expect(readBody({ type: 'sticker', sticker_id: 4 })).toEqual({
      kind: 'unsupported',
      label: '[sticker]',
    });
    expect(readBody({ type: 'url', media: 'https://x.test' })).toEqual({
      kind: 'text',
      text: 'https://x.test',
    });
    expect(readBody({ type: 'Poll' })).toEqual({ kind: 'unsupported', label: '[poll]' });
    expect(readBody({})).toEqual({ kind: 'unsupported', label: '[message]' });
  });
});
