import type { ContactRow, RowTag } from '../api/schemas';
import {
  attributeChips,
  displayName,
  EXTRA_KEYS,
  formatPhone,
  isOptedOut,
  type AttributeChip,
} from './contact-model';

/** Everything a list row or card needs, resolved once so the table and the grid cannot drift apart (WD-CON-008). */
export interface RowView {
  id: string;
  name: string;
  language: string;
  email: string;
  phone: string;
  memo: string;
  status: string;
  stage: string;
  optedOut: boolean;
  groups: Array<{ id: string; name: string; color: string | null }>;
  tags: RowTag[];
  attributes: AttributeChip[];
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');

export function rowView(row: ContactRow, attributeLabels: ReadonlyMap<string, string>): RowView {
  return {
    id: row.id,
    name: displayName(row),
    language: text(row.customFields[EXTRA_KEYS.language]),
    email: row.email ?? '',
    phone: formatPhone(row.phone),
    memo: text(row.customFields[EXTRA_KEYS.memo]),
    status: row.status ?? '',
    stage: row.lifecycleStage ?? '',
    optedOut: isOptedOut(row),
    // The list asks for `expand=groups,tags`, so the chips arrive with the row (a deleted group simply is not there).
    groups: (row.groups ?? []).map((g) => ({ id: g.id, name: g.name, color: g.color })),
    tags: row.tags ?? [],
    attributes: attributeChips(row.customFields, attributeLabels),
  };
}
