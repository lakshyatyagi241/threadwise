import { shapeCommerceNode } from './commerce-shapes';
import type { RuntimeEdge, RuntimeGraph, RuntimeNode } from './runtime-graph';

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
  list: 'List',
  ask: 'Question',
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
  trigger: 'Trigger',
  end: 'End',
};

/** The handle names that mean a fixed port on a node type (TW-FLR-013 rule 5). The rest are `pN` (option N+1) or `else` (0). */
const PORT_MAP: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  condition: { yes: 1, no: 2 },
  book_appointment: { booked: 1, no_slots: 2 },
  whatsapp_shop: { purchased: 1, abandoned: 2 },
  woocommerce: { purchased: 1, abandoned: 2 },
  shopify: { purchased: 1, abandoned: 2 },
  google_form: { submitted: 1, timeout: 2 },
  deal: { created: 1, error: 2 },
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

/**
 * A variable-name field as the author typed it: one surrounding `{{ }}`, a leading `@`, braces and spaces are dropped, so an Ask
 * never stores under a literal key `{{name}}` (TW-FLR-013 rule 7).
 */
export function cleanVar(v: unknown, fallback: string): string {
  let s = str(v).trim();
  if (s === '') return fallback;
  s = s
    .replace(/^\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')
    .replace(/^@/, '')
    .replace(/[{}\s]/g, '');
  return s === '' ? fallback : s;
}

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
      };
    }
    case 'buttons': {
      const opts = arr(data.options);
      return {
        bodyText: str(data.prompt, 'Please choose:'),
        buttons: opts.map((o, i) => ({
          id: `p${i}`,
          title: typeof o === 'string' ? o : str(obj(o).title, `Option ${i + 1}`),
        })),
        variable: cleanVar(data.var, 'choice'),
        footerText: str(data.footerText),
        keepMenuOpen: data.keepMenuOpen !== false,
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
      return {
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
          })),
      };
    case 'location':
      return {
        latitude: Number(data.latitude) || 0,
        longitude: Number(data.longitude) || 0,
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
    const mapped = TYPE_MAP[builderType] ?? (str(n.flowNodeType) || ucfirst(builderType));
    nodes.push({ id, type: mapped, props: shapeNode(builderType, obj(n.data)) });
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
  return { nodes, edges, vars: obj(g.vars) };
}

function ucfirst(s: string): string {
  return s === '' ? s : s[0]!.toUpperCase() + s.slice(1);
}
