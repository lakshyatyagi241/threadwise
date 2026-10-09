import { describe, expect, it } from 'vitest';
import {
  MAX_PRODUCT_ITEMS,
  extractGoogleId,
  agentOptionLabel,
  appsScriptHref,
  flowOptionLabel,
  formLabel,
  formatPrice,
  handoffFlows,
  mergePicked,
  readProductItems,
  serviceLabel,
  stageOptions,
  storeLabel,
  toProductItem,
  withSavedOption,
  type HelperT,
  type ProductItem,
} from './helpers';

/** Stands in for the `flb.builder.formsChannels.helpers` translator, with the English wording of those messages. */
const t = ((key: string, v: Record<string, string | number> = {}) => {
  switch (key) {
    case 'storeWithCurrency':
      return `${v.name} · ${v.currency}`;
    case 'flowLive':
      return `${v.name} · live`;
    case 'flowDraft':
      return `${v.name} · draft`;
    case 'flowFallback':
      return 'Flow';
    case 'service':
      return `${v.name}${v.active === 'yes' ? '' : ' (inactive)'}${v.minutes ? ` · ${v.minutes} min` : ''}`;
    case 'form':
      return `${v.title}${v.published === 'yes' ? '' : ' (draft)'}`;
    case 'stageInPipeline':
      return `${v.pipeline} · ${v.name}`;
    case 'agentFallback':
      return `Agent ${v.id}`;
    case 'agentWithModel':
      return `${v.name} · ${v.provider}/${v.model}`;
    default:
      return key;
  }
}) as unknown as HelperT;

const item = (id: string): ProductItem => ({
  id: '',
  retailer_id: id,
  name: id,
  sku: '',
  image: null,
  price_minor: null,
  currency: null,
  url: '',
  in_stock: true,
});

describe('product items', () => {
  it('maps a catalog product to the Reference shape (whole product, url and stock included)', () => {
    expect(
      toProductItem({
        id: 'u-1',
        retailerId: 'sku1',
        name: 'Mug',
        sku: 'sku1',
        image: 'u',
        priceMinor: 1250,
        currency: 'USD',
        url: 'https://shop.test/mug',
        inStock: true,
      }),
    ).toEqual({
      id: 'u-1',
      retailer_id: 'sku1',
      name: 'Mug',
      sku: 'sku1',
      image: 'u',
      price_minor: 1250,
      currency: 'USD',
      url: 'https://shop.test/mug',
      in_stock: true,
    });
  });
  it('a product with no sku or url saves empty strings, like the picker response', () => {
    const it = toProductItem({
      id: 'u-2',
      retailerId: 'r',
      name: 'N',
      sku: null,
      image: null,
      priceMinor: null,
      currency: null,
      url: null,
      inStock: false,
    });
    expect(it.sku).toBe('');
    expect(it.url).toBe('');
    expect(it.in_stock).toBe(false);
  });
  it('merges without duplicates and caps at 30', () => {
    expect(mergePicked([item('a')], [item('a'), item('b')]).map((p) => p.retailer_id)).toEqual([
      'a',
      'b',
    ]);
    const many = Array.from({ length: 40 }, (_, i) => item(`p${i}`));
    expect(mergePicked([], many)).toHaveLength(MAX_PRODUCT_ITEMS);
  });
  it('reads garbage safely', () => {
    expect(readProductItems(null)).toEqual([]);
    expect(readProductItems([1, { retailer_id: 5, name: 'x' }])).toEqual([
      {
        id: '',
        retailer_id: '5',
        name: 'x',
        sku: '',
        image: null,
        price_minor: null,
        currency: null,
        url: '',
        in_stock: true,
      },
    ]);
  });
  it('formats prices', () => {
    expect(formatPrice('USD', 999)).toBe('USD 9.99');
    expect(formatPrice(null, null)).toBe('—');
  });
});

describe('google ids', () => {
  it('extracts the id from a url and keeps a bare id', () => {
    expect(
      extractGoogleId(
        ' https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUv/edit#gid=0 ',
      ),
    ).toBe('1AbCdEfGhIjKlMnOpQrStUv');
    expect(extractGoogleId('short')).toBe('short');
  });
});

describe('withSavedOption', () => {
  const base = [
    { v: '', l: 'pick' },
    { v: 'a', l: 'A' },
  ];
  it('adds a missing saved id', () => {
    expect(withSavedOption(base, 'z', (id) => `#${id}`)).toEqual([...base, { v: 'z', l: '#z' }]);
  });
  it('leaves a known or empty value alone', () => {
    expect(withSavedOption(base, 'a', () => 'x')).toBe(base);
    expect(withSavedOption(base, '', () => 'x')).toBe(base);
    expect(withSavedOption(base, undefined, () => 'x')).toBe(base);
  });
});

describe('option labels', () => {
  it('store: name, with the currency when it has one', () => {
    expect(storeLabel('Shop', 'USD', t)).toBe('Shop · USD');
    expect(storeLabel('Catalog 9', null, t)).toBe('Catalog 9');
  });
  it('flow: live or draft suffix', () => {
    expect(flowOptionLabel('Welcome', true, t)).toBe('Welcome · live');
    expect(flowOptionLabel('Welcome', false, t)).toBe('Welcome · draft');
    expect(flowOptionLabel('', false, t)).toBe('Flow · draft');
  });
  it('service: inactive and duration parts only when they apply', () => {
    expect(serviceLabel('Consult', true, 30, t)).toBe('Consult · 30 min');
    expect(serviceLabel('Consult', false, 45, t)).toBe('Consult (inactive) · 45 min');
    expect(serviceLabel('Consult', true, null, t)).toBe('Consult');
  });
  it('form: a draft says so', () => {
    expect(formLabel('Lead', true, t)).toBe('Lead');
    expect(formLabel('Lead', false, t)).toBe('Lead (draft)');
  });
});

describe('stageOptions', () => {
  it('shows the bare stage name with one pipeline', () => {
    expect(
      stageOptions(
        [
          { id: 'a', name: 'New Lead', pipeline: 'Sales' },
          { id: 'b', name: 'Won', pipeline: 'Sales' },
        ],
        t,
      ),
    ).toEqual([
      { v: 'a', l: 'New Lead' },
      { v: 'b', l: 'Won' },
    ]);
  });
  it('prefixes the pipeline when there are several', () => {
    expect(
      stageOptions(
        [
          { id: 'a', name: 'Won', pipeline: 'Sales' },
          { id: 'b', name: 'Won', pipeline: 'Renewals' },
        ],
        t,
      ).map((o) => o.l),
    ).toEqual(['Sales · Won', 'Renewals · Won']);
  });
});

describe('handoffFlows', () => {
  const flows = [
    'chat',
    'instagram',
    'facebook',
    'tiktok',
    'telegram',
    'line',
    'email',
    'call',
  ].map((flowType) => ({ flowType }));
  it('Instagram hand-off hides Instagram and call flows only (Reference quirk: the other channels stay)', () => {
    expect(handoffFlows(flows, ['instagram']).map((f) => f.flowType)).toEqual([
      'chat',
      'facebook',
      'tiktok',
      'telegram',
      'line',
      'email',
    ]);
  });
  it('Facebook hand-off hides six channels but LINE / WeChat / Viber stay (QUIRK)', () => {
    expect(
      handoffFlows(flows, ['instagram', 'facebook', 'tiktok', 'telegram', 'email']).map(
        (f) => f.flowType,
      ),
    ).toEqual(['chat', 'line']);
  });
});

describe('agentOptionLabel', () => {
  it('shows provider/model when the agent has both', () => {
    expect(agentOptionLabel('Triage', 'openai', 'gpt-4o-mini', 'abcdef1234', t)).toBe(
      'Triage · openai/gpt-4o-mini',
    );
    expect(agentOptionLabel('Triage', null, 'gpt-4o-mini', 'abcdef1234', t)).toBe('Triage');
    expect(agentOptionLabel('', 'openai', 'm', 'abcdef1234', t)).toBe('Agent abcdef12 · openai/m');
  });
});

describe('appsScriptHref', () => {
  it('points at the editor API, encoded', () => {
    expect(appsScriptHref('1FAIpQLSc_abc-123')).toBe(
      '/api/v2/flows/builder-context/google/forms/1FAIpQLSc_abc-123/apps-script',
    );
    expect(appsScriptHref('a/b')).toContain('a%2Fb');
  });
});
