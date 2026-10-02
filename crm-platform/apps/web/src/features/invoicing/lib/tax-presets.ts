import type { TaxPresetRow } from '@crm/contracts';

/** Is the preset row in force on `asOf` (`YYYY-MM-DD`)? Both ends of its window are inclusive. */
export const inForce = (row: Pick<TaxPresetRow, 'effectiveFrom' | 'effectiveTo'>, asOf: string): boolean =>
  row.effectiveFrom <= asOf && (row.effectiveTo === null || row.effectiveTo >= asOf);

/** The rows ticked at first: those in force that the workspace does not have yet. */
export function defaultPicked(rows: readonly TaxPresetRow[], asOf: string): Set<string> {
  return new Set(rows.filter((r) => !r.exists && inForce(r, asOf)).map((r) => r.code));
}

/** The codes to send, in the order of the list, skipping rows that already exist. */
export const codesToApply = (rows: readonly TaxPresetRow[], picked: ReadonlySet<string>): string[] =>
  rows.filter((r) => picked.has(r.code) && !r.exists).map((r) => r.code);

/** Does any picked row carry the country's default (standard) rate? Then the "set default" switch means something. */
export const pickedHasDefault = (rows: readonly TaxPresetRow[], picked: ReadonlySet<string>): boolean =>
  rows.some((r) => r.isDefault && picked.has(r.code) && !r.exists);
