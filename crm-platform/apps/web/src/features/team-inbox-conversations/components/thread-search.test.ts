import { describe, expect, it } from 'vitest';
import type { MessageResponse } from '@crm/contracts';
import { matchingMessages } from './thread-search';

const m = (id: string, body: string | null) => ({ id, body }) as unknown as MessageResponse;

describe('matchingMessages', () => {
  const list = [m('a', 'Hello there'), m('b', null), m('c', 'say HELLO again'), m('d', 'bye')];
  it('finds messages by text without caring about case, oldest first', () => {
    expect(matchingMessages(list, 'hello')).toEqual(['a', 'c']);
  });
  it('matches nothing for empty text and skips messages without text', () => {
    expect(matchingMessages(list, '  ')).toEqual([]);
    expect(matchingMessages(list, 'zzz')).toEqual([]);
  });
});
