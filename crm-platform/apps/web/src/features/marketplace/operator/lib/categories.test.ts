import { describe, expect, it } from 'vitest';
import { createMarketCategorySchema, updateMarketCategorySchema } from '@crm/contracts';
import { category } from '../test-fixtures';
import {
  CATEGORY_LIMITS,
  canDeleteCategory,
  categoryProblems,
  createBody,
  draftFromCategory,
  emptyCategoryDraft,
  groupCategories,
  updateBody,
} from './categories';

const filled = (over = {}) => ({
  ...emptyCategoryDraft(),
  slug: 'lead-sources',
  name: 'Lead sources',
  ...over,
});

describe('categoryProblems', () => {
  it('a slug and a name are enough', () => {
    expect(categoryProblems(filled(), 'create')).toEqual({});
  });

  it('the slug follows the contract rule and is only checked on create', () => {
    for (const bad of ['', 'A', 'a', '1abc', 'has space', 'UPPER', 'x'.repeat(49)]) {
      expect(categoryProblems(filled({ slug: bad }), 'create').slug, bad).toBeDefined();
    }
    expect(categoryProblems(filled({ slug: 'NOT VALID' }), 'edit').slug).toBeUndefined();
  });

  it('the name is 2 to 60 characters', () => {
    expect(categoryProblems(filled({ name: '' }), 'create').name).toEqual({ code: 'required' });
    expect(categoryProblems(filled({ name: 'x' }), 'create').name).toMatchObject({
      code: 'tooShort',
    });
    expect(categoryProblems(filled({ name: 'x'.repeat(61) }), 'create').name).toMatchObject({
      code: 'tooLong',
    });
  });

  it('description up to 300, icon of lowercase letters digits and dashes, order 0 to 10000', () => {
    expect(
      categoryProblems(filled({ description: 'x'.repeat(301) }), 'create').description,
    ).toMatchObject({ code: 'tooLong' });
    expect(categoryProblems(filled({ icon: 'Bad Icon' }), 'create').icon).toEqual({ code: 'icon' });
    expect(categoryProblems(filled({ icon: 'shopping-cart' }), 'create').icon).toBeUndefined();
    expect(categoryProblems(filled({ sortOrder: '-3' }), 'create').sortOrder).toMatchObject({
      code: 'number',
    });
    expect(categoryProblems(filled({ sortOrder: '10001' }), 'create').sortOrder).toMatchObject({
      code: 'number',
    });
  });

  it('agrees with the contract on the limits', () => {
    const create = (over: Record<string, unknown>) =>
      createMarketCategorySchema.safeParse({
        kind: 'integration',
        slug: 'ok-slug',
        name: 'Okay',
        ...over,
      }).success;
    expect(create({ name: 'x'.repeat(CATEGORY_LIMITS.nameMax) })).toBe(true);
    expect(create({ name: 'x'.repeat(CATEGORY_LIMITS.nameMax + 1) })).toBe(false);
    expect(create({ description: 'x'.repeat(CATEGORY_LIMITS.descriptionMax + 1) })).toBe(false);
    expect(create({ sortOrder: CATEGORY_LIMITS.sortOrderMax + 1 })).toBe(false);
  });
});

describe('request bodies', () => {
  it('createBody makes a body the contract accepts and leaves empty optional fields out', () => {
    const body = createBody(filled({ description: ' Portals ', icon: '', sortOrder: '20' }));
    expect(body).toEqual({
      kind: 'integration',
      slug: 'lead-sources',
      name: 'Lead sources',
      description: 'Portals',
      sortOrder: 20,
    });
    expect(createMarketCategorySchema.safeParse(body).success).toBe(true);
  });

  it('updateBody is null when nothing changed', () => {
    const c = category();
    expect(updateBody(c, draftFromCategory(c))).toBeNull();
  });

  it('updateBody sends rowVersion and the fields that changed', () => {
    const c = category({ rowVersion: 7 });
    const d = draftFromCategory(c);
    expect(updateBody(c, { ...d, name: 'Lead portals' })).toEqual({
      rowVersion: 7,
      name: 'Lead portals',
    });
    expect(updateBody(c, { ...d, isActive: false })).toEqual({ rowVersion: 7, isActive: false });
    expect(updateBody(c, { ...d, sortOrder: '40' })).toEqual({ rowVersion: 7, sortOrder: 40 });
    expect(
      updateMarketCategorySchema.safeParse(updateBody(c, { ...d, isActive: false })).success,
    ).toBe(true);
  });

  it('a blank description or icon clears the stored one with null', () => {
    const c = category();
    const d = draftFromCategory(c);
    expect(updateBody(c, { ...d, description: '' })).toEqual({ rowVersion: 1, description: null });
    expect(updateBody(c, { ...d, icon: '  ' })).toEqual({ rowVersion: 1, icon: null });
  });

  it('never sends the slug or the kind (they cannot change)', () => {
    const c = category();
    const body = updateBody(c, {
      ...draftFromCategory(c),
      slug: 'other',
      kind: 'mini_app',
      name: 'Changed',
    });
    expect(Object.keys(body ?? {}).sort()).toEqual(['name', 'rowVersion']);
  });
});

describe('deleting and grouping', () => {
  it('only an empty category can be deleted', () => {
    expect(canDeleteCategory({ appCount: 0 })).toBe(true);
    expect(canDeleteCategory({ appCount: 1 })).toBe(false);
  });

  it('groups by kind in the operator order, mini apps first', () => {
    const groups = groupCategories([
      category({ id: 'a', kind: 'integration', slug: 'p', name: 'Payments', sortOrder: 50 }),
      category({ id: 'b', kind: 'mini_app', slug: 'u', name: 'Utilities', sortOrder: 80 }),
      category({ id: 'c', kind: 'integration', slug: 'l', name: 'Lead sources', sortOrder: 10 }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['mini_app', 'integration']);
    expect(groups[1]?.categories.map((c) => c.slug)).toEqual(['l', 'p']);
  });
});
