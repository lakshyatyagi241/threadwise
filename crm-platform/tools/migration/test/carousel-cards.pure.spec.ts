import { describe, expect, it } from 'vitest';
import { storedCards } from '../transform/templates';

describe('carousel cards as the app stores them', () => {
  it('reads a null entry as an empty component instead of throwing', () => {
    const cards = [null, { components: [null, { type: 'BODY', text: 'hello' }] }, 'not an object'];
    const out = storedCards(cards);
    expect(out).toHaveLength(3);
    expect(out![1]).toMatchObject({ body: 'hello', image: null, headerHandle: null });
    expect(out![0]).toMatchObject({ body: '' });
  });

  it('uppercases button types the way a standard template does', () => {
    const out = storedCards([
      {
        components: [
          { type: 'HEADER', format: 'VIDEO', example: { header_handle: ['h1'] } },
          { type: 'BODY', text: 'b' },
          { type: 'BUTTONS', buttons: [{ type: 'quick_reply', text: 'Yes' }] },
        ],
      },
    ]);
    expect(out![0]).toMatchObject({
      format: 'video',
      headerHandle: 'h1',
      buttons: [{ type: 'QUICK_REPLY', text: 'Yes' }],
    });
  });

  it('returns null when the cards are not a list', () => {
    expect(storedCards(undefined)).toBeNull();
    expect(storedCards({})).toBeNull();
  });
});
