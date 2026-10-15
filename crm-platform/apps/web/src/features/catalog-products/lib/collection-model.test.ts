import { describe, expect, it } from 'vitest';
import {
  createCollectionSchema,
  updateCollectionSchema,
  type CollectionResponse,
} from '@crm/contracts';
import {
  EMPTY_COLLECTION_FORM,
  buildCollectionInput,
  buildCollectionUpdate,
  collectionProblems,
  filterPick,
  formFromCollection,
  liveProductIds,
  pickerItems,
  togglePick,
} from './collection-model';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const member = (n: number, active = true) => ({
  id: U(n),
  name: `P${n}`,
  sku: null,
  imageUrl: null,
  priceDisplay: '$ 1',
  retailerId: `r${n}`,
  active,
});
const collection = (products = [member(1), member(2, false)]): CollectionResponse => ({
  id: U(100),
  name: 'Summer Sale',
  slug: 'summer-sale',
  description: null,
  isActive: true,
  productCount: products.length,
  metaSetId: null,
  products,
  rowVersion: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

describe('togglePick', () => {
  it('refuses the 31st and leaves the selection unchanged', () => {
    const full = Array.from({ length: 30 }, (_, i) => U(i + 1));
    const out = togglePick(full, U(99));
    expect(out.refused).toBe(true);
    expect(out.selected).toEqual(full);
  });
  it('adds in tick order and removes on a second tick', () => {
    const a = togglePick([], U(9)).selected;
    const b = togglePick(a, U(4)).selected;
    expect(b).toEqual([U(9), U(4)]);
    expect(togglePick(b, U(9)).selected).toEqual([U(4)]);
  });
});

describe('filterPick', () => {
  const items = [
    { name: 'Cotton Tee', sku: 'ST-001' },
    { name: 'Mug', sku: null },
  ];
  it('matches name or sku, ignoring case', () => {
    expect(filterPick(items, 'tee')).toHaveLength(1);
    expect(filterPick(items, 'st-0')).toHaveLength(1);
    expect(filterPick(items, 'MUG')).toHaveLength(1);
    expect(filterPick(items, '  ')).toHaveLength(2);
    expect(filterPick(items, 'zzz')).toHaveLength(0);
  });
});

describe('pickerItems', () => {
  it('adds members the API list lacks so they are not dropped on save', () => {
    const pick = [{ id: U(1), name: 'P1', sku: null, imageUrl: null, priceDisplay: '$ 1' }];
    const items = pickerItems(pick, collection().products);
    expect(items.map((i) => i.id).sort()).toEqual([U(1), U(2)].sort());
  });
});

describe('form building', () => {
  it('starts an edit from the stored members in order', () => {
    expect(formFromCollection(collection()).productIds).toEqual([U(1), U(2)]);
  });
  it('trims and nulls a blank description; the result satisfies the contract', () => {
    const body = buildCollectionInput({ name: ' Summer ', description: '  ', productIds: [U(1)] });
    expect(body).toEqual({ name: 'Summer', description: null, productIds: [U(1)], isActive: true });
    expect(createCollectionSchema.safeParse(body).success).toBe(true);
    expect(
      updateCollectionSchema.safeParse(
        buildCollectionUpdate({ name: 'S', description: 'd', productIds: [U(1)] }, 3),
      ).success,
    ).toBe(true);
  });
  it('reports every problem a form has', () => {
    expect(collectionProblems(EMPTY_COLLECTION_FORM)).toEqual(['nameRequired', 'noProducts']);
    expect(
      collectionProblems({
        name: 'x'.repeat(121),
        description: 'y'.repeat(501),
        productIds: [U(1)],
      }),
    ).toEqual(['nameTooLong', 'descriptionTooLong']);
    expect(collectionProblems({ name: 'ok', description: '', productIds: [U(1)] })).toEqual([]);
  });
});

describe('liveProductIds', () => {
  it('keeps active members only', () => {
    expect(liveProductIds(collection())).toEqual([U(1)]);
  });
});
