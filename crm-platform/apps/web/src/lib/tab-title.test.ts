import { describe, expect, it } from 'vitest';
import { splitTitleBadge } from './tab-title';

describe('splitTitleBadge', () => {
  it('separates the unread badge from the page title', () => {
    expect(splitTitleBadge('(3) Inbox | Admin')).toEqual({ badge: '(3) ', base: 'Inbox | Admin' });
    expect(splitTitleBadge('(99+) Inbox')).toEqual({ badge: '(99+) ', base: 'Inbox' });
  });
  it('leaves a title without a badge alone', () => {
    expect(splitTitleBadge('Inbox | Admin')).toEqual({ badge: '', base: 'Inbox | Admin' });
  });
  it('does not take a parenthesised word for a badge', () => {
    expect(splitTitleBadge('(beta) Inbox')).toEqual({ badge: '', base: '(beta) Inbox' });
  });
});
