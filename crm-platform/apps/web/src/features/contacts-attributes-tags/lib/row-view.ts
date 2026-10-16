import type { ContactRow, RowTag } from '../api/schemas';
import { channelOptIn, type OptIn } from './subscription';
import {
  attributeChips,
  displayName,
  EXTRA_KEYS,
  formatPhone,
  isOptedOut,
  type AttributeChip,
} from './contact-model';

/** Everything a list row or card needs, resolved once so the table and the grid cannot drift apart (TW-CON-008). */
export interface RowView {
  id: string;
  name: string;
  language: string;
  email: string;
  phone: string;
  memo: string;
  status: string;
  stage: string;
  /** The owner's id, or null when the contact belongs to nobody. */
  ownerId: string | null;
  /** The company's id, or null; its name is looked up by the cell (one cached request per company). */
  companyId: string | null;
  optedOut: boolean;
  /** WhatsApp, SMS and email opt-in, from the contact's subscription labels and its opt-out flag. */
  whatsappOptIn: OptIn;
  smsOptIn: OptIn;
  emailOptIn: OptIn;
  /** Where the contact came from: the source column, else the legacy custom value. */
  source: string;
  /** ISO timestamp of the last note, activity or meeting; null when there was none. */
  lastActivityAt: string | null;
  groups: Array<{ id: string; name: string; color: string | null }>;
  tags: RowTag[];
  attributes: AttributeChip[];
  /** Every custom attribute value of the contact as display text, by key (for the attribute columns). */
  custom: Record<string, string>;
  /** `YYYY-MM-DD` or null (BL-217). */
  dateOfBirth: string | null;
  /** Flagged as a minor (BL-190). */
  isMinor: boolean;
  /** ISO timestamp the contact was created. */
  createdAt: string;
  /** The lead score and who set it ('ai' = the AI lead scorer); null when the contact has none. */
  leadScore: number | null;
  leadScoreSource: 'manual' | 'ai' | null;
  leadScoredAt: string | null;
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** Scalar custom values as text (booleans, numbers, strings); objects and empty values are left out. */
export function customValues(fields: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string' && value.trim() !== '') out[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = String(value);
  }
  return out;
}

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
    ownerId: row.ownerId ?? null,
    companyId: row.companyId ?? null,
    optedOut: isOptedOut(row),
    whatsappOptIn: channelOptIn(row, 'whatsapp'),
    smsOptIn: channelOptIn(row, 'sms'),
    emailOptIn: channelOptIn(row, 'email'),
    source: (row.source ?? text(row.customFields[EXTRA_KEYS.source])).trim(),
    lastActivityAt: row.lastActivityAt ?? null,
    // The list asks for `expand=groups,tags`, so the chips arrive with the row (a deleted group simply is not there).
    groups: (row.groups ?? []).map((g) => ({ id: g.id, name: g.name, color: g.color })),
    tags: row.tags ?? [],
    attributes: attributeChips(row.customFields, attributeLabels),
    custom: customValues(row.customFields),
    dateOfBirth: row.dateOfBirth,
    isMinor: row.isMinor,
    createdAt: row.createdAt,
    leadScore: row.leadScore,
    leadScoreSource: row.leadScoreSource,
    leadScoredAt: row.leadScoredAt,
  };
}
