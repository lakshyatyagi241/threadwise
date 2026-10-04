import {
  flbListOption,
  type FlowEdge,
  type FlowNode,
  type FlbTemplateButtonRef,
  type FlbTestWebhookRequest,
  type FlbTestWebhookResponse,
} from '@crm/contracts';

/**
 * The Test runner engine (TW-FLB-024): walks the canvas graph in memory, no messages are sent. Framework-free: every side
 * effect (the webhook call, timers, logging) is injected so the whole thing runs synchronously under test.
 * Behavior and log copy follow Reference's `stepTest` / `sendTest` / `checkCond`.
 */

export type LogMedia = { kind: string; url: string; filename: string };
export type LogEntry = { kind: 'system' | 'user' | 'bot'; text: string; media?: LogMedia };

/** Pause between two simulated steps, ms. */
export const STEP_DELAY_MS = 220;
/** Pause between the operator's first message and the first step, ms. */
export const START_DELAY_MS = 200;

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

  const log = (kind: LogEntry['kind'], text: string, media?: LogMedia) =>
    opts.onLog(media ? { kind, text, media } : { kind, text });
  const sys = (t: string) => log('system', t);
  const bot = (t: string, media?: LogMedia) => log('bot', t, media);

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
        bot(`${interp(d.prompt || d.question, v)}\n${lines}`);
        opts.onAwaiting(true);
        return;
      }
      case 'ask':
        bot(interp(d.prompt, v));
        opts.onAwaiting(true);
        return;
      case 'condition': {
        // Walk the AND/OR chain; ops[i-1] joins rule i-1 and i. The legacy single shape (var/op/value) still works.
        const legacy = d.var ? [{ variable: d.var, operator: d.op, value: d.value }] : [];
        const conds = (Array.isArray(d.conditions) ? d.conditions : legacy).map(rec);
        const ops = arr(d.operators);
        let ok = false;
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
    if (node.type === 'ask') {
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
    current: () => current,
    vars: () => ({ ...vars }),
    stop: () => {
      runId += 1;
      current = null;
      pendingStart = null;
    },
  };
}
