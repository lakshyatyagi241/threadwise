import { COMPANY_NAME_MAX, type CompanySelectItem } from '@crm/contracts';

/** A company as a form holds it: its id, and its name when the form already has it (otherwise the picker reads it). */
export interface CompanyRef {
  id: string;
  name?: string | null;
}

/** One row of the open list: a company to pick, or "create this name" (the last row). */
export type PickerOption =
  | { kind: 'company'; id: string; name: string; industry: string | null }
  | { kind: 'create'; name: string };

/**
 * What the list offers for the text typed. The companies are the search hits as they came. "Create" is offered, last, only when
 * the person may create companies, the text is a usable name (not blank, not longer than a name may be) and no hit has exactly
 * that name (compared case-insensitively): offering to make a second "Acme" next to the one in the list would invite a duplicate.
 * `settled` says the hits are for this very text (the search waits 250 ms after typing stops), so a stale list never decides it.
 */
export function pickerOptions(
  hits: readonly CompanySelectItem[],
  text: string,
  opts: { canCreate: boolean; settled: boolean },
): PickerOption[] {
  const rows: PickerOption[] = hits.map((h) => ({
    kind: 'company',
    id: h.id,
    name: h.name,
    industry: h.industry,
  }));
  const name = text.trim();
  if (
    opts.canCreate &&
    opts.settled &&
    name !== '' &&
    name.length <= COMPANY_NAME_MAX &&
    !hits.some((h) => h.name.trim().toLowerCase() === name.toLowerCase())
  ) {
    rows.push({ kind: 'create', name });
  }
  return rows;
}

/** The highlighted row after an arrow key: wraps at both ends; -1 (nothing highlighted yet) goes to the first or last row. */
export function moveActive(current: number, delta: 1 | -1, length: number): number {
  if (length <= 0) return -1;
  if (current < 0) return delta === 1 ? 0 : length - 1;
  return (current + delta + length) % length;
}
