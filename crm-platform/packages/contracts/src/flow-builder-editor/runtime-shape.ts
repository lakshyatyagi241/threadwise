import {
  FLB_ASK_GIVE_UP_MODES,
  FLB_ASK_MAX_RETRIES,
  flbCleanAskFileExtensions,
  type FlbAskGiveUp,
} from './ask-media';
import { flbCleanAskInputType, flbCleanDateFormat } from './ask-input';
import { flbSanitizeConditionGroup } from './condition-group';
import type { FlbNodeData } from './node-catalogue';

/**
 * The editor to runtime FIELD seam (TW-FLB-070): Reference's FlowNormalizer, as one pure function.
 *
 * The inspector forms save Reference's builder vocabulary (`save`, `lat`, `multi`, `bot`, `flow`, a comma string of `fields`, ...), so
 * saved flows, exports and templates stay import/export compatible with Reference. The runtime reads another vocabulary for several
 * node types (`variable`, `latitude`, `allowMultiple`, `agentId`, `flowId`, an array of fields, ...). Reference translated on the way out
 * of its `/api/flows/{id}` endpoint; `flbToRuntimeData` is that translation for the `data` bag of ONE node, and `flbRuntimeNodeData`
 * applies it to a whole graph. `FlowReaderService.getRunnableFlow` returns the graph through it.
 *
 * Contract:
 * - Pure and total: never throws, never reads a clock, a database or the network, never mutates its input.
 * - Additive: every original field is kept. Only the runtime-named keys are added. A key the runtime reads under the SAME name as the
 *   editor saves it is rewritten only to its normalised form (`ai.fields` string to array, `poll.options` to a list, `mysql.port` to an
 *   integer, `condition.conditions` cleaned, `cta` legacy single-kind into `ctaActions`), which is what Reference delivered.
 * - Idempotent: `f(f(x))` equals `f(x)`, so it can run before OR after the runtime's own `compileGraph` shaping.
 * - Types Reference's normaliser never translated (the Instagram, Facebook, Telegram and call-assistant families, `trigger`, `end`) come
 *   back as an untouched copy, exactly as Reference's "unmapped types fall through as-is".
 *
 * Not done here because it needs the database (Reference hydrated them in the same method): the `template` row (body, buttons, variable
 * map) and the `wa_form` live check. The runtime reads those through its own services (`TemplatesService.findForFlow`,
 * `WaFormRecords.liveForm`).
 *
 * Deliberate differences from the PHP, each because our ids are UUIDs and not integers:
 * - `ai.assistant_id` and `ai_call.assistantId` are integers only when the editor saved an integer; a UUID is never cast (PHP's `(int)`
 *   would turn `3fa8...` into 3). `template.tplId` becomes `templateId` the same way.
 * - `book_appointment.bookingTypeId` stays a string (the id of the booking type); `0` still means "every service" and becomes `''`.
 */

export interface FlbRuntimeShapeOptions {
  /**
   * The public origin (`https://app.example.com`) a relative media path is made absolute with (Reference's `absoluteUrl`). Without it a
   * relative path is left as saved (our media are stored as full URLs).
   */
  baseUrl?: string;
}

/** The loose node the shaper accepts: a saved builder node (`type`) or a legacy one that only carries `flowNodeType`. */
export interface FlbShapeableNode {
  type?: unknown;
  flowNodeType?: unknown;
  data?: unknown;
}

type Bag = Record<string, unknown>;

// --- PHP semantics (the reference is PHP: casts and `??` are part of the contract) -------------------------------------------

const isNil = (v: unknown): v is null | undefined => v === undefined || v === null;
const isRecord = (v: unknown): v is Bag => typeof v === 'object' && v !== null && !Array.isArray(v);

/** PHP `??` over several candidates: the first that is not null. */
const coalesce = (...vs: unknown[]): unknown => vs.find((v) => !isNil(v));

/** PHP `(string)` of a scalar; a missing value is `fallback` (the `?? 'default'` of the PHP). */
function s(v: unknown, fallback = ''): string {
  if (isNil(v)) return fallback;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  if (typeof v === 'boolean') return v ? '1' : '';
  return '';
}

const NUM = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

/** PHP `(float)`: the leading number of a string, else 0. */
function toFloat(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const m = NUM.exec(v);
    const n = m ? Number(m[0]) : 0;
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** PHP `(int)`: truncated toward zero. */
const toInt = (v: unknown): number => Math.trunc(toFloat(v)) || 0;

/** PHP `is_numeric`. */
const isNumeric = (v: unknown): boolean =>
  typeof v === 'number'
    ? Number.isFinite(v)
    : typeof v === 'string' && /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/.test(v);

/** PHP `(bool)`: false for nothing, 0, "0", "" and an empty array. */
function toBool(v: unknown): boolean {
  if (isNil(v)) return false;
  if (typeof v === 'string') return v !== '' && v !== '0';
  if (typeof v === 'number') return v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

/** PHP `(array)` followed by `array_values`. */
function list(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (isNil(v)) return [];
  if (isRecord(v)) return Object.values(v);
  return [v];
}

/** PHP `mb_substr($s, 0, $n)`: counts characters, not UTF-16 units. */
const cut = (v: string, n: number): string => Array.from(v).slice(0, n).join('');

/** An id the editor saved that really is an integer (a Reference-era id); a UUID or free text is 0, never a leading-digits accident. */
function strictInt(v: unknown): number {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : 0;
  if (typeof v === 'string' && /^\s*\d+\s*$/.test(v)) return Number(v.trim());
  return 0;
}

/**
 * Reference's `cleanVar`: a variable NAME the author typed as `{{name}}`, `@name` or ` name ` becomes `name`; nothing usable is the
 * default. (The runtime's own `cleanVar` is slightly stricter and runs again; both agree on every normal name.)
 */
export function flbCleanVarName(v: unknown, fallback = ''): string {
  const t = s(v).trim();
  if (t === '') return fallback;
  const unwrapped = t
    .replace(/^\s*\{\{\s*|\s*\}\}\s*$/g, '')
    .replace(/^[ \t\r\n@{}]+|[ \t\r\n@{}]+$/g, '');
  return unwrapped !== '' ? unwrapped : fallback;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Reference's `absoluteUrl`: a dynamic `{{var}}` and anything with a scheme pass through; a relative path gets the origin when known. */
function absoluteUrl(raw: string, baseUrl: string | undefined): string {
  const u = raw.trim();
  if (u === '' || u.includes('{{') || SCHEME.test(u) || !baseUrl) return u;
  return `${baseUrl.replace(/\/+$/, '')}/${u.replace(/^\/+/, '')}`;
}

/** The variable-name alias a node saves under `save` and the runtime reads as `variable`. An existing `variable` survives a blank `save`. */
function variableFrom(d: Bag, source: string, fallback: string): string {
  const own = s(d[source]).trim();
  return flbCleanVarName(own !== '' ? own : d.variable, fallback);
}

// --- per type ----------------------------------------------------------------------------------------------------------------

const REPLY_KINDS: Record<string, string> = {
  text: 'Text',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  document: 'Document',
};
const CTA_TYPES = ['url', 'phone', 'call_now', 'copy'];
const UNIT_SECONDS: Record<string, number> = {
  sec: 1,
  second: 1,
  seconds: 1,
  min: 60,
  minute: 60,
  minutes: 60,
  hour: 3600,
  hours: 3600,
  day: 86400,
  days: 86400,
};

function ctaActionsOf(d: Bag): Array<{ type: string; label: string; value: string }> {
  let raw: unknown[];
  if (Array.isArray(d.actions)) raw = d.actions;
  else if (Array.isArray(d.ctaActions))
    raw = d.ctaActions; // already runtime-named (a flow saved before the editor)
  else {
    // The legacy single-kind shape (`kind` + `url` / `phone` / `code`) becomes one action.
    let kind = s(d.kind, 'url').toLowerCase();
    if (!CTA_TYPES.includes(kind)) kind = 'url';
    const value =
      kind === 'phone' || kind === 'call_now' ? s(d.phone) : kind === 'copy' ? s(d.code) : s(d.url);
    raw = [{ type: kind, label: s(d.label), value }];
  }
  return raw.slice(0, 3).map((a) => {
    const r = isRecord(a) ? a : {};
    let type = s(r.type, 'url').toLowerCase();
    if (!CTA_TYPES.includes(type)) type = 'url';
    return { type, label: s(r.label), value: s(r.value) };
  });
}

function productItemsOf(d: Bag): Array<Record<string, unknown>> {
  let picked: unknown[] = Array.isArray(d.productItems) ? d.productItems : [];
  if (picked.length === 0 && Array.isArray(d.productIds)) {
    picked = d.productIds.map((rid) => ({ retailer_id: s(rid) }));
  }
  if (picked.length === 0 && toBool(d.product)) picked = [{ retailer_id: s(d.product) }];
  return picked
    .filter(isRecord)
    .map((p) => ({
      retailer_id: s(coalesce(p.retailer_id, p.retailerId)),
      name: s(p.name),
      image: s(p.image),
      price_minor: toInt(coalesce(p.price_minor, p.priceMinor)),
      currency: s(p.currency),
      url: s(p.url),
    }))
    .filter((p) => p.retailer_id !== '')
    .slice(0, 30);
}

function shapeFields(d: Bag): string[] {
  let raw: unknown = coalesce(d.fields, []);
  if (typeof raw === 'string') raw = raw === '' ? [] : raw.trim().split(/\s*,\s*/);
  return list(raw)
    .map((f) => s(isRecord(f) ? coalesce(f.key, f.name, '') : f).trim())
    .filter((f) => f !== '' && f !== '0'); // PHP's array_filter without a callback also drops "0"
}

type Shaper = (d: Bag, o: FlbRuntimeShapeOptions) => Bag;

/** The retry, wrong-reply, skip and timeout settings the Ask-for-file and Ask-for-location nodes share. */
function askWaitSettings(d: Bag, fallbackReply: string): Bag {
  const retries = isNil(d.retries) ? 2 : toInt(d.retries);
  const mode = s(d.onFail, 'continue');
  const minutes = toInt(d.timeoutMinutes);
  return {
    maxRetries: Math.min(FLB_ASK_MAX_RETRIES, Math.max(0, retries)),
    wrongReplyText: s(d.wrongReply).trim() === '' ? fallbackReply : s(d.wrongReply),
    skipKeyword: s(d.skipKeyword).trim(),
    onGiveUp: (FLB_ASK_GIVE_UP_MODES as readonly string[]).includes(mode)
      ? (mode as FlbAskGiveUp)
      : 'continue',
    timeoutMinutes: Math.max(0, minutes),
  };
}

const SHAPERS: Record<string, Shaper> = {
  message: (d) => ({ flowReplies: [{ flowReplyType: 'Text', data: s(d.text) }] }),

  sequence: (d, o) => ({
    flowReplies: list(d.replies).map((r) => {
      const rec = isRecord(r) ? r : {};
      const kind = REPLY_KINDS[s(rec.type, 'text').toLowerCase()] ?? 'Text';
      if (kind === 'Text') return { flowReplyType: kind, data: s(rec.text) };
      return {
        flowReplyType: kind,
        data: absoluteUrl(s(coalesce(rec.url, rec.mediaUrl, rec.fileUrl)), o.baseUrl),
        filename: s(rec.filename),
        caption: s(rec.caption),
      };
    }),
  }),

  media: (d, o) => {
    const url = absoluteUrl(s(coalesce(d.url, d.mediaUrl, d.fileUrl, d.media, d.file)), o.baseUrl);
    return {
      mediaKind: s(coalesce(d.kind, d.mediaKind), 'image').toLowerCase(),
      mediaUrl: url,
      mediaCaption: s(d.caption),
      mediaFilename: s(d.filename),
      mediaMimetype: s(d.mimetype),
      // The runtime reads `url` first, so a relative path is made absolute there too (only when an origin is known).
      ...(o.baseUrl && typeof d.url === 'string' && d.url.trim() !== '' ? { url } : {}),
    };
  },

  notify_number: (d, o) => {
    const kind = s(coalesce(d.kind, d.mediaKind), 'text').toLowerCase();
    const url = absoluteUrl(s(coalesce(d.url, d.mediaUrl)), o.baseUrl);
    return {
      copyNumber: s(d.copyNumber).replace(/[^0-9{}\w]/g, ''),
      source: d.source === 'custom' ? 'custom' : 'mirror',
      kind,
      text: s(d.text),
      mediaKind: kind === 'text' ? '' : kind,
      mediaUrl: url,
      mediaCaption: s(d.caption),
      mediaFilename: s(d.filename),
      ...(o.baseUrl && typeof d.url === 'string' && d.url.trim() !== '' ? { url } : {}),
    };
  },

  wa_to_instagram: (d) => ({
    igUsername: s(d.igUsername).trim().replace(/^@+/, ''),
    introText: s(d.introText, 'Continue with us on Instagram'),
  }),

  wa_form: (d) => ({
    formId: s(d.formId),
    bodyText: s(d.bodyText, 'Please tap below to fill out our form.'),
    ctaLabel: s(d.ctaLabel, 'Open form'),
    flowVariable: flbCleanVarName(d.flowVariable, 'form_submission'),
  }),

  google_meet: (d) => ({
    title: s(d.title, 'WhatsApp consultation'),
    durationMinutes: isNil(d.durationMinutes) ? 30 : toInt(d.durationMinutes),
    leadMinutes: isNil(d.leadMinutes) ? 5 : toInt(d.leadMinutes),
    sendCalendarInvite: toBool(d.sendCalendarInvite),
    messageTemplate: s(
      d.messageTemplate,
      'Your meeting link: {{meet_link}}\nStarts at {{meet_start}}',
    ),
  }),

  google_sheets: (d) => ({
    mode: s(d.mode, 'write'),
    sheetId: s(d.sheetId),
    tabName: s(d.tabName),
    columns: Array.isArray(d.columns) ? d.columns : [],
    matchColumn: s(d.matchColumn),
    matchValue: s(d.matchValue),
    saveAs: flbCleanVarName(d.saveAs, 'sheet_row'),
    matchByHeader: toBool(d.matchByHeader),
  }),

  google_docs: (d) => ({
    templateId: s(d.templateId),
    newTitle: s(d.newTitle, 'Document for {{name}}'),
    placeholders: Array.isArray(d.placeholders) ? d.placeholders : [],
    shareable: isNil(d.shareable) ? true : toBool(d.shareable),
    messageTemplate: s(d.messageTemplate, "Here's your document: {{doc_url}}"),
    saveAs: flbCleanVarName(d.saveAs, 'doc_url'),
  }),

  google_form: (d) => ({
    formId: s(d.formId),
    bodyText: s(d.bodyText, 'Please fill out this short form:'),
    saveAs: flbCleanVarName(d.saveAs, 'google_form'),
    expiresInSec: isNil(d.expiresInSec) ? 86400 : toInt(d.expiresInSec),
  }),

  template: (d) => {
    const id = strictInt(d.tplId);
    return {
      templateName: s(coalesce(d.tpl, d.templateName)),
      preview: s(d.preview),
      ...(id > 0 ? { templateId: id } : {}),
    };
  },

  list: (d) => ({
    headerText: '',
    bodyText: s(d.prompt, 'Please choose:'),
    buttonText: s(d.button, 'View options'),
    listItems: list(d.options).map((opt, i) => {
      const rec = isRecord(opt) ? opt : null;
      return {
        id: `p${i}`,
        title: cut(typeof opt === 'string' ? opt : s(rec?.title, `Option ${i + 1}`), 24),
        description: rec ? cut(s(rec.description), 72) : '',
        section: rec ? cut(s(rec.section), 24) : '',
      };
    }),
    variable: flbCleanVarName(d.var, 'choice'),
    savePropertyKey: toBool(d.saveProperty) ? s(d.propertyKey).trim() : '',
  }),

  buttons: (d) => ({
    headerText: '',
    bodyText: s(d.prompt, 'Please choose:'),
    buttons: list(d.options).map((opt, i) => ({
      id: `p${i}`,
      title:
        typeof opt === 'string' ? opt : s(isRecord(opt) ? opt.title : undefined, `Option ${i + 1}`),
    })),
    variable: flbCleanVarName(d.var, 'choice'),
    savePropertyKey: toBool(d.saveProperty) ? s(d.propertyKey).trim() : '',
  }),

  ask: (d) => {
    const retries = isNil(d.retries) ? 0 : toInt(d.retries);
    const mode = s(d.onFail, 'continue');
    return {
      question: s(d.prompt),
      variable: flbCleanVarName(d.var, 'answer'),
      acceptMedia: toBool(d.acceptMedia),
      expectedAnswers: list(coalesce(d.options, d.expected, []))
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter((v) => v !== ''),
      // The checked answer (not Reference: its Ask saved "Validate as" and never read it). `maxRetries` 0 keeps asking, as the console does.
      inputType: flbCleanAskInputType(d.validate),
      dateFormat: flbCleanDateFormat(d.dateFormat),
      wrongReplyText: s(d.wrongReply).trim(),
      maxRetries: Math.min(FLB_ASK_MAX_RETRIES, Math.max(0, retries)),
      onGiveUp: (FLB_ASK_GIVE_UP_MODES as readonly string[]).includes(mode) ? mode : 'continue',
      savePropertyKey: toBool(d.saveProperty) ? s(d.propertyKey).trim() : '',
    };
  },

  // Not Reference nodes (TW-FLB-081, 082): the runtime reads `question` / `variable` like Ask, plus the shared wait settings.
  ask_file: (d) => ({
    question: s(d.prompt),
    variable: flbCleanVarName(d.var, 'file'),
    extensions: flbCleanAskFileExtensions(d.extensions),
    savePropertyKey: toBool(d.saveProperty) ? s(d.propertyKey).trim() : '',
    ...askWaitSettings(d, 'That is not a file we can accept. Please send it as an attachment.'),
  }),
  ask_location: (d) => ({
    question: s(d.prompt),
    variable: flbCleanVarName(d.var, 'location'),
    interactive: isNil(d.interactive) ? true : toBool(d.interactive),
    ...askWaitSettings(
      d,
      'Please share your location with the attachment (+) menu, then Location.',
    ),
  }),

  condition: (d) => {
    const conditions = Array.isArray(d.conditions)
      ? d.conditions.map((c) => {
          const r = isRecord(c) ? c : {};
          return {
            variable: flbCleanVarName(r.variable, ''),
            operator: s(r.operator, 'equals'),
            value: s(r.value),
          };
        })
      : [{ variable: flbCleanVarName(d.var, ''), operator: s(d.op, 'equals'), value: s(d.value) }];
    const first = conditions[0] ?? { variable: '', operator: 'equals', value: '' };
    // The optional nested tree (beyond Reference): sanitised, and absent when the node only has the flat chain.
    const conditionGroup = flbSanitizeConditionGroup(d.conditionGroup, (v) =>
      flbCleanVarName(v, ''),
    );
    return {
      ...(conditionGroup ? { conditionGroup } : {}),
      conditions,
      logicOperators: list(d.operators).map((o) => (s(o).toUpperCase() === 'OR' ? 'OR' : 'AND')),
      variable: first.variable,
      operator: first.operator,
      compareValue: first.value,
    };
  },

  delay: (d) => ({
    delaySeconds: (isNil(d.amount) ? 5 : toInt(d.amount)) * (UNIT_SECONDS[s(d.unit, 'min')] ?? 60),
  }),

  webhook: (d) => ({
    method: s(d.method, 'POST').toUpperCase(),
    url: s(d.url),
    body: s(d.body),
    variable: variableFrom(d, 'save', 'response'),
    contentType: s(d.contentType, 'application/json'),
    headers: list(d.headers)
      .filter(isRecord)
      .map((h) => ({ key: s(h.key), value: s(h.value) }))
      .filter((h) => h.key !== ''),
  }),

  mysql: (d) => ({
    host: s(d.host),
    port: isNil(d.port) ? 3306 : toInt(d.port),
    database: s(d.database),
    username: s(d.username),
    password: s(d.password),
    sql: s(d.sql),
    variable: variableFrom(d, 'save', 'rows'),
  }),

  code: (d) => ({ code: s(d.code), variable: variableFrom(d, 'save', 'result') }),

  subflow: (d) => {
    // `flow` is the picked flow. Both runtime names are set from it, so a stale `selectedFlowId` can never win.
    if (isNil(d.flow)) return {};
    const id = s(d.flow);
    return { flowId: id, selectedFlowId: id };
  },

  assign: (d) => ({ teamId: s(d.team), userId: s(d.userId), noteForAgent: s(d.message) }),

  tag: (d) => ({
    action: s(d.action, 'add').toLowerCase() === 'remove' ? 'remove' : 'add',
    tagId: s(d.tagId),
    tag: s(d.tag),
  }),

  deal: (d) => ({
    action: s(d.action, 'create').toLowerCase() === 'move' ? 'move' : 'create',
    dealName: s(d.dealName, '{{contact_name}} — deal'),
    stageId: s(d.stageId),
    dealValue: s(d.value),
    ownerId: s(d.ownerId),
    saveAs: flbCleanVarName(d.saveAs, 'deal_id'),
  }),

  ai: (d) => {
    const aid = strictInt(coalesce(d.assistant, d.assistant_id, 0));
    return {
      model: s(d.model, 'gpt-4o-mini'),
      prompt: s(d.prompt),
      variable: variableFrom(d, 'save', 'reply'),
      assistant_id: aid > 0 ? aid : null,
      extract: toBool(d.extract),
      silent: toBool(d.silent),
      conversational: toBool(d.conversational),
      exit_keyword: s(d.exit_keyword),
      fields: shapeFields(d),
      ...(!isNil(d.temperature) && isNumeric(d.temperature)
        ? { temperature: toFloat(d.temperature) }
        : {}),
      ...(!isNil(d.maxTokens) && isNumeric(d.maxTokens) ? { maxTokens: toInt(d.maxTokens) } : {}),
    };
  },

  cta: (d) => {
    const actions = ctaActionsOf(d);
    const first = actions[0] ?? { type: 'url', label: '', value: '' };
    const isPhone = first.type === 'phone' || first.type === 'call_now';
    return {
      ctaActions: actions,
      headerText: s(d.headerText),
      bodyText: s(d.bodyText),
      footerText: s(d.footerText),
      ctaType: first.type,
      ctaLabel: first.label || 'Visit',
      ctaUrl: isPhone ? `tel:${first.value.replace(/\s+/g, '')}` : first.value,
      ctaPhone: isPhone ? first.value : '',
      ctaCode: first.type === 'copy' ? first.value : '',
    };
  },

  location: (d) => ({
    latitude: toFloat(coalesce(d.lat, d.latitude)),
    longitude: toFloat(coalesce(d.lng, d.longitude)),
    address: s(d.address),
    title: s(d.title),
  }),

  poll: (d) => ({
    question: s(d.question, 'Pick one'),
    options: list(d.options),
    allowMultiple: toBool(coalesce(d.multi, d.allowMultiple)),
  }),

  chatbot: (d) => {
    // `bot` is the AI agent. Both runtime names (`agentId` new, `botId` legacy) follow it.
    if (isNil(d.bot)) return {};
    const id = s(d.bot);
    return { agentId: id, botId: id };
  },

  book_appointment: (d) => {
    const pinned = s(d.bookingTypeId).trim();
    return {
      slotCount: isNil(d.slotCount) ? 5 : toInt(d.slotCount),
      prompt: s(d.prompt, 'Pick a time that works for you:'),
      confirmation: s(d.confirmation, '✅ Booked! See you on {{slot}}.'),
      calendarOverride: s(d.calendarOverride),
      collectEmail: toBool(d.collectEmail),
      bookingTypeId: pinned === '0' ? '' : pinned,
    };
  },

  ai_call: (d) => {
    const n = strictInt(d.assistantId);
    // An integer id is normalised; a UUID (ours) is left exactly as saved for the runtime to resolve.
    if (n > 0) return { assistantId: n };
    return typeof d.assistantId === 'string' &&
      d.assistantId.trim() !== '' &&
      !/^\s*0+\s*$/.test(d.assistantId)
      ? {}
      : { assistantId: 0 };
  },

  // Call flow (voice IVR), flat fields for the call runtime.
  cf_say: (d) => ({ text: s(d.text) }),
  cf_listen: (d) => ({
    variable: variableFrom(d, 'save', 'caller_said'),
    silenceTimeout: isNil(d.silenceTimeout) ? 6 : toInt(d.silenceTimeout),
  }),
  cf_ai: (d) => {
    const aid = strictInt(coalesce(d.assistant, 0));
    return {
      model: s(d.model, 'gpt-4o-mini'),
      prompt: s(d.prompt),
      variable: variableFrom(d, 'save', 'ai_reply'),
      assistant_id: aid > 0 ? aid : null,
      endOnGoodbye: isNil(d.endOnGoodbye) ? true : toBool(d.endOnGoodbye),
    };
  },
  cf_menu: (d) => ({
    routeBy: s(d.mode, 'intent'),
    options: list(d.options).map((o) => {
      const r = isRecord(o) ? o : {};
      return { match: s(r.match), label: s(r.label) };
    }),
  }),
  cf_search: (d) => ({
    query: s(d.query),
    variable: variableFrom(d, 'save', 'search'),
    filler: s(d.filler),
  }),
  cf_transfer: (d) => ({ number: s(d.number), message: s(d.message) }),
  cf_hangup: (d) => ({ goodbye: s(d.goodbye) }),
};

for (const provider of ['whatsapp_shop', 'woocommerce', 'shopify'] as const) {
  SHAPERS[provider] = (d) => ({
    provider,
    storeId: s(d.storeId),
    headerText: s(d.headerText),
    bodyText: s(d.bodyText, 'Tap a product to see details:'),
    footerText: s(d.footerText),
    abandonedWaitMinutes: isNil(d.abandonedWaitMinutes) ? 5 : toInt(d.abandonedWaitMinutes),
    productItems: productItemsOf(d),
  });
}

/** The node types this shaper translates (every other type comes back as an untouched copy). */
export const FLB_RUNTIME_SHAPED_TYPES: readonly string[] = Object.keys(SHAPERS);

/**
 * The `data` bag the runtime executors read for one builder node: the original fields plus the runtime-named ones Reference's
 * FlowNormalizer would add. See the file comment for the contract (pure, additive, idempotent).
 */
export function flbToRuntimeData(
  node: FlbShapeableNode,
  options: FlbRuntimeShapeOptions = {},
): FlbNodeData {
  const data: Bag = isRecord(node.data) ? node.data : {};
  const type = s(coalesce(node.type, node.flowNodeType));
  const shape = Object.prototype.hasOwnProperty.call(SHAPERS, type) ? SHAPERS[type] : undefined;
  return shape ? { ...data, ...shape(data, options) } : { ...data };
}

/**
 * A graph with every node's `data` shaped by `flbToRuntimeData` (ids, positions, `isStart`, edges and vars are untouched). Accepts the
 * saved graph or any loose `{ flowNodes, flowEdges, vars }`; the input is not mutated.
 */
export function flbRuntimeNodeData<G extends { flowNodes: ReadonlyArray<FlbShapeableNode> }>(
  graph: G,
  options: FlbRuntimeShapeOptions = {},
): G {
  return {
    ...graph,
    flowNodes: graph.flowNodes.map((n) => ({ ...n, data: flbToRuntimeData(n, options) })),
  } as G;
}
