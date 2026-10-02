import { currencyExponent } from '../money/currency';
import type { ChecklistCondition, ChecklistItem, TaxProfile } from './types';

/**
 * Legal invoice-fields checklist. `fields` maps the checklist vocabulary (`document_title`, `invoice_number`, `seller_tax_id`,
 * `line_hsn_sac`, `place_of_supply`, `reverse_charge_wording`, ...) to what the document has: `true`, or the actual text for fields
 * with a mandatory wording. Absent / false / empty string = missing.
 */
export interface InvoiceFacts {
  fields: Readonly<Record<string, boolean | string | undefined>>;
}

export interface ComplianceContext {
  b2b?: boolean;
  reverseCharge?: boolean;
  export?: boolean;
  interState?: boolean;
  composition?: boolean;
  /** The document carries zero-rated or exempt lines. */
  exemptOrZero?: boolean;
  /** Document total in minor units, for amount thresholds. */
  totalMinor?: bigint;
  currency?: string;
}

export interface ComplianceIssue {
  field: string;
  label: string;
  level: 'required' | 'recommended';
  problem: 'missing' | 'wrong_text';
  expected?: string;
}

function applies(item: ChecklistItem, ctx: ComplianceContext, currency: string): boolean {
  const c: ChecklistCondition = item.when;
  switch (c) {
    case 'always':
      return true;
    case 'b2b':
      return ctx.b2b === true;
    case 'b2c':
      return ctx.b2b !== true;
    case 'reverse_charge':
      return ctx.reverseCharge === true;
    case 'export':
      return ctx.export === true;
    case 'inter_state':
      return ctx.interState === true;
    case 'intra_state':
      return ctx.interState === false;
    case 'composition':
      return ctx.composition === true;
    case 'exempt_or_zero':
      return ctx.exemptOrZero === true;
    case 'above_threshold': {
      if (ctx.totalMinor === undefined || !item.thresholdMajor) return true;
      const threshold = BigInt(item.thresholdMajor) * 10n ** BigInt(currencyExponent(currency));
      return ctx.totalMinor >= threshold;
    }
    default:
      return false;
  }
}

/** The checklist items that apply to a document in this context (for showing a "what must be on this invoice" panel). */
export function applicableChecklist(
  profile: TaxProfile,
  ctx: ComplianceContext = {},
): ChecklistItem[] {
  const currency = ctx.currency ?? profile.currency;
  return profile.checklist.filter((i) => applies(i, ctx, currency));
}

/** What is missing from a document, per the profile's checklist. Not legal advice: a preset to verify. */
export function checkInvoiceCompliance(
  profile: TaxProfile,
  facts: InvoiceFacts,
  ctx: ComplianceContext = {},
): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  for (const item of applicableChecklist(profile, ctx)) {
    const v = facts.fields[item.field];
    const present = typeof v === 'string' ? v.trim().length > 0 : v === true;
    if (!present) {
      issues.push({
        field: item.field,
        label: item.label,
        level: item.level,
        problem: 'missing',
        ...(item.mustContain ? { expected: item.mustContain } : {}),
      });
      continue;
    }
    if (
      item.mustContain &&
      typeof v === 'string' &&
      !v.toLowerCase().includes(item.mustContain.toLowerCase())
    ) {
      issues.push({
        field: item.field,
        label: item.label,
        level: item.level,
        problem: 'wrong_text',
        expected: item.mustContain,
      });
    }
  }
  return issues;
}
