import { MERGE_TAG_PATTERN } from '@crm/contracts';
import {
  buttonSubType,
  scalarize,
  type ButtonVar,
  type CardVars,
  type SendVars,
  type TemplateShape,
} from '../../../infra/providers/whatsapp/meta-send-payload';

/** What the builder needs to know about one recipient: how a token resolves, and where stored media lives. */
export interface VarsContext {
  /** One token (a contact column, a contact attribute, a workspace default or a system token) to its value; '' when unknown. */
  pull(key: string): string;
  /** A stored media path to its public URL; null when the storage layer cannot say. */
  mediaUrl(path: string): string | null;
}

type Dict = Record<string, unknown>;
const isDict = (x: unknown): x is Dict => typeof x === 'object' && x !== null && !Array.isArray(x);
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : isDict(x) ? Object.values(x) : []);

/**
 * `{slot: attribute key}` from either stored shape of a variable map (WaDesk's `flattenMap`):
 *   nested (templates)  `{ header: [{num, key}], body: [{num, key}] }`
 *   flat   (composer)   `{ "1": "first_name", "2": "email" }`
 * `num` is trusted when present, otherwise the position plus one.
 */
export function flattenMap(
  map: unknown,
  sections: readonly string[] = ['header', 'body'],
): Record<string, string> {
  if (!isDict(map) || Object.keys(map).length === 0) return {};
  const out: Record<string, string> = {};

  if (!sections.some((s) => map[s] !== undefined)) {
    for (const [slot, key] of Object.entries(map)) {
      if (typeof key === 'string' || typeof key === 'number') out[slot] = String(key);
    }
    return out;
  }
  for (const section of sections) {
    list(map[section]).forEach((entry, i) => {
      const key = isDict(entry) ? String(entry.key ?? '') : String(entry ?? '');
      const num = isDict(entry) && entry.num !== undefined ? Number(entry.num) : i + 1;
      if (key !== '') out[String(num)] = key;
    });
  }
  return out;
}

const keyOf = (entry: unknown): string =>
  isDict(entry) ? String(entry.key ?? '') : String(entry ?? '');

/** Buttons that take a send-time parameter, with `{{tokens}}` in their value resolved for this recipient. */
function buttonVars(
  buttons: unknown[],
  positional: Record<string, string>,
  pull: (k: string) => string,
): ButtonVar[] {
  const out: ButtonVar[] = [];
  buttons.forEach((b, index) => {
    if (!isDict(b)) return;
    const sub = buttonSubType(String(b.type ?? ''));
    if (sub === null) return; // static: no send-time parameter
    const resolved = String(b.value ?? '').replace(MERGE_TAG_PATTERN, (_m, inner: string) => {
      const key = inner.trim();
      // A positional slot is translated through the variable map first; a name is looked up as written.
      if (/^\d+$/.test(key) && positional[key]) return pull(positional[key]!);
      return pull(key);
    });
    // Meta rejects an empty quick-reply payload (#132000); without one it uses the button text.
    if (sub === 'quick_reply' && resolved.trim() === '') return;
    out.push({ index, subType: sub, value: resolved });
  });
  return out;
}

/**
 * The per-recipient variables of a template (WaDesk's `varsForRecipient`, without the overrides, which are applied after).
 * Authentication templates are not handled: they cannot be broadcast (WD-BCAST-012).
 */
export function buildRecipientVars(
  t: TemplateShape & { headerLocation?: unknown },
  ctx: VarsContext,
): SendVars {
  const vmap = isDict(t.variableMap) ? t.variableMap : {};
  const vars: SendVars = {};

  // Header text: a single token, the first slot.
  const headerMap = list(vmap.header);
  if (headerMap.length > 0) vars.header = ctx.pull(keyOf(headerMap[0]));

  // Body: positional, in variable-map order.
  const bodyMap = list(vmap.body);
  if (bodyMap.length > 0) vars.body = bodyMap.map((e) => ctx.pull(keyOf(e)));

  const buttons = buttonVars(list(t.buttons), flattenMap(vmap, ['body']), ctx.pull);
  if (buttons.length) vars.buttons = buttons;

  // Header media: the template's own stored file, passed as a link (nothing is pre-uploaded to Meta).
  const att = (t.attachmentType ?? '').toLowerCase();
  if (t.attachmentFile && att !== '' && att !== 'none' && att !== 'text') {
    const url = ctx.mediaUrl(t.attachmentFile);
    if (url) vars.headerMediaUrl = url;
  }
  // WaDesk read a location header's coordinates nowhere on this path, so a location template lost its header and Meta
  // rejected it (#132012). They come from the template here.
  if (att === 'location' && isDict(t.headerLocation)) vars.headerLocation = t.headerLocation;

  if (t.templateType === 'carousel') {
    const cards = list(vmap.cards);
    vars.cards = list(t.carouselData).map((card, i): CardVars => {
      const c = isDict(card) ? card : {};
      const out: CardVars = {};
      const image = typeof c.image === 'string' ? c.image : '';
      if (image) {
        const url = /^https?:/i.test(image) ? image : ctx.mediaUrl(image);
        if (url) {
          out.headerMediaUrl = url;
          out.headerFormat = image.toLowerCase().endsWith('.mp4') ? 'video' : 'image';
        }
      }
      const cardMap = isDict(cards[i]) ? list((cards[i] as Dict).body) : [];
      if (cardMap.length) out.body = cardMap.map((e) => ctx.pull(keyOf(e)));
      const positional: Record<string, string> = {};
      cardMap.forEach((e, n) => {
        const k = keyOf(e);
        if (k) positional[String(isDict(e) && e.num !== undefined ? Number(e.num) : n + 1)] = k;
      });
      const cardButtons = buttonVars(list(c.buttons), positional, ctx.pull);
      if (cardButtons.length) out.buttons = cardButtons;
      return out;
    });
  }
  return vars;
}

export { scalarize };
