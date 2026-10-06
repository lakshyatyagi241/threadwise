import type { TemplateDetail, TplButton, TplMetaCategory, V1Template } from '@crm/contracts';
import type { TemplateRow } from '../../../../message-templates';

/** What the public shape reads, whichever service produced the template (a stored row or a write's detail). */
export interface PublicTemplateSource {
  uuid: string;
  name: string;
  type: string;
  metaCategory: string | null;
  language: string;
  header: string | null;
  body: string;
  footer: string | null;
  buttons: unknown;
  attachmentType: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export const sourceOfRow = (r: TemplateRow): PublicTemplateSource => ({
  uuid: r.uuid,
  name: r.templateName,
  type: r.templateType,
  metaCategory: r.metaCategory ?? r.category,
  language: r.language,
  header: r.header,
  body: r.templateBody,
  footer: r.footer,
  buttons: r.buttons,
  attachmentType: r.attachmentType,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export const sourceOfDetail = (d: TemplateDetail): PublicTemplateSource => ({
  uuid: d.id,
  name: d.name,
  type: d.templateType,
  metaCategory: d.metaCategory,
  language: d.language,
  header: d.header,
  body: d.body,
  footer: d.footer,
  buttons: d.buttons,
  attachmentType: d.attachmentType,
  status: d.status,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

type ButtonOut = Record<string, unknown>;

/** Our stored button (Meta's vocabulary) in WaDesk's: `visit_website`, `call_phone`, `quick_reply`, with a single `value`. */
export function publicButtonOf(b: TplButton): ButtonOut {
  const type = String(b.type).toUpperCase();
  if (type === 'URL') return { type: 'visit_website', text: b.text ?? null, value: b.url ?? null };
  if (type === 'PHONE_NUMBER')
    return { type: 'call_phone', text: b.text ?? null, value: b.phone_number ?? null };
  if (type === 'QUICK_REPLY') return { type: 'quick_reply', text: b.text ?? null };
  return { type: String(b.type).toLowerCase(), text: b.text ?? null };
}

const buttonsOf = (raw: unknown): ButtonOut[] =>
  Array.isArray(raw)
    ? raw.filter((b): b is TplButton => !!b && typeof b === 'object').map((b) => publicButtonOf(b))
    : [];

const ATTACHMENTS = new Set(['image', 'video', 'audio', 'document', 'location']);

export function toPublicTemplate(s: PublicTemplateSource): V1Template {
  const attachment = (s.attachmentType ?? '').toLowerCase();
  return {
    id: s.uuid,
    name: s.name,
    type: s.type,
    category: s.metaCategory ? s.metaCategory.toLowerCase() : null,
    language: s.language,
    header: s.header,
    // The template domain keeps no location or carousel today, so the public shape cannot show them (reported as a gap).
    header_location: null,
    body: s.body,
    footer: s.footer,
    buttons: buttonsOf(s.buttons),
    carousel_data: [],
    attachment_type: ATTACHMENTS.has(attachment)
      ? (attachment as V1Template['attachment_type'])
      : null,
    status: s.status,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

// --- reading what the client wrote ---------------------------------------------------------------------------------------------

const SLUGS: Record<string, TplMetaCategory> = {
  '1': 'MARKETING',
  marketing: 'MARKETING',
  '2': 'AUTHENTICATION',
  authentication: 'AUTHENTICATION',
  '3': 'UTILITY',
  utility: 'UTILITY',
};

/**
 * WaDesk's `category` input: Meta's numeric id 1/2/3, a Meta slug (any case) or an industry bucket (travel, healthcare, ...). The
 * industry buckets have no home in our model, which keeps only Meta's category, so they and anything unrecognised read as utility, the
 * category WaDesk stored for them.
 */
export function metaCategoryOfInput(raw: string | number): TplMetaCategory {
  return SLUGS[String(raw).trim().toLowerCase()] ?? 'UTILITY';
}

export const BUTTON_CAP = 3;

/**
 * WaDesk's `buttons` plus `quick_replies` in our button shape: CTA buttons first, then each non-blank quick reply, only the first three
 * kept (extras are dropped silently, as in WaDesk). Items that are not objects are skipped.
 */
export function buttonsOfInput(
  buttons: unknown[] | undefined,
  quickReplies: unknown[] | undefined,
): TplButton[] {
  const out: TplButton[] = [];
  for (const raw of buttons ?? []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const b = raw as Record<string, unknown>;
    const type = typeof b.type === 'string' ? b.type.trim().toLowerCase() : '';
    const text = typeof b.text === 'string' ? b.text : undefined;
    const value = b.value === undefined || b.value === null ? undefined : String(b.value);
    if (type === 'visit_website' || type === 'url')
      out.push({ type: 'URL', ...(text ? { text } : {}), ...(value ? { url: value } : {}) });
    else if (type === 'call_phone' || type === 'phone_number' || type === 'phone') {
      const cc = typeof b.country_code === 'string' ? b.country_code.replace(/\D/g, '') : '';
      const digits = (value ?? '').replace(/[^\d+]/g, '');
      out.push({
        type: 'PHONE_NUMBER',
        ...(text ? { text } : {}),
        ...(digits ? { phone_number: digits.startsWith('+') ? digits : `+${cc}${digits}` } : {}),
      });
    } else if (type === 'quick_reply') out.push({ type: 'QUICK_REPLY', ...(text ? { text } : {}) });
    else if (type) out.push({ type: type.toUpperCase(), ...(text ? { text } : {}) });
  }
  for (const q of quickReplies ?? []) {
    const text = (typeof q === 'object' && q !== null ? (q as { text?: unknown }).text : q) ?? '';
    const t = String(text).trim();
    if (t) out.push({ type: 'QUICK_REPLY', text: t });
  }
  return out.slice(0, BUTTON_CAP);
}
