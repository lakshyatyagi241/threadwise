import { MERGE_TAG_PATTERN, type ComposeTemplate } from '@crm/contracts';
import { slotMap } from './compose-model';

/**
 * The send-time mapping panel's model (TW-BCAST-005): what each template slot is called, what it auto-fills from when left
 * blank, which parts can be changed for this one send, and the overrides body the form posts. Pure.
 */

export type ButtonKind = 'url' | 'copy_code' | 'quick_reply' | 'phone';

export interface SlotToken {
  /** The label: the placeholder's own name, or the mapped attribute for a positional `{{1}}`. */
  name: string;
  /** Normalised attribute key it resolves to. */
  key: string;
}

export interface SectionMeta {
  text: string;
  slots: number;
  tokens: SlotToken[];
  /** `{{key}}` per slot, from the template's own variable map: what a blank field falls back to. */
  defaults: string[];
}

export interface ButtonMeta {
  index: number;
  kind: ButtonKind;
  label: string;
  value: string;
  /** Only a URL or copy-code button carries a send-time value. */
  editable: boolean;
}

export interface PanelMeta {
  /** Authentication templates send a fresh code per recipient: nothing is editable. */
  editable: boolean;
  lockedReason: 'auth' | 'twilio' | null;
  mediaEditable: boolean;
  buttonsEditable: boolean;
  headerFormat: string;
  headerMediaUrl: string;
  header: SectionMeta;
  body: SectionMeta;
  footer: SectionMeta;
  buttons: ButtonMeta[];
}

const ALIASES: Record<string, string> = {
  phone_number: 'phone',
  phone_no: 'phone',
  number: 'phone',
  contact_number: 'phone',
  whatsapp_number: 'phone',
  mobile_number: 'mobile',
  mobile_no: 'mobile',
  full_name: 'name',
  customer_name: 'name',
  contact_name: 'name',
  first: 'first_name',
  last: 'last_name',
  surname: 'last_name',
  mail: 'email',
  email_address: 'email',
  e_mail: 'email',
};

/** Same normalisation the server uses, so `{{Phone Number}}` and `{{phone}}` mean the same attribute. */
export function normalizeKey(raw: string): string {
  const k = raw
    .toLowerCase()
    .trim()
    .replace(/[\s\-.]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^_+|_+$/g, '');
  return ALIASES[k] ?? k;
}

const tokensIn = (text: string): string[] =>
  [...text.matchAll(MERGE_TAG_PATTERN)].map((m) => (m[1] ?? '').trim());

/** The `{{key}}` each slot of one section falls back to, in the variable map's order. */
function defaultsOf(section: unknown): string[] {
  const list = Array.isArray(section)
    ? section
    : section && typeof section === 'object'
      ? Object.values(section)
      : [];
  return list.map((e) => {
    const key =
      typeof e === 'object' && e !== null
        ? String((e as { key?: unknown }).key ?? '')
        : String(e ?? '');
    return key ? `{{${key}}}` : '';
  });
}

function sectionMeta(
  text: string,
  mapSection: unknown,
  positional: Record<string, string>,
): SectionMeta {
  const raws = text ? tokensIn(text) : [];
  const tokens = raws.map((raw, i): SlotToken => {
    if (/^\d+$/.test(raw)) {
      const mapped = positional[raw] ?? positional[String(i + 1)] ?? '';
      if (mapped) {
        const key = normalizeKey(mapped);
        return { name: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '), key };
      }
      return { name: `Value ${raw}`, key: raw };
    }
    return { name: raw, key: normalizeKey(raw) };
  });
  return { text, slots: raws.length, tokens, defaults: defaultsOf(mapSection) };
}

export function buttonKind(type: string): ButtonKind {
  switch (type.trim().toLowerCase()) {
    case 'visit_website':
    case 'url':
    case 'cta_url':
      return 'url';
    case 'copy_code':
    case 'copy_text':
    case 'coupon_code':
      return 'copy_code';
    case 'call_phone':
    case 'call':
    case 'phone':
    case 'phone_number':
    case 'cta_call':
    case 'voice_call':
    case 'catalog':
      return 'phone';
    default:
      return 'quick_reply';
  }
}

export function buildMeta(t: ComposeTemplate): PanelMeta {
  const fmt = (t.attachmentType ?? 'TEXT').toUpperCase();
  const format = fmt === '' || fmt === 'NONE' ? 'TEXT' : fmt;
  const vmap =
    typeof t.variableMap === 'object' && t.variableMap !== null
      ? (t.variableMap as Record<string, unknown>)
      : {};
  const nested = ['header', 'body'].some((s) => vmap[s] !== undefined);
  const flat = nested ? {} : slotMap(vmap);
  const hmap = nested ? vmap.header : undefined;
  const bmap = nested ? vmap.body : Object.values(flat);

  const twilio = t.engine === 'twilio';
  const auth = t.type === 'auth';
  const buttons = (Array.isArray(t.buttons) ? t.buttons : []).flatMap((b, index): ButtonMeta[] => {
    if (typeof b !== 'object' || b === null) return [];
    const o = b as Record<string, unknown>;
    const kind = buttonKind(String(o.type ?? ''));
    return [
      {
        index,
        kind,
        label: String(o.text ?? o.label ?? `Button ${index + 1}`),
        value: String(o.value ?? ''),
        editable: kind === 'url' || kind === 'copy_code',
      },
    ];
  });

  return {
    editable: !auth,
    lockedReason: auth ? 'auth' : twilio ? 'twilio' : null,
    mediaEditable: !twilio && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format),
    buttonsEditable: !twilio,
    headerFormat: format,
    headerMediaUrl: t.attachmentUrl ?? '',
    header:
      format === 'TEXT'
        ? sectionMeta(t.header ?? '', hmap, nested ? slotMap({ header: vmap.header }) : {})
        : { text: '', slots: 0, tokens: [], defaults: [] },
    body: sectionMeta(t.body, bmap, nested ? slotMap({ body: vmap.body }) : flat),
    footer: sectionMeta(t.footer ?? '', undefined, {}),
    buttons,
  };
}

/** True when the panel has something to fill in. */
export function hasFields(m: PanelMeta): boolean {
  return (
    m.header.slots > 0 ||
    m.body.slots > 0 ||
    m.footer.slots > 0 ||
    m.mediaEditable ||
    m.buttons.some((b) => b.editable)
  );
}

export interface PanelState {
  header: string;
  body: string[];
  footer: string[];
  mediaUrl: string;
  buttons: Record<number, string>;
}

export const emptyState = (m: PanelMeta): PanelState => ({
  header: '',
  body: Array<string>(m.body.slots).fill(''),
  footer: Array<string>(m.footer.slots).fill(''),
  mediaUrl: '',
  buttons: {},
});

/** The panel's state for overrides saved earlier (the edit screen of a schedule): the inverse of `toOverrides`. */
export function stateFromOverrides(
  o: Record<string, unknown> | null | undefined,
  m: PanelMeta,
): PanelState {
  const s = emptyState(m);
  if (!o) return s;
  const header = o.header as { mode?: string; text?: string; mediaUrl?: string } | undefined;
  if (header?.mode === 'media' && typeof header.mediaUrl === 'string') s.mediaUrl = header.mediaUrl;
  else if (header?.mode === 'text' && typeof header.text === 'string') s.header = header.text;
  for (const key of ['body', 'footer'] as const) {
    const list = o[key];
    if (Array.isArray(list))
      list.forEach((v, i) => i < s[key].length && (s[key][i] = String(v ?? '')));
  }
  if (Array.isArray(o.buttons)) {
    for (const b of o.buttons as Array<{ index?: number; value?: string }>) {
      if (typeof b.index === 'number' && typeof b.value === 'string') s.buttons[b.index] = b.value;
    }
  }
  return s;
}

/**
 * The `templateOverrides` the form posts. A blank slot is not an empty value: it means "use what the template does", so an
 * all-blank section is left out. A pasted media link wins over header text; buttons with nothing typed are left out.
 */
export function toOverrides(s: PanelState, m: PanelMeta): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (m.header.slots > 0 && s.header !== '') out.header = { mode: 'text', text: s.header };
  if (s.body.join('') !== '') out.body = s.body;
  if (s.footer.join('') !== '') out.footer = s.footer;
  if (s.mediaUrl.trim() !== '') out.header = { mode: 'media', mediaUrl: s.mediaUrl.trim() };
  const buttons = m.buttons
    .filter((b) => b.editable && (s.buttons[b.index] ?? '').trim() !== '')
    .map((b) => ({ index: b.index, subType: b.kind, value: (s.buttons[b.index] ?? '').trim() }));
  if (buttons.length) out.buttons = buttons;
  return Object.keys(out).length ? out : null;
}

/** The attributes offered as one-click chips, the slot's own first: first name, name, phone, email, last name, company, city. */
const PRIORITY = ['first_name', 'name', 'phone', 'email', 'last_name', 'company_name', 'city'];

export function chipKeys(available: readonly string[], own: string | null): string[] {
  const have = new Set(available);
  const out: string[] = [];
  if (own && have.has(own)) out.push(own);
  for (const k of PRIORITY) if (have.has(k) && !out.includes(k)) out.push(k);
  return out.slice(0, 5);
}
