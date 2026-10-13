import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderWithMessages } from '@/features/auth-registration-security/platform/render-test-utils';
import { VariantsSection } from './variants-section';
import {
  EMPTY_VARIANTS,
  newRow,
  validateVariants,
  type VariantsState,
} from '../lib/variants-model';

const props = (state: VariantsState, extra: Record<string, unknown> = {}) => ({
  state,
  onChange: () => undefined,
  problems: null,
  serverErrors: {},
  hadVariants: false,
  productPriceMajor: '10',
  currencyCode: 'INR',
  ...extra,
});

const filled: VariantsState = {
  enabled: true,
  options: [
    { name: 'Size', values: ['S', 'M'] },
    { name: 'Colour', values: ['Red'] },
  ],
  rows: [
    { ...newRow(['S', 'Red']), priceMajor: '8', stockQty: '3', sku: 'TS-S-R' },
    { ...newRow(['M', 'Red']), stockQty: '4' },
  ],
};

describe.each(['en', 'ar'] as const)('VariantsSection (%s)', (locale) => {
  const render = (p: ReturnType<typeof props>) =>
    renderWithMessages(createElement(VariantsSection, p), { locale });

  it('shows only the switch while variants are off', () => {
    const html = render(props(EMPTY_VARIANTS));
    expect(html).toContain('cat-p-hasvariants');
    expect(html).not.toContain('variant-option-0');
  });

  it('warns that stored variants go on save when switched off', () => {
    expect(render(props(EMPTY_VARIANTS, { hadVariants: true }))).toContain('role="alert"');
  });

  it('renders options, chips, presets, bulk fill, table and the aggregate hints', () => {
    const html = render(props(filled));
    expect(html).toContain('variant-option-1');
    expect(html.match(/data-testid="variant-chip"/g)).toHaveLength(3);
    expect(html).toContain('cat-v-bulk-price');
    expect(html).toContain('cat-v-bulk-stock');
    expect(html).toContain('TS-S-R');
    expect(html).toContain('S / Red');
    expect(html).toContain('M / Red');
    expect(html).toContain('data-testid="variant-count"');
    // total stock 7, lowest price 8
    expect(html).toMatch(/data-testid="variant-summary"[\s\S]*>7</);
    expect(html).toContain('8');
  });

  it('says unlimited when an active variant has no stock', () => {
    const html = render(props({ ...filled, rows: [...filled.rows, newRow(['M', 'Blue'])] }));
    expect(html).toMatch(/data-testid="variant-summary"[\s\S]*?<strong[^>]*>[^<0-9]+</);
  });

  it('shows the field problems after a submit', () => {
    const bad: VariantsState = {
      ...filled,
      options: [{ name: '', values: [] }],
      rows: [],
    };
    const html = render(props(bad, { problems: validateVariants(bad) }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-invalid');
  });

  it('shows a server error on a row field', () => {
    const html = render(props(filled, { serverErrors: { 'variants.0.sku': 'SKU is taken' } }));
    expect(html).toContain('SKU is taken');
  });
});
