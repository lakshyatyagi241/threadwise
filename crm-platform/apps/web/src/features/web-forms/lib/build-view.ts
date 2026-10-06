import { FORM_FIELD_KINDS, type CrmProperty, type FieldBlock, type FieldKind } from './types';

/** The kinds the palette offers as plain "new field" buttons, in the order a person looks for them. `hidden` has its own group. */
export const PALETTE_KINDS: readonly FieldKind[] = FORM_FIELD_KINDS.filter((k) => k !== 'hidden');

/** The kinds a plain (unbound) field may be switched to without losing what it holds: text-like with text-like, choice with choice. */
const KIND_FAMILIES: ReadonlyArray<ReadonlySet<FieldKind>> = [
  new Set<FieldKind>(['short_text', 'long_text', 'email', 'phone']),
  new Set<FieldKind>(['number', 'currency', 'rating']),
  new Set<FieldKind>(['dropdown', 'radio', 'checkbox_group']),
  new Set<FieldKind>(['date']),
  new Set<FieldKind>(['checkbox']),
];

/** The kinds this field can change into: its own family. A field bound to a CRM property keeps the property's kind. */
export function kindChoices(f: Pick<FieldBlock, 'kind' | 'bind'>): FieldKind[] {
  if (f.bind || f.kind === 'hidden') return [f.kind];
  const family = KIND_FAMILIES.find((s) => s.has(f.kind));
  return family ? [...family] : [f.kind];
}

/** Which controls the inspector shows for a kind. */
export function kindTraits(kind: FieldKind): {
  placeholder: boolean;
  options: boolean;
  textLimits: boolean;
  pattern: boolean;
  range: boolean;
  required: boolean;
} {
  const text = kind === 'short_text' || kind === 'long_text';
  return {
    placeholder:
      text ||
      kind === 'email' ||
      kind === 'phone' ||
      kind === 'number' ||
      kind === 'currency' ||
      kind === 'dropdown',
    options: kind === 'dropdown' || kind === 'radio' || kind === 'checkbox_group',
    textLimits: text,
    pattern: kind === 'short_text',
    range: kind === 'number' || kind === 'currency',
    required: kind !== 'hidden',
  };
}

export interface PropertyGroup {
  object: CrmProperty['object'];
  items: CrmProperty[];
}

/** The picker's list, filtered by the search words (label, key) and grouped Contact then Company; required properties first. */
export function groupProperties(
  properties: readonly CrmProperty[],
  query: string,
): PropertyGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (p: CrmProperty) => {
    const hay = `${p.label} ${p.property}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  return (['contact', 'company'] as const)
    .map((object) => ({
      object,
      items: properties
        .filter((p) => p.object === object && match(p))
        .sort(
          (a, b) =>
            Number(b.requiredByWorkspace) - Number(a.requiredByWorkspace) ||
            a.label.localeCompare(b.label),
        ),
    }))
    .filter((g) => g.items.length > 0);
}

export function findProperty(
  properties: readonly CrmProperty[],
  bind: { object: string; property: string } | undefined,
): CrmProperty | null {
  if (!bind) return null;
  return properties.find((p) => p.object === bind.object && p.property === bind.property) ?? null;
}

/** A short text of a block for the list: the label, or the heading text, or the start of the paragraph, or the divider's name. */
export function blockTitle(
  b: { type: string; label?: string; text?: string; html?: string },
  fallback: { divider: string; paragraph: string },
): string {
  if (b.type === 'field') return b.label ?? '';
  if (b.type === 'heading') return b.text ?? '';
  if (b.type === 'paragraph') {
    const plain = (b.html ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return plain ? (plain.length > 80 ? `${plain.slice(0, 77)}...` : plain) : fallback.paragraph;
  }
  return fallback.divider;
}
