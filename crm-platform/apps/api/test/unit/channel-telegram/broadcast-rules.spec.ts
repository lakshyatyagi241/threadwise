import { describe, expect, it } from 'vitest';
import {
  chatType,
  isUnreachable,
  mediaKindFor,
  personalise,
  progressPct,
  recipientKind,
} from '../../../src/modules/channel-telegram/broadcast-rules';

describe('blocked vs failed (TW-TG-013 rule 7)', () => {
  it('every refusal that means the person is gone is unreachable, whatever the case', () => {
    for (const d of [
      'Forbidden: bot was blocked by the user',
      'Forbidden: user is deactivated',
      'Bad Request: chat not found',
      'Bad Request: PEER_ID_INVALID',
      'Forbidden: bot was kicked from the group chat',
      'Bad Request: have no rights to send a message',
      'Bad Request: not enough rights to send text messages to the chat',
      'Forbidden: user is deleted',
    ]) {
      expect(isUnreachable(d), d).toBe(true);
    }
  });

  it('a rate limit or a network error is a failure, which a retry may fix', () => {
    for (const d of [
      'Too Many Requests: retry after 5',
      'fetch failed',
      'Bad Request: message is too long',
      '',
    ]) {
      expect(isUnreachable(d), d).toBe(false);
    }
  });
});

describe('the message text', () => {
  it('{{name}} becomes the chat title, with or without spaces; nothing else is merged', () => {
    expect(personalise('Hi {{name}}, and {{ name }}!', 'Asha')).toBe('Hi Asha, and Asha!');
    expect(personalise('Hi {{first_name}}', 'Asha')).toBe('Hi {{first_name}}');
    expect(personalise('  Hi {{name}}  ', null)).toBe('Hi');
  });
});

describe('progress', () => {
  it('blocked counts as done, an empty broadcast is 0, and it rounds', () => {
    expect(progressPct(60, 10, 10, 100)).toBe(80);
    expect(progressPct(0, 0, 0, 0)).toBe(0);
    expect(progressPct(1, 0, 0, 3)).toBe(33);
    expect(progressPct(2, 0, 0, 3)).toBe(67);
  });
});

describe('the attachment kind from its address', () => {
  it('maps extensions the way Reference did, ignoring the query string and case', () => {
    expect(mediaKindFor('https://x.test/a.JPG?v=1')).toBe('image');
    expect(mediaKindFor('https://x.test/a.png')).toBe('image');
    expect(mediaKindFor('https://x.test/a.webp')).toBe('image');
    expect(mediaKindFor('https://x.test/a.gif')).toBe('animation');
    expect(mediaKindFor('https://x.test/a.mp4')).toBe('video');
    expect(mediaKindFor('https://x.test/a.mov')).toBe('video');
    expect(mediaKindFor('https://x.test/a.mp3')).toBe('audio');
    expect(mediaKindFor('https://x.test/a.ogg')).toBe('audio');
    expect(mediaKindFor('https://x.test/a.pdf')).toBe('document');
    expect(mediaKindFor('https://x.test/noext')).toBe('document');
    expect(mediaKindFor('not a url.jpeg')).toBe('image');
  });
});

describe('the chat type', () => {
  it('a positive id is private; a room takes the latest seen type, else group when someone wrote and channel when not', () => {
    expect(chatType('555', [], false)).toBe('private');
    expect(chatType('-100', ['supergroup'], true)).toBe('group');
    expect(chatType('-100', ['channel'], true)).toBe('channel');
    expect(chatType('-100', [], true)).toBe('group');
    expect(chatType('-100', [], false)).toBe('channel');
  });

  it('a recipient is private or group', () => {
    expect(recipientKind('private')).toBe('private');
    expect(recipientKind('group')).toBe('group');
    expect(recipientKind('channel')).toBe('group');
  });
});
