import { describe, expect, it } from 'vitest';
import { moveItem, outcomeChoices, validateOutcomeName } from './outcomes';

const A = { id: 'a', name: 'Interested', isActive: true };
const B = { id: 'b', name: 'Left message', isActive: true };
const HIDDEN = { id: 'h', name: 'Old', isActive: false };

describe('outcomeChoices', () => {
  it('offers the active outcomes in order', () => {
    expect(outcomeChoices([A, B], null).map((o) => o.id)).toEqual(['a', 'b']);
  });
  it('keeps the outcome a task has even when it is no longer offered', () => {
    expect(outcomeChoices([A], HIDDEN).map((o) => o.id)).toEqual(['a', 'h']);
  });
  it('does not repeat an outcome that is offered and current', () => {
    expect(outcomeChoices([A, B], A)).toHaveLength(2);
  });
  it('is empty when nothing is configured and the task has none', () => {
    expect(outcomeChoices([], null)).toEqual([]);
  });
});

describe('moveItem', () => {
  it('moves up and down', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
  });
  it('ignores a move off either end and never changes the input', () => {
    const input = ['a', 'b'];
    expect(moveItem(input, 0, -1)).toEqual(['a', 'b']);
    expect(moveItem(input, 1, 2)).toEqual(['a', 'b']);
    expect(input).toEqual(['a', 'b']);
  });
});

describe('validateOutcomeName', () => {
  it('needs a name', () => {
    expect(validateOutcomeName('   ', 191)).toBe('nameRequired');
  });
  it('caps the length by characters', () => {
    expect(validateOutcomeName('x'.repeat(192), 191)).toBe('nameTooLong');
    expect(validateOutcomeName('x'.repeat(191), 191)).toBeNull();
  });
  it('accepts a normal name', () => {
    expect(validateOutcomeName('Not able to reach', 191)).toBeNull();
  });
});
