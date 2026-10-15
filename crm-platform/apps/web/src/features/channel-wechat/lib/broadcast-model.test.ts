import { describe, expect, it } from 'vitest';
import { audienceLabel, rowAction } from './broadcast-model';

describe('rowAction', () => {
  it('a draft is sent, a failed one is sent again, the rest have no button', () => {
    expect(rowAction({ status: 'draft', canRetry: false })).toBe('send');
    expect(rowAction({ status: 'failed', canRetry: true })).toBe('retry');
    expect(rowAction({ status: 'sending', canRetry: false })).toBeNull();
    expect(rowAction({ status: 'done', canRetry: false })).toBeNull();
  });

  it('a send stuck after its worker died can be retried', () => {
    expect(rowAction({ status: 'sending', canRetry: true })).toBe('retry');
  });
});

describe('audienceLabel', () => {
  it('names the audience with the tag number or the count', () => {
    expect(audienceLabel({ audience: 'tag', tagId: '107', total: 0 })).toEqual({
      key: 'tag',
      values: { tag: '107', count: 0 },
    });
    expect(audienceLabel({ audience: 'list', tagId: null, total: 12 }).values.count).toBe(12);
    expect(audienceLabel({ audience: 'all', tagId: null, total: 0 }).key).toBe('all');
  });
});
