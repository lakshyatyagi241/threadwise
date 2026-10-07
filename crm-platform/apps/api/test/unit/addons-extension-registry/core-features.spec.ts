import { describe, expect, it } from 'vitest';
import { coreFeaturesIn } from '../../../src/modules/addons-extension-registry/addon-grants';

describe('coreFeaturesIn', () => {
  it('finds the flags that are on for every plan, sorted and once each', () => {
    expect(coreFeaturesIn(['woocommerce', 'analytics', 'shopify', 'shopify'])).toEqual([
      'shopify',
      'woocommerce',
    ]);
  });

  it('lets optional flags and module-contributed keys through', () => {
    expect(coreFeaturesIn(['analytics', 'automation', 'calling', 'access_reports'])).toEqual([]);
    expect(coreFeaturesIn([])).toEqual([]);
  });
});
