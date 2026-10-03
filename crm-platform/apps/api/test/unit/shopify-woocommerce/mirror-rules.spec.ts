import { describe, expect, it } from 'vitest';
import { nextLink } from '../../../src/infra/providers/ecom/shopify-admin.client';
import {
  CUSTOMER_GROUP,
  shopifyCustomer,
  shopifyInStock,
  shopifyOrder,
  shopifyOrderStatus,
  shopifyProduct,
  slugify,
  toMinor,
  wooCustomer,
  wooInStock,
  wooInvoiceUrl,
  wooOrder,
  wooOrderStatus,
  wooProduct,
} from '../../../src/modules/shopify-woocommerce/mirror-rules';

const ctx = { storeUrl: 'my-store.myshopify.com', currency: 'INR' };

describe('money and names', () => {
  it('a price in the store’s decimals becomes minor units; empty or unreadable is 0', () => {
    expect(toMinor('19.99')).toBe(1999);
    expect(toMinor('0.1')).toBe(10);
    expect(toMinor(' 5 ')).toBe(500);
    expect(toMinor(12)).toBe(1200);
    expect(toMinor('')).toBe(0);
    expect(toMinor(null)).toBe(0);
    expect(toMinor('free')).toBe(0);
  });

  it('a slug is lower-case words joined by hyphens, accents removed', () => {
    expect(slugify('Café  Crème! Large')).toBe('cafe-creme-large');
    expect(slugify('---')).toBe('');
  });
});

describe('a Shopify product (WD-ECOM-011)', () => {
  const product = {
    id: 123,
    title: 'Blue Shirt',
    handle: 'blue-shirt',
    body_html: '<p>Soft <b>cotton</b></p>',
    tags: 'summer, cotton ,',
    vendor: 'Acme',
    product_type: 'Shirts',
    status: 'active',
    images: [{ src: 'https://cdn/1.jpg' }, { src: 'https://cdn/2.jpg' }],
    variants: [{ price: '799.00', compare_at_price: '999.00', sku: 'SH-1', inventory_quantity: 4 }],
  };

  it('maps the first variant, the images, the strike-through price, the tags and the product address', () => {
    expect(shopifyProduct(product, ctx)).toEqual({
      storeId: '123',
      sku: 'SH-1',
      name: 'Blue Shirt',
      slug: 'blue-shirt',
      description: 'Soft cotton',
      bodyHtml: '<p>Soft <b>cotton</b></p>',
      priceMinor: 79900,
      comparePriceMinor: 99900,
      currency: 'INR',
      imageUrl: 'https://cdn/1.jpg',
      gallery: ['https://cdn/1.jpg', 'https://cdn/2.jpg'],
      inStock: true,
      status: 'active',
      category: 'Shirts',
      brand: 'Acme',
      productUrl: 'https://my-store.myshopify.com/products/blue-shirt',
      tags: ['summer', 'cotton'],
    });
  });

  it('a variant with no SKU gets one from the product id, and a missing compare price is none', () => {
    const p = shopifyProduct({ id: 9, title: 'X', variants: [{ price: '5', sku: '' }] }, ctx);
    expect(p.sku).toBe('SHOPIFY-9');
    expect(p.comparePriceMinor).toBeNull();
    expect(p.slug).toBe('x');
    expect(p.currency).toBe('INR');
    expect(shopifyProduct({ id: 9 }, { storeUrl: 's', currency: null }).currency).toBe('USD');
  });

  it('maps the status, and falls back to the single image field', () => {
    expect(shopifyProduct({ id: 1, status: 'DRAFT' }, ctx).status).toBe('draft');
    expect(shopifyProduct({ id: 1, status: 'archived' }, ctx).status).toBe('archived');
    expect(shopifyProduct({ id: 1, status: 'weird' }, ctx).status).toBe('active');
    expect(shopifyProduct({ id: 1, image: { src: 'https://cdn/only.jpg' } }, ctx).imageUrl).toBe(
      'https://cdn/only.jpg',
    );
  });

  it('stock: untracked inventory is available; tracked is in stock above zero in total', () => {
    expect(shopifyInStock({ variants: [{ price: '1' }] })).toBe(true);
    expect(shopifyInStock({ variants: [] })).toBe(true);
    expect(
      shopifyInStock({ variants: [{ inventory_quantity: 0 }, { inventory_quantity: 0 }] }),
    ).toBe(false);
    expect(
      shopifyInStock({ variants: [{ inventory_quantity: 0 }, { inventory_quantity: 3 }] }),
    ).toBe(true);
    expect(
      shopifyInStock({ variants: [{ inventory_quantity: null }, { inventory_quantity: 0 }] }),
    ).toBe(false);
  });
});

describe('a Shopify order and customer (WD-ECOM-011)', () => {
  it('order status: refunded, voided or cancelled is cancelled, fulfilled is shipped, paid is paid, the rest new', () => {
    expect(shopifyOrderStatus({ financial_status: 'refunded' })).toBe('cancelled');
    expect(shopifyOrderStatus({ financial_status: 'voided' })).toBe('cancelled');
    expect(shopifyOrderStatus({ financial_status: 'paid', cancelled_at: '2026-01-01' })).toBe(
      'cancelled',
    );
    expect(shopifyOrderStatus({ financial_status: 'paid', fulfillment_status: 'fulfilled' })).toBe(
      'shipped',
    );
    expect(shopifyOrderStatus({ financial_status: 'PAID' })).toBe('paid');
    expect(shopifyOrderStatus({ financial_status: 'pending' })).toBe('new');
    expect(shopifyOrderStatus({})).toBe('new');
  });

  it('maps the customer, a phone cut to digits, the lines, the total and the meta', () => {
    const o = shopifyOrder(
      {
        id: 77,
        name: '#1001',
        order_number: 1001,
        email: 'order@x.test',
        total_price: '1598.00',
        currency: 'INR',
        financial_status: 'paid',
        created_at: '2026-10-01T10:00:00Z',
        customer: {
          first_name: 'Asha',
          last_name: 'K',
          phone: '+91 98765-43210',
          email: 'asha@x.test',
        },
        line_items: [
          { title: 'Blue Shirt', quantity: 2, price: '799.00', sku: 'SH-1' },
          { title: 'Gift' },
        ],
      },
      { currency: 'USD' },
    );
    expect(o).toMatchObject({
      storeId: '77',
      phone: '919876543210',
      name: 'Asha K',
      email: 'asha@x.test',
      totalMinor: 159800,
      currency: 'INR',
      status: 'paid',
    });
    expect(o.items).toEqual([
      { title: 'Blue Shirt', qty: 2, price: '799.00', sku: 'SH-1' },
      { title: 'Gift', qty: 1, price: '0', sku: null },
    ]);
    expect(o.meta).toMatchObject({ name: '#1001', order_number: 1001, financial_status: 'paid' });
  });

  it('the phone comes from the order, then the shipping address; none is null; the currency falls back to the store’s', () => {
    expect(shopifyOrder({ id: 1, phone: '98 765', customer: {} }, { currency: 'EUR' }).phone).toBe(
      '98765',
    );
    expect(
      shopifyOrder({ id: 1, shipping_address: { phone: '12-34' } }, { currency: 'EUR' }).phone,
    ).toBe('1234');
    const none = shopifyOrder({ id: 1 }, { currency: 'EUR' });
    expect(none.phone).toBeNull();
    expect(none.name).toBeNull();
    expect(none.currency).toBe('EUR');
  });

  it('a customer needs a number; the name falls back to it', () => {
    expect(
      shopifyCustomer({
        id: 5,
        first_name: 'Asha',
        phone: '+91 98765',
        orders_count: 3,
        total_spent: '120.50',
      }),
    ).toEqual({
      storeId: '5',
      phone: '9198765',
      name: 'Asha',
      email: null,
      firstName: 'Asha',
      lastName: null,
      ordersCount: 3,
      totalSpent: '120.50',
    });
    expect(shopifyCustomer({ id: 6, phone: '12345' })?.name).toBe('12345');
    expect(shopifyCustomer({ id: 7, first_name: 'No Phone' })).toBeNull();
    expect(shopifyCustomer({ id: 8, phone: '---' })).toBeNull();
  });
});

describe('a WooCommerce product (WD-ECOM-011)', () => {
  const wc = { storeUrl: 'https://example.com', currency: 'USD' };

  it('the selling price and a strike-through only when the list price is higher', () => {
    const sale = wooProduct(
      { id: 5, name: 'Mug', price: '8', regular_price: '10', stock_status: 'instock' },
      wc,
    );
    expect(sale.priceMinor).toBe(800);
    expect(sale.comparePriceMinor).toBe(1000);
    const full = wooProduct({ id: 6, name: 'Cup', price: '10', regular_price: '10' }, wc);
    expect(full.comparePriceMinor).toBeNull();
    expect(wooProduct({ id: 7, name: 'Pot', regular_price: '12' }, wc).priceMinor).toBe(1200);
  });

  it('maps the taxonomies, the status, the permalink and a missing SKU', () => {
    const p = wooProduct(
      {
        id: 5,
        name: 'Mug',
        slug: 'mug',
        sku: '',
        status: 'trash',
        categories: [{ name: 'Kitchen' }],
        brands: [{ name: 'Acme' }],
        tags: [{ name: 'gift' }, 'plain'],
        short_description: '<p>Nice <i>mug</i></p>',
        description: '<p>Long</p>',
        permalink: 'https://example.com/product/mug',
        images: [{ src: 'https://cdn/m.jpg' }],
      },
      wc,
    );
    expect(p).toMatchObject({
      sku: 'WOO-5',
      status: 'archived',
      category: 'Kitchen',
      brand: 'Acme',
      tags: ['gift', 'plain'],
      description: 'Nice mug',
      bodyHtml: '<p>Long</p>',
      productUrl: 'https://example.com/product/mug',
      imageUrl: 'https://cdn/m.jpg',
    });
    expect(wooProduct({ id: 1, name: 'A', status: 'draft' }, wc).status).toBe('draft');
    expect(wooProduct({ id: 1, name: 'A', status: 'publish' }, wc).status).toBe('active');
    expect(wooProduct({ id: 1, name: 'A', status: 'private' }, wc).status).toBe('draft');
    expect(wooProduct({ id: 9, name: 'A' }, wc).productUrl).toBe('https://example.com/?p=9');
  });

  it('stock: the status wins, then managed quantity, else available', () => {
    expect(wooInStock({ stock_status: 'outofstock', manage_stock: true, stock_quantity: 9 })).toBe(
      false,
    );
    expect(wooInStock({ stock_status: 'onbackorder' })).toBe(true);
    expect(wooInStock({ stock_status: 'instock' })).toBe(true);
    expect(wooInStock({ manage_stock: true, stock_quantity: 0 })).toBe(false);
    expect(wooInStock({ manage_stock: true, stock_quantity: 2 })).toBe(true);
    expect(wooInStock({ manage_stock: true, stock_quantity: null })).toBe(true);
    expect(wooInStock({})).toBe(true);
  });
});

describe('a WooCommerce order and customer (WD-ECOM-011, 028)', () => {
  const wc = { currency: 'USD' };

  it('status: cancelled, refunded or failed is cancelled, completed is shipped, processing paid, the rest new', () => {
    for (const s of ['cancelled', 'refunded', 'failed'])
      expect(wooOrderStatus({ status: s })).toBe('cancelled');
    expect(wooOrderStatus({ status: 'completed' })).toBe('shipped');
    expect(wooOrderStatus({ status: 'processing' })).toBe('paid');
    for (const s of ['pending', 'on-hold', 'checkout-draft', 'custom-status', '']) {
      expect(wooOrderStatus({ status: s })).toBe('new');
    }
  });

  it('a local billing number is made international from the billing country', () => {
    const o = wooOrder(
      {
        id: 900,
        number: '900',
        status: 'processing',
        total: '49.50',
        payment_method: 'cod',
        payment_method_title: 'Cash on delivery',
        billing: {
          first_name: 'Ngozi',
          last_name: 'O',
          email: 'n@x.test',
          phone: '08012345678',
          country: 'NG',
        },
        line_items: [
          { name: 'Mug', quantity: 2, price: 8, sku: 'MUG-1' },
          { name: 'Cup', quantity: 1, total: '5.00' },
        ],
      },
      wc,
    );
    expect(o).toMatchObject({
      storeId: '900',
      phone: '2348012345678',
      name: 'Ngozi O',
      email: 'n@x.test',
      totalMinor: 4950,
      currency: 'USD',
      status: 'paid',
    });
    expect(o.items).toEqual([
      { title: 'Mug', qty: 2, price: '8', sku: 'MUG-1' },
      { title: 'Cup', qty: 1, price: '5.00', sku: null },
    ]);
    expect(o.meta).toMatchObject({
      name: '#900',
      woo_status: 'processing',
      payment_method: 'cod',
      invoice_url: '',
    });
  });

  it('an invoice link is taken from the plugin field or a PDF plugin’s meta, https only', () => {
    expect(wooInvoiceUrl({ invoice_url: 'https://x.test/inv.pdf' })).toBe('https://x.test/inv.pdf');
    expect(wooInvoiceUrl({ invoice_url: 'http://x.test/inv.pdf' })).toBe('');
    expect(
      wooInvoiceUrl({
        meta_data: [
          { key: 'other', value: 'https://no' },
          { key: '_wcpdf_invoice_url', value: ' https://pdf.test/1 ' },
        ],
      }),
    ).toBe('https://pdf.test/1');
    expect(wooInvoiceUrl({ meta_data: [{ key: '_invoice_url', value: 'ftp://x' }] })).toBe('');
    expect(wooInvoiceUrl({})).toBe('');
  });

  it('a customer needs a reachable number, made international from the billing country', () => {
    expect(
      wooCustomer({
        id: 3,
        first_name: 'Asha',
        last_name: 'K',
        email: 'a@x.test',
        billing: { phone: '9876543210', country: 'IN' },
      }),
    ).toMatchObject({ storeId: '3', phone: '919876543210', name: 'Asha K', email: 'a@x.test' });
    expect(wooCustomer({ id: 4, first_name: 'No Phone' })).toBeNull();
    expect(wooCustomer({ id: 5, billing: { phone: '9876543210', country: 'IN' } })?.name).toBe(
      '919876543210',
    );
  });
});

describe('the customer groups and paging', () => {
  it('each store’s customers go into a group with WaDesk’s name and colour', () => {
    expect(CUSTOMER_GROUP.shopify).toEqual({ name: 'Shopify Customers', color: '#95BF47' });
    expect(CUSTOMER_GROUP.woocommerce).toEqual({ name: 'WooCommerce Customers', color: '#7F54B3' });
  });

  it('the next Shopify page is the Link header’s rel=next, and the last page has none', () => {
    const link =
      '<https://s.myshopify.com/admin/api/2026-04/products.json?limit=250&page_info=prev>; rel="previous", <https://s.myshopify.com/admin/api/2026-04/products.json?limit=250&page_info=abc>; rel="next"';
    expect(nextLink(link)).toBe(
      'https://s.myshopify.com/admin/api/2026-04/products.json?limit=250&page_info=abc',
    );
    expect(nextLink('<https://s.myshopify.com/x>; rel="previous"')).toBeNull();
    expect(nextLink('')).toBeNull();
    expect(nextLink(null)).toBeNull();
  });
});
