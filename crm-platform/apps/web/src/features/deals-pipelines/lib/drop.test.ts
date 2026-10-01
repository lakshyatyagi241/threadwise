import { describe, expect, it } from 'vitest';
import { dropIndex } from './drop';

const cards = [
  { id: 'a', top: 0, bottom: 100 },
  { id: 'b', top: 110, bottom: 210 },
  { id: 'c', top: 220, bottom: 320 },
];

describe('dropIndex', () => {
  it('counts the cards whose middle is above the pointer', () => {
    expect(dropIndex(10, cards, null)).toBe(0);
    expect(dropIndex(60, cards, null)).toBe(1);
    expect(dropIndex(165, cards, null)).toBe(2);
    expect(dropIndex(400, cards, null)).toBe(3);
  });

  it('leaves the dragged card out', () => {
    // dragging b: dropping below c means index 2 among [a, c]
    expect(dropIndex(400, cards, 'b')).toBe(2);
    expect(dropIndex(5, cards, 'b')).toBe(0);
    expect(dropIndex(160, cards, 'b')).toBe(1);
  });

  it('is zero for an empty column', () => {
    expect(dropIndex(50, [], null)).toBe(0);
  });
});
