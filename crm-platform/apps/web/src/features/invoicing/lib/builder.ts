import {
  formatQty,
  parseQty,
  type CreateInvoiceInput,
  type InvoiceIssue,
  type InvoiceLineInput,
  type InvoiceProfile,
  type InvoiceResponse,
  type TaxRateResponse,
} from '@crm/contracts';
import { addDays, isDay } from './dates';
import {
  checkBuyerTaxId,
  lineTaxOfRate,
  placeOfSupplyOf,
  previewAutoTax,
  slabPercentOf,
  splitPlace,
  type AutoTaxOutcome,
} from './tax-info';
import { priceInvoice, type LineTax, type PricingResult } from './totals';

/**
 * The invoice form's working copy. Every box holds what the person typed (text); `draftToBody` turns it into the request
 * (`CreateInvoiceInput` / `UpdateInvoiceInput`: decimal strings in major units) and `pricingOf` into the live totals through
 * `computeInvoice` (@crm/contracts) and `@crm/tax`, the very functions the API prices with.
 */

// --- lines (reusable: recurring templates and sales orders edit the same lines) --------------------------------------------------

/** A line's tax choice: the workspace default rate (the request omits `taxRateId`), no tax (`null`), or a tax rate's uuid. */
export const TAX_DEFAULT = 'default';
export const TAX_NONE = 'none';
/** A saved line whose tax rate no longer exists: kept as it was until the person picks a current one. */
export const TAX_SNAPSHOT = 'snapshot';

export interface LineSnapshot {
  name: string;
  /** Percent. */
  rate: string;
  inclusive: boolean;
  components: Array<{ type: string; rate: string }> | null;
}

export interface DraftLine {
  /** Stable React key; never sent. */
  key: string;
  description: string;
  sku: string;
  /** HSN/SAC code, typed. Only used where the seller's country asks for it; empty lets the tax rate's default fill it. */
  hsnSac: string;
  /** Typed ("2", "1.5"), up to 4 decimals. */
  qty: string;
  /** Typed in major units ("12.50"). */
  price: string;
  discountKind: 'percent' | 'amount';
  /** Typed: a percent ("10") or an amount in major units. Empty for no discount. */
  discount: string;
  /** `TAX_DEFAULT`, `TAX_NONE`, `TAX_SNAPSHOT` or a tax rate uuid. */
  taxRateId: string;
  taxSnapshot: LineSnapshot | null;
}

let counter = 0;
export const newKey = (): string => `l${Date.now().toString(36)}${(counter++).toString(36)}`;

export const emptyLine = (taxRateId: string = TAX_DEFAULT): DraftLine => ({
  key: newKey(),
  description: '',
  sku: '',
  hsnSac: '',
  qty: '1',
  price: '',
  discountKind: 'percent',
  discount: '',
  taxRateId,
  taxSnapshot: null,
});

/** A line the person has not started: it is dropped on save instead of being a problem. */
export const isBlankLine = (l: DraftLine): boolean =>
  l.description.trim() === '' &&
  l.price.trim() === '' &&
  (l.qty.trim() === '' || l.qty.trim() === '1');

/**
 * What a person typed in an amount box ("12", "12.5", "1,234.50", "12,5") as a wire decimal ("12.50" stays "12.50"), or null when
 * it is not a non-negative decimal with at most `scale` decimals. No rounding: the currency's own decimals are checked by the pricing.
 */
export function decimalOf(text: string, scale = 4, maxInt = 12): string | null {
  let s = text.trim().replace(/\s/g, '');
  if (s === '') return null;
  if (s.includes(',') && !s.includes('.')) {
    const parts = s.split(',');
    s =
      parts.length === 2 && parts[1]!.length <= scale ? `${parts[0]}.${parts[1]}` : parts.join('');
  } else s = s.replace(/,/g, '');
  const m = new RegExp(`^(\\d{1,${maxInt}})(?:\\.(\\d{1,${scale}}))?$`).exec(s);
  if (!m) return null;
  return m[2] === undefined ? m[1]! : `${m[1]}.${m[2]}`;
}

/** The rate a line is priced with: the default one for `TAX_DEFAULT` (none when the workspace has none), nothing for `TAX_NONE`. */
export function rateOfLine(
  l: DraftLine,
  rates: readonly TaxRateResponse[],
): TaxRateResponse | null {
  if (l.taxRateId === TAX_NONE || l.taxRateId === TAX_SNAPSHOT) return null;
  if (l.taxRateId === TAX_DEFAULT) return rates.find((r) => r.isDefault && r.isActive) ?? null;
  return rates.find((r) => r.id === l.taxRateId) ?? null;
}

/** The tax a line carries in `rates` mode. */
export function lineTaxOf(l: DraftLine, rates: readonly TaxRateResponse[]): LineTax | null {
  if (l.taxRateId === TAX_SNAPSHOT && l.taxSnapshot) {
    return lineTaxOfRate({
      name: l.taxSnapshot.name || 'Tax',
      rate: l.taxSnapshot.rate,
      inclusive: l.taxSnapshot.inclusive,
      components: l.taxSnapshot.components,
    });
  }
  const r = rateOfLine(l, rates);
  return r ? lineTaxOfRate(r) : null;
}

const lineDiscountOf = (l: DraftLine): { kind: 'percent' | 'amount'; value: string } | null => {
  const v = decimalOf(
    l.discount,
    l.discountKind === 'percent' ? 2 : 4,
    l.discountKind === 'percent' ? 3 : 12,
  );
  return v === null ? null : { kind: l.discountKind, value: v };
};

/**
 * The lines as the request carries them: blank lines dropped, numbers as decimal strings, `taxRateId` ABSENT for the default rate,
 * `null` for no tax. `currency` is accepted for symmetry with the other editors; the server checks the currency's own decimals.
 */
export function linesToInput(
  lines: readonly DraftLine[],
  _currency: string,
  _taxRates: readonly TaxRateResponse[],
): InvoiceLineInput[] {
  return lines
    .filter((l) => !isBlankLine(l))
    .map((l) => {
      const discount = lineDiscountOf(l);
      const hsn = l.hsnSac.trim();
      const sku = l.sku.trim();
      return {
        description: l.description.trim(),
        ...(sku ? { sku } : {}),
        ...(hsn ? { hsnSac: hsn } : {}),
        qty: decimalOf(l.qty, 4, 8) ?? l.qty.trim(),
        unitPrice: decimalOf(l.price) ?? (l.price.trim() === '' ? '0' : l.price.trim()),
        ...(discount && Number(discount.value) > 0 ? { discount } : {}),
        ...(l.taxRateId === TAX_DEFAULT
          ? {}
          : {
              taxRateId:
                l.taxRateId === TAX_NONE || l.taxRateId === TAX_SNAPSHOT ? null : l.taxRateId,
            }),
      };
    });
}

export type LineField = 'description' | 'qty' | 'unitPrice' | 'discount' | 'hsnSac' | 'taxRateId';
export type LineProblem =
  | 'descriptionRequired'
  | 'qtyInvalid'
  | 'priceInvalid'
  | 'lineDiscountInvalid'
  | 'hsnRequired'
  | 'hsnInvalid'
  | 'taxRateRemoved';

/** What is wrong with one line (a blank line has nothing wrong). `requireHsn`: the seller's country asks for an HSN/SAC. */
export function lineProblems(
  l: DraftLine,
  currency: string,
  opts: { requireHsn?: boolean } = {},
): Partial<Record<LineField, LineProblem>> {
  void currency;
  const p: Partial<Record<LineField, LineProblem>> = {};
  if (isBlankLine(l)) return p;
  if (l.description.trim() === '') p.description = 'descriptionRequired';
  const qty = decimalOf(l.qty, 4, 8);
  if (qty === null || (parseQty(qty) ?? 0n) === 0n) p.qty = 'qtyInvalid';
  if (l.price.trim() !== '' && decimalOf(l.price) === null) p.unitPrice = 'priceInvalid';
  if (l.discount.trim() !== '') {
    const d = lineDiscountOf(l);
    if (d === null || (d.kind === 'percent' && Number(d.value) > 100))
      p.discount = 'lineDiscountInvalid';
  }
  const hsn = l.hsnSac.trim();
  if (hsn !== '' && !/^[0-9A-Za-z]{2,12}$/.test(hsn)) p.hsnSac = 'hsnInvalid';
  else if (opts.requireHsn && hsn === '') p.hsnSac = 'hsnRequired';
  if (l.taxRateId === TAX_SNAPSHOT) p.taxRateId = 'taxRateRemoved';
  return p;
}

// --- the document ---------------------------------------------------------------------------------------------------------------

export type TaxMode = 'rates' | 'auto';
export type SupplyKind = 'goods' | 'services' | 'digital';

export interface InvoiceDraft {
  contactId: string | null;
  contactLabel: string;
  companyId: string | null;
  dealId: string | null;
  /** Only set when editing (the owner stays); a new invoice leaves it out and the API assigns the caller. */
  ownerId: string | null;
  docType: 'tax_invoice' | 'proforma';
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  buyerAddress: string;
  buyerTaxId: string;
  /** ISO 3166-1 alpha-2, typed. */
  buyerCountry: string;
  currency: string;
  issueDate: string;
  /** Empty: the profile's default payment terms apply when the invoice is issued. */
  dueDate: string;
  reference: string;
  taxMode: TaxMode;
  supplyType: SupplyKind;
  /** The state or province part of the place of supply ("MH" of "IN-MH"); the country is the buyer's. */
  placeRegion: string;
  reverseCharge: boolean;
  lines: DraftLine[];
  discountKind: 'none' | 'percent' | 'amount';
  /** Typed: a percent ("10") or an amount in major units. */
  discountText: string;
  /** Typed, major units; never discounted or taxed. */
  shipping: string;
  notes: string;
  terms: string;
  legalNotes: string;
}

export function emptyDraft(
  profile: Pick<InvoiceProfile, 'currency' | 'dueDays' | 'terms'> | undefined,
  today: string,
  fallbackCurrency = 'USD',
): InvoiceDraft {
  const days = profile?.dueDays;
  return {
    contactId: null,
    contactLabel: '',
    companyId: null,
    dealId: null,
    ownerId: null,
    docType: 'tax_invoice',
    buyerName: '',
    buyerEmail: '',
    buyerPhone: '',
    buyerAddress: '',
    buyerTaxId: '',
    buyerCountry: '',
    currency: profile?.currency || fallbackCurrency,
    issueDate: today,
    dueDate: days === null || days === undefined ? '' : addDays(today, days),
    reference: '',
    taxMode: 'rates',
    supplyType: 'goods',
    placeRegion: '',
    reverseCharge: false,
    lines: [emptyLine()],
    discountKind: 'none',
    discountText: '',
    shipping: '',
    notes: '',
    terms: profile?.terms ?? '',
    legalNotes: '',
  };
}

/**
 * A saved draft as a working copy. Not in the response (so an edit starts from the defaults): the supply type of an auto invoice.
 * The tax mode comes from the explanation the server keeps for `auto` invoices.
 */
export function draftOf(inv: InvoiceResponse): InvoiceDraft {
  const auto = inv.taxExplanation !== null;
  const place = splitPlace(inv.placeOfSupply);
  const shippingMinor = Number(inv.amountsMinor.shipping);
  return {
    contactId: inv.contact?.id ?? null,
    contactLabel: inv.contact?.name ?? '',
    companyId: inv.company?.id ?? null,
    dealId: inv.deal?.id ?? null,
    ownerId: inv.owner?.id ?? null,
    docType: inv.docType === 'proforma' ? 'proforma' : 'tax_invoice',
    buyerName: inv.buyer.name ?? '',
    buyerEmail: inv.buyer.email ?? '',
    buyerPhone: inv.buyer.phone ?? '',
    buyerAddress: inv.buyer.address ?? '',
    buyerTaxId: inv.buyer.taxId ?? '',
    buyerCountry: inv.buyer.country ?? (place.region ? place.country : ''),
    currency: inv.currency,
    issueDate: inv.issueDate ?? '',
    dueDate: inv.dueDate ?? '',
    reference: inv.reference ?? '',
    taxMode: auto ? 'auto' : 'rates',
    supplyType: 'goods',
    placeRegion: place.region,
    reverseCharge: inv.reverseCharge,
    lines:
      inv.lines.length > 0
        ? inv.lines.map((l) => {
            const taxed = l.taxRate !== '0' && l.taxRate !== '' ? true : !!l.taxName;
            return {
              key: newKey(),
              description: l.description,
              sku: l.sku ?? '',
              hsnSac: l.hsnSac ?? '',
              qty: formatQty(parseQty(l.qty) ?? 1n),
              price: l.unitPrice,
              discountKind: l.discount?.kind ?? 'percent',
              discount: l.discount?.value ?? '',
              taxRateId: l.taxRateId
                ? l.taxRateId
                : auto
                  ? TAX_DEFAULT
                  : taxed
                    ? TAX_SNAPSHOT
                    : TAX_NONE,
              taxSnapshot:
                !l.taxRateId && taxed
                  ? {
                      name: l.taxName ?? '',
                      rate: l.taxRate,
                      inclusive: l.taxInclusive,
                      components:
                        l.taxComponents?.map((c) => ({ type: c.type, rate: c.rate })) ?? null,
                    }
                  : null,
            };
          })
        : [emptyLine()],
    discountKind: inv.discount ? inv.discount.kind : 'none',
    discountText: inv.discount?.value ?? '',
    shipping: shippingMinor > 0 ? inv.amounts.shipping : '',
    notes: inv.notes ?? '',
    terms: inv.terms ?? '',
    legalNotes: inv.legalNotes ?? '',
  };
}

// --- pricing ----------------------------------------------------------------------------------------------------------------------

export interface PricingContext {
  rates: readonly TaxRateResponse[];
  /** The invoicing profile (seller country and state for auto tax). */
  profile: Pick<InvoiceProfile, 'sellerCountry' | 'sellerState' | 'sellerTaxId'> | undefined;
  /** Today in the workspace calendar: the supply date when the draft has no issue date. */
  today: string;
}

export interface DraftPricing {
  result: PricingResult;
  /** The tax engine's live reasoning (auto mode only). */
  auto: AutoTaxOutcome | null;
  /** The draft index of each priced line (blank lines are not priced). */
  used: number[];
  /** The tax each priced line carries (null: none). */
  taxes: Array<LineTax | null>;
  /** Reverse charge applies: set by the person, or decided by the engine in auto mode. */
  reverseCharge: boolean;
}

export const usedIndexes = (lines: readonly DraftLine[]): number[] =>
  lines.flatMap((l, i) => (isBlankLine(l) ? [] : [i]));

export const placeOfSupplyOfDraft = (
  d: InvoiceDraft,
  sellerCountry: string | null | undefined,
): string | null => placeOfSupplyOf(d.buyerCountry || sellerCountry, d.placeRegion);

/** Prices the draft: `computeInvoice` for the figures, `resolveTaxForLine` for the taxes of an auto invoice. */
export function pricingOf(draft: InvoiceDraft, ctx: PricingContext): DraftPricing {
  const used = usedIndexes(draft.lines);
  const lines = used.map((i) => draft.lines[i]!);
  let auto: AutoTaxOutcome | null = null;
  let taxes: Array<LineTax | null>;
  if (draft.taxMode === 'auto') {
    auto = previewAutoTax(
      {
        sellerCountry: ctx.profile?.sellerCountry ?? null,
        sellerState: ctx.profile?.sellerState ?? null,
        sellerTaxId: ctx.profile?.sellerTaxId ?? null,
        buyerCountry: draft.buyerCountry.trim() || null,
        buyerTaxId: draft.buyerTaxId.trim() || null,
        placeOfSupply: placeOfSupplyOfDraft(draft, ctx.profile?.sellerCountry),
        supplyType: draft.supplyType,
        date: isDay(draft.issueDate) ? draft.issueDate : ctx.today,
      },
      lines.map((l) => ({
        hsnSac: l.hsnSac.trim() || null,
        ratePercent:
          l.taxRateId === TAX_DEFAULT || l.taxRateId === TAX_NONE || l.taxRateId === TAX_SNAPSHOT
            ? null
            : slabPercentOf(ctx.rates.find((r) => r.id === l.taxRateId)),
      })),
    );
    taxes = auto.ok ? auto.preview.lines : lines.map(() => null);
  } else {
    taxes = lines.map((l) => lineTaxOf(l, ctx.rates));
  }
  const reverseCharge = draft.reverseCharge || (auto?.ok === true && auto.preview.reverseCharge);
  const docDiscount =
    draft.discountKind === 'none'
      ? null
      : (() => {
          const v = decimalOf(
            draft.discountText,
            draft.discountKind === 'percent' ? 2 : 4,
            draft.discountKind === 'percent' ? 3 : 12,
          );
          return v === null || Number(v) === 0 ? null : { kind: draft.discountKind, value: v };
        })();
  const result = priceInvoice({
    currency: draft.currency,
    discount: docDiscount,
    shipping: decimalOf(draft.shipping),
    reverseCharge,
    lines: lines.map((l, i) => ({
      qty: decimalOf(l.qty, 4, 8) ?? '0',
      unitPrice: decimalOf(l.price) ?? '0',
      discount: lineDiscountOf(l),
      tax: taxes[i] ?? null,
    })),
  });
  return { result, auto, used, taxes, reverseCharge };
}

// --- problems ---------------------------------------------------------------------------------------------------------------------

export type Problem =
  | LineProblem
  | 'currencyInvalid'
  | 'issueDateInvalid'
  | 'dueBeforeIssue'
  | 'dueInvalid'
  | 'noLines'
  | 'discountInvalid'
  | 'shippingInvalid'
  | 'emailInvalid'
  | 'amountZero'
  | 'amountInvalid'
  | 'contactRequired'
  | 'countryInvalid'
  | 'regionInvalid'
  | 'autoNeedsSellerCountry';

/** Problems by field path (`buyerEmail`, `lines.2.qty`, `discount`): the same paths the API and `computeInvoice` use. */
export type DraftProblems = Record<string, Problem>;

export const hasProblems = (p: DraftProblems): boolean => Object.keys(p).length > 0;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ValidateOptions {
  mode: 'draft' | 'issue';
  /** The seller's country asks for an HSN/SAC on each line. */
  requireHsn: boolean;
  sellerCountry: string | null | undefined;
}

/**
 * What is wrong with a draft, by path. Saving a draft is lenient (a half-built invoice may be kept, as long as it has one line);
 * issuing needs a buyer and a positive total too, because an issued invoice is frozen and numbered. A tax id that fails its checksum is NOT a problem here
 * (the form warns; the engine's check does not prove or disprove a registration).
 */
export function validateDraft(
  draft: InvoiceDraft,
  pricing: DraftPricing,
  opts: ValidateOptions,
): DraftProblems {
  const out: DraftProblems = {};
  if (!/^[A-Za-z]{3}$/.test(draft.currency.trim())) out.currency = 'currencyInvalid';
  // Empty is allowed: a draft made from an order or a schedule has no date yet, and issuing dates it that day.
  if (draft.issueDate !== '' && !isDay(draft.issueDate)) out.issueDate = 'issueDateInvalid';
  if (draft.dueDate !== '') {
    if (!isDay(draft.dueDate)) out.dueDate = 'dueInvalid';
    else if (isDay(draft.issueDate) && draft.dueDate < draft.issueDate)
      out.dueDate = 'dueBeforeIssue';
  }
  if (draft.buyerEmail.trim() !== '' && !EMAIL.test(draft.buyerEmail.trim()))
    out.buyerEmail = 'emailInvalid';
  if (draft.buyerCountry.trim() !== '' && !/^[A-Za-z]{2}$/.test(draft.buyerCountry.trim()))
    out.buyerCountry = 'countryInvalid';
  if (draft.placeRegion.trim() !== '' && !/^[A-Za-z0-9]{1,3}$/.test(draft.placeRegion.trim()))
    out.placeRegion = 'regionInvalid';
  if (draft.discountKind !== 'none' && draft.discountText.trim() !== '') {
    const d = decimalOf(
      draft.discountText,
      draft.discountKind === 'percent' ? 2 : 4,
      draft.discountKind === 'percent' ? 3 : 12,
    );
    if (d === null || (draft.discountKind === 'percent' && Number(d) > 100))
      out.discount = 'discountInvalid';
  }
  if (draft.shipping.trim() !== '' && decimalOf(draft.shipping) === null)
    out.shipping = 'shippingInvalid';
  if (opts.mode === 'issue' && !draft.contactId && draft.buyerName.trim() === '')
    out.buyerName = 'contactRequired';
  if (
    draft.taxMode === 'auto' &&
    pricing.auto &&
    !pricing.auto.ok &&
    pricing.auto.reason !== 'failed'
  ) {
    out.taxMode = 'autoNeedsSellerCountry';
  }

  const used = usedIndexes(draft.lines);
  // The API keeps no invoice without a line (a draft included).
  if (used.length === 0) out.lines = 'noLines';
  for (const i of used) {
    const lp = lineProblems(draft.lines[i]!, draft.currency, { requireHsn: opts.requireHsn });
    for (const [field, problem] of Object.entries(lp)) {
      // The removed-rate and missing-HSN notes only stop an issue: a draft may keep them while the person decides.
      if (opts.mode === 'draft' && (problem === 'taxRateRemoved' || problem === 'hsnRequired'))
        continue;
      out[`lines.${i}.${field}`] = problem!;
    }
  }
  if (!hasProblems(out)) {
    const r = pricing.result;
    if (!r.ok) Object.assign(out, issuesToProblems(r.issues, pricing.used));
    else if (opts.mode === 'issue' && r.totals.totalMinor <= 0) out.lines = 'amountZero';
  }
  return out;
}

/**
 * `computeInvoice` issues (paths over the priced lines) as problems on the draft's own paths: `lines.0.unitPrice` of the first
 * priced line is the draft line it came from.
 */
export function issuesToProblems(
  issues: readonly InvoiceIssue[],
  used: readonly number[],
): DraftProblems {
  const out: DraftProblems = {};
  for (const issue of issues) {
    const m = /^lines\.(\d+)\.(\w+)$/.exec(issue.path);
    if (m) {
      const draftIndex = used[Number(m[1])] ?? Number(m[1]);
      const field = m[2] === 'taxRate' ? 'taxRateId' : m[2]!;
      const problem: Problem =
        field === 'qty'
          ? 'qtyInvalid'
          : field === 'unitPrice'
            ? 'priceInvalid'
            : field === 'discount'
              ? 'lineDiscountInvalid'
              : 'amountInvalid';
      out[`lines.${draftIndex}.${field}`] = problem;
    } else if (issue.path === 'discount') out.discount = 'discountInvalid';
    else if (issue.path === 'shipping') out.shipping = 'shippingInvalid';
    else if (issue.path === 'lines' && /at least one/.test(issue.message)) out.lines = 'noLines';
    else out[issue.path || 'lines'] = 'amountInvalid';
  }
  return out;
}

/** The server's field errors (`lines.1.taxRateId`, `discount` ...) on the draft's paths; the messages stay the server's English words, the paths are what matter. */
export const serverPath = (path: string, used: readonly number[]): string => {
  const m = /^lines\.(\d+)(\..+)?$/.exec(path);
  if (!m) return path;
  return `lines.${used[Number(m[1])] ?? Number(m[1])}${m[2] ?? ''}`;
};

// --- the request ---------------------------------------------------------------------------------------------------------------------

/**
 * The request body of a create, and (with `rowVersion`) of an update: a draft is edited whole, so every field goes, empty ones as
 * `null`. `ownerId` is left out unless the draft has one (an edit keeps the owner; a new invoice belongs to the caller).
 */
export function draftToBody(
  draft: InvoiceDraft,
  rates: readonly TaxRateResponse[],
  sellerCountry?: string | null,
): CreateInvoiceInput {
  const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());
  const disc =
    draft.discountKind === 'none'
      ? null
      : (() => {
          const v = decimalOf(
            draft.discountText,
            draft.discountKind === 'percent' ? 2 : 4,
            draft.discountKind === 'percent' ? 3 : 12,
          );
          return v === null || Number(v) === 0 ? null : { kind: draft.discountKind, value: v };
        })();
  const country = orNull(draft.buyerCountry);
  const auto = draft.taxMode === 'auto';
  return {
    docType: draft.docType,
    contactId: draft.contactId,
    companyId: draft.companyId,
    dealId: draft.dealId,
    ...(draft.ownerId ? { ownerId: draft.ownerId } : {}),
    buyerName: orNull(draft.buyerName),
    buyerEmail: orNull(draft.buyerEmail),
    buyerPhone: orNull(draft.buyerPhone),
    buyerAddress: orNull(draft.buyerAddress),
    buyerTaxId: orNull(draft.buyerTaxId),
    buyerCountry: country ? country.toUpperCase() : null,
    currency: draft.currency.trim().toUpperCase(),
    taxMode: draft.taxMode,
    supplyType: draft.supplyType,
    placeOfSupply:
      auto || draft.placeRegion.trim() ? placeOfSupplyOfDraft(draft, sellerCountry) : null,
    reverseCharge: draft.reverseCharge,
    issueDate: orNull(draft.issueDate),
    dueDate: orNull(draft.dueDate),
    reference: orNull(draft.reference),
    discount: disc,
    shipping: decimalOf(draft.shipping),
    notes: orNull(draft.notes),
    terms: orNull(draft.terms),
    legalNotes: orNull(draft.legalNotes),
    lines: linesToInput(draft.lines, draft.currency, rates),
  };
}

/** Same working copy field for field, used to tell whether the person changed anything (leave-page guard). */
export function isSameDraft(a: InvoiceDraft, b: InvoiceDraft): boolean {
  const strip = (d: InvoiceDraft) => ({
    ...d,
    lines: d.lines.map(({ key: _key, ...rest }) => rest),
  });
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

/** Prefill a buyer from a contact (the picker, `?contact=`): keeps what the person already typed. */
export function withContact(
  d: InvoiceDraft,
  c: { id: string; label: string; email?: string | null; phone?: string | null } | null,
): InvoiceDraft {
  if (!c) return { ...d, contactId: null, contactLabel: '' };
  return {
    ...d,
    contactId: c.id,
    contactLabel: c.label,
    buyerName: c.label,
    buyerEmail: c.email ?? d.buyerEmail,
    buyerPhone: c.phone ?? d.buyerPhone,
  };
}

/** The live check of the buyer's tax id for the form (never a reason to refuse a save). */
export const taxIdCheckOf = (d: InvoiceDraft, sellerCountry: string | null | undefined) =>
  checkBuyerTaxId(d.buyerCountry.trim() || null, sellerCountry, d.buyerTaxId);
