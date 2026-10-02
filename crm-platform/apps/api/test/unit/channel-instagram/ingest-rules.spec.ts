import { describe, expect, it } from 'vitest';
import { truthy } from '../../../src/common/truthy';
import {
  AUTOMATION_WINDOW_MS,
  contactNameOf,
  isGenuineInbound,
  isHistory,
  isPlaceholderTitle,
  normalize,
  normalizeButtons,
  previewOf,
  senderOf,
  sentAtOf,
  shouldAutomate,
  skipThread,
  threadKey,
  threadTitle,
} from '../../../src/modules/channel-instagram/ingest-rules';
import {
  toConversations,
  toMessages,
} from '../../../src/infra/providers/channel-instagram/http-instagram-bridge.client';

const NOW = new Date('2026-10-03T12:00:00.000Z');

const msg = (over: Record<string, unknown> = {}, conv: Record<string, unknown> = {}) =>
  normalize(
    {
      account: { id: 'A1', username: 'shop' },
      conversation: { id: 'A1_555', name: 'Asha', handle: 'asha', ...conv },
      message: { id: 'm1', from_me: false, type: 'text', text: 'hello', ...over },
    },
    NOW,
  );

describe('flags the way the engine sends them', () => {
  it('false, 0, empty, "0" and an empty list are not set; everything else is', () => {
    for (const v of [false, 0, '', '0', null, undefined, []]) expect(truthy(v)).toBe(false);
    for (const v of [true, 1, '1', 'yes', 'false', [1], {}]) expect(truthy(v)).toBe(true);
  });
});

describe('the thread (TW-IG-008)', () => {
  it('title is the name, else the @handle, else "Instagram"', () => {
    expect(threadTitle('Asha', '@asha')).toBe('Asha');
    expect(threadTitle('', 'asha')).toBe('@asha');
    expect(threadTitle('', '@@asha')).toBe('@asha');
    expect(threadTitle('', '')).toBe('Instagram');
  });

  it('a placeholder title is "Instagram" or a bare numeric sender id, with or without @', () => {
    expect(isPlaceholderTitle('Instagram')).toBe(true);
    expect(isPlaceholderTitle('@913620425089077')).toBe(true);
    expect(isPlaceholderTitle('913620425089077')).toBe(true);
    expect(isPlaceholderTitle('@asha')).toBe(false);
    expect(isPlaceholderTitle('Asha 2')).toBe(false);
    expect(isPlaceholderTitle('')).toBe(false);
  });

  it('a payload with no conversation id gets the same key every time, and a different one for different content', () => {
    const a = threadKey('', { x: 1 });
    expect(a).toBe(threadKey('', { x: 1 }));
    expect(a).not.toBe(threadKey('', { x: 2 }));
    expect(a.startsWith('ig:unknown-')).toBe(true);
    expect(threadKey('A1_555', {})).toBe('ig:A1_555');
  });

  it('the sender is what follows the last colon, or the whole id when there is none', () => {
    expect(senderOf('A1:555')).toBe('555');
    expect(senderOf('A1_555')).toBe('A1_555');
  });

  it('a real name or a non-numeric handle resolves a placeholder; a numeric handle alone does not', () => {
    expect(msg({}, { name: '', handle: 'asha' }).resolvedHuman).toBe(true);
    expect(msg({}, { name: 'Asha', handle: '' }).resolvedHuman).toBe(true);
    expect(msg({}, { name: '', handle: '913620425089077' }).resolvedHuman).toBe(false);
    expect(msg({}, { name: '', handle: '' }).resolvedHuman).toBe(false);
  });
});

describe('the message (TW-IG-008)', () => {
  it('direction follows from_me the way the engine means it', () => {
    expect(msg({ from_me: true }).direction).toBe('out');
    expect(msg({ from_me: 1 }).direction).toBe('out');
    expect(msg({ from_me: 0 }).direction).toBe('in');
    expect(msg({ from_me: undefined }).direction).toBe('in');
  });

  it('type defaults to text, ids may be numbers, and the trigger defaults to a keyword DM', () => {
    const n = msg({ type: undefined, id: 42, ig_trigger: undefined });
    expect(n.type).toBe('text');
    expect(n.providerMid).toBe('42');
    expect(n.trigger).toBe('dm_keyword');
    expect(msg({ ig_trigger: 'story_reply' }).trigger).toBe('story_reply');
  });

  it('the preview is the text cut to 140 characters, or [Photo]-style for media with no text', () => {
    expect(previewOf('x'.repeat(200), 'text')).toHaveLength(140);
    expect(previewOf('😀'.repeat(150), 'text')).toBe('😀'.repeat(140));
    expect(previewOf('', 'image')).toBe('[Image]');
    expect(previewOf('', 'story_reply')).toBe('[Story_reply]');
    expect(previewOf('', 'text')).toBe('');
  });

  it('the send time is the message’s own when it parses, else now', () => {
    expect(sentAtOf('2026-10-01T08:30:00Z', NOW).toISOString()).toBe('2026-10-01T08:30:00.000Z');
    expect(sentAtOf('soon', NOW)).toBe(NOW);
    expect(sentAtOf('', NOW)).toBe(NOW);
  });

  it('buttons become {text, url?}, empty ones are dropped, and none at all is null', () => {
    expect(
      normalizeButtons([
        { title: 'Visit', url: 'https://x.test' },
        { text: 'Yes' },
        { title: '' },
        { title: 'No', url: '' },
        'junk',
      ]),
    ).toEqual([{ text: 'Visit', url: 'https://x.test' }, { text: 'Yes' }, { text: 'No' }]);
    expect(normalizeButtons([])).toBeNull();
    expect(normalizeButtons(null)).toBeNull();
    expect(normalizeButtons([{ title: '' }])).toBeNull();
  });
});

describe('what a message is allowed to trigger', () => {
  it('only a genuine inbound makes a contact: not our own send, a test ping or history', () => {
    expect(isGenuineInbound(msg())).toBe(true);
    expect(isGenuineInbound(msg({ from_me: true }))).toBe(false);
    expect(isGenuineInbound(msg({ is_test: true }))).toBe(false);
    expect(isGenuineInbound(msg({ is_backfill: 1 }))).toBe(false);
    expect(
      isGenuineInbound(
        normalize({ message: { text: 'hi' }, conversation: { id: 'c' } }, NOW, true),
      ),
    ).toBe(false);
  });

  it('an automation needs text, unless the trigger kind fires on any message of its kind', () => {
    expect(shouldAutomate(msg())).toBe(true);
    expect(shouldAutomate(msg({ text: '   ' }))).toBe(false);
    expect(shouldAutomate(msg({ text: '', ig_trigger: 'story_mention' }))).toBe(true);
    expect(shouldAutomate(msg({ text: '', ig_trigger: 'mention' }))).toBe(true);
    expect(shouldAutomate(msg({ text: '', ig_trigger: 'story_reply' }))).toBe(false);
    expect(shouldAutomate(msg({ is_test: true }))).toBe(false);
    expect(shouldAutomate(msg({ from_me: true }))).toBe(false);
  });

  it('a contact is named by the thread, unless that is only a placeholder', () => {
    expect(contactNameOf(msg())).toBe('Asha');
    expect(contactNameOf(msg({}, { name: '', handle: '913620425089077' }))).toBeNull();
    expect(contactNameOf(msg({}, { name: '', handle: '' }))).toBeNull();
  });
});

describe('the pull (TW-IG-009)', () => {
  it('skips a thread we hold when the engine reports nothing newer, unless forced', () => {
    const held = new Date('2026-10-03T10:00:00Z');
    expect(skipThread(held, '2026-10-03T09:00:00Z', false)).toBe(true);
    expect(skipThread(held, '2026-10-03T10:00:00Z', false)).toBe(true);
    expect(skipThread(held, '2026-10-03T10:00:01Z', false)).toBe(false);
    expect(skipThread(held, '2026-10-03T09:00:00Z', true)).toBe(false);
  });

  it('never skips a thread we do not hold or one the engine gives no time for', () => {
    expect(skipThread(undefined, '2026-10-03T09:00:00Z', false)).toBe(false);
    expect(skipThread(null, '2026-10-03T09:00:00Z', false)).toBe(false);
    expect(skipThread(new Date(), null, false)).toBe(false);
    expect(skipThread(new Date(), 'garbage', false)).toBe(false);
  });

  it('a message older than the automation window is history', () => {
    expect(isHistory(new Date(NOW.getTime() - AUTOMATION_WINDOW_MS - 1), NOW)).toBe(true);
    expect(isHistory(new Date(NOW.getTime() - AUTOMATION_WINDOW_MS), NOW)).toBe(false);
    expect(isHistory(NOW, NOW)).toBe(false);
  });

  it('reads the engine’s thread and message lists, dropping a thread with no id', () => {
    expect(
      toConversations([
        {
          id: 'c1',
          account: 7,
          name: 'A',
          handle: 'a',
          avatar: 'u',
          last_at: '2026-10-03T09:00:00Z',
        },
        { id: '' },
        { id: 'c2' },
      ]),
    ).toEqual([
      {
        id: 'c1',
        account: '7',
        name: 'A',
        handle: 'a',
        avatar: 'u',
        lastAt: '2026-10-03T09:00:00Z',
      },
      { id: 'c2', account: '', name: '', handle: '', avatar: '', lastAt: null },
    ]);
    expect(
      toMessages([
        {
          id: 'm1',
          from_me: 1,
          text: 'hi',
          buttons: [{ title: 'Go' }],
          at: '2026-10-03T09:00:00Z',
        },
        { id: 7 },
      ]),
    ).toEqual([
      {
        id: 'm1',
        fromMe: true,
        type: 'text',
        text: 'hi',
        mediaUrl: '',
        buttons: [{ title: 'Go' }],
        at: '2026-10-03T09:00:00Z',
      },
      { id: '7', fromMe: false, type: 'text', text: '', mediaUrl: '', buttons: null, at: null },
    ]);
    expect(toConversations({})).toEqual([]);
    expect(toMessages(null)).toEqual([]);
  });
});
