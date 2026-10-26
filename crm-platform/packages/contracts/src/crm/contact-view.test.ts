import { describe, expect, it } from 'vitest';
import {
  CONTACT_VIEW_NAME_MAX,
  CONTACT_VIEW_NAME_MIN,
  createContactViewSchema,
  updateContactViewSchema,
} from './contact-view';

const create = (name: string) => createContactViewSchema.safeParse({ name, filter: {} });

describe('a saved view name', () => {
  it('needs at least 3 and at most 50 characters, after trimming', () => {
    expect(CONTACT_VIEW_NAME_MIN).toBe(3);
    expect(CONTACT_VIEW_NAME_MAX).toBe(50);
    expect(create('ab').success).toBe(false);
    expect(create('  ab  ').success).toBe(false);
    expect(create('abc').success).toBe(true);
    expect(create('x'.repeat(50)).success).toBe(true);
    expect(create('x'.repeat(51)).success).toBe(false);
  });

  it('keeps the same limits when a view is renamed', () => {
    const patch = (name: string) => updateContactViewSchema.safeParse({ name, rowVersion: 1 });
    expect(patch('ab').success).toBe(false);
    expect(patch('A good name').success).toBe(true);
    expect(patch('x'.repeat(51)).success).toBe(false);
  });
});
