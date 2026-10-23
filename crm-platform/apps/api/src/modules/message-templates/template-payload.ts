import { countPlaceholders, tokensOf, type VariableMap } from './template-variables';

/**
 * The body of `POST /{waba}/message_templates` built from a stored template (TW-TPL-024). Pure; golden-file tested.
 * Covers standard (text/media), authentication and carousel templates; catalog and limited-time-offer builders are separate work.
 */

export type MediaFormat = 'IMAGE' | 'VIDEO' | 'DOCUMENT';

export interface TemplateButton {
  type: string;
  text?: string;
  url?: string;
  phone_number?: string;
  example?: string | string[];
  [k: string]: unknown;
}

/** One card of a carousel as it is stored and sent: the file is ours (`image`), Meta's own copy of the example is `headerHandle`. */
export interface TemplateCard {
  format?: 'image' | 'video' | string;
  image?: string | null;
  headerHandle?: string | null;
  headerSampleUrl?: string | null;
  body: string;
  buttons?: TemplateButton[] | null;
}

export interface TemplateDraft {
  name: string;
  language?: string | null;
  /** The local vertical or Meta category in any case. */
  category?: string | null;
  metaCategory?: string | null;
  templateType: 'standard' | 'media' | 'auth' | string;
  header?: string | null;
  attachmentType?: string | null;
  /** The media handle Meta returned for the header example. */
  headerHandle?: string | null;
  body: string;
  footer?: string | null;
  buttons?: TemplateButton[] | null;
  /** `templateType: 'carousel'` only. */
  cards?: TemplateCard[] | null;
  variableMap?: VariableMap | null;
  codeExpirationMinutes?: number | null;
  parameterFormat?: 'POSITIONAL' | 'NAMED' | null;
}

export interface MetaTemplateBody {
  name: string;
  category: string;
  language: string;
  allow_category_change: boolean;
  parameter_format: 'POSITIONAL' | 'NAMED';
  message_send_ttl_seconds?: number;
  components: Array<Record<string, unknown>>;
}

/** Lowercase, every run of non `[a-z0-9]` becomes `_`, trimmed of `_`, at most 512, never empty. */
export function normalizeTemplateName(raw: string): string {
  const n = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 512);
  return n || 'untitled_template';
}

const MARKETING_VERTICALS = new Set(['ecommerce', 'festival', 'travel']);

export function metaCategoryOf(
  d: Pick<TemplateDraft, 'metaCategory' | 'category' | 'templateType'>,
): string {
  const explicit = (d.metaCategory ?? '').trim().toUpperCase();
  if (explicit) return explicit;
  if (d.templateType === 'auth') return 'AUTHENTICATION';
  const cat = (d.category ?? '').trim().toLowerCase();
  if (cat === 'marketing' || cat === 'utility' || cat === 'authentication')
    return cat.toUpperCase();
  return MARKETING_VERTICALS.has(cat) ? 'MARKETING' : 'UTILITY';
}

const HEADER_FORMATS: Record<string, string> = {
  image: 'IMAGE',
  video: 'VIDEO',
  document: 'DOCUMENT',
  location: 'LOCATION',
};

/** Meta wants real-looking values; the literal word "example" is auto-rejected, so fall back to "Sample N". */
function bodyExamples(body: string, map: VariableMap | null | undefined): string[] {
  const n = tokensOf(body).length;
  return Array.from({ length: n }, (_, i) => {
    const slot = map?.body?.find((s) => s.num === i + 1);
    return slot?.example?.trim() || slotLabel(slot?.key) || `Sample ${i + 1}`;
  });
}

const slotLabel = (key: string | undefined) => (key && !/^\d+$/.test(key) ? key : undefined);

function buttonOf(b: TemplateButton): Record<string, unknown> {
  const type = b.type.toUpperCase();
  if (type === 'OTP') return { ...b, type: 'OTP' };
  const out: Record<string, unknown> = { type };
  if (b.text) out.text = b.text;
  if (type === 'URL') {
    out.url = b.url;
    if (countPlaceholders(b.url ?? '') > 0) {
      const ex = Array.isArray(b.example) ? b.example[0] : b.example;
      out.example = [ex?.trim() || 'sample'];
    }
  } else if (type === 'PHONE_NUMBER') out.phone_number = b.phone_number;
  else if (type === 'COPY_CODE') out.example = Array.isArray(b.example) ? b.example[0] : b.example;
  else if (type === 'FLOW') {
    for (const k of ['flow_id', 'flow_action', 'navigate_screen'] as const)
      if (b[k] !== undefined) out[k] = b[k];
  }
  return out;
}

/** A carousel's CAROUSEL component: each card a picture or video, a short text and up to two buttons (all cards alike, as Meta requires). */
function carouselOf(cards: TemplateCard[]): Record<string, unknown> {
  return {
    type: 'CAROUSEL',
    cards: cards.slice(0, 10).map((c) => {
      const components: Array<Record<string, unknown>> = [
        {
          type: 'HEADER',
          format: String(c.format ?? 'image').toUpperCase() === 'VIDEO' ? 'VIDEO' : 'IMAGE',
          example: { header_handle: [c.headerHandle ?? ''] },
        },
        { type: 'BODY', text: c.body },
      ];
      if (c.buttons?.length)
        components.push({ type: 'BUTTONS', buttons: c.buttons.slice(0, 2).map(buttonOf) });
      return { components };
    }),
  };
}

export function buildMetaTemplate(d: TemplateDraft): MetaTemplateBody {
  const category = metaCategoryOf(d);
  const auth = category === 'AUTHENTICATION' || d.templateType === 'auth';
  const components: Array<Record<string, unknown>> = [];

  if (auth) {
    components.push({ type: 'BODY', add_security_recommendation: true });
    if (d.codeExpirationMinutes)
      components.push({ type: 'FOOTER', code_expiration_minutes: d.codeExpirationMinutes });
    const otp = (d.buttons ?? []).find((b) => b.type.toUpperCase() === 'OTP');
    components.push({
      type: 'BUTTONS',
      buttons: [otp ? buttonOf(otp) : { type: 'OTP', otp_type: 'COPY_CODE' }],
    });
  } else if (d.templateType === 'carousel') {
    // A carousel is the bubble's text and then the cards; it has no header, footer or buttons of its own.
    const body: Record<string, unknown> = { type: 'BODY', text: d.body };
    if (countPlaceholders(d.body) > 0)
      body.example = { body_text: [bodyExamples(d.body, d.variableMap)] };
    components.push(body);
    components.push(carouselOf(d.cards ?? []));
  } else {
    const attach = (d.attachmentType ?? '').toLowerCase();
    const format = HEADER_FORMATS[attach];
    if (format) {
      const header: Record<string, unknown> = { type: 'HEADER', format };
      if (format !== 'LOCATION') header.example = { header_handle: [d.headerHandle ?? ''] };
      components.push(header);
    } else if (d.header) {
      const header: Record<string, unknown> = { type: 'HEADER', format: 'TEXT', text: d.header };
      if (countPlaceholders(d.header) > 0) {
        const n = tokensOf(d.header).length;
        header.example = {
          header_text: Array.from(
            { length: n },
            (_, i) =>
              d.variableMap?.header?.find((s) => s.num === i + 1)?.example?.trim() ||
              slotLabel(d.variableMap?.header?.find((s) => s.num === i + 1)?.key) ||
              'Sample',
          ).slice(0, 1),
        };
      }
      components.push(header);
    }
    const body: Record<string, unknown> = { type: 'BODY', text: d.body };
    if (countPlaceholders(d.body) > 0)
      body.example = { body_text: [bodyExamples(d.body, d.variableMap)] };
    components.push(body);
    if (d.footer) components.push({ type: 'FOOTER', text: d.footer });
    if (d.buttons?.length)
      components.push({ type: 'BUTTONS', buttons: d.buttons.slice(0, 10).map(buttonOf) });
  }

  return {
    name: normalizeTemplateName(d.name),
    category,
    language: d.language || 'en_US',
    allow_category_change: true,
    parameter_format: d.parameterFormat ?? 'POSITIONAL',
    ...(auth ? { message_send_ttl_seconds: 60 } : {}),
    components,
  };
}
