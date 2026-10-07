import {
  WIZARD_CONTACT_FIELDS,
  WIZARD_TEMPLATE_CATEGORIES,
  type WizardTemplate,
  type WizardTemplateSlot,
  type WizardVariables,
} from '@crm/contracts';
import type { PreviewModel } from '@/features/message-templates/lib/form-model';

export type TemplateCategory = (typeof WIZARD_TEMPLATE_CATEGORIES)[number];

export interface TemplateFilters {
  q: string;
  language: string;
  category: TemplateCategory | '';
}
export const NO_FILTERS: TemplateFilters = { q: '', language: '', category: '' };

/** Client-side filter over the approved templates: name and body text, language, category. */
export function filterTemplates(
  list: readonly WizardTemplate[],
  f: TemplateFilters,
): WizardTemplate[] {
  const q = f.q.trim().toLowerCase();
  return list.filter(
    (t) =>
      (f.language === '' || t.language === f.language) &&
      (f.category === '' || t.category === f.category) &&
      (q === '' || t.name.toLowerCase().includes(q) || t.body.toLowerCase().includes(q)),
  );
}

/** The languages the templates are written in, for the filter (most used first). */
export function languageOptions(list: readonly WizardTemplate[]): string[] {
  const n = new Map<string, number>();
  for (const t of list) n.set(t.language, (n.get(t.language) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l);
}

export const isFiltered = (f: TemplateFilters): boolean =>
  f.q.trim() !== '' || f.language !== '' || f.category !== '';

/** A short plain-text excerpt of the body for a card. */
export function snippet(body: string, max = 110): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

const BUTTON_KINDS: Record<string, PreviewModel['buttons'][number]['kind']> = {
  URL: 'url',
  PHONE_NUMBER: 'phone',
  COPY_CODE: 'copy_code',
  QUICK_REPLY: 'quick_reply',
};

/** What the existing WhatsApp bubble draws, from a template as the wizard lists it. Placeholders stay as `{{n}}` (shown as pills). */
export function previewModelOf(t: WizardTemplate): PreviewModel {
  const media =
    t.attachmentType === 'image' || t.attachmentType === 'video' || t.attachmentType === 'document'
      ? t.attachmentType
      : null;
  const headerKind: PreviewModel['headerKind'] = media
    ? media
    : t.attachmentType === 'location'
      ? 'location'
      : t.header
        ? 'text'
        : 'none';
  return {
    auth: t.category === 'authentication',
    language: t.language,
    headerKind,
    headerText: headerKind === 'text' ? (t.header ?? '') : '',
    headerImageUrl: media === 'image' && t.attachmentUrl ? t.attachmentUrl : null,
    body: t.body,
    footer: t.footer ?? '',
    buttons: t.buttons.map((b) => ({
      kind: BUTTON_KINDS[String(b['type'] ?? '').toUpperCase()] ?? 'quick_reply',
      text: typeof b['text'] === 'string' ? b['text'] : '',
    })),
    expiry: null,
  };
}

/** The same message with what a contact would read (the sample of step 3): values replace the placeholders. */
export function previewModelWithText(
  t: WizardTemplate,
  text: { header: string | null; body: string; footer: string | null },
): PreviewModel {
  const base = previewModelOf(t);
  return {
    ...base,
    headerText: base.headerKind === 'text' ? (text.header ?? '') : '',
    body: text.body,
    footer: text.footer ?? '',
  };
}

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

/**
 * Pre-fills the placeholders that have no source yet: a template whose own key for a placeholder is a contact field
 * (`first_name`) or one of the workspace's custom properties maps to it. Placeholders already mapped are left alone.
 */
export function prefillVariables(
  slots: readonly Pick<WizardTemplateSlot, 'slot' | 'key'>[],
  variables: WizardVariables,
  extraFields: readonly string[] = [],
): WizardVariables {
  const known = new Map<string, string>();
  for (const f of [...WIZARD_CONTACT_FIELDS, ...extraFields]) known.set(norm(f), f);
  const out: WizardVariables = { ...variables };
  for (const s of slots) {
    if (out[s.slot]) continue;
    const hit = known.get(norm(s.key));
    if (hit) out[s.slot] = { kind: 'field', field: hit, fallback: null };
  }
  return out;
}

/** True when `prefillVariables` would change something. */
export const wouldPrefill = (before: WizardVariables, after: WizardVariables): boolean =>
  Object.keys(after).length !== Object.keys(before).length;
