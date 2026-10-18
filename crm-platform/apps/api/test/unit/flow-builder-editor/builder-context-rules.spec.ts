import { describe, expect, it } from 'vitest';
import {
  catalogStoreName,
  emailLabel,
  flowTypeOf,
  formIsLive,
  instagramLabel,
  productOption,
  storeOption,
} from '../../../src/modules/flow-builder-editor/builder-context-rules';

describe('builder reference-data labels (TW-FLB-026)', () => {
  it('Instagram: @username, else @account <id> (never the display name)', () => {
    expect(instagramLabel({ id: 4, username: 'shop', name: 'Shop' })).toBe('@shop');
    expect(instagramLabel({ id: 4, username: null, name: 'Shop' })).toBe('@account 4');
    expect(instagramLabel({ id: 4, username: '' })).toBe('@account 4');
  });
  it('Email: name, else address, else Email <id>', () => {
    expect(emailLabel({ id: 2, name: 'Support', email: 's@x.test' })).toBe('Support');
    expect(emailLabel({ id: 2, name: '', email: 's@x.test' })).toBe('s@x.test');
    expect(emailLabel({ id: 2, name: null, email: null })).toBe('Email 2');
  });
  it('WhatsApp catalog: name, else Catalog <catalog id>', () => {
    expect(catalogStoreName('Main', '123')).toBe('Main');
    expect(catalogStoreName(null, '123')).toBe('Catalog 123');
    expect(catalogStoreName('', '123')).toBe('Catalog 123');
  });
  it('store option: name, else URL, with the store currency (null when unset)', () => {
    expect(
      storeOption({ uuid: 'u', store_name: 'Shop', store_url: 'x.test', currency: 'USD' }),
    ).toEqual({
      id: 'u',
      name: 'Shop',
      currency: 'USD',
    });
    expect(storeOption({ uuid: 'u', store_name: null, store_url: 'x.test', currency: '' })).toEqual(
      {
        id: 'u',
        name: 'x.test',
        currency: null,
      },
    );
  });
  it('a form is live only when published AND pushed to Meta', () => {
    expect(formIsLive('published', '111')).toBe(true);
    expect(formIsLive('Published', '111')).toBe(true);
    expect(formIsLive('published', null)).toBe(false);
    expect(formIsLive('draft', '111')).toBe(false);
  });
  it('an unknown stored flow type reads as chat', () => {
    expect(flowTypeOf('instagram')).toBe('instagram');
    expect(flowTypeOf('call')).toBe('call');
    expect(flowTypeOf('smoke-signals')).toBe('chat');
    expect(flowTypeOf(null)).toBe('chat');
  });
  it('a product option carries the id, sku, url and stock the picker needs', () => {
    expect(
      productOption({
        uuid: 'p-1',
        retailer_id: 'RET-1',
        name: 'Mug',
        sku: 'S1',
        image_url: 'https://i/x.png',
        price_minor: '1999',
        currency_code: 'USD',
        product_url: 'https://shop/mug',
        in_stock: true,
      }),
    ).toEqual({
      id: 'p-1',
      retailerId: 'RET-1',
      name: 'Mug',
      sku: 'S1',
      image: 'https://i/x.png',
      priceMinor: 1999,
      currency: 'USD',
      url: 'https://shop/mug',
      inStock: true,
    });
    const bare = productOption({
      uuid: 'p-2',
      retailer_id: 'p-2',
      name: 'N',
      price_minor: null,
      in_stock: false,
    });
    expect(bare).toMatchObject({
      sku: null,
      image: null,
      priceMinor: null,
      currency: null,
      url: null,
      inStock: false,
    });
  });
});
