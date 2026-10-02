import {
  PRODUCT_BODY_HTML_MAX,
  PRODUCT_CURRENCIES,
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_GALLERY_MAX,
  PRODUCT_NAME_MAX,
  PRODUCT_PRICE_MAX,
  PRODUCT_SKU_MAX,
  formatProductMoney,
  type CreateProductInput,
  type ProductCurrency,
  type ProductResponse,
  type ProductStatus,
} from '@crm/contracts';

/** The pure half of the product form (WD-CAT-020): the form model, its checks, what is posted, and the live indicators. */

/** The currency list of the form, with WaDesk's labels (symbol, code, name), in the same order as the contract. */
export const CURRENCY_LABELS: Record<ProductCurrency, string> = {
  INR: '₹ INR · Indian Rupee',
  USD: '$ USD · US Dollar',
  EUR: '€ EUR · Euro',
  GBP: '£ GBP · British Pound',
  AED: 'د.إ AED · UAE Dirham',
  KES: 'KSh KES · Kenyan Shilling',
  NGN: '₦ NGN · Nigerian Naira',
  ZAR: 'R ZAR · South African Rand',
  BRL: 'R$ BRL · Brazilian Real',
  MXN: '$ MXN · Mexican Peso',
  CRC: '₡ CRC · Costa Rican Colón',
  PHP: '₱ PHP · Philippine Peso',
  IDR: 'Rp IDR · Indonesian Rupiah',
  SGD: 'S$ SGD · Singapore Dollar',
  MYR: 'RM MYR · Malaysian Ringgit',
  THB: '฿ THB · Thai Baht',
  VND: '₫ VND · Vietnamese Đồng',
  EGP: 'E£ EGP · Egyptian Pound',
  PKR: '₨ PKR · Pakistani Rupee',
  BDT: '৳ BDT · Bangladeshi Taka',
  LKR: 'Rs LKR · Sri Lankan Rupee',
};
export const CURRENCY_OPTIONS = PRODUCT_CURRENCIES.map((code) => ({
  code,
  label: CURRENCY_LABELS[code],
}));

/** Suggestions of the category box (WaDesk's datalist). */
export const CATEGORY_SUGGESTIONS = [
  'Apparel',
  'Accessories',
  'Beauty',
  'Home',
  'Food & Drink',
  'Electronics',
] as const;

export const STATUS_OPTIONS: ProductStatus[] = ['active', 'draft', 'archived'];

export interface ProductForm {
  name: string;
  sku: string;
  description: string;
  bodyHtml: string;
  imageUrl: string;
  galleryUrls: string[];
  priceMajor: string;
  comparePriceMajor: string;
  currencyCode: string;
  stockQty: string;
  weightGrams: string;
  inStock: boolean;
  sortOrder: string;
  status: ProductStatus;
  category: string;
  /** Comma separated, as typed. */
  tags: string;
}

export const EMPTY_PRODUCT_FORM: ProductForm = {
  name: '',
  sku: '',
  description: '',
  bodyHtml: '',
  imageUrl: '',
  galleryUrls: [],
  priceMajor: '',
  comparePriceMajor: '',
  currencyCode: 'INR',
  stockQty: '',
  weightGrams: '',
  inStock: true,
  sortOrder: '0',
  status: 'active',
  category: '',
  tags: '',
};

const fixed2 = (major: string | null): string => {
  if (!major) return '';
  const n = Number(major);
  return Number.isFinite(n) ? n.toFixed(2) : major;
};

export function formFromProduct(p: ProductResponse): ProductForm {
  return {
    name: p.name,
    sku: p.sku ?? '',
    description: p.description ?? '',
    bodyHtml: p.bodyHtml ?? '',
    imageUrl: p.imageUrl ?? '',
    galleryUrls: p.galleryUrls,
    priceMajor: fixed2(p.priceMajor),
    comparePriceMajor: p.comparePriceMinor ? fixed2(p.comparePriceMajor) : '',
    currencyCode: p.currencyCode,
    stockQty: p.stockQty === null ? '' : String(p.stockQty),
    weightGrams: p.weightGrams === null ? '' : String(p.weightGrams),
    inStock: p.inStock,
    sortOrder: String(p.sortOrder),
    status: p.status,
    category: p.category ?? '',
    tags: p.tags.join(', '),
  };
}

/** "cotton, summer ,, bestseller" becomes three tags: trimmed, blanks dropped, no repeats. */
export function parseTags(csv: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of csv.split(',')) {
    const tag = raw.trim();
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

export type FieldKey =
  | 'name'
  | 'sku'
  | 'description'
  | 'bodyHtml'
  | 'imageUrl'
  | 'gallery'
  | 'priceMajor'
  | 'comparePriceMajor'
  | 'stockQty'
  | 'weightGrams'
  | 'sortOrder'
  | 'category'
  | 'tags';

export const PROBLEM_KEYS = [
  'required',
  'tooLong',
  'notNumber',
  'tooBig',
  'notWhole',
  'badUrl',
  'outOfRange',
  'tooMany',
] as const;
export type ProblemKey = (typeof PROBLEM_KEYS)[number];
export type Problems = Partial<Record<FieldKey, ProblemKey>>;

const AMOUNT = /^\d+(\.\d+)?$/;
const WHOLE = /^\d+$/;

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function amountProblem(value: string, required: boolean): ProblemKey | undefined {
  const v = value.trim();
  if (!v) return required ? 'required' : undefined;
  if (!AMOUNT.test(v)) return 'notNumber';
  if (Number(v) > PRODUCT_PRICE_MAX) return 'tooBig';
  return undefined;
}

function wholeProblem(value: string, max: number): ProblemKey | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (!WHOLE.test(v)) return 'notWhole';
  if (Number(v) > max) return 'outOfRange';
  return undefined;
}

/** Field checks mirroring the contract, so the person sees them before the server does. Empty means the form can be sent. */
export function validate(form: ProductForm): Problems {
  const out: Problems = {};
  const set = (key: FieldKey, p: ProblemKey | undefined) => {
    if (p) out[key] = p;
  };
  const name = form.name.trim();
  if (!name) out.name = 'required';
  else if (name.length > PRODUCT_NAME_MAX) out.name = 'tooLong';
  if (form.sku.trim().length > PRODUCT_SKU_MAX) out.sku = 'tooLong';
  if (form.description.length > PRODUCT_DESCRIPTION_MAX) out.description = 'tooLong';
  if (form.bodyHtml.length > PRODUCT_BODY_HTML_MAX) out.bodyHtml = 'tooLong';
  if (form.category.trim().length > 96) out.category = 'tooLong';
  if (form.tags.length > 1024) out.tags = 'tooLong';
  set('priceMajor', amountProblem(form.priceMajor, true));
  set('comparePriceMajor', amountProblem(form.comparePriceMajor, false));
  set('stockQty', wholeProblem(form.stockQty, 1_000_000));
  set('weightGrams', wholeProblem(form.weightGrams, 1_000_000));
  set('sortOrder', wholeProblem(form.sortOrder, 9999));
  const image = form.imageUrl.trim();
  if (image && (image.length > 1024 || !isHttpUrl(image))) out.imageUrl = 'badUrl';
  const gallery = form.galleryUrls.map((u) => u.trim()).filter(Boolean);
  if (gallery.length > PRODUCT_GALLERY_MAX) out.gallery = 'tooMany';
  else if (gallery.some((u) => u.length > 1024 || !isHttpUrl(u))) out.gallery = 'badUrl';
  return out;
}

const int = (v: string): number | null => (v.trim() ? Number.parseInt(v.trim(), 10) : null);
const text = (v: string): string | null => (v.trim() ? v.trim() : null);

/** The request body. Blank optional fields are posted as null so an edit can clear them. */
export function buildInput(form: ProductForm): CreateProductInput {
  return {
    name: form.name.trim(),
    sku: text(form.sku),
    description: form.description.trim() ? form.description : null,
    bodyHtml: form.bodyHtml.trim() ? form.bodyHtml : null,
    priceMajor: form.priceMajor.trim(),
    comparePriceMajor: text(form.comparePriceMajor),
    currencyCode: form.currencyCode as ProductCurrency,
    inStock: form.inStock,
    stockQty: int(form.stockQty),
    sortOrder: int(form.sortOrder) ?? 0,
    status: form.status,
    weightGrams: int(form.weightGrams),
    category: text(form.category),
    tags: parseTags(form.tags),
    imageUrl: text(form.imageUrl),
    galleryUrls: form.galleryUrls.map((u) => u.trim()).filter(Boolean),
  };
}

export type Profit =
  { kind: 'none' } | { kind: 'off'; percent: number } | { kind: 'lower' } | { kind: 'same' };

/** The "Profit indicator": the discount of the price against the compare-at price. */
export function profitIndicator(priceMajor: string, compareMajor: string): Profit {
  const price = Number.parseFloat(priceMajor);
  const compare = Number.parseFloat(compareMajor);
  if (!Number.isFinite(price) || !Number.isFinite(compare) || compare <= 0) return { kind: 'none' };
  if (compare > price)
    return { kind: 'off', percent: Math.round(((compare - price) / compare) * 100) };
  if (compare < price) return { kind: 'lower' };
  return { kind: 'same' };
}

/** The storefront preview, as the saved price will read ("₹ 1,299"). */
export function previewPrice(form: Pick<ProductForm, 'priceMajor' | 'currencyCode'>): string {
  const n = Number.parseFloat(form.priceMajor);
  return formatProductMoney(Number.isFinite(n) ? Math.round(n * 100) : 0, form.currencyCode);
}

/** The struck-through compare-at price: shown only when it is above the price. */
export function previewCompare(
  form: Pick<ProductForm, 'priceMajor' | 'comparePriceMajor' | 'currencyCode'>,
): string | null {
  const price = Number.parseFloat(form.priceMajor || '0');
  const compare = Number.parseFloat(form.comparePriceMajor || '0');
  if (
    !Number.isFinite(compare) ||
    compare <= 0 ||
    !(compare > (Number.isFinite(price) ? price : 0))
  )
    return null;
  return formatProductMoney(Math.round(compare * 100), form.currencyCode);
}

/** The server's field names to the form's: the API answers `priceMajor`, `galleryUrls.2` and so on. */
export function fieldOfPath(path: string): FieldKey | null {
  const head = path.split('.')[0] ?? '';
  if (head === 'galleryUrls') return 'gallery';
  const keys: FieldKey[] = [
    'name',
    'sku',
    'description',
    'bodyHtml',
    'imageUrl',
    'priceMajor',
    'comparePriceMajor',
    'stockQty',
    'weightGrams',
    'sortOrder',
    'category',
    'tags',
  ];
  return (keys as string[]).includes(head) ? (head as FieldKey) : null;
}
