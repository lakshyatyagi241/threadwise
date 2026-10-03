import type { CompanyActivityEntry } from '@crm/contracts';

/** The fields an activity entry can name, with the message key of the label that goes with each. */
export const FIELD_LABELS = {
  name: 'name',
  website: 'website',
  email: 'email',
  phone: 'phone',
  industry: 'industry',
  sizeRange: 'sizeRange',
  address: 'address',
  notes: 'notes',
  owner: 'owner',
} as const;

export type FieldKey = keyof typeof FIELD_LABELS;
export const isFieldKey = (f: string): f is FieldKey => f in FIELD_LABELS;

/** One line of the activity card, in the shape the screen renders (it adds the words). */
export type ChangeView =
  | { kind: 'field'; field: FieldKey; old: string | null; new: string | null }
  | { kind: 'contactLinked' | 'contactUnlinked'; contact: { id: string; name: string | null } }
  | { kind: 'other'; field: string };

const asText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? v : String(v);
};

const asContact = (v: unknown): { id: string; name: string | null } | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as { id?: unknown; name?: unknown };
  return typeof o.id === 'string'
    ? { id: o.id, name: typeof o.name === 'string' ? o.name : null }
    : null;
};

/** The raw changes of one entry as lines the screen can word; a field it does not know is kept as `other`, never dropped. */
export function changeViews(entry: Pick<CompanyActivityEntry, 'changes'>): ChangeView[] {
  const out: ChangeView[] = [];
  for (const c of entry.changes) {
    if (isFieldKey(c.field)) {
      out.push({ kind: 'field', field: c.field, old: asText(c.old), new: asText(c.new) });
    } else if (c.field === 'contactLinked' || c.field === 'contactUnlinked') {
      const contact = asContact(c.field === 'contactLinked' ? c.new : c.old);
      if (contact) out.push({ kind: c.field, contact });
    } else {
      out.push({ kind: 'other', field: c.field });
    }
  }
  return out;
}
