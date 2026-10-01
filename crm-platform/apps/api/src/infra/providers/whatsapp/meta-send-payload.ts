/**
 * The Cloud API `template` object for one recipient (TW-BCAST-017): name, language and the components that carry the
 * header, body, button and carousel parameters. Pure: it knows the approved template and the per-recipient values, nothing
 * about contacts or storage.
 *
 * Every rule below exists because Meta rejects the send otherwise, and each was learned the hard way in Reference:
 *  - a parameter count that differs from the approved template is #132000, so the body and header carry EXACTLY as many
 *    parameters as the template declares (padded when short, cut when long, none when it has no placeholder);
 *  - an empty text parameter is #131008, so a blank value falls back to the template's own example, then to the
 *    placeholder's name, then to "-";
 *  - a send-time button parameter is only valid for a button that takes one (a static URL or a phone button must not carry
 *    one), and an empty quick-reply payload is #132000.
 */

export interface TemplateShape {
  templateName: string;
  language: string | null;
  templateType: string;
  templateBody: string;
  header: string | null;
  attachmentType: string | null;
  attachmentFile: string | null;
  /** POSITIONAL or NAMED; NAMED parameters are tagged with their placeholder name. */
  parameterFormat: string | null;
  variableMap: unknown;
  buttons: unknown;
  carouselData: unknown;
}

export interface ButtonVar {
  index: number;
  subType: string;
  value: string;
}

export interface CardVars {
  headerMediaUrl?: string;
  headerMediaId?: string;
  /** image or video. */
  headerFormat?: string;
  body?: string[];
  buttons?: ButtonVar[];
}

export interface SendVars {
  header?: string;
  body?: string[];
  buttons?: ButtonVar[];
  /** The caller resolves the template's stored sample media into a URL when nothing else names one. */
  headerMediaUrl?: string;
  headerMediaId?: string;
  headerFilename?: string;
  headerLocation?: { latitude?: unknown; longitude?: unknown; name?: unknown; address?: unknown };
  cards?: CardVars[];
  thumbnailProductRetailerId?: string;
}

type Dict = Record<string, unknown>;
const isDict = (x: unknown): x is Dict => typeof x === 'object' && x !== null && !Array.isArray(x);
const asArray = (x: unknown): unknown[] =>
  Array.isArray(x) ? x : isDict(x) ? Object.values(x) : [];
const isScalar = (x: unknown): x is string | number | boolean =>
  typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean';

/**
 * Any value to a safe string for a Meta parameter. A value can be an array (a custom attribute stored as JSON) or a
 * variable-map object; prefer a labelled scalar (example, text, value, key), else join the scalar members.
 */
export function scalarize(x: unknown): string {
  if (Array.isArray(x) || isDict(x)) {
    if (isDict(x)) {
      for (const k of ['example', 'text', 'value', 'key']) {
        if (isScalar(x[k])) return String(x[k]);
      }
    }
    const flat = asArray(x).filter(isScalar);
    return flat.length ? flat.map(String).join(', ') : '';
  }
  return isScalar(x) ? String(x) : '';
}

/** Meta accepts template names ^[a-z0-9_]{1,512}$. */
export function normalizeName(name: string): string {
  const n = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 512);
  return n || 'untitled_template';
}

export function countPlaceholders(s: string | null | undefined): number {
  return (s ?? '').match(/\{\{\s*\w+\s*\}\}/g)?.length ?? 0;
}

export function placeholderNames(s: string | null | undefined): string[] {
  return [...(s ?? '').matchAll(/\{\{\s*([^\s{}]+?)\s*\}\}/g)].map((m) => m[1]!);
}

const isNumeric = (s: string) => s !== '' && !Number.isNaN(Number(s));

/** Which button types carry a send-time parameter, and of which kind. Null means none (phone and catalog buttons are static). */
export function buttonSubType(type: string): string | null {
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
      return null;
    default:
      return 'quick_reply';
  }
}

/** Does this approved button take a send-time parameter? */
function shouldEmitButtonParam(btn: ButtonVar, tplButtons: unknown[]): boolean {
  const sub = btn.subType.toLowerCase();
  if (['quick_reply', 'copy_code', 'voice_call'].includes(sub)) return true;
  if (sub !== 'url') return false;
  const tplBtn = tplButtons[btn.index];
  if (!isDict(tplBtn)) return false;
  if (['otp_one_tap', 'otp_copy', 'otp'].includes(String(tplBtn.type ?? ''))) return true;
  const url = String(tplBtn.value ?? tplBtn.url ?? '');
  return countPlaceholders(url) > 0;
}

function sendButton(btn: ButtonVar) {
  const sub = btn.subType.toLowerCase() || 'url';
  const value = btn.value;
  const parameters =
    sub === 'quick_reply'
      ? [{ type: 'payload', payload: value }]
      : sub === 'copy_code'
        ? [{ type: 'coupon_code', coupon_code: value }]
        : sub === 'voice_call'
          ? []
          : sub === 'catalog'
            ? [{ type: 'action', action: { thumbnail_product_retailer_id: value } }]
            : [{ type: 'text', text: value }];
  return { type: 'button', sub_type: sub, index: Math.trunc(btn.index) || 0, parameters };
}

/** A fallback for an empty parameter: the template's own example, else the placeholder's name, else "-". */
function fallbackText(example: string, name: string): string {
  if (example !== '') return example;
  return name !== '' && !isNumeric(name) ? name : '-';
}

function documentFilename(vars: SendVars, mediaUrl: string, t: TemplateShape): string {
  let name = (vars.headerFilename ?? '').trim();

  if (name === '' && mediaUrl !== '') {
    let base = '';
    try {
      base = new URL(mediaUrl).pathname.split('/').pop() ?? '';
    } catch {
      base = '';
    }
    // Skip our own upload name (time_random.ext): it reads as garbage.
    if (base !== '' && !/^\d{9,}_[A-Za-z0-9]{20,}\./.test(base)) name = base;
  }
  if (name === '') {
    let src = t.attachmentFile ?? '';
    if (mediaUrl !== '') {
      try {
        src = new URL(mediaUrl).pathname;
      } catch {
        /* keep the stored file name */
      }
    }
    const ext = (src.split('.').pop() ?? '').toLowerCase();
    name = `${t.templateName.trim() || 'document'}.${/^[a-z0-9]{1,5}$/.test(ext) ? ext : 'pdf'}`;
  }

  name = name.replace(/\\/g, '/').split('/').pop() ?? '';
  name = name
    .replace(/[^\w .()-]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (name === '') name = 'document.pdf';
  if (!name.includes('.')) name += '.pdf';
  return name.slice(0, 240);
}

function sendHeader(t: TemplateShape, vars: SendVars) {
  const type = (t.attachmentType || 'TEXT').toUpperCase();
  const isMedia = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(type);

  if (!isMedia && type !== 'LOCATION') {
    // A text header carries exactly as many parameters as it declares; none when it has no placeholder.
    const placeholders = countPlaceholders(t.header);
    if (placeholders < 1) return null;

    let value = (vars.header ?? '').trim();
    if (value === '') {
      const map = isDict(t.variableMap) ? asArray(t.variableMap.header) : [];
      const example = scalarize(map[0]).trim();
      value = fallbackText(isNumeric(example) ? '' : example, placeholderNames(t.header)[0] ?? '');
    }
    const named = (t.parameterFormat || 'POSITIONAL').toUpperCase() === 'NAMED';
    const headerName = named ? (placeholderNames(t.header)[0] ?? '') : '';
    const parameters = Array.from({ length: placeholders }, () => ({
      type: 'text',
      text: value,
      ...(named && headerName !== '' && !isNumeric(headerName)
        ? { parameter_name: headerName }
        : {}),
    }));
    return { type: 'header', parameters };
  }

  if (type === 'LOCATION') {
    const loc = vars.headerLocation;
    if (!loc || !loc.latitude || !loc.longitude) return null;
    return {
      type: 'header',
      parameters: [
        {
          type: 'location',
          location: {
            latitude: String(loc.latitude),
            longitude: String(loc.longitude),
            name: String(loc.name ?? ''),
            address: String(loc.address ?? ''),
          },
        },
      ],
    };
  }

  const mediaId = vars.headerMediaId ?? '';
  const mediaUrl = vars.headerMediaUrl ?? '';
  if (mediaId === '' && mediaUrl === '') return null;
  const key = type.toLowerCase();
  const media: Dict = mediaId !== '' ? { id: mediaId } : { link: mediaUrl };
  if (key === 'document') media.filename = documentFilename(vars, mediaUrl, t);
  return { type: 'header', parameters: [{ type: key, [key]: media }] };
}

function sendCard(index: number, c: CardVars, tplCardButtons: unknown[]) {
  const components: unknown[] = [];
  if (c.headerMediaId || c.headerMediaUrl) {
    const media = c.headerMediaId ? { id: c.headerMediaId } : { link: c.headerMediaUrl };
    const type = (c.headerFormat || 'image').toLowerCase();
    components.push({ type: 'header', parameters: [{ type, [type]: media }] });
  }
  if (c.body && c.body.length) {
    components.push({
      type: 'body',
      parameters: c.body.map((v) => ({ type: 'text', text: String(v) })),
    });
  }
  for (const btn of c.buttons ?? []) {
    if (shouldEmitButtonParam(btn, tplCardButtons)) components.push(sendButton(btn));
  }
  return { card_index: index, components };
}

export interface SendTemplatePayload {
  name: string;
  language: { code: string };
  components: unknown[];
}

export function buildSend(t: TemplateShape, vars: SendVars): SendTemplatePayload {
  const send: SendTemplatePayload = {
    name: normalizeName(t.templateName),
    language: { code: t.language || 'en_US' },
    components: [],
  };

  const header = sendHeader(t, vars);
  if (header) send.components.push(header);

  // BODY: exactly as many parameters as the approved body has placeholders.
  const placeholders = countPlaceholders(t.templateBody);
  let bodyVars = [...(vars.body ?? [])];
  while (bodyVars.length < placeholders) bodyVars.push('');
  bodyVars = bodyVars.slice(0, placeholders);

  if (bodyVars.length > 0) {
    const examples = isDict(t.variableMap) ? asArray(t.variableMap.body) : [];
    const names = placeholderNames(t.templateBody);
    const named = (t.parameterFormat || 'POSITIONAL').toUpperCase() === 'NAMED';
    const seen = new Set<string>();
    const parameters: unknown[] = [];
    bodyVars.forEach((v, i) => {
      let text = scalarize(v).trim();
      if (text === '') text = fallbackText(scalarize(examples[i]).trim(), names[i] ?? '');
      const param: Dict = { type: 'text', text };
      const pname = names[i] ?? '';
      if (named && pname !== '' && !isNumeric(pname)) {
        // A NAMED body with two parameters sharing a name is rejected: a placeholder used twice needs one parameter.
        if (seen.has(pname)) return;
        seen.add(pname);
        param.parameter_name = pname;
      }
      parameters.push(param);
    });
    send.components.push({ type: 'body', parameters });
  }

  const tplButtons = asArray(t.buttons);
  for (const btn of vars.buttons ?? []) {
    if (shouldEmitButtonParam(btn, tplButtons)) send.components.push(sendButton(btn));
  }

  if (t.templateType === 'catalog') {
    let rid = (vars.thumbnailProductRetailerId ?? '').trim();
    if (rid === '') {
      for (const b of tplButtons) {
        if (isDict(b) && String(b.type ?? '').toLowerCase() === 'catalog') {
          rid = String(b.value ?? b.thumbnail_product_retailer_id ?? '').trim();
          break;
        }
      }
    }
    if (rid !== '') {
      send.components.push({
        type: 'button',
        sub_type: 'catalog',
        index: 0,
        parameters: [{ type: 'action', action: { thumbnail_product_retailer_id: rid } }],
      });
    }
  }

  if (t.templateType === 'carousel') {
    // Re-indexed 0..N-1: a gap in the source (a deleted card) is rejected by Meta, which wants sequential card indexes.
    const tplCards = asArray(t.carouselData);
    const cards = (vars.cards ?? []).map((c, i) => {
      const card = tplCards[i];
      return sendCard(i, c, isDict(card) ? asArray(card.buttons) : []);
    });
    if (cards.length) send.components.push({ type: 'carousel', cards });
  }

  return send;
}
