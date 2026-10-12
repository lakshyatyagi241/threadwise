import type { InfiniteData } from '@tanstack/react-query';
import type { MessageListResponse } from '@crm/contracts';
import { message, outgoing, thread } from '@/test/inbox-fixtures';
import { flattenMessages, REFUSED_SEND_CODES, withMessage } from './thread-model';

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
