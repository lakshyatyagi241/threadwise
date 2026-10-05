import { describe, expect, it } from 'vitest';
import { catalogMirrorBody } from '../../../src/modules/catalog-products/inbox-conversation-mirror';

const product = (name: string) => ({
  id: 1,
  name,
  imageUrl: null,
  priceMinor: 100,
  currency: 'INR',
  retailerId: 'r',
});

describe('catalogMirrorBody (the thread text of a catalog message)', () => {
  it('uses the typed message, trimmed', () => {
    expect(catalogMirrorBody({ mode: 'mpm', body: '  Look  ', products: [product('A')] })).toBe(
      'Look',
    );
  });
  it('says what was sent when nothing was typed: the product, how many more, or the link', () => {
    expect(catalogMirrorBody({ mode: 'spm', body: null, products: [product('Shirt')] })).toBe(
      'Shirt',
    );
    expect(
      catalogMirrorBody({
        mode: 'mpm',
        body: '   ',
        products: [product('A'), product('B'), product('C')],
      }),
    ).toBe('A and 2 more');
    expect(catalogMirrorBody({ mode: 'mpm', body: null, products: [product('Solo')] })).toBe(
      'Solo',
    );
    expect(catalogMirrorBody({ mode: 'link', body: null, products: [] })).toBe('Catalog link');
    expect(catalogMirrorBody({ mode: 'mpm', body: null, products: [] })).toBe('Catalog');
  });
});
