import {
  flbAskFileAccepts,
  flbCleanAskFileExtensions,
  flbIsCondGroup,
  flbSanitizeConditionGroup,
  type FlbCondGroup,
  type FlowEdge,
  type FlowNode,
  type FlbTemplateButtonRef,
  type FlbTestWebhookRequest,
  type FlbTestWebhookResponse,
} from '@crm/contracts';
import { condSummary, listOption, nodeLabel } from '../../lib/contract-text';
import { type Translate } from '../../lib/msg';

/**
 * The Test runner engine (TW-FLB-024): walks the canvas graph in memory, no messages are sent. Framework-free: every side
 * effect (the webhook call, timers, logging) is injected so the whole thing runs synchronously under test.
 * Behavior and log copy follow Reference's `stepTest` / `sendTest` / `checkCond`.
 */

export type LogMedia = { kind: string; url: string; filename: string };
/** The tap targets of a Quick replies / List / Poll message: the panel draws them as buttons under the bubble, as WhatsApp does. */
export type LogChoices = {
  kind: 'buttons' | 'list' | 'poll';
  /** The message body without the numbered fallback lines. */
  prompt: string;
  labels: string[];
  /** The list's opener label ("Choose below"). */
  button?: string;
};
export type LogEntry = {
  kind: 'system' | 'user' | 'bot';
  text: string;
  media?: LogMedia;
  choices?: LogChoices;
};

/** Pause between two simulated steps, ms. */
export const STEP_DELAY_MS = 220;
/** Pause between the operator's first message and the first step, ms. */
export const START_DELAY_MS = 200;

/** A file the operator "sends" in the test run: nothing is uploaded, only what the runtime checks (name, MIME type). */
export interface SimFile {
  name: string;
  mime: string;
  caption?: string;
}
export interface SimLocation {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

/** Same default as the runtime (`maxRetries`): two more tries after a wrong reply. */
const askRetries = (d: Record<string, unknown>): number => {
  const n = Math.trunc(Number(d.retries ?? 2));
  return Math.min(10, Math.max(0, Number.isFinite(n) ? n : 2));
};
const MEDIA_KIND_OF_MIME = (mime: string): string => {
  const m = mime.toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'document';
};

export interface SimulatorOptions {
  /** The `flb` translator: the log lines are catalogue messages (`simulator.*`). */
  t: Translate;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Quick-reply buttons of the template a Send-template node points at (resolved by the web from the template list). */
  templateButtons?: (node: FlowNode) => FlbTemplateButtonRef[];
  /** Whether a Send template node's template exists in this workspace; when it does not, the test run says the real run skips it. */
  templateExists?: (node: FlowNode) => boolean;
  /** Name of a flow by id, for the Sub-flow node log line. */
  flowName?: (id: string) => string | undefined;
  /** Fires the real, server-guarded webhook request (the one thing the test run does for real). */
  callWebhook: (req: FlbTestWebhookRequest) => Promise<FlbTestWebhookResponse>;
  /** Runs `fn` after `ms`. Defaults to `setTimeout`. */
  schedule?: (fn: () => void, ms: number) => void;
  onLog: (entry: LogEntry) => void;
  /** Called when `start()` resets the transcript. */
  onReset?: () => void;
  onAwaiting: (awaiting: boolean) => void;
  /** Random source for the simulated order id. */
  random?: () => number;
}

export interface Simulator {
  /** (Re)start a run: the bot waits for the operator's first message. */
  start: () => void;
  /** The operator's message. */
  send: (text: string) => void;
  /** The operator answers an Ask for file / image node with a (fake) file: only its name, type and caption matter. */
  sendFile: (file: SimFile) => void;
  /** The operator answers an Ask for location node with a (fake) shared location. */
  sendLocation: (loc: SimLocation) => void;
  /** The node the run is parked on or executing; null before the first message and after the end. */
  current: () => FlowNode | null;
  /** Variables of the current run (a copy). */
  vars: () => Record<string, string>;
  /** Abandon the run: pending steps and webhook replies are ignored from now on. */
  stop: () => void;
}

type Rec = Record<string, unknown>;
type Vars = Record<string, string>;

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});

/** `{{ var }}`: spaces allowed, dotted keys (`response.field`) looked up literally, unknown names stay literal. */
const interp = (s: unknown, vars: Vars): string =>
  str(s).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k: string) => vars[k] ?? m);

/** Must agree with the runtime evaluator or the preview lies about which port fires live. */
export function checkCond(v: unknown, op: unknown, val: unknown): boolean {
  const a = str(v);
  const b = str(val);
  switch (op) {
    case 'equals':
      return a === b;
    case 'not_equals':
      return a !== b;
    case 'contains':
      return a.toLowerCase().includes(b.toLowerCase());
    case 'not_contains':
      return !a.toLowerCase().includes(b.toLowerCase());
    case 'gt':
      return parseFloat(a) > parseFloat(b);
    case 'lt':
      return parseFloat(a) < parseFloat(b);
    case 'exists':
      return a.trim() !== '';
  }
  return false;
}

export function createSimulator(opts: SimulatorOptions): Simulator {
  const { nodes, edges } = opts;
  const schedule = opts.schedule ?? ((fn: () => void, ms: number) => void setTimeout(fn, ms));
  const random = opts.random ?? Math.random;
  const tx = (key: string, values?: Record<string, string | number>) =>
    opts.t(`simulator.${key}`, values);
  const unitText = (unit: string) =>
    ['sec', 'min', 'hour', 'day'].includes(unit)
      ? opts.t(`builder.simple.editors.delay.${unit}`)
      : unit;

  let runId = 0;
  let vars: Vars = {};
  let current: FlowNode | null = null;
  let pendingStart: FlowNode | null = null;
  let expectedKeywords: string[] = [];
  /** Wrong replies given to the Ask for file / location node the run is parked on. */
  let askAttempts = 0;

  const log = (kind: LogEntry['kind'], text: string, media?: LogMedia, choices?: LogChoices) =>
    opts.onLog({ kind, text, ...(media ? { media } : {}), ...(choices ? { choices } : {}) });
  const sys = (t: string) => log('system', t);
  const bot = (t: string, media?: LogMedia, choices?: LogChoices) => log('bot', t, media, choices);

  const findNode = (id: string) => nodes.find((n) => n.id === id) ?? null;
  const stop = () => {
    current = null;
    opts.onAwaiting(false);
  };

  /** Run `fn` later, unless the run was restarted or stopped in the meantime. */
  const later = (ms: number, fn: () => void) => {
    const id = runId;
    schedule(() => {
      if (id === runId) fn();
    }, ms);
  };

  const stepTest = (node: FlowNode | null): void => {
    if (!node) {
      sys(tx('flowEnded'));
      stop();
      return;
    }
    current = node;
    const advance = (sourceHandle: string) => {
      const e = edges.find((x) => x.source === node.id && x.sourceHandle === sourceHandle);
      const next = e ? findNode(e.target) : null;
      if (!next) {
        sys(sourceHandle !== 'out' ? tx('noPathPort', { port: sourceHandle }) : tx('noPath'));
        stop();
        return;
      }
      later(STEP_DELAY_MS, () => stepTest(next));
    };
    const d = rec(node.data);
    const v = vars;
    switch (node.type) {
      case 'trigger':
        return advance('out');
      case 'message':
        bot(interp(d.text, v));
        return advance('out');
      case 'notify_number': {
        const num = interp(d.copyNumber, v) || tx('noNumber');
        const what =
          d.kind && d.kind !== 'text' ? `[${str(d.kind)}] ${interp(d.url, v)}` : interp(d.text, v);
        sys(tx('copySent', { number: num, what }));
        return advance('out');
      }
      case 'wa_to_instagram': {
        const u = str(d.igUsername).replace(/^@/, '') || tx('noUsername');
        bot(`${interp(d.introText, v)}\nhttps://ig.me/m/${u}`);
        return advance('out');
      }
      case 'sequence': {
        const reps = arr(d.replies);
        if (reps.length === 0) {
          bot(tx('sequenceEmpty'));
          return advance('out');
        }
        for (const raw of reps) {
          const r = rec(raw);
          const kind = (str(r.type) || 'text').toLowerCase();
          if (kind === 'text') bot(interp(r.text, v));
          else
            bot(r.caption ? interp(r.caption, v) : '', {
              kind,
              url: str(r.url || r.data),
              filename: str(r.filename),
            });
        }
        return advance('out');
      }
      case 'template': {
        if (opts.templateExists && !opts.templateExists(node)) {
          const msg = `Template "${str(d.tpl) || '?'}" is not a template of this workspace: the real run skips this node. Pick one of your approved templates in the node (the node holds the template's name).`;
          console.warn(`[flow-test] node ${node.id}: ${msg}`);
          sys(`⚠ ${msg}`);
        }
        const qr = opts.templateButtons?.(node) ?? [];
        const head = tx('templateHead', { name: str(d.tpl) || '?', preview: interp(d.preview, v) });
        if (qr.length) {
          bot(
            `${head}\n${qr.map((b, i) => `  ${i + 1}. ${b.label || opts.t('contracts.ports.button', { n: i + 1 })}`).join('\n')}`,
          );
          opts.onAwaiting(true);
          return;
        }
        bot(head);
        return advance('out');
      }
      case 'media': {
        const kind = (str(d.kind) || 'image').toLowerCase();
        if (!str(d.url || d.data)) {
          console.warn(`[flow-test] node ${node.id}: the media node has no link, nothing to send`);
          sys('⚠ This media node has no link: the real run sends only the caption.');
        }
        bot(d.caption ? interp(d.caption, v) : '', {
          kind,
          url: str(d.url || d.data),
          filename: str(d.filename),
        });
        return advance('out');
      }
      case 'buttons':
      case 'list':
      case 'poll': {
        const lines = arr(d.options)
          .map((o, i) => {
            if (typeof o === 'string') return `  ${i + 1}. ${o}`;
            const it = listOption(opts.t, o, i);
            return `  ${i + 1}. ${it.title}${it.description ? ` — ${it.description}` : ''}${it.section ? `   [${it.section}]` : ''}`;
          })
          .join('\n');
        const prompt = interp(d.prompt || d.question, v);
        const labels = arr(d.options).map((o, i) =>
          typeof o === 'string' ? o : listOption(opts.t, o, i).title,
        );
        const header = rec(d.header);
        const headerMedia =
          node.type === 'buttons' && str(header.type) === 'image' && str(header.link)
            ? { kind: 'image', url: str(header.link), filename: '' }
            : undefined;
        bot(`${prompt}\n${lines}`, headerMedia, {
          kind: node.type as 'buttons' | 'list' | 'poll',
          prompt,
          labels,
          ...(node.type === 'list' ? { button: str(d.button) || undefined } : {}),
        });
        opts.onAwaiting(true);
        return;
      }
      case 'ask':
        bot(interp(d.prompt, v));
        opts.onAwaiting(true);
        return;
      case 'ask_file':
        askAttempts = 0;
        bot(interp(d.prompt, v));
        sys(
          tx('waitingFile', {
            types: flbCleanAskFileExtensions(d.extensions).join(', ') || tx('anyType'),
          }),
        );
        opts.onAwaiting(true);
        return;
      case 'ask_location':
        askAttempts = 0;
        bot(interp(d.prompt, v));
        sys(d.interactive === false ? tx('waitingLocation') : tx('locationButton'));
        opts.onAwaiting(true);
        return;
      case 'condition': {
        // Walk the AND/OR chain; ops[i-1] joins rule i-1 and i. The legacy single shape (var/op/value) still works.
        const legacy = d.var ? [{ variable: d.var, operator: d.op, value: d.value }] : [];
        const conds = (Array.isArray(d.conditions) ? d.conditions : legacy).map(rec);
        const ops = arr(d.operators);
        let ok = false;
        // The nested tree (beyond Reference) wins over the flat chain, with the same per-rule check.
        const tree = flbSanitizeConditionGroup(d.conditionGroup);
        if (tree) {
          const walk = (g: FlbCondGroup): boolean => {
            if (g.items.length === 0) return false;
            const test = (i: FlbCondGroup['items'][number]) =>
              flbIsCondGroup(i) ? walk(i) : checkCond(v[i.variable] ?? '', i.operator, i.value);
            return g.op === 'or' ? g.items.some(test) : g.items.every(test);
          };
          ok = walk(tree);
          sys(tx(ok ? 'ifYes' : 'ifNo', { summary: condSummary(opts.t, tree) }));
          return advance(ok ? 'yes' : 'no');
        }
        if (conds.length > 0) {
          const first = conds[0]!;
          ok = checkCond(v[str(first.variable)] ?? '', first.operator, first.value);
          for (let i = 1; i < conds.length; i++) {
            const c = conds[i]!;
            const next = checkCond(v[str(c.variable)] ?? '', c.operator, c.value);
            ok = (ops[i - 1] || 'AND') === 'OR' ? ok || next : ok && next;
          }
        }
        const summary = conds
          .map(
            (c, i) =>
              `${i ? ` ${opts.t(str(ops[i - 1]).toUpperCase() === 'OR' ? 'contracts.cond.or' : 'contracts.cond.and')} ` : ''}${str(c.variable)} ${str(c.operator)} ${str(c.value)}`,
          )
          .join('');
        sys(tx(ok ? 'ifYes' : 'ifNo', { summary }));
        return advance(ok ? 'yes' : 'no');
      }
      case 'delay':
        sys(tx('waitSkipped', { amount: str(d.amount), unit: unitText(str(d.unit)) }));
        return advance('out');
      case 'webhook': {
        // The one real call: fired server-side (SSRF-guarded) so the operator can confirm the endpoint; the response is
        // saved to {{save}} and flattened to {{save.field}} for the nodes downstream.
        const wUrl = interp(d.url, v);
        if (!wUrl.trim()) {
          sys(tx('webhookNoUrl'));
          return advance('out');
        }
        const saveAs = str(d.save || d.variable) || 'response';
        sys(tx('calling', { method: str(d.method) || 'POST', url: wUrl }));
        const id = runId;
        const req: FlbTestWebhookRequest = {
          url: str(d.url),
          method: d.method === undefined ? undefined : str(d.method),
          body: d.body === undefined ? undefined : str(d.body),
          contentType: d.contentType === undefined ? undefined : str(d.contentType),
          headers: Array.isArray(d.headers)
            ? (d.headers as { key?: string; value?: string }[])
            : undefined,
          vars: v,
        };
        void opts
          .callWebhook(req)
          .then((j) => {
            if (id !== runId) return;
            if (j.ok) {
              v[saveAs] = j.response;
              if (j.json && typeof j.json === 'object') {
                for (const [k, val] of Object.entries(j.json))
                  v[`${saveAs}.${k}`] = typeof val === 'object' ? JSON.stringify(val) : String(val);
              }
              sys(
                tx(j.success ? 'httpOk' : 'httpNon2xx', { status: j.status, ref: `{{${saveAs}}}` }),
              );
            } else {
              v[saveAs] = '';
              sys(tx('webhookFailed', { error: j.error || tx('noResponse') }));
            }
          })
          .catch((e: unknown) => {
            if (id !== runId) return;
            v[saveAs] = '';
            sys(tx('webhookError', { error: e instanceof Error ? e.message : str(e) }));
          })
          .then(() => {
            // Only continue if this run was not restarted mid-flight.
            if (id === runId && current === node) advance('out');
          });
        return; // async: advance happens once the request settles
      }
      case 'code':
        sys(tx('runJs', { ref: `{{${str(d.save) || 'result'}}}` }));
        return advance('out');
      case 'mysql':
        sys(tx('query', { database: str(d.database) || 'db', sql: str(d.sql).slice(0, 48) }));
        return advance('out');
      case 'ai':
        bot(tx('aiReply', { model: str(d.model) || 'AI' }));
        return advance('out');
      case 'tag':
        sys(
          tx(str(d.action) === 'remove' ? 'tagRemove' : 'tagAdd', {
            tag: str(d.tag || d.tagId) || '?',
          }),
        );
        return advance('out');
      case 'assign':
        sys(
          d.userId
            ? tx('assignedUser', { team: str(d.team) || '?', user: str(d.userId) })
            : tx('assigned', { team: str(d.team) || '?' }),
        );
        return advance('out');
      case 'subflow': {
        const fid = str(d.flow);
        sys(tx('subflow', { name: opts.flowName?.(fid) ?? `#${fid || '?'}` }));
        return advance('out');
      }
      case 'cta': {
        const actions = arr(d.actions).map(rec);
        const lines = actions.length
          ? actions
              .map((a) => `[${str(a.type) || 'url'}] ${str(a.label)} → ${str(a.value)}`)
              .join('\n')
          : `[${str(d.kind) || 'url'}] ${str(d.label)} → ${str(d.url || d.phone || d.code)}`;
        bot(tx('cta', { lines }));
        return advance('out');
      }
      case 'location':
        bot(
          d.lat && d.lng
            ? tx('locationCoords', {
                name: str(d.name),
                address: str(d.address),
                lat: str(d.lat),
                lng: str(d.lng),
              })
            : tx('location', { name: str(d.name), address: str(d.address) }),
        );
        return advance('out');
      case 'chatbot':
        bot(tx('chatbot', { bot: str(d.bot) || '?' }));
        return advance('out');
      case 'whatsapp_shop':
      case 'woocommerce':
      case 'shopify': {
        const items = arr(d.productItems).map(rec);
        if (items.length === 0) {
          sys(tx('noProducts'));
          return advance('abandoned');
        }
        const list = items
          .map((p, i) => {
            const minor = Number(p.price_minor ?? p.priceMinor ?? 0);
            return `  ${i + 1}. ${str(p.name || p.retailer_id || p.retailerId)}${minor ? ` · ${(minor / 100).toFixed(2)} ${str(p.currency)}` : ''}`;
          })
          .join('\n');
        bot(
          tx('commerce', {
            type: node.type,
            body: interp(d.bodyText || tx('pickProduct'), v),
            list,
          }),
        );
        opts.onAwaiting(true);
        return;
      }
      case 'book_appointment': {
        const sample = [1, 2, 3, 4, 5].map((n) => tx(`slot${n}`));
        const slots = sample.slice(0, Math.max(1, Math.min(10, Number(d.slotCount) || 5)));
        bot(
          `${str(d.prompt) || tx('pickTime')}\n${slots.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`,
        );
        sys(tx('slotPicked'));
        return advance('booked');
      }
      case 'google_sheets': {
        const sheet = d.sheetId ? `${str(d.sheetId).slice(0, 10)}…` : tx('noSheet');
        const summary =
          d.mode === 'read'
            ? tx('sheetsLookup', {
                column: str(d.matchColumn) || '?',
                value: interp(d.matchValue, v),
                sheet,
              })
            : tx('sheetsAppend', { sheet, count: arr(d.columns).length });
        sys(tx('sheetsLine', { mode: (str(d.mode) || 'write').toUpperCase(), summary }));
        return advance('out');
      }
      case 'google_docs': {
        sys(
          tx('docsLine', {
            template: d.templateId ? `${str(d.templateId).slice(0, 10)}…` : tx('noTemplate'),
            title: interp(d.newTitle, v),
          }),
        );
        const mockUrl = 'https://docs.google.com/document/d/MOCKED/edit';
        bot(
          interp(d.messageTemplate || tx('docMessage', { url: mockUrl }), {
            ...v,
            doc_url: mockUrl,
          }),
        );
        return advance('out');
      }
      case 'google_form': {
        const mockUrl = `https://docs.google.com/forms/d/${str(d.formId) || 'MOCKED'}/viewform`;
        bot(`${interp(d.bodyText || tx('formPrompt'), v)}\n\n${mockUrl}`);
        sys(tx('formSubmitted'));
        return advance('submitted');
      }
      case 'deal': {
        sys(
          tx(d.action === 'move' ? 'dealMove' : 'dealCreate', {
            stage: str(d.stageId) || tx('noStage'),
            name: interp(d.dealName || tx('dealName'), v),
            hasValue: d.value ? 'yes' : 'no',
            value: d.value ? interp(d.value, v) : '',
          }),
        );
        return advance('created');
      }
      case 'wa_form':
        bot(interp(d.bodyText || d.body || tx('waFormPrompt'), v));
        sys(
          tx('waFormLine', {
            form: str(d.formId || d.formTitle || d.metaFlowId) || tx('selectForm'),
          }),
        );
        return advance('out');
      case 'api_library': {
        // The call itself needs the workspace's saved API and a contact; the test chat does not run it.
        const saveAs = str(d.save) || 'api_response';
        sys(
          `call saved API "${str(d.apiName) || '(none picked)'}" → {{${saveAs}}} (skipped in test, leaves by success)`,
        );
        return advance('success');
      }
      case 'faq': {
        // The match needs the workspace's FAQs and its embedding model: the test chat does not run it, so nothing is sent and no
        // `<save>.*` variable is set. The step takes the "answered" exit when it is wired, else "no match", so either branch can be walked.
        const wired = (handle: string) =>
          edges.some((x) => x.source === node.id && x.sourceHandle === handle);
        const port = wired('matched') || !wired('no_match') ? 'matched' : 'no_match';
        sys(
          tx(port === 'matched' ? 'faqAnswered' : 'faqNoMatch', {
            query: str(d.query) || '{{user_message}}',
            ref: `{{${str(d.save) || 'faq'}}}`,
          }),
        );
        return advance(port);
      }
      case 'end':
        sys(tx('flowEnded'));
        stop();
        return;
      default:
        sys(tx('unknownNode', { type: node.type }));
        return advance('out');
    }
  };

  /** Resolve a 1-based number / title reply to an option index; falls back to the first option. */
  const pickIndex = (titles: string[], value: string): number => {
    let idx = titles.findIndex((o) => o.toLowerCase() === value.toLowerCase());
    if (idx < 0) {
      const n = parseInt(value, 10);
      if (!isNaN(n) && n >= 1 && n <= titles.length) idx = n - 1;
    }
    return idx < 0 ? 0 : idx;
  };

  /** Route to `handle`'s edge, or log `missing` and stop when nothing is wired. */
  const route = (node: FlowNode, handle: string, missing: string) => {
    const e = edges.find((x) => x.source === node.id && x.sourceHandle === handle);
    const next = e ? findNode(e.target) : null;
    if (next) later(STEP_DELAY_MS, () => stepTest(next));
    else sys(missing);
  };

  const start = (): void => {
    runId += 1;
    current = null;
    pendingStart = null;
    opts.onReset?.();
    // Prefer the pinned start node, else the first trigger, else node 0 so a canvas without a trigger still gives feedback.
    const first =
      nodes.find((n) => n.isStart) ?? nodes.find((n) => n.type === 'trigger') ?? nodes[0];
    if (!first) {
      sys(tx('canvasEmpty'));
      opts.onAwaiting(false);
      return;
    }
    // WhatsApp behavior: the bot waits for the customer to open the conversation.
    const kw = first.type === 'trigger' ? str(rec(first.data).keywords) : '';
    expectedKeywords = kw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    vars = { name: 'Anya', phone: '+919876543210' };
    pendingStart = first;
    sys(
      expectedKeywords.length
        ? tx('typeKeyword', { first: expectedKeywords[0]!, list: expectedKeywords.join(', ') })
        : tx('typeAny'),
    );
    opts.onAwaiting(true);
  };

  /** An answer to an Ask for file / location node: saved like the runtime saves it, or a wrong reply (retry, skip, give up). */
  const answerAsk = (
    node: FlowNode,
    reply:
      | { kind: 'text'; text: string }
      | { kind: 'file'; file: SimFile }
      | { kind: 'location'; loc: SimLocation },
  ): void => {
    const d = rec(node.data);
    const isFile = node.type === 'ask_file';
    const name = str(d.var).replace(/[{}\s@]/g, '') || (isFile ? 'file' : 'location');
    const clear = isFile
      ? ['', 'url', 'kind', 'name', 'mime', 'caption']
      : ['', 'latitude', 'longitude', 'name', 'address', 'link'];
    const setEmpty = (status: string) => {
      for (const s of clear) vars[s ? `${name}_${s}` : name] = '';
      vars[`${name}_status`] = status;
    };
    const finish = () => {
      opts.onAwaiting(false);
      route(node, 'out', tx('nothingAfter', { type: nodeLabel(opts.t, node.type) }));
    };
    const skip = str(d.skipKeyword).trim().toLowerCase();
    if (reply.kind === 'text' && skip !== '' && reply.text.trim().toLowerCase() === skip) {
      setEmpty('skipped');
      sys(tx('skippedByCustomer'));
      return finish();
    }
    if (isFile && reply.kind === 'file') {
      const f = reply.file;
      if (flbAskFileAccepts(flbCleanAskFileExtensions(d.extensions), f)) {
        const url = `chatmedia:test-${f.name || 'file'}`;
        vars[name] = url;
        vars[`${name}_url`] = url;
        vars[`${name}_kind`] = MEDIA_KIND_OF_MIME(f.mime);
        vars[`${name}_name`] = f.name;
        vars[`${name}_mime`] = f.mime;
        vars[`${name}_caption`] = f.caption ?? '';
        vars[`${name}_status`] = 'received';
        sys(tx('fileSaved', { ref: `{{${name}}}` }));
        return finish();
      }
    }
    if (!isFile && reply.kind === 'location') {
      const l = reply.loc;
      const link = `https://www.google.com/maps?q=${l.latitude},${l.longitude}`;
      vars[name] = link;
      vars[`${name}_link`] = link;
      vars[`${name}_latitude`] = String(l.latitude);
      vars[`${name}_longitude`] = String(l.longitude);
      vars[`${name}_name`] = l.name ?? '';
      vars[`${name}_address`] = l.address ?? '';
      vars[`${name}_status`] = 'received';
      sys(tx('locationSaved', { ref: `{{${name}}}` }));
      return finish();
    }
    // Not what was asked for.
    askAttempts += 1;
    if (askAttempts <= askRetries(d)) {
      bot(interp(d.wrongReply || (isFile ? tx('wrongFile') : tx('wrongLocation')), vars));
      return;
    }
    if (d.onFail === 'end') {
      sys(tx('retriesEnd'));
      stop();
      return;
    }
    setEmpty('failed');
    sys(tx('retriesMove'));
    finish();
  };

  const sendFile = (file: SimFile): void => {
    const node = current;
    if (!node || node.type !== 'ask_file') return;
    log(
      'user',
      tx(file.caption ? 'userFileCaption' : 'userFile', {
        name: file.name,
        mime: file.mime,
        caption: file.caption ?? '',
      }),
    );
    answerAsk(node, { kind: 'file', file });
  };

  const sendLocation = (loc: SimLocation): void => {
    const node = current;
    if (!node || node.type !== 'ask_location') return;
    log(
      'user',
      tx('userLocation', {
        hasName: loc.name ? 'yes' : 'no',
        name: loc.name ?? '',
        lat: loc.latitude,
        lng: loc.longitude,
        hasAddress: loc.address ? 'yes' : 'no',
        address: loc.address ?? '',
      }),
    );
    answerAsk(node, { kind: 'location', loc });
  };

  const send = (value: string): void => {
    // First message: open the conversation. An off-keyword opener still runs, with a soft note.
    if (!current && pendingStart) {
      log('user', value);
      const first = pendingStart;
      if (expectedKeywords.length > 0) {
        const lc = value.toLowerCase();
        if (!expectedKeywords.some((k) => lc.includes(k.toLowerCase()))) sys(tx('keywordMiss'));
      }
      vars.user_message = value;
      pendingStart = null;
      opts.onAwaiting(false);
      later(START_DELAY_MS, () => stepTest(first));
      return;
    }
    const node = current;
    if (!node) return;
    log('user', value);
    const d = rec(node.data);
    if (node.type === 'ask_file' || node.type === 'ask_location') {
      answerAsk(node, { kind: 'text', text: value });
    } else if (node.type === 'ask') {
      vars[str(d.var) || 'answer'] = value;
      opts.onAwaiting(false);
      const expected = arr(d.options);
      let handle: string | null = null;
      if (expected.length > 0) {
        const idx = expected.findIndex(
          (o) => typeof o === 'string' && o.toLowerCase() === value.toLowerCase(),
        );
        handle = idx >= 0 ? `p${idx}` : 'else';
      }
      const e = edges.find(
        (x) => x.source === node.id && (handle ? x.sourceHandle === handle : true),
      );
      const next = e ? findNode(e.target) : null;
      if (next) later(STEP_DELAY_MS, () => stepTest(next));
      else if (handle) sys(tx('portNotConnected', { port: handle }));
      else sys(tx('nothingAfterAsk'));
    } else if (node.type === 'buttons' || node.type === 'list' || node.type === 'poll') {
      // List items are objects: match and save their title, never the object ("[object Object]").
      const raw = arr(d.options);
      const titles =
        node.type === 'list'
          ? raw.map((o, i) => listOption(opts.t, o, i).title)
          : raw.map((o) => str(o));
      const idx = pickIndex(titles, value);
      vars[str(d.var) || 'choice'] = titles[idx] || value;
      opts.onAwaiting(false);
      route(node, `p${idx}`, tx('optionNotConnected', { port: `p${idx}`, n: idx + 1 }));
    } else if (node.type === 'template') {
      const qr = opts.templateButtons?.(node) ?? [];
      const idx = pickIndex(
        qr.map((b) => b.label),
        value,
      );
      opts.onAwaiting(false);
      route(node, `p${idx}`, tx('buttonNotConnected', { label: qr[idx]?.label || `p${idx}` }));
    } else if (
      node.type === 'whatsapp_shop' ||
      node.type === 'woocommerce' ||
      node.type === 'shopify'
    ) {
      // Numeric pick = purchase; anything else = abandon (the runtime's resume / abandon-timer ports).
      const items = arr(d.productItems).map(rec);
      const n = parseInt(value, 10);
      opts.onAwaiting(false);
      if (!isNaN(n) && n >= 1 && n <= items.length) {
        const picked = items[n - 1]!;
        vars.commerce_choice = str(picked.retailer_id ?? picked.retailerId);
        vars.order_id = `TEST-${Math.floor(random() * 9000 + 1000)}`;
        vars.order_total = String(Number(picked.price_minor ?? picked.priceMinor ?? 0) / 100);
        vars.order_currency = str(picked.currency);
        sys(
          tx('simPurchase', { name: str(picked.name || picked.retailer_id || picked.retailerId) }),
        );
        route(node, 'purchased', tx('portNotConnected', { port: 'purchased' }));
      } else {
        sys(tx('simAbandon'));
        route(node, 'abandoned', tx('portNotConnected', { port: 'abandoned' }));
      }
    }
  };

  return {
    start,
    send,
    sendFile,
    sendLocation,
    current: () => current,
    vars: () => ({ ...vars }),
    stop: () => {
      runId += 1;
      current = null;
      pendingStart = null;
    },
  };
}
