import {
  flbAskFileAccepts,
  flbCleanAskFileExtensions,
  flbCondSummary,
  flbIsCondGroup,
  flbSanitizeConditionGroup,
  type FlbCondGroup,
  flbListOption,
  type FlowEdge,
  type FlowNode,
  type FlbTemplateButtonRef,
  type FlbTestWebhookRequest,
  type FlbTestWebhookResponse,
} from '@crm/contracts';

/**
 * The Test runner engine (WD-FLB-024): walks the canvas graph in memory, no messages are sent. Framework-free: every side
 * effect (the webhook call, timers, logging) is injected so the whole thing runs synchronously under test.
 * Behavior and log copy follow WaDesk's `stepTest` / `sendTest` / `checkCond`.
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
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Quick-reply buttons of the template a Send-template node points at (resolved by the web from the template list). */
  templateButtons?: (node: FlowNode) => FlbTemplateButtonRef[];
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
      sys('Flow ended.');
      stop();
      return;
    }
    current = node;
    const advance = (sourceHandle: string) => {
      const e = edges.find((x) => x.source === node.id && x.sourceHandle === sourceHandle);
      const next = e ? findNode(e.target) : null;
      if (!next) {
        const portLabel = sourceHandle !== 'out' ? ` (port "${sourceHandle}")` : '';
        sys(`No path forward${portLabel} — stop.`);
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
        const num = interp(d.copyNumber, v) || '(no number set)';
        const what =
          d.kind && d.kind !== 'text' ? `[${str(d.kind)}] ${interp(d.url, v)}` : interp(d.text, v);
        sys(`Copy sent to ${num}: ${what}`);
        return advance('out');
      }
      case 'wa_to_instagram': {
        const u = str(d.igUsername).replace(/^@/, '') || '(no username)';
        bot(`${interp(d.introText, v)}\nhttps://ig.me/m/${u}`);
        return advance('out');
      }
      case 'sequence': {
        const reps = arr(d.replies);
        if (reps.length === 0) {
          bot('(empty sequence)');
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
        const qr = opts.templateButtons?.(node) ?? [];
        const head = `[template: ${str(d.tpl) || '?'}]\n${interp(d.preview, v)}`;
        if (qr.length) {
          bot(
            `${head}\n${qr.map((b, i) => `  ${i + 1}. ${b.label || `Button ${i + 1}`}`).join('\n')}`,
          );
          opts.onAwaiting(true);
          return;
        }
        bot(head);
        return advance('out');
      }
      case 'media': {
        const kind = (str(d.kind) || 'image').toLowerCase();
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
            const it = flbListOption(o, i);
            return `  ${i + 1}. ${it.title}${it.description ? ` — ${it.description}` : ''}${it.section ? `   [${it.section}]` : ''}`;
          })
          .join('\n');
        const prompt = interp(d.prompt || d.question, v);
        const labels = arr(d.options).map((o, i) =>
          typeof o === 'string' ? o : flbListOption(o, i).title,
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
          `(waiting for a file: ${
            flbCleanAskFileExtensions(d.extensions).join(', ') || 'any type'
          } — use the attach button)`,
        );
        opts.onAwaiting(true);
        return;
      case 'ask_location':
        askAttempts = 0;
        bot(interp(d.prompt, v));
        sys(
          d.interactive === false
            ? '(waiting for a shared location)'
            : '(a "Send location" button is shown — use the location button)',
        );
        opts.onAwaiting(true);
        return;
      case 'condition': {
        // Walk the AND/OR chain; ops[i-1] joins rule i-1 and i. The legacy single shape (var/op/value) still works.
        const legacy = d.var ? [{ variable: d.var, operator: d.op, value: d.value }] : [];
        const conds = (Array.isArray(d.conditions) ? d.conditions : legacy).map(rec);
        const ops = arr(d.operators);
        let ok = false;
        // The nested tree (beyond WaDesk) wins over the flat chain, with the same per-rule check.
        const tree = flbSanitizeConditionGroup(d.conditionGroup);
        if (tree) {
          const walk = (g: FlbCondGroup): boolean => {
            if (g.items.length === 0) return false;
            const test = (i: FlbCondGroup['items'][number]) =>
              flbIsCondGroup(i) ? walk(i) : checkCond(v[i.variable] ?? '', i.operator, i.value);
            return g.op === 'or' ? g.items.some(test) : g.items.every(test);
          };
          ok = walk(tree);
          sys(`if ${flbCondSummary(tree)} → ${ok ? 'YES' : 'NO'}`);
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
              `${i ? ` ${str(ops[i - 1]) || 'AND'} ` : ''}${str(c.variable)} ${str(c.operator)} ${str(c.value)}`,
          )
          .join('');
        sys(`if ${summary} → ${ok ? 'YES' : 'NO'}`);
        return advance(ok ? 'yes' : 'no');
      }
      case 'delay':
        sys(`wait ${str(d.amount)} ${str(d.unit)} (skipped in test)`);
        return advance('out');
      case 'webhook': {
        // The one real call: fired server-side (SSRF-guarded) so the operator can confirm the endpoint; the response is
        // saved to {{save}} and flattened to {{save.field}} for the nodes downstream.
        const wUrl = interp(d.url, v);
        if (!wUrl.trim()) {
          sys('webhook has no URL — skipped');
          return advance('out');
        }
        const saveAs = str(d.save || d.variable) || 'response';
        sys(`Calling ${str(d.method) || 'POST'} ${wUrl} …`);
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
              sys(`← HTTP ${j.status}${j.success ? '' : ' (non-2xx)'} · saved to {{${saveAs}}}`);
            } else {
              v[saveAs] = '';
              sys(`webhook failed: ${j.error || 'no response'}`);
            }
          })
          .catch((e: unknown) => {
            if (id !== runId) return;
            v[saveAs] = '';
            sys(`webhook error: ${e instanceof Error ? e.message : str(e)}`);
          })
          .then(() => {
            // Only continue if this run was not restarted mid-flight.
            if (id === runId && current === node) advance('out');
          });
        return; // async: advance happens once the request settles
      }
      case 'code':
        sys(`run JS → {{${str(d.save) || 'result'}}} (mocked — runs live only)`);
        return advance('out');
      case 'mysql':
        sys(`query ${str(d.database) || 'db'}: ${str(d.sql).slice(0, 48)}… (mocked)`);
        return advance('out');
      case 'ai':
        bot(`[${str(d.model) || 'AI'}] (simulated reply)`);
        return advance('out');
      case 'tag':
        sys(`${str(d.action) || 'add'} tag "${str(d.tag || d.tagId) || '?'}"`);
        return advance('out');
      case 'assign':
        sys(`assigned to team "${str(d.team) || '?'}"${d.userId ? ` user ${str(d.userId)}` : ''}`);
        return advance('out');
      case 'subflow': {
        const fid = str(d.flow);
        sys(`run sub-flow "${opts.flowName?.(fid) ?? `#${fid || '?'}`}" (skipped in test)`);
        return advance('out');
      }
      case 'cta': {
        const actions = arr(d.actions).map(rec);
        const lines = actions.length
          ? actions
              .map((a) => `[${str(a.type) || 'url'}] ${str(a.label)} → ${str(a.value)}`)
              .join('\n')
          : `[${str(d.kind) || 'url'}] ${str(d.label)} → ${str(d.url || d.phone || d.code)}`;
        bot(`(CTA)\n${lines}`);
        return advance('out');
      }
      case 'location':
        bot(
          `(location) ${str(d.name)}\n${str(d.address)}${d.lat && d.lng ? `\nlat ${str(d.lat)}, lng ${str(d.lng)}` : ''}`,
        );
        return advance('out');
      case 'chatbot':
        bot(`[chatbot: ${str(d.bot) || '?'}] (simulated)`);
        return advance('out');
      case 'whatsapp_shop':
      case 'woocommerce':
      case 'shopify': {
        const items = arr(d.productItems).map(rec);
        if (items.length === 0) {
          sys('No products on commerce node — taking abandoned port.');
          return advance('abandoned');
        }
        const list = items
          .map((p, i) => {
            const minor = Number(p.price_minor ?? p.priceMinor ?? 0);
            return `  ${i + 1}. ${str(p.name || p.retailer_id || p.retailerId)}${minor ? ` · ${(minor / 100).toFixed(2)} ${str(p.currency)}` : ''}`;
          })
          .join('\n');
        bot(
          `[${node.type}] ${interp(d.bodyText || 'Pick a product:', v)}\n${list}\n(Reply with a number to simulate purchase, or wait — abandon timer not run in test)`,
        );
        opts.onAwaiting(true);
        return;
      }
      case 'book_appointment': {
        const sample = [
          'Mon 20 May · 10:00 AM',
          'Mon 20 May · 11:30 AM',
          'Tue 21 May · 9:00 AM',
          'Tue 21 May · 4:00 PM',
          'Wed 22 May · 2:30 PM',
        ];
        const slots = sample.slice(0, Math.max(1, Math.min(10, Number(d.slotCount) || 5)));
        bot(
          `${str(d.prompt) || 'Pick a time:'}\n${slots.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`,
        );
        sys('(simulated) customer picks slot 1 → booked');
        return advance('booked');
      }
      case 'google_sheets': {
        const sheet = d.sheetId ? `${str(d.sheetId).slice(0, 10)}…` : '(no sheet)';
        const summary =
          d.mode === 'read'
            ? `Lookup row where ${str(d.matchColumn) || '?'}="${interp(d.matchValue, v)}" in ${sheet}`
            : `Append row to ${sheet} — ${arr(d.columns).length} columns`;
        sys(
          `[Google Sheets · ${(str(d.mode) || 'write').toUpperCase()}] ${summary} (skipped in test)`,
        );
        return advance('out');
      }
      case 'google_docs': {
        sys(
          `[Google Docs] copy template ${d.templateId ? `${str(d.templateId).slice(0, 10)}…` : '(no template)'} → "${interp(d.newTitle, v)}" (mocked URL)`,
        );
        const mockUrl = 'https://docs.google.com/document/d/MOCKED/edit';
        bot(
          interp(d.messageTemplate || "Here's your document: {{doc_url}}", {
            ...v,
            doc_url: mockUrl,
          }),
        );
        return advance('out');
      }
      case 'google_form': {
        const mockUrl = `https://docs.google.com/forms/d/${str(d.formId) || 'MOCKED'}/viewform`;
        bot(`${interp(d.bodyText || 'Please fill out this short form:', v)}\n\n${mockUrl}`);
        sys('(simulated) form submitted → submitted port');
        return advance('submitted');
      }
      case 'deal': {
        const act = d.action === 'move' ? 'move contact deal to' : 'create deal in';
        sys(
          `[CRM] ${act} stage ${str(d.stageId) || '(none)'} — "${interp(d.dealName || 'deal', v)}"${d.value ? ` · ${interp(d.value, v)}` : ''} (skipped in test)`,
        );
        return advance('created');
      }
      case 'wa_form':
        bot(interp(d.bodyText || d.body || 'Please complete this form:', v));
        sys(
          `(simulated) published Meta form ${str(d.formId || d.formTitle || d.metaFlowId) || '(select a form)'} sent → out`,
        );
        return advance('out');
      case 'end':
        sys('Flow ended.');
        stop();
        return;
      default:
        sys(`(unknown node type "${node.type}" — skipping)`);
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
      sys('Canvas is empty. Add a trigger and at least one node, then click Restart.');
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
        ? `Type "${expectedKeywords[0]}" (or any keyword: ${expectedKeywords.join(', ')}) to start the flow.`
        : 'Type any message to start the flow.',
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
      route(node, 'out', `Nothing connected after ${node.type} — stop.`);
    };
    const skip = str(d.skipKeyword).trim().toLowerCase();
    if (reply.kind === 'text' && skip !== '' && reply.text.trim().toLowerCase() === skip) {
      setEmpty('skipped');
      sys('Skipped by the customer.');
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
        sys(`File saved to {{${name}}}.`);
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
      sys(`Location saved to {{${name}}} (maps link).`);
      return finish();
    }
    // Not what was asked for.
    askAttempts += 1;
    if (askAttempts <= askRetries(d)) {
      bot(
        interp(
          d.wrongReply ||
            (isFile
              ? 'That is not a file we can accept. Please send it as an attachment.'
              : 'Please share your location with the attachment (+) menu, then Location.'),
          vars,
        ),
      );
      return;
    }
    if (d.onFail === 'end') {
      sys('Retries used up — the flow ends here.');
      stop();
      return;
    }
    setEmpty('failed');
    sys('Retries used up — moving on without an answer.');
    finish();
  };

  const sendFile = (file: SimFile): void => {
    const node = current;
    if (!node || node.type !== 'ask_file') return;
    log('user', `📎 ${file.name} (${file.mime})${file.caption ? `\n${file.caption}` : ''}`);
    answerAsk(node, { kind: 'file', file });
  };

  const sendLocation = (loc: SimLocation): void => {
    const node = current;
    if (!node || node.type !== 'ask_location') return;
    log(
      'user',
      `📍 ${loc.name ? `${loc.name} · ` : ''}${loc.latitude}, ${loc.longitude}${loc.address ? `\n${loc.address}` : ''}`,
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
        if (!expectedKeywords.some((k) => lc.includes(k.toLowerCase())))
          sys("(message didn't match any keyword — running anyway for testing)");
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
      else if (handle) sys(`Port "${handle}" not connected — stop.`);
      else sys('Nothing connected after ask — stop.');
    } else if (node.type === 'buttons' || node.type === 'list' || node.type === 'poll') {
      // List items are objects: match and save their title, never the object ("[object Object]").
      const raw = arr(d.options);
      const titles =
        node.type === 'list'
          ? raw.map((o, i) => flbListOption(o, i).title)
          : raw.map((o) => str(o));
      const idx = pickIndex(titles, value);
      vars[str(d.var) || 'choice'] = titles[idx] || value;
      opts.onAwaiting(false);
      route(node, `p${idx}`, `Port "p${idx}" (option ${idx + 1}) not connected — stop.`);
    } else if (node.type === 'template') {
      const qr = opts.templateButtons?.(node) ?? [];
      const idx = pickIndex(
        qr.map((b) => b.label),
        value,
      );
      opts.onAwaiting(false);
      route(node, `p${idx}`, `Button "${qr[idx]?.label || `p${idx}`}" not connected — stop.`);
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
          `Simulated purchase: ${str(picked.name || picked.retailer_id || picked.retailerId)} → port "purchased"`,
        );
        route(node, 'purchased', 'Port "purchased" not connected — stop.');
      } else {
        sys('Simulated abandon → port "abandoned"');
        route(node, 'abandoned', 'Port "abandoned" not connected — stop.');
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
