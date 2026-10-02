import type { DocItem, PublicDoc, SalesDoc } from '../api/schemas';
import { docDiscountOf, draftTotals, isBlankLine, lineInputs, type Draft } from './builder';
import type { SalesDocKind } from './kinds';
import type { DocStatus } from './status';
import type { DocDiscount, TaxGroup } from './totals';

/**
 * Everything the printed document shows, in one flat shape. The builder's live preview, the staff view of a saved document,
 * the print sheet and the buyer's page all draw the same paper from this model, so what the person sees while typing is what
 * the buyer receives. A saved document's figures are the server's own (it priced them with the same function the preview uses);
 * only the draft's are computed here.
 */
export interface PaperSeller {
  name: string;
  logoUrl: string | null;
  address: string;
  taxId: string;
}

export interface PaperLine {
  description: string;
  qty: string;
  unitPriceMinor: number;
  discount: DocDiscount;
  /** The rate applied to the line, in basis points. */
  taxRateBp: number;
  /** After the line discount, before tax. */
  netMinor: number;
}

export interface PaperDoc {
  kind: SalesDocKind;
  number: string;
  title: string;
  status: DocStatus;
  validUntil: string | null;
  issuedAt: string | null;
  currency: string;
  seller: PaperSeller;
  buyer: { name: string; company: string; email: string; phone: string };
  lines: PaperLine[];
  subtotalMinor: number;
  discount: DocDiscount;
  discountMinor: number;
  taxGroups: TaxGroup[];
  taxMinor: number;
  totalMinor: number;
  notes: string;
  terms: string;
}

/** One tax row per rate, from the server's own per-line tax. */
function groupsOf(items: readonly DocItem[]): TaxGroup[] {
  const groups = new Map<number, TaxGroup>();
  for (const i of items) {
    const g = groups.get(i.effectiveTaxBp) ?? {
      rateBp: i.effectiveTaxBp,
      baseMinor: 0,
      taxMinor: 0,
    };
    g.baseMinor += i.netMinor;
    g.taxMinor += i.taxMinor;
    groups.set(i.effectiveTaxBp, g);
  }
  return [...groups.values()].filter((g) => g.taxMinor > 0);
}

const lineOf = (i: DocItem): PaperLine => ({
  description: i.description,
  qty: i.qty,
  unitPriceMinor: i.unitPriceMinor,
  discount: i.discount,
  taxRateBp: i.effectiveTaxBp,
  netMinor: i.netMinor,
});

export function paperFromDoc(doc: SalesDoc, seller: PaperSeller): PaperDoc {
  return {
    kind: doc.kind,
    number: doc.number,
    title: doc.title,
    status: doc.status,
    validUntil: doc.validUntil,
    issuedAt: doc.sentAt ?? doc.createdAt,
    currency: doc.currency,
    seller,
    buyer: {
      name: doc.buyer.name,
      company: doc.company?.name ?? '',
      email: doc.buyer.email,
      phone: doc.buyer.phone,
    },
    lines: doc.items.map(lineOf),
    subtotalMinor: doc.subtotalMinor,
    discount: doc.discount,
    discountMinor: doc.discountMinor,
    taxGroups: groupsOf(doc.items),
    taxMinor: doc.taxMinor,
    totalMinor: doc.totalMinor,
    notes: doc.notes,
    terms: doc.terms,
  };
}

export function paperFromPublic(doc: PublicDoc): PaperDoc {
  return {
    kind: doc.kind,
    number: doc.number,
    title: doc.title,
    status: doc.status,
    validUntil: doc.validUntil,
    issuedAt: doc.sentAt,
    currency: doc.currency,
    seller: { name: doc.seller.name, logoUrl: null, address: '', taxId: '' },
    // The buyer's own email and phone are not sent back to a link holder (TW-PROP-014 / D-16).
    buyer: { name: doc.buyer.name, company: doc.buyer.company, email: '', phone: '' },
    lines: doc.items.map(lineOf),
    subtotalMinor: doc.subtotalMinor,
    discount: doc.discount,
    discountMinor: doc.discountMinor,
    taxGroups: groupsOf(doc.items),
    taxMinor: doc.taxMinor,
    totalMinor: doc.totalMinor,
    notes: doc.notes,
    terms: doc.terms,
  };
}

/** The live preview: the form's current values, priced here with the shared function. */
export function paperFromDraft(
  d: Draft,
  ctx: {
    kind: SalesDocKind;
    number: string;
    status: DocStatus;
    seller: PaperSeller;
    issuedAt: string | null;
  },
): PaperDoc {
  const totals = draftTotals(d);
  const inputs = lineInputs(d);
  const rows = d.lines.filter((l) => !isBlankLine(l));
  return {
    kind: ctx.kind,
    number: ctx.number,
    title: d.title.trim(),
    status: ctx.status,
    validUntil: d.validUntil || null,
    issuedAt: ctx.issuedAt,
    currency: d.currency,
    seller: ctx.seller,
    buyer: {
      name: d.buyerName.trim(),
      company: '',
      email: d.buyerEmail.trim(),
      phone: d.buyerPhone.trim(),
    },
    lines: rows.map((l, n) => ({
      description: l.description.trim(),
      qty: l.qty,
      unitPriceMinor: inputs[n]!.unitPriceMinor,
      discount: inputs[n]!.discount,
      taxRateBp: totals.lines[n]!.taxBp,
      netMinor: totals.lines[n]!.netMinor,
    })),
    subtotalMinor: totals.subtotalMinor,
    discount: docDiscountOf(d),
    discountMinor: totals.discountMinor,
    taxGroups: totals.taxGroups,
    taxMinor: totals.taxMinor,
    totalMinor: totals.totalMinor,
    notes: d.notes.trim(),
    terms: d.terms.trim(),
  };
}
