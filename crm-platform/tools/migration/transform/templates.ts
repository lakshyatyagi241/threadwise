import type { Source } from '../extract/source';
import { badText, cutText, docKeys, isDeleted, str, type Doc } from '../util';
import { c, times, TS_COLS } from './common';
import type { Ctx, HandlerSpec, Outcome, Soft } from './types';

const asDoc = (v: unknown): Doc =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Doc) : {};

/**
 * A CAROUSEL component's cards as the app stores them (apps/api message-templates/template-payload.ts, TemplateCard): the picture is
 * Meta's copy of the example (`headerHandle`), the file is ours (`image`) and a migrated card has none. Meta's buttons are kept as they are.
 */
export function storedCards(cards: unknown): Doc[] | null {
  if (!Array.isArray(cards)) return null;
  return cards.map((card) => {
    // every entry goes through asDoc, so a null entry reads as an empty component and not as a TypeError
    const comps: Doc[] = Array.isArray(asDoc(card).components)
      ? (asDoc(card).components as unknown[]).map(asDoc)
      : [];
    const header = asDoc(comps.find((x) => x.type === 'HEADER'));
    const text = asDoc(comps.find((x) => x.type === 'BODY'));
    const btns = asDoc(comps.find((x) => x.type === 'BUTTONS'));
    const handles = asDoc(header.example).header_handle;
    const handle = Array.isArray(handles) && typeof handles[0] === 'string' ? handles[0] : null;
    return {
      format: String(header.format ?? 'IMAGE').toUpperCase() === 'VIDEO' ? 'video' : 'image',
      image: null,
      headerHandle: handle,
      body: str(text.text) ?? '',
      // the same type casing as a standard template's buttons (the BUTTONS branch above), so the app reads one shape
      buttons: Array.isArray(btns.buttons)
        ? btns.buttons.map((b) => {
            const { type: bt, ...rest } = asDoc(b);
            return { ...rest, type: String(bt ?? '').toUpperCase() };
          })
        : null,
    };
  });
}

/**
 * broadcast_templates -> wa_templates.
 *
 * A Waboo template document is Meta's own template: { name, language, category, status, components: [HEADER | BODY | FOOTER | BUTTONS |
 * CAROUSEL ...], meta_template_id }. WaDesk keeps the same thing split in columns (header / template_body / footer / buttons / carousel_data
 * / variable_map, packages/db/src/schema/message-templates). Nothing is re-submitted to Meta: the template keeps its Meta id and its
 * Meta status, and a later sync (or the connection going live) refreshes it. A component we cannot place exactly quarantines the template
 * (TEMPLATE_COMPONENT_UNSUPPORTED) rather than loading a template that would send differently from the approved one.
 */

const STATUS: Record<string, string> = {
  APPROVED: 'approved',
  PENDING: 'pending',
  IN_APPEAL: 'pending',
  REJECTED: 'rejected',
  PAUSED: 'paused',
  DISABLED: 'disabled',
  DRAFT: 'draft',
};
const META_CATEGORIES = new Set(['MARKETING', 'UTILITY', 'AUTHENTICATION']);
const MEDIA = new Set(['IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION']);
const NAME_MAX = 512;
const BODY_MAX = 1024;

class Unsupported extends Error {}

type Slot = { num: number; key: string; example?: string };

/** {{1}} / {{name}} placeholders in order of first appearance. */
const tokens = (text: string | null): string[] => {
  const seen: string[] = [];
  for (const m of (text ?? '').matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g))
    if (!seen.includes(m[1]!)) seen.push(m[1]!);
  return seen;
};
const examplesOf = (example: unknown, key: 'body_text' | 'header_text'): string[] => {
  const raw = example !== null && typeof example === 'object' ? (example as Doc)[key] : undefined;
  const first = Array.isArray(raw) ? (Array.isArray(raw[0]) ? raw[0] : raw) : [];
  return first.filter((x: unknown): x is string => typeof x === 'string');
};
const slots = (
  text: string | null,
  example: unknown,
  key: 'body_text' | 'header_text',
): Slot[] | undefined => {
  const t = tokens(text);
  if (t.length === 0) return undefined;
  const ex = examplesOf(example, key);
  return t.map((k, i) => {
    const e = ex[i]?.trim();
    return { num: i + 1, key: k, ...(e ? { example: cutText(e, 200) } : {}) };
  });
};

const TEMPLATE_FIELDS = {
  _id: 'id',
  id: 'drop:the id inside Waboo (id_map keeps the document id)',
  name: 'col:template_name',
  language: 'col:language',
  category: 'col:meta_category (upper case) and category (lower case)',
  type: 'drop:channel type, only whatsapp exists; col:channel',
  template_type: 'drop:Waboo UI label; col:template_type is derived from category and header',
  status: 'col:status and meta_status (the Meta status kept as is); DELETED is excluded',
  components:
    'col:header, template_body, footer, buttons, carousel_data, attachment_type, variable_map (a component with no exact place quarantines the template)',
  meta_template_id: 'col:meta_template_id (kept so the template matches Meta)',
  rejection_reason: 'col:rejection_reason (NONE or empty is no reason)',
  quality: 'col:quality_score',
  inputValues: 'drop:Waboo form state of the template editor',
  used_in_automation: 'drop:derived flag; WaDesk finds the flows that use a template itself',
  used_automation_ids:
    'drop:derived list of automations using the template (TEMPLATE_USAGE_DROPPED)',
  created_by: 'col:user_id (the migrated user, when the id resolves)',
  updated_by: 'drop:last editor; wa_templates has no such column',
  created_time: 'col:created_at',
  modified_time: 'col:updated_at',
  is_deleted: 'drop:soft-delete flag; deleted templates are excluded and counted',
  deleted_time: 'drop:soft-delete timestamp',
};

export const templates: HandlerSpec = {
  handler: 'templates',
  collection: 'broadcast_templates',
  mapCollection: 'broadcast_templates',
  tables: {
    wa_templates: {
      columns: [
        c('user_id', 'bigint'),
        c('template_name', 'text'),
        c('header', 'text'),
        c('template_body', 'text'),
        c('footer', 'text'),
        c('buttons', 'jsonb'),
        c('carousel_data', 'jsonb'),
        c('variable_map', 'jsonb'),
        c('code_expiration_minutes', 'smallint'),
        c('rejection_reason', 'text'),
        c('category', 'text'),
        c('meta_category', 'text'),
        c('template_type', 'text'),
        c('attachment_type', 'text'),
        c('header_sample_url', 'text'),
        c('language', 'text'),
        c('parameter_format', 'text'),
        c('status', 'text'),
        c('meta_status', 'text'),
        c('meta_template_id', 'text'),
        c('channel', 'text'),
        c('quality_score', 'text'),
        ...TS_COLS,
      ],
      fp: ['template_name', 'language', 'template_body', 'status', 'meta_template_id'],
      // the template-quality step (pilot/templates/quality.cjs) writes the Meta rating, and with it updated_at and row_version: its own
      // step output is the check for those columns
      // provider_config_id is written by the cutover, when the number the templates belong to is connected (load/cutover.ts step 3)
      // header_media_key is written by the files step, which copies the header file named by header_sample_url into our storage
      skipCompare: [
        'quality_score',
        'updated_at',
        'row_version',
        'provider_config_id',
        'header_media_key',
      ],
      constants: { row_version: 1 },
    },
  },
  fields: TEMPLATE_FIELDS,
  transform(doc: Doc, ctx: Ctx): Outcome {
    if (isDeleted(doc))
      return { kind: 'exclude', code: 'SOFT_DELETED', reason: 'is_deleted or deleted_time is set' };
    const metaStatus = (str(doc.status) ?? '').toUpperCase();
    if (metaStatus === 'DELETED')
      return { kind: 'exclude', code: 'SOFT_DELETED', reason: 'the template was deleted at Meta' };
    const status = STATUS[metaStatus];
    if (!status)
      return {
        kind: 'quarantine',
        code: 'STATUS_UNKNOWN',
        reason: `template status "${metaStatus}" has no WaDesk equivalent`,
      };
    const name = str(doc.name);
    if (!name || name.length > NAME_MAX)
      return {
        kind: 'quarantine',
        code: 'INVALID_NAME',
        reason: 'template name is empty or too long',
      };
    const language = str(doc.language);
    if (!language || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language))
      return {
        kind: 'quarantine',
        code: 'INVALID_LANGUAGE',
        reason: `language "${language ?? ''}" is not a Meta language code`,
      };
    const metaCategory = (str(doc.category) ?? '').toUpperCase();
    if (!META_CATEGORIES.has(metaCategory))
      return {
        kind: 'quarantine',
        code: 'INVALID_CATEGORY',
        reason: `category "${metaCategory}" is not MARKETING, UTILITY or AUTHENTICATION`,
      };

    let header: string | null = null;
    let headerEx: unknown;
    let body: string | null = null;
    let bodyEx: unknown;
    let footer: string | null = null;
    let attachment: string | null = null;
    let headerSample: string | null = null;
    let buttons: unknown[] = [];
    let carousel: unknown = null;
    let codeMinutes: number | null = null;
    try {
      if (!Array.isArray(doc.components)) throw new Unsupported('the template has no components');
      for (const comp of doc.components as Doc[]) {
        const type = (str(comp?.type) ?? '').toUpperCase();
        if (type === 'HEADER') {
          const format = (str(comp.format) ?? 'TEXT').toUpperCase();
          if (format === 'TEXT') {
            header = str(comp.text) ?? null;
            headerEx = comp.example;
          } else if (MEDIA.has(format)) {
            attachment = format.toLowerCase();
            // Meta's copy of the header file (the example handle), as the app's own template sync keeps it: it shows the header at once,
            // and the files step copies it into our storage (header_media_key) because the link is short-lived
            const handles = asDoc(comp.example).header_handle;
            const h = Array.isArray(handles) ? str(handles[0]) : null;
            if (attachment !== 'location' && h && /^https:\/\//i.test(h)) headerSample = h;
          } else throw new Unsupported(`header format "${format}" is not one WaDesk has`);
        } else if (type === 'BODY') {
          body = str(comp.text) ?? null;
          bodyEx = comp.example;
        } else if (type === 'FOOTER') {
          footer = str(comp.text) ?? null;
          if (typeof comp.code_expiration_minutes === 'number')
            codeMinutes = comp.code_expiration_minutes;
        } else if (type === 'BUTTONS') {
          if (!Array.isArray(comp.buttons))
            throw new Unsupported('a BUTTONS component without buttons');
          buttons = comp.buttons.map((b: Doc) => {
            const { type: bt, ...rest } = b;
            return { ...rest, type: String(bt ?? '').toUpperCase() };
          });
        } else if (type === 'CAROUSEL') carousel = storedCards(comp.cards);
        else throw new Unsupported(`component "${type}" is not one WaDesk has`);
      }
      // AUTHENTICATION bodies are fixed by Meta and carry no text
      if (body === null && metaCategory !== 'AUTHENTICATION' && carousel === null)
        throw new Unsupported('the template has no BODY text');
      if (body !== null && body.length > BODY_MAX)
        throw new Unsupported(`the body is longer than ${BODY_MAX} characters`);
    } catch (e) {
      if (e instanceof Unsupported)
        return { kind: 'quarantine', code: 'TEMPLATE_COMPONENT_UNSUPPORTED', reason: e.message };
      throw e;
    }

    const named = [...tokens(header), ...tokens(body)].some((k) => !/^\d+$/.test(k));
    const variableMap: Record<string, Slot[]> = {};
    const hs = slots(header, headerEx, 'header_text');
    const bs = slots(body, bodyEx, 'body_text');
    if (hs) variableMap.header = hs;
    if (bs) variableMap.body = bs;

    const t = times(doc, ctx.fallbackAt);
    const soft: Soft[] = [...t.soft];
    if (doc.used_automation_ids !== undefined)
      soft.push({
        code: 'TEMPLATE_USAGE_DROPPED',
        reason: 'used_automation_ids (which automations use the template) was not kept',
      });
    if (attachment && attachment !== 'location')
      soft.push({
        code: 'HEADER_SAMPLE_NOT_KEPT',
        reason: headerSample
          ? 'the media header example is a short-lived Meta link: kept as header_sample_url; the files step copies the file into our storage'
          : 'the media header example is a short-lived Meta link and was not kept (it is not an https address); the template keeps its Meta id',
      });
    const createdBy = doc.created_by as Doc | null | undefined;
    const user =
      createdBy?.id !== undefined && createdBy?.id !== null
        ? ctx.ref('user', createdBy.id)
        : undefined;
    const reason = str(doc.rejection_reason);
    const auth = metaCategory === 'AUTHENTICATION';

    return {
      kind: 'rows',
      soft,
      rows: [
        {
          table: 'wa_templates',
          sub: '',
          row: {
            user_id: user?.id ?? null,
            template_name: name,
            header,
            template_body: body ?? '',
            footer,
            buttons: auth ? [] : buttons,
            carousel_data: carousel,
            variable_map: variableMap,
            code_expiration_minutes: codeMinutes,
            rejection_reason: reason && reason.toUpperCase() !== 'NONE' ? reason : null,
            category: metaCategory.toLowerCase(),
            meta_category: metaCategory,
            template_type: auth
              ? 'auth'
              : carousel
                ? 'carousel'
                : attachment
                  ? 'media'
                  : 'standard',
            attachment_type: attachment,
            header_sample_url: headerSample,
            language,
            parameter_format: named ? 'NAMED' : 'POSITIONAL',
            status,
            meta_status: metaStatus,
            meta_template_id: str(doc.meta_template_id) ?? null,
            channel: 'whatsapp',
            quality_score: str(doc.quality) ?? null,
            created_at: t.created,
            updated_at: t.updated,
          },
        },
      ],
    };
  },
};

/**
 * The Meta copy of a template's media header file (the example handle) when the document has one an https address names: what the
 * transform keeps as `header_sample_url`. Shared by the transform and by `template-headers` (templates loaded before it kept it).
 */
export function headerSampleOf(doc: Doc): string | null {
  if (!Array.isArray(doc.components)) return null;
  for (const comp of doc.components as Doc[]) {
    if ((str(comp?.type) ?? '').toUpperCase() !== 'HEADER') continue;
    const format = (str(comp.format) ?? '').toUpperCase();
    if (format !== 'IMAGE' && format !== 'VIDEO' && format !== 'DOCUMENT') return null;
    const handles = asDoc(comp.example).header_handle;
    const h = Array.isArray(handles) ? str(handles[0]) : null;
    return h && /^https:\/\//i.test(h) ? h : null;
  }
  return null;
}

/** The dump's templates that have a header link, by every key the document answers to. */
export async function headerLinks(source: Source, client: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!source.collections(client).includes('broadcast_templates')) return out;
  for await (const d of source.read(client, 'broadcast_templates')) {
    const doc = d as Doc;
    if (badText(doc)) continue;
    const url = headerSampleOf(doc);
    if (!url) continue;
    for (const k of docKeys(doc)) out.set(k.key, url);
  }
  return out;
}
