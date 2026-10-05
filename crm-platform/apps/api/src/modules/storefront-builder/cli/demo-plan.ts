import { couponDiscount, couponRedeemable, type CouponTerms } from '../rules/coupon-rules';
import { shippingFee, type ShippingConfig } from '../rules/shipping';

/**
 * The store demo data as a PLAN: pure, seeded, no database. `seed-store-demo` turns the plan into rows through the real write path;
 * the plan is what the tests pin (the same seed and the same clock always give the same plan, so a re-run is idempotent and a
 * `--reset` knows exactly what it made).
 *
 * Money is the store's own unit: minor units x100 (paise for INR), like `wa_orders` and `wa_products` store it.
 */

/** Written to `wa_orders.meta_json.demo` and to the tags of a demo product: the marker `--reset` finds the seed's rows by. */
export const DEMO_MARKER = 'store-demo';
/** Every demo customer's `company` starts with this, so the Customers screen says plainly that they are demo rows. */
export const DEMO_COMPANY_PREFIX = 'Demo · ';
export const DEMO_CURRENCY = 'INR';
export const DEFAULT_SEED = 20261005;
export const DEMO_SHIPPING: ShippingConfig = { flat_minor: 4900, free_above_minor: 99900 };

export type DemoStatus =
  'new' | 'pending' | 'confirmed' | 'paid' | 'processing' | 'completed' | 'shipped' | 'cancelled';
export type DemoSource = 'storefront' | 'waba';
/** How the order stands on money. `refunded` is a paid order that was cancelled and returned in the ledger. */
export type DemoPayState = 'paid' | 'unpaid' | 'awaiting' | 'cod' | 'refunded';
export type DemoGateway = 'razorpay' | 'stripe' | 'payu';

export interface DemoProduct {
  key: string;
  sku: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  priceMinor: number;
  comparePriceMinor: number | null;
  weightGrams: number;
  /** Stock left AFTER the demo orders (null: not tracked). */
  stockQty: number | null;
  status: 'active' | 'draft';
  /** A data URL: the demo needs no network. */
  image: string;
}

export interface DemoCoupon {
  code: string;
  type: 'percent' | 'flat';
  amount: number;
  minSubtotalMinor: number | null;
  maxDiscountMinor: number | null;
  freeShipping: boolean;
  startsAt: Date | null;
  expiresAt: Date | null;
  usageLimit: number | null;
  /** How many demo orders redeemed it (what `used_count` says). */
  usedCount: number;
  /** True: only the target shop (`storefront_id` set); false: every shop of the workspace. */
  storeScoped: boolean;
}

export interface DemoCustomer {
  key: string;
  name: string;
  /** E.164 with the "+". For an existing contact this is its own number. */
  phone: string;
  email: string | null;
  address: string;
  company: string;
  /** The customer is a contact the workspace already has (filled in by the caller from the database). */
  existingContact: boolean;
}

export interface DemoOrderLine {
  productKey: string;
  qty: number;
  unitMinor: number;
}

export interface DemoOrder {
  key: string;
  /** 1..N, oldest first. */
  index: number;
  customerKey: string;
  source: DemoSource;
  status: DemoStatus;
  payState: DemoPayState;
  paymentMethod: 'prepaid' | 'cod';
  gateway: DemoGateway | null;
  gatewayPaymentId: string | null;
  paymentLink: string | null;
  lines: DemoOrderLine[];
  couponCode: string | null;
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  taxRatePercent: number | null;
  taxMinor: number;
  totalMinor: number;
  rtoScore: number | null;
  rtoBand: 'low' | 'medium' | 'high' | null;
  notes: string | null;
  placedAt: Date;
}

export interface DemoPlan {
  seed: number;
  now: Date;
  products: DemoProduct[];
  coupons: DemoCoupon[];
  customers: DemoCustomer[];
  orders: DemoOrder[];
}

/** An existing contact the plan may use as a customer (the seeder reads them from the database). */
export interface ExistingContact {
  name: string;
  phone: string;
  email: string | null;
}

export interface PlanInput {
  seed?: number;
  now: Date;
  existingContacts?: readonly ExistingContact[];
  orderCount?: number;
}

// ---- seeded randomness --------------------------------------------------------------------------------------------------

/** mulberry32: tiny, fast, and the same sequence on every machine. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 24 * 60 * 60 * 1000;

// ---- catalogue ----------------------------------------------------------------------------------------------------------

/** A flat tile with the product's initials: a self-contained image (no download, no host to reach). */
export function tileImage(label: string, hue: number): string {
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">` +
    `<rect width="400" height="400" fill="hsl(${hue} 55% 88%)"/>` +
    `<circle cx="200" cy="200" r="120" fill="hsl(${hue} 50% 72%)"/>` +
    `<text x="200" y="228" font-family="Arial,sans-serif" font-size="84" font-weight="700" text-anchor="middle" fill="hsl(${hue} 45% 28%)">${initials}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

interface ProductSeed {
  name: string;
  category: string;
  description: string;
  price: number;
  compare?: number;
  grams: number;
  /** Starting stock; `0` sells out, `null` is untracked. */
  stock: number | null;
  status?: 'active' | 'draft';
}

const CATALOGUE: readonly ProductSeed[] = [
  {
    name: 'Classic Cotton Tee',
    category: 'Apparel',
    description: 'Soft 180 GSM combed cotton, relaxed fit.',
    price: 59900,
    compare: 79900,
    grams: 220,
    stock: 60,
  },
  {
    name: 'Slim Fit Denim Jacket',
    category: 'Apparel',
    description: 'Stretch denim with a washed finish and brass buttons.',
    price: 249900,
    compare: 299900,
    grams: 780,
    stock: 18,
  },
  {
    name: 'Linen Summer Shirt',
    category: 'Apparel',
    description: 'Breathable pure linen, half sleeves.',
    price: 129900,
    grams: 260,
    stock: 35,
  },
  {
    name: 'Zip Hoodie',
    category: 'Apparel',
    description: 'Brushed fleece lining, two front pockets.',
    price: 179900,
    compare: 209900,
    grams: 640,
    stock: 24,
  },
  {
    name: 'Steel Water Bottle 1L',
    category: 'Home & Kitchen',
    description: 'Double-wall insulated, keeps cold for 24 hours.',
    price: 89900,
    grams: 410,
    stock: 80,
  },
  {
    name: 'Ceramic Mug Set of 2',
    category: 'Home & Kitchen',
    description: 'Hand-glazed stoneware, dishwasher safe.',
    price: 69900,
    grams: 700,
    stock: 40,
  },
  {
    name: 'Bamboo Cutting Board',
    category: 'Home & Kitchen',
    description: 'Juice groove, non-slip feet.',
    price: 49900,
    grams: 900,
    stock: 28,
  },
  {
    name: 'Scented Soy Candle',
    category: 'Home & Kitchen',
    description: 'Hand-poured, 40 hour burn. Sold out for now.',
    price: 39900,
    grams: 300,
    stock: 0,
  },
  {
    name: 'Canvas Tote Bag',
    category: 'Accessories',
    description: 'Heavy canvas with an inner zip pocket.',
    price: 34900,
    grams: 240,
    stock: 4,
  },
  {
    name: 'Leather Card Holder',
    category: 'Accessories',
    description: 'Full-grain leather, six card slots.',
    price: 54900,
    compare: 64900,
    grams: 70,
    stock: 45,
  },
  {
    name: 'Polarised Sunglasses',
    category: 'Accessories',
    description: 'UV400 polarised lenses, metal frame.',
    price: 149900,
    grams: 60,
    stock: 22,
  },
  {
    name: 'Silicone Earbuds Case',
    category: 'Accessories',
    description: 'Draft: waiting for the photo shoot.',
    price: 24900,
    grams: 30,
    stock: null,
    status: 'draft',
  },
];

const slugOf = (s: string): string =>
  `demo-${s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;

function buildProducts(): DemoProduct[] {
  return CATALOGUE.map((p, i) => ({
    key: `p${i + 1}`,
    sku: `DEMO-${String(i + 1).padStart(3, '0')}`,
    name: p.name,
    slug: slugOf(p.name),
    category: p.category,
    description: p.description,
    priceMinor: p.price,
    comparePriceMinor: p.compare ?? null,
    weightGrams: p.grams,
    stockQty: p.stock,
    status: p.status ?? 'active',
    image: tileImage(p.name, (i * 47 + 15) % 360),
  }));
}

// ---- customers ----------------------------------------------------------------------------------------------------------

interface CustomerSeed {
  name: string;
  email: string;
  address: string;
  segment: string;
}

/** The ten customers the seed creates (their numbers are in a block no real subscriber is given). */
const NEW_CUSTOMERS: readonly CustomerSeed[] = [
  {
    name: 'Aarav Mehta',
    email: 'aarav.mehta@demo-store.test',
    address: '14 Palm Grove Road, Indiranagar, Bengaluru 560038',
    segment: 'Retail',
  },
  {
    name: 'Diya Nair',
    email: 'diya.nair@demo-store.test',
    address: '7 Marine Drive Apartments, Kochi 682031',
    segment: 'Retail',
  },
  {
    name: 'Kabir Singh',
    email: 'kabir.singh@demo-store.test',
    address: '221 Sector 21, Chandigarh 160022',
    segment: 'Wholesale',
  },
  {
    name: 'Isha Verma',
    email: 'isha.verma@demo-store.test',
    address: '9 Civil Lines, Jaipur 302006',
    segment: 'Retail',
  },
  {
    name: 'Rohan Kulkarni',
    email: 'rohan.kulkarni@demo-store.test',
    address: '33 Koregaon Park, Pune 411001',
    segment: 'Boutique',
  },
  {
    name: 'Meera Iyer',
    email: 'meera.iyer@demo-store.test',
    address: '5 Besant Nagar, Chennai 600090',
    segment: 'Retail',
  },
  {
    name: 'Vikram Rao',
    email: 'vikram.rao@demo-store.test',
    address: '18 Banjara Hills, Hyderabad 500034',
    segment: 'Wholesale',
  },
  {
    name: 'Sana Khan',
    email: 'sana.khan@demo-store.test',
    address: '42 Park Street, Kolkata 700016',
    segment: 'Boutique',
  },
  {
    name: 'Neha Gupta',
    email: 'neha.gupta@demo-store.test',
    address: '61 Vasant Vihar, New Delhi 110057',
    segment: 'Retail',
  },
  {
    name: 'Arjun Reddy',
    email: 'arjun.reddy@demo-store.test',
    address: '12 Jubilee Hills, Hyderabad 500033',
    segment: 'Retail',
  },
];

/** The first demo number is +91 90000 10001. Only the seed uses this block; `--reset` deletes contacts in it. */
export const demoPhone = (n: number): string => `+9190000${String(10000 + n)}`;
export const demoPhones = (): string[] => NEW_CUSTOMERS.map((_, i) => demoPhone(i + 1));

const EXISTING_ADDRESSES = [
  '27 Residency Road, Bengaluru 560025',
  '3 Linking Road, Bandra, Mumbai 400050',
  '88 Anna Salai, Chennai 600002',
  '15 MG Road, Pune 411001',
] as const;

/**
 * 14 customers: up to four are contacts the workspace already has (an existing contact keeps its own name and number, so the CRM
 * link finds it), the rest are new. Customers 13 and 14 only have a saved profile, no orders.
 */
function buildCustomers(existing: readonly ExistingContact[]): DemoCustomer[] {
  const out: DemoCustomer[] = [];
  existing.slice(0, 4).forEach((c, i) => {
    out.push({
      key: `c${out.length + 1}`,
      name: c.name,
      phone: c.phone,
      email: c.email,
      address: EXISTING_ADDRESSES[i]!,
      company: `${DEMO_COMPANY_PREFIX}Retail`,
      existingContact: true,
    });
  });
  NEW_CUSTOMERS.forEach((c, i) => {
    if (out.length >= 14) return;
    out.push({
      key: `c${out.length + 1}`,
      name: c.name,
      phone: demoPhone(i + 1),
      email: c.email,
      address: c.address,
      company: `${DEMO_COMPANY_PREFIX}${c.segment}`,
      existingContact: false,
    });
  });
  return out;
}

// ---- coupons ------------------------------------------------------------------------------------------------------------

export const DEMO_COUPON_CODES = [
  'DEMO-WELCOME10',
  'DEMO-FLAT200',
  'DEMO-EXPIRED15',
  'DEMO-SOLDOUT20',
  'DEMO-STORE5',
] as const;

function buildCoupons(now: Date): DemoCoupon[] {
  const at = (days: number) => new Date(now.getTime() + days * DAY);
  const base = { maxDiscountMinor: null, freeShipping: false, usedCount: 0, storeScoped: false };
  return [
    {
      ...base,
      code: 'DEMO-WELCOME10',
      type: 'percent',
      amount: 10,
      minSubtotalMinor: null,
      maxDiscountMinor: 30000,
      startsAt: at(-60),
      expiresAt: at(90),
      usageLimit: null,
    },
    {
      ...base,
      code: 'DEMO-FLAT200',
      type: 'flat',
      amount: 20000,
      minSubtotalMinor: 100000,
      startsAt: null,
      expiresAt: null,
      usageLimit: null,
    },
    {
      ...base,
      code: 'DEMO-EXPIRED15',
      type: 'percent',
      amount: 15,
      minSubtotalMinor: null,
      startsAt: at(-60),
      expiresAt: at(-10),
      usageLimit: null,
    },
    {
      ...base,
      code: 'DEMO-SOLDOUT20',
      type: 'percent',
      amount: 20,
      minSubtotalMinor: null,
      maxDiscountMinor: 50000,
      startsAt: null,
      expiresAt: null,
      usageLimit: 3,
    },
    {
      ...base,
      code: 'DEMO-STORE5',
      type: 'percent',
      amount: 5,
      minSubtotalMinor: null,
      freeShipping: true,
      startsAt: null,
      expiresAt: at(30),
      usageLimit: null,
      storeScoped: true,
    },
  ];
}

const termsOf = (c: DemoCoupon): CouponTerms => ({
  code: c.code,
  type: c.type,
  amount: c.amount,
  minSubtotalMinor: c.minSubtotalMinor,
  maxDiscountMinor: c.maxDiscountMinor,
  freeShipping: c.freeShipping,
  active: true,
  startsAt: c.startsAt,
  expiresAt: c.expiresAt,
  usageLimit: null,
  usedCount: 0,
});

// ---- orders -------------------------------------------------------------------------------------------------------------

interface Slot {
  status: DemoStatus;
  payState: DemoPayState;
  paymentMethod: 'prepaid' | 'cod';
  /** Age range in days (min..max). */
  age: [number, number];
}

const S = (
  status: DemoStatus,
  payState: DemoPayState,
  paymentMethod: 'prepaid' | 'cod',
  min: number,
  max: number,
): Slot => ({
  status,
  payState,
  paymentMethod,
  age: [min, max],
});

/**
 * The shape of the 30 orders: every status, every payment state, prepaid and cash on delivery. Prepaid orders that are paid are
 * `paid` or `completed` because those are the statuses the CRM bridge bills (`StoreOrderSalesService`); cash on delivery orders
 * move through confirmed, processing and shipped unpaid.
 */
const SLOTS: readonly Slot[] = [
  ...Array.from({ length: 6 }, () => S('completed', 'paid', 'prepaid', 12, 44)),
  S('completed', 'cod', 'cod', 14, 30),
  ...Array.from({ length: 4 }, () => S('paid', 'paid', 'prepaid', 0.3, 6)),
  ...Array.from({ length: 4 }, () => S('shipped', 'cod', 'cod', 3, 9)),
  ...Array.from({ length: 2 }, () => S('processing', 'cod', 'cod', 1, 3)),
  ...Array.from({ length: 3 }, () => S('confirmed', 'cod', 'cod', 0.5, 5)),
  S('pending', 'awaiting', 'prepaid', 0.2, 3),
  S('pending', 'awaiting', 'prepaid', 1, 6),
  S('pending', 'unpaid', 'prepaid', 18, 30),
  S('new', 'unpaid', 'prepaid', 0.05, 0.6),
  S('new', 'cod', 'cod', 0.05, 0.8),
  S('new', 'unpaid', 'prepaid', 0.1, 1.5),
  S('cancelled', 'unpaid', 'prepaid', 8, 40),
  S('cancelled', 'cod', 'cod', 6, 36),
  S('cancelled', 'refunded', 'prepaid', 9, 38),
  S('cancelled', 'refunded', 'prepaid', 15, 42),
];

/** Who orders how often: two buyers come back often, a few twice, the rest once. Twelve customers have orders. */
const ORDER_WEIGHTS = [5, 4, 4, 3, 3, 2, 2, 2, 2, 1, 1, 1];

const GATEWAYS: readonly DemoGateway[] = ['razorpay', 'razorpay', 'stripe', 'payu'];
const GST_RATE = 18;

function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const pick = <T>(items: readonly T[], rand: () => number): T =>
  items[Math.floor(rand() * items.length)]!;

const RTO: Record<'low' | 'medium' | 'high', [number, number]> = {
  low: [8, 28],
  medium: [32, 55],
  high: [62, 88],
};

/**
 * The whole demo data set for one clock and one seed. Pure: calling it twice with the same input returns equal plans, and nothing
 * here reads the database, the network or `Date.now()`.
 */
export function buildDemoPlan(input: PlanInput): DemoPlan {
  const seed = input.seed ?? DEFAULT_SEED;
  const now = input.now;
  const rand = rng(seed);
  const products = buildProducts();
  const coupons = buildCoupons(now);
  const customers = buildCustomers(input.existingContacts ?? []);
  const sellable = products.filter((p) => p.status === 'active');
  const count = Math.min(input.orderCount ?? SLOTS.length, SLOTS.length);

  // 1. when: each slot gets an age inside its range; the orders are then numbered oldest first.
  const slots = SLOTS.slice(0, count)
    .map((s) => {
      const age = s.age[0] + rand() * (s.age[1] - s.age[0]);
      return { ...s, placedAt: new Date(now.getTime() - Math.round(age * DAY)) };
    })
    .sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime());

  // 2. who: customers repeat by weight, shuffled over the orders.
  const buyers = customers.slice(0, ORDER_WEIGHTS.length);
  const wheel = shuffle(
    buyers.flatMap((c, i) => Array.from({ length: ORDER_WEIGHTS[i] ?? 1 }, () => c.key)),
    rand,
  );

  // 3. what: one to three lines each.
  const orders: DemoOrder[] = slots.map((slot, i) => {
    const index = i + 1;
    const lineCount = 1 + Math.floor(rand() * 3);
    const chosen = shuffle(sellable, rand).slice(0, lineCount);
    const lines: DemoOrderLine[] = chosen.map((p) => ({
      productKey: p.key,
      qty: 1 + Math.floor(rand() * (p.priceMinor < 60000 ? 3 : 2)),
      unitMinor: p.priceMinor,
    }));
    const subtotalMinor = lines.reduce((a, l) => a + l.unitMinor * l.qty, 0);
    const paidish = slot.payState === 'paid' || slot.payState === 'refunded';
    const gateway = paidish ? pick(GATEWAYS, rand) : null;
    const band =
      slot.paymentMethod === 'cod' ? pick(['low', 'low', 'medium', 'high'] as const, rand) : null;
    return {
      key: `demo-order-${String(index).padStart(2, '0')}`,
      index,
      customerKey: wheel[i % wheel.length]!,
      source: 'storefront' as DemoSource,
      status: slot.status,
      payState: slot.payState,
      paymentMethod: slot.paymentMethod,
      gateway,
      gatewayPaymentId: gateway
        ? `pay_DEMO${String(seed % 1000).padStart(3, '0')}${String(index).padStart(4, '0')}`
        : null,
      paymentLink:
        slot.payState === 'awaiting' ? `https://pay.example.test/demo/order-${index}` : null,
      lines,
      couponCode: null,
      subtotalMinor,
      discountMinor: 0,
      shippingMinor: 0,
      taxRatePercent: null,
      taxMinor: 0,
      totalMinor: subtotalMinor,
      rtoScore: band ? Math.round(RTO[band][0] + rand() * (RTO[band][1] - RTO[band][0])) : null,
      rtoBand: band,
      notes:
        rand() < 0.2
          ? pick(
              [
                'Please call before delivery.',
                'Gift wrap if possible.',
                'Leave with the security desk.',
              ],
              rand,
            )
          : null,
      placedAt: slot.placedAt,
    };
  });

  // 4. where from: about a third are WhatsApp catalog carts (they carry no coupon and no shipping, like a cart sent from the chat).
  const waba = new Set(
    shuffle(
      orders.map((o) => o.index),
      rand,
    ).slice(0, Math.round(count / 3)),
  );
  for (const o of orders) if (waba.has(o.index)) o.source = 'waba';

  // 5. coupons: each is used on orders its own rules allow, in the numbers the scenario needs (storefront orders only).
  const uses: Array<[string, number]> = [
    ['DEMO-WELCOME10', 3],
    ['DEMO-FLAT200', 2],
    ['DEMO-EXPIRED15', 2],
    ['DEMO-SOLDOUT20', 3],
    ['DEMO-STORE5', 2],
  ];
  const free = new Set(orders.filter((o) => o.source === 'storefront').map((o) => o.index));
  for (const [code, n] of uses) {
    const coupon = coupons.find((c) => c.code === code)!;
    const eligible = shuffle(
      orders.filter(
        (o) => free.has(o.index) && couponRedeemable(termsOf(coupon), o.subtotalMinor, o.placedAt),
      ),
      rand,
    );
    for (const o of eligible.slice(0, n)) {
      o.couponCode = code;
      free.delete(o.index);
    }
    coupon.usedCount = orders.filter((o) => o.couponCode === code).length;
    if (code === 'DEMO-SOLDOUT20') coupon.usageLimit = Math.max(1, coupon.usedCount);
  }

  // 6. the money lines: discount from the coupon rules, shipping from the shop's rule, GST on some, one total.
  const taxed = new Set(
    shuffle(
      orders.map((o) => o.index),
      rand,
    ).slice(0, Math.round(count * 0.4)),
  );
  for (const o of orders) {
    const coupon = coupons.find((c) => c.code === o.couponCode);
    o.discountMinor = coupon ? couponDiscount(termsOf(coupon), o.subtotalMinor, o.placedAt) : 0;
    const freeShip = coupon ? coupon.freeShipping : false;
    o.shippingMinor =
      o.source === 'waba' || freeShip ? 0 : shippingFee(DEMO_SHIPPING, o.subtotalMinor);
    if (taxed.has(o.index)) {
      o.taxRatePercent = GST_RATE;
      o.taxMinor = Math.round(((o.subtotalMinor - o.discountMinor) * GST_RATE) / 100);
    }
    o.totalMinor = o.subtotalMinor - o.discountMinor + o.shippingMinor + o.taxMinor;
  }

  // 7. stock left: the starting stock less what the orders that were not cancelled took (never below zero, a sold-out line stays 0).
  const sold = new Map<string, number>();
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    for (const l of o.lines) sold.set(l.productKey, (sold.get(l.productKey) ?? 0) + l.qty);
  }
  for (const p of products) {
    if (p.stockQty === null || p.stockQty === 0) continue;
    p.stockQty = Math.max(1, p.stockQty - (sold.get(p.key) ?? 0));
  }
  // The tote bag is the "low stock" example: whatever the orders took, a handful are left.
  const tote = products.find((p) => p.name === 'Canvas Tote Bag');
  if (tote) tote.stockQty = 3;

  return { seed, now, products, coupons, customers, orders };
}

/** The checks the generator promises, as data: the tests read this, and the seeder prints it as the summary of what it planned. */
export function summarisePlan(plan: DemoPlan): {
  products: number;
  categories: number;
  coupons: number;
  customers: number;
  existingContactCustomers: number;
  orders: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
  byPayState: Record<string, number>;
  repeatCustomers: number;
} {
  const tally = <T>(items: T[], f: (t: T) => string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const i of items) out[f(i)] = (out[f(i)] ?? 0) + 1;
    return out;
  };
  const perCustomer = tally(plan.orders, (o) => o.customerKey);
  return {
    products: plan.products.length,
    categories: new Set(plan.products.map((p) => p.category)).size,
    coupons: plan.coupons.length,
    customers: plan.customers.length,
    existingContactCustomers: plan.customers.filter((c) => c.existingContact).length,
    orders: plan.orders.length,
    byStatus: tally(plan.orders, (o) => o.status),
    bySource: tally(plan.orders, (o) => o.source),
    byPayState: tally(plan.orders, (o) => o.payState),
    repeatCustomers: Object.values(perCustomer).filter((n) => n > 1).length,
  };
}
