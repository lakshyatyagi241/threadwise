import type { InfiniteData } from '@tanstack/react-query';
import type { MessageListResponse } from '@crm/contracts';
import { message, outgoing, thread } from '@/test/inbox-fixtures';
import { flattenMessages, mergeThread, REFUSED_SEND_CODES, withMessage } from './thread-model';

const pages = (...list: MessageListResponse[]): InfiniteData<MessageListResponse> => ({
  pages: list,
  pageParams: list.map(() => undefined),
});

describe('flattenMessages', () => {
  it('joins newest-first pages into one list, oldest first', () => {
    const data = pages(thread([message(3), message(4)], true), thread([message(1), message(2)]));
    expect(flattenMessages(data).map((m) => m.seq)).toEqual([1, 2, 3, 4]);
  });

  it('keeps a message once when two pages overlap', () => {
    const data = pages(thread([message(2), message(3)]), thread([message(1), message(2)]));
    expect(flattenMessages(data).map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  it('is empty before anything has loaded', () => {
    expect(flattenMessages(undefined)).toEqual([]);
  });
});

describe('withMessage', () => {
  it('adds the stored message to the newest page, in order', () => {
    const data = pages(thread([message(1), message(2)]));
    const next = withMessage(data, outgoing(3));
    expect(next?.pages[0]?.data.map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  it('does not add a message twice', () => {
    const data = pages(thread([message(1), outgoing(2)]));
    expect(withMessage(data, outgoing(2))).toBe(data);
  });

  it('leaves an empty cache alone', () => {
    expect(withMessage(undefined, outgoing(1))).toBeUndefined();
  });
});

describe('REFUSED_SEND_CODES', () => {
  it('holds the refusals a retry cannot fix, and not a dropped connection', () => {
    expect(REFUSED_SEND_CODES.has('SERVICE_WINDOW_CLOSED')).toBe(true);
    expect(REFUSED_SEND_CODES.has('CHANNEL_DISCONNECTED')).toBe(true);
    expect(REFUSED_SEND_CODES.has('PLAN_LIMIT_REACHED')).toBe(true);
    expect(REFUSED_SEND_CODES.has('CLIENT_NETWORK')).toBe(false);
  });
});

describe('mergeThread', () => {
  const at = (minute: number) => `2026-10-11T09:${String(minute).padStart(2, '0')}:00.000Z`;
  const note = (id: string, createdAt: string) => ({
    id,
    conversationId: '11111111-1111-4111-8111-111111111111',
    author: { userId: null, name: 'Kabir Rao' },
    body: `note ${id}`,
    mentions: [],
    isPinned: false,
    editedAt: null,
    createdAt,
    rowVersion: 1,
  });
  const kinds = (items: ReturnType<typeof mergeThread>) =>
    items.map((i) => (i.kind === 'note' ? `note:${i.note.id}` : `msg:${i.message.seq}`));

  it('puts a note after the last message written before it', () => {
    const merged = mergeThread(
      [
        message(1, { createdAt: at(0) }),
        message(2, { createdAt: at(10) }),
        message(3, { createdAt: at(30) }),
      ],
      [note('a', at(20))],
    );
    expect(kinds(merged)).toEqual(['msg:1', 'msg:2', 'note:a', 'msg:3']);
  });

  it('puts notes before the first message and after the last, and keeps several in order', () => {
    const merged = mergeThread(
      [message(1, { createdAt: at(10) }), message(2, { createdAt: at(20) })],
      [note('late2', at(50)), note('early', at(1)), note('late1', at(40))],
    );
    expect(kinds(merged)).toEqual(['note:early', 'msg:1', 'msg:2', 'note:late1', 'note:late2']);
  });

  it('keeps the message first when a note and a message are from the same instant', () => {
    expect(kinds(mergeThread([message(1, { createdAt: at(5) })], [note('a', at(5))]))).toEqual([
      'msg:1',
      'note:a',
    ]);
  });

  it('is just the messages when there are no notes, and just the notes when there are no messages', () => {
    expect(kinds(mergeThread([message(1), message(2)], []))).toEqual(['msg:1', 'msg:2']);
    expect(kinds(mergeThread([], [note('a', at(1)), note('b', at(2))]))).toEqual([
      'note:a',
      'note:b',
    ]);
  });
});
