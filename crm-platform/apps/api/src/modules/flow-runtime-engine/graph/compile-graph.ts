import {
  flbAskNeedsInputCheck,
  flbCleanAgeWhenUnder,
  flbCleanAskInputType,
  flbCleanMinAge,
  flbParseCoordinate,
  flbSanitizeConditionGroup,
  flbToRuntimeData,
  flbCleanCarouselCards,
} from '@crm/contracts';
import { shapeCommerceNode } from './commerce-shapes';
import type { RuntimeEdge, RuntimeGraph, RuntimeNode } from './runtime-graph';
import { cleanVar } from './clean-var';

/** What the editor saves (TW-FLR-013): nodes with a lower-case `type` and a `data` bag, edges with a source handle. */
export interface BuilderNode {
  id?: unknown;
  type?: unknown;
  flowNodeType?: unknown;
  isStart?: unknown;
  data?: unknown;
}
export interface BuilderEdge {
  source?: unknown;
  sourceHandle?: unknown;
  target?: unknown;
}
export interface BuilderGraph {
  flowNodes?: BuilderNode[];
  flowEdges?: BuilderEdge[];
  vars?: unknown;
}

/** Builder `type` to executor name. A type missing here keeps its own name and the runtime warns and moves on (TW-FLR-016 rule 4). */
export const TYPE_MAP: Readonly<Record<string, string>> = {
  message: 'Message',
  sequence: 'Message',
  media: 'Media',
  notify_number: 'NotifyNumber',
  wa_to_instagram: 'WaToInstagram',
  google_meet: 'GoogleMeet',
  wa_form: 'WaForm',
  template: 'Template',
  buttons: 'InteractiveButtons',
  carousel: 'Carousel',
  list: 'List',
  ask: 'Question',
  ask_file: 'AskFile',
  ask_location: 'AskLocation',
  condition: 'Condition',
  delay: 'TimeDelay',
  webhook: 'Webhook',
  code: 'Code',
  mysql: 'MySQL',
  subflow: 'SubFlow',
  assign: 'AssignAgent',
  tag: 'TagContact',
  whatsapp_shop: 'CommerceShop',
  woocommerce: 'CommerceShop',
  shopify: 'CommerceShop',
  ai: 'ChatGPT',
  cta: 'CTA',
  location: 'Location',
  poll: 'Poll',
  chatbot: 'Chatbot',
  book_appointment: 'BookAppointment',
  ai_call: 'AiCall',
  google_sheets: 'GoogleSheets',
  google_docs: 'GoogleDocs',
  google_form: 'GoogleForm',
  deal: 'Deal',
  api_library: 'ApiLibrary',
  faq: 'Faq',
  trigger: 'Trigger',
  end: 'End',
  // Instagram and Messenger nodes that are the shared nodes under another name (TW-FLR-061, 062): same executor, the editor's own fields.
  ig_send_dm: 'Message',
  ig_ask: 'Question',
  ig_quick: 'InteractiveButtons',
  ig_buttons: 'CTA',
  ig_ai: 'ChatGPT',
  ig_to_whatsapp: 'SocialHandoff',
  fb_to_whatsapp: 'SocialHandoff',
  // CRM steps and conditions beyond Tag (TW-FLR-072 to 077): the executor reads the editor's own `data`.
  update_contact: 'UpdateContact',
  list_member: 'ListMember',
  in_list: 'InList',
  in_segment: 'InSegment',
  wa_session: 'WaSession',
  sheet_check: 'SheetCheck',
  sheet_contact: 'SheetContact',
};

/** The handle names that mean a fixed port on a node type (TW-FLR-013 rule 5). The rest are `pN` (option N+1) or `else` (0). */
const PORT_MAP: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  condition: { yes: 1, no: 2 },
  book_appointment: { booked: 1, no_slots: 2 },
  // Human handoff (BL-398); the old single exit (`out`) is port 1 too.
  assign: { assigned: 1, waiting: 2, unavailable: 3 },
  whatsapp_shop: { purchased: 1, abandoned: 2 },
  woocommerce: { purchased: 1, abandoned: 2 },
  shopify: { purchased: 1, abandoned: 2 },
  google_form: { submitted: 1, timeout: 2 },
  deal: { created: 1, error: 2 },
  api_library: { success: 1, error: 2 },
  faq: { matched: 1, no_match: 2 },
  in_list: { yes: 1, no: 2 },
  in_segment: { yes: 1, no: 2 },
  wa_session: { yes: 1, no: 2 },
  sheet_check: { yes: 1, no: 2 },
};

const UNIT_SECONDS: Readonly<Record<string, number>> = {
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

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : v === undefined || v === null ? fallback : String(v);
const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const int = (v: unknown, fallback: number): number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : fallback;
};

export { cleanVar };

function replyType(kind: string): 'Text' | 'Image' | 'Video' | 'Audio' | 'Document' {
  switch (kind.toLowerCase()) {
    case 'image':
      return 'Image';
    case 'video':
      return 'Video';
    case 'audio':
      return 'Audio';
    case 'document':
      return 'Document';
    default:
      return 'Text';
  }
}

function shapeNode(type: string, data: Record<string, unknown>): Record<string, unknown> {
  const commerce = shapeCommerceNode(type, data);
  if (commerce) return commerce;
  switch (type) {
    case 'ig_send_dm':
      return shapeNode('message', data);
    case 'ig_ask':
      return shapeNode('ask', { ...data, prompt: data.question, var: data.save });
    case 'ig_quick':
      return shapeNode('buttons', { ...data, prompt: data.text, var: 'choice' });
    case 'ig_buttons':
      // A link button is a call-to-action; a postback button has no tap to wait for in a single-exit node, so only links are kept.
      return shapeNode('cta', {
        valueText: data.text,
        ctaActions: arr(data.buttons)
          .map(obj)
          .filter((b) => str(b.type, 'web_url') === 'web_url' && str(b.url) !== '')
          .map((b) => ({ type: 'url', label: str(b.title), value: str(b.url) })),
      });
    case 'ig_ai':
      return { data: { ...data, variable: cleanVar(data.save, 'ai_reply') } };
    case 'message':
      return { replies: [{ type: 'Text', data: str(data.text) }] };
    case 'sequence':
      return {
        replies: arr(data.replies).map((raw) => {
          const r = obj(raw);
          const t = replyType(str(r.type, 'text'));
          return t === 'Text'
            ? { type: t, data: str(r.text) }
            : {
                type: t,
                data: str(r.url ?? r.mediaUrl ?? r.fileUrl),
                filename: str(r.filename),
                caption: str(r.caption),
              };
        }),
      };
    case 'media':
      return {
        mediaKind: str(data.kind ?? data.mediaKind, 'image').toLowerCase(),
        mediaUrl: str(data.url ?? data.mediaUrl ?? data.fileUrl ?? data.media ?? data.file),
        caption: str(data.caption),
        filename: str(data.filename),
        mimeType: str(data.mimetype),
      };
    case 'list': {
      const opts = arr(data.options);
      return {
        bodyText: str(data.prompt, 'Please choose:'),
        buttonText: str(data.button, 'View options'),
        items: opts.map((o, i) => {
          const r = typeof o === 'string' ? { title: o } : obj(o);
          return {
            id: `p${i}`,
            title: str(r.title, `Option ${i + 1}`).slice(0, 24),
            description: str(r.description).slice(0, 72),
            section: str(r.section).slice(0, 24),
          };
        }),
        variable: cleanVar(data.var, 'choice'),
        footerText: str(data.footerText),
        savePropertyKey: str(data.savePropertyKey),
      };
    }
    case 'carousel': {
      // The reply buttons become the node's exits in card order (`p0`, `p1`, ...); a card's link buttons keep their kind and value.
      const cards = flbCleanCarouselCards(data.cards);
      let reply = 0;
      const buttons: Array<{ id: string; title: string }> = [];
      const handoffs: Record<string, { team: string; message: string }> = {};
      return {
        bodyText: str(data.text),
        cards: cards.map((c) => ({
          image: c.image,
          title: c.title,
          text: c.text,
          buttons: c.buttons.map((b) => {
            if (b.type !== 'reply' && b.type !== 'agent')
              return { kind: 'link', type: b.type, label: b.label, value: b.value };
            const i = reply++;
            if (b.type === 'agent')
              handoffs[String(i)] = { team: b.team ?? '', message: b.note ?? '' };
            const title = b.label || `Option ${i + 1}`;
            buttons.push({ id: `p${i}`, title });
            return { kind: 'reply', index: i, label: title };
          }),
        })),
        buttons,
        handoffs,
        variable: cleanVar(data.var, 'choice'),
      };
    }
    case 'buttons': {
      const opts = arr(data.options);
      return {
        bodyText: str(data.prompt, 'Please choose:'),
        buttons: opts.map((o, i) => {
          const icon = str(arr(data.optionIcons)[i]).trim();
          return {
            id: `p${i}`,
            title: typeof o === 'string' ? o : str(obj(o).title, `Option ${i + 1}`),
            ...(/^https?:\/\/\S+$/i.test(icon) ? { icon } : {}),
          };
        }),
        variable: cleanVar(data.var, 'choice'),
        footerText: str(data.footerText),
        savePropertyKey: str(data.savePropertyKey),
        keepMenuOpen: data.keepMenuOpen !== false,
        handoffs: cleanHandoffs(data.handoffs, opts.length),
        actions: cleanButtonActions(data.optionActions, opts.length),
      };
    }
    case 'ask':
      return {
        question: str(data.prompt),
        variable: cleanVar(data.var, 'answer'),
        acceptMedia: data.acceptMedia === true,
        expectedAnswers: arr(data.options ?? data.expected)
          .map((v) => (typeof v === 'string' ? v.trim() : ''))
          .filter((s) => s !== ''),
        footerText: str(data.footerText),
        // A checked answer (see AskInputNode); `flbToRuntimeData` has already normalised these.
        inputType: flbCleanAskInputType(data.inputType),
        dateFormat: str(data.dateFormat),
        wrongReplyText: str(data.wrongReplyText),
        ageMinAge: flbCleanMinAge(data.ageMinAge),
        ageWhenUnder: flbCleanAgeWhenUnder(data.ageWhenUnder),
        ageEndText: str(data.ageEndText),
        maxRetries: int(data.maxRetries, 0),
        onGiveUp: str(data.onGiveUp, 'continue'),
        savePropertyKey: str(data.savePropertyKey),
        verifyOtp: data.verifyOtp === true,
      };
    // Not Reference nodes (TW-FLB-081, 082). `flbToRuntimeData` has already normalised the wait settings.
    case 'ask_file':
    case 'ask_location':
      return {
        question: str(data.question ?? data.prompt),
        variable: cleanVar(data.variable ?? data.var, type === 'ask_file' ? 'file' : 'location'),
        ...(type === 'ask_file'
          ? {
              extensions: arr(data.extensions).map((e) => str(e)),
              savePropertyKey: str(data.savePropertyKey),
            }
          : { interactive: data.interactive !== false }),
        maxRetries: int(data.maxRetries, 2),
        wrongReplyText: str(data.wrongReplyText ?? data.wrongReply),
        skipKeyword: str(data.skipKeyword),
        onGiveUp: str(data.onGiveUp ?? data.onFail, 'continue'),
        timeoutMinutes: int(data.timeoutMinutes, 0),
      };
    case 'condition': {
      const raw = data.conditions;
      const conditions = Array.isArray(raw)
        ? raw.map((c) => ({
            variable: cleanVar(obj(c).variable, ''),
            operator: str(obj(c).operator, 'equals'),
            value: str(obj(c).value),
          }))
        : [
            {
              variable: cleanVar(data.var, ''),
              operator: str(data.op, 'equals'),
              value: str(data.value),
            },
          ];
      // The optional nested tree (beyond Reference): when valid it wins over the flat chain at run time.
      const conditionGroup = flbSanitizeConditionGroup(data.conditionGroup, (v) => cleanVar(v, ''));
      return {
        ...(conditionGroup ? { conditionGroup } : {}),
        conditions,
        logicOperators: arr(data.operators).map((o) =>
          str(o).toUpperCase() === 'OR' ? 'OR' : 'AND',
        ),
      };
    }
    case 'delay': {
      const mult = UNIT_SECONDS[str(data.unit, 'min')] ?? 60;
      return { delaySeconds: int(data.amount ?? 5, 5) * mult };
    }
    case 'poll':
      return {
        question: str(data.question),
        options: arr(data.options).map((o) => (typeof o === 'string' ? o : str(obj(o).text))),
        allowMultiple: data.allowMultiple === true,
      };
    case 'cta':
      return {
        headerText: str(data.headerText),
        bodyText: str(data.valueText ?? data.bodyText),
        footerText: str(data.footerText),
        actions: arr(data.ctaActions ?? data.actions)
          .slice(0, 3)
          .map((a) => ({
            type: str(obj(a).type, 'url').toLowerCase(),
            label: str(obj(a).label),
            value: str(obj(a).value),
            ...(str(obj(a).icon).trim() ? { icon: str(obj(a).icon).trim() } : {}),
          })),
      };
    case 'location':
      return {
        latitude: flbParseCoordinate(data.latitude),
        longitude: flbParseCoordinate(data.longitude),
        title: str(data.title ?? data.locationName ?? data.name),
        address: str(data.address),
      };
    default:
      // A node type without a compiler keeps its raw data: its executor (when it is built) reads it from here.
      return { data };
  }
}

/** The port a builder edge leaves by. */
function portOf(type: string, handle: unknown): number {
  const h = str(handle);
  const named = PORT_MAP[type]?.[h];
  if (named !== undefined) return named;
  if (h === 'else') return 0;
  const m = /^p(\d+)$/.exec(h);
  if (m) return Number(m[1]) + 1;
  return 1;
}

/**
 * Builder graph to runtime graph (TW-FLR-013). Pure: no database, no clock. The pinned start node (`isStart`) moves to the front,
 * else the first `trigger` node, else the order is kept; the runtime always begins at the first node.
 */
/**
 * "Hand over to a person" on a button: `{ "<exit index>": { team, message } }`, only for exits that exist. The compiler gives such an
 * exit its own Assign agent step when the author wired nothing to it.
 */
function cleanHandoffs(
  raw: unknown,
  exits: number,
): Record<string, { team: string; message: string }> {
  const out: Record<string, { team: string; message: string }> = {};
  for (const [k, v] of Object.entries(obj(raw))) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= exits) continue;
    const h = obj(v);
    out[String(i)] = { team: str(h.team).trim(), message: str(h.message).slice(0, 500) };
  }
  return out;
}

/**
 * What a button does when tapped, besides leading to the next step. `live_agent` is the `handoffs` above, not an action here. A `flow`
 * action hands the conversation to that flow; the opt actions carry on to the step wired after the button.
 */
export type ButtonAction =
  { type: 'flow'; flow: string } | { type: 'opt_in' } | { type: 'opt_out' };

/**
 * "Button pressed action" on a button: `{ "<exit index>": { type: "flow" | "opt_in" | "opt_out", flow? } }`, only for exits that exist.
 * The compiler gives such an exit its own step (Run sub-flow, or Opt in / Opt out of marketing) in front of whatever is wired after it.
 */
export function cleanButtonActions(raw: unknown, exits: number): Record<string, ButtonAction> {
  const out: Record<string, ButtonAction> = {};
  for (const [k, v] of Object.entries(obj(raw))) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= exits) continue;
    const a = obj(v);
    if (a.type === 'opt_in' || a.type === 'opt_out') out[String(i)] = { type: a.type };
    else if (a.type === 'flow' && str(a.flow).trim() !== '')
      out[String(i)] = { type: 'flow', flow: str(a.flow).trim() };
  }
  return out;
}

export function compileGraph(input: unknown): RuntimeGraph {
  const g = obj(input) as BuilderGraph;
  const raw = [...arr(g.flowNodes)].map(obj) as BuilderNode[];
  let start = raw.findIndex((n) => Boolean(n.isStart));
  if (start < 0) start = raw.findIndex((n) => n.type === 'trigger');
  if (start > 0) raw.unshift(raw.splice(start, 1)[0]!);

  const typeById = new Map<string, string>();
  const nodes: RuntimeNode[] = [];
  for (const n of raw) {
    const id = str(n.id);
    if (id === '') continue;
    const builderType = str(n.type ?? n.flowNodeType);
    typeById.set(id, builderType);
    const props = shapeNode(
      builderType,
      flbToRuntimeData({ type: builderType, data: obj(n.data) }),
    );
    // An Ask with "Validate as" set (and no fixed answers or file upload) is the checked question; every other Ask keeps Reference's.
    const mapped =
      builderType === 'ask' && flbAskNeedsInputCheck(props)
        ? 'AskInput'
        : (TYPE_MAP[builderType] ?? (str(n.flowNodeType) || ucfirst(builderType)));
    const given = str(obj(n.data).label ?? obj(n.data).name ?? obj(n.data).title).trim();
    nodes.push({ id, type: mapped, ...(given ? { label: given.slice(0, 80) } : {}), props });
  }

  const edges: RuntimeEdge[] = [];
  for (const e of arr(g.flowEdges).map(obj) as BuilderEdge[]) {
    const source = str(e.source);
    const target = str(e.target);
    if (source === '' || target === '') continue;
    edges.push({
      from: `${source}_${portOf(typeById.get(source) ?? '', e.sourceHandle)}`,
      to: target,
    });
  }
  // A Template node whose quick replies are wired to their own branches waits for the tap; one with no `pN` edge moves straight on.
  const tapWired = new Set(
    (arr(g.flowEdges).map(obj) as BuilderEdge[])
      .filter((e) => /^p\d+$/.test(str(e.sourceHandle)))
      .map((e) => str(e.source)),
  );
  for (const n of nodes) if (n.type === 'Template') n.props.buttonsWired = tapWired.has(n.id);
  // A button that hands the visitor to a person and has nothing wired after it gets its own Assign agent step.
  const wired = new Set(edges.map((e) => e.from));
  for (const n of [...nodes]) {
    for (const [idx, h] of Object.entries(obj(n.props.handoffs))) {
      const from = `${n.id}_${portOf(typeById.get(n.id) ?? '', `p${idx}`)}`;
      if (wired.has(from)) continue;
      const id = `${n.id}__agent_${idx}`;
      const give = obj(h);
      nodes.push({
        id,
        type: 'AssignAgent',
        props: shapeNode(
          'assign',
          flbToRuntimeData({
            type: 'assign',
            data: { team: str(give.team), message: str(give.message) },
          }),
        ),
      });
      edges.push({ from, to: id });
    }
  }
  // A button with an action runs that step first (a sub-flow, or the contact's marketing opt-in / opt-out), then goes on to whatever the
  // author wired to the button, if anything.
  for (const n of [...nodes]) {
    for (const [idx, action] of Object.entries(
      n.type === 'InteractiveButtons' ? (obj(n.props.actions) as Record<string, ButtonAction>) : {},
    )) {
      const from = `${n.id}_${portOf(typeById.get(n.id) ?? '', `p${idx}`)}`;
      const id = `${n.id}__action_${idx}`;
      nodes.push(
        action.type === 'flow'
          ? {
              id,
              type: 'SubFlow',
              props: shapeNode(
                'subflow',
                flbToRuntimeData({ type: 'subflow', data: { flow: action.flow } }),
              ),
            }
          : { id, type: 'ContactConsent', props: { data: { action: action.type } } },
      );
      const wiredEdge = edges.find((e) => e.from === from);
      if (wiredEdge) {
        // A sub-flow takes the run over for good (the engine does not return to this flow), so nothing carries on after it; the opt
        // steps do carry on to what the author wired.
        if (action.type !== 'flow') edges.push({ from: `${id}_1`, to: wiredEdge.to });
        wiredEdge.to = id;
      } else edges.push({ from, to: id });
    }
  }
  return { nodes, edges, vars: obj(g.vars) };
}

function ucfirst(s: string): string {
  return s === '' ? s : s[0]!.toUpperCase() + s.slice(1);
}
