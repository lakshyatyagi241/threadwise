import { flbSanitizeConditionGroup } from '@crm/contracts';
import { evaluateConditions, evaluateConditionTree } from './condition';
import { askItems, buttonItems, listRows, REPLY_BUTTONS_MAX } from './menus';
import type { NodeContext, NodeExecutor, NodeResult, OutboundMessage, SendOutcome } from './types';

const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** A failed send either ends the run (a prompt the customer never got) or is skipped (a plain message), unless the channel is down. */
function failed(
  out: Extract<SendOutcome, { ok: false }>,
  mode: 'skip' | 'end',
  ctx: NodeContext,
): NodeResult | null {
  if (out.halt) return { kind: 'halt', reason: out.error };
  ctx.note(`send failed: ${out.error}`);
  return mode === 'end' ? { kind: 'fail', code: out.code, reason: out.error } : null;
}

const advance: NodeResult = { kind: 'advance', port: 1 };

const isHttp = (u: string) => /^https?:\/\//i.test(u) || u.startsWith('chatmedia:');

/** Message and Sequence: each reply in order (WD-FLR-021). */
const message: NodeExecutor = {
  types: ['Message'],
  async execute(ctx) {
    const replies = arr(ctx.node.props.replies).map(obj);
    if (replies.length === 0) {
      ctx.note('no replies: moving on');
      return advance;
    }
    for (const r of replies) {
      const type = str(r.type);
      let msg: OutboundMessage;
      if (type === 'Text') {
        const body = ctx.render(r.data);
        if (body.trim() === '') continue;
        msg = { kind: 'text', body };
        ctx.run.lastOut = { kind: 'text', text: body, url: '', caption: '', filename: null };
      } else {
        const url = str(r.data);
        if (!isHttp(url) && !url.includes('{{')) {
          ctx.note(`${type} reply has no usable link: skipped`);
          continue;
        }
        const resolved = ctx.render(url);
        const caption = ctx.render(r.caption);
        const mediaKind = type.toLowerCase() as 'image' | 'video' | 'audio' | 'document';
        msg = {
          kind: 'media',
          mediaKind,
          url: resolved,
          ...(caption && mediaKind !== 'audio' ? { caption } : {}),
          ...(str(r.filename) ? { filename: str(r.filename) } : {}),
        };
        ctx.run.lastOut = {
          kind: mediaKind,
          text: '',
          url: resolved,
          caption,
          filename: str(r.filename) || null,
        };
      }
      const out = await ctx.send(msg);
      if (!out.ok) {
        const stop = failed(out, 'skip', ctx);
        if (stop) return stop;
      }
    }
    return advance;
  },
};

/** The standalone Media node (WD-FLR-021). */
const media: NodeExecutor = {
  types: ['Media'],
  async execute(ctx) {
    const p = ctx.node.props;
    const url = ctx.render(p.mediaUrl);
    if (!isHttp(url)) {
      ctx.note('no usable media link: skipped');
      return advance;
    }
    const kindRaw = str(p.mediaKind).toLowerCase();
    const mediaKind =
      (['image', 'video', 'audio', 'document'] as const).find((k) => k === kindRaw) ?? 'document';
    const caption = ctx.render(p.caption);
    const filename = ctx.render(p.filename);
    ctx.run.lastOut = { kind: mediaKind, text: '', url, caption, filename: filename || null };
    const out = await ctx.send({
      kind: 'media',
      mediaKind,
      url,
      ...(caption && mediaKind !== 'audio' ? { caption } : {}),
      ...(filename ? { filename } : {}),
      ...(str(p.mimeType) ? { mimeType: str(p.mimeType) } : {}),
    });
    if (!out.ok) {
      const stop = failed(out, 'skip', ctx);
      if (stop) return stop;
    }
    return advance;
  },
};

/** The Ask node (WD-FLR-022): one question, free text or expected answers as buttons. */
const ask: NodeExecutor = {
  types: ['Question'],
  async execute(ctx) {
    const p = ctx.node.props;
    let question = ctx.render(p.question || 'Please provide your answer:');
    // A prompt that renders empty would send a blank bubble and swallow the next message as the "answer".
    if (question.trim() === '') {
      question = 'Please reply to continue.';
      ctx.note('the question rendered empty: used a visible fallback');
    }
    const items = askItems(ctx.node, ctx.render);
    const footer = str(p.footerText) || undefined;
    const out = await ctx.send(
      items.length > 0
        ? { kind: 'buttons', body: question, ...(footer ? { footer } : {}), buttons: items }
        : { kind: 'text', body: question },
    );
    if (!out.ok) return failed(out, 'end', ctx)!;
    ctx.run.menus.byNode[ctx.node.id] = items;
    if (items.length > 0) {
      ctx.run.menus.latest = {
        nodeId: ctx.node.id,
        variable: str(p.variable) || 'answer',
        answerItems: items,
      };
    }
    return {
      kind: 'wait',
      wait: {
        nodeId: ctx.node.id,
        variable: str(p.variable) || 'answer',
        kind: 'Question',
        answerItems: items,
        acceptMedia: p.acceptMedia === true,
      },
    };
  },
};

/** The Buttons node (WD-FLR-023). The menu stays tappable after a leaf branch unless `keepMenuOpen` is off. */
const buttons: NodeExecutor = {
  types: ['InteractiveButtons'],
  async execute(ctx) {
    const p = ctx.node.props;
    const items = buttonItems(ctx.node, ctx.render);
    if (items.length === 0) {
      ctx.note('no buttons: moving on');
      return advance;
    }
    const body = ctx.render(p.bodyText || 'Choose an option:');
    const footer = str(p.footerText) || undefined;
    const out = await ctx.send({
      kind: 'buttons',
      body,
      ...(footer ? { footer } : {}),
      buttons: items,
    });
    if (!out.ok) return failed(out, 'end', ctx)!;
    const variable = str(p.variable) || 'choice';
    ctx.run.menus.byNode[ctx.node.id] = items;
    ctx.run.menus.latest = { nodeId: ctx.node.id, variable, answerItems: items };
    return {
      kind: 'wait',
      wait: {
        nodeId: ctx.node.id,
        variable,
        kind: 'Question',
        answerItems: items,
        persistent: p.keepMenuOpen !== false,
      },
    };
  },
};

/** The List node (WD-FLR-024): rows grouped into sections, the row index is the output port. */
const list: NodeExecutor = {
  types: ['List'],
  async execute(ctx) {
    const p = ctx.node.props;
    const rows = listRows(ctx.node);
    if (rows.length === 0) {
      ctx.note('the list has no items: nothing to wait for');
      return { kind: 'park' };
    }
    const sections: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }> = [];
    const items = arr(p.items).map(obj);
    for (const r of rows) {
      let section = sections.find((s) => s.title === r.section);
      if (!section) {
        section = { title: r.section, rows: [] };
        sections.push(section);
      }
      const description = str(items[r.port - 1]?.description) || undefined;
      section.rows.push({
        id: r.id,
        title: ctx.render(r.title),
        ...(description ? { description } : {}),
      });
    }
    const body = ctx.render(p.bodyText || 'Please select from the list:');
    const footer = str(p.footerText) ? ctx.render(p.footerText) : undefined;
    const out = await ctx.send({
      kind: 'list',
      body,
      ...(footer ? { footer } : {}),
      button: str(p.buttonText) || 'Select',
      sections,
    });
    if (!out.ok) return failed(out, 'end', ctx)!;
    return {
      kind: 'wait',
      wait: {
        nodeId: ctx.node.id,
        variable: str(p.variable) || 'choice',
        kind: 'List',
        listItems: rows,
      },
    };
  },
};

/** The Poll node (WD-FLR-025): no channel here has a native poll, so it is a list (single choice) or numbered text. */
const poll: NodeExecutor = {
  types: ['Poll'],
  async execute(ctx) {
    const p = ctx.node.props;
    const options = arr(p.options)
      .map(str)
      .filter((o) => o.trim() !== '');
    if (options.length < 2 || options.length > 12) {
      return { kind: 'fail', code: 'FLR_POLL_OPTIONS', reason: 'A poll needs 2 to 12 options' };
    }
    const question = ctx.render(p.question || 'Poll Question');
    const multiple = p.allowMultiple === true;
    let msg: OutboundMessage;
    if (multiple || options.length > 10) {
      msg = {
        kind: 'text',
        body: `${question}\n\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n\nReply with the numbers (comma-separated):`,
      };
    } else {
      msg = {
        kind: 'list',
        body: question,
        button: 'Vote',
        sections: [
          {
            title: 'Options',
            rows: options.map((o, i) => ({ id: `poll_${ctx.node.id}_${i}`, title: o })),
          },
        ],
      };
    }
    const out = await ctx.send(msg);
    if (!out.ok) return failed(out, 'end', ctx)!;
    return {
      kind: 'wait',
      wait: {
        nodeId: ctx.node.id,
        variable: 'poll_response',
        kind: 'Poll',
        allowMultiple: multiple,
      },
    };
  },
};

/** The Condition node (WD-FLR-028): yes is port 1, no is port 2. */
const condition: NodeExecutor = {
  types: ['Condition'],
  async execute(ctx) {
    const p = ctx.node.props;
    // A valid nested `conditionGroup` wins; the flat chain is the fallback (and every pre-existing flow).
    const met =
      p.conditionGroup !== undefined && flbSanitizeConditionGroup(p.conditionGroup)
        ? evaluateConditionTree(ctx.run.vars, p.conditionGroup)
        : evaluateConditions(
            ctx.run.vars,
            arr(p.conditions) as Parameters<typeof evaluateConditions>[1],
            arr(p.logicOperators),
          );
    ctx.note(met ? 'condition true' : 'condition false');
    return { kind: 'advance', port: met ? 1 : 2, branch: true };
  },
};

/** The Delay node (WD-FLR-029): the run sleeps in the database and a delayed job wakes it, so a restart loses nothing. */
const delay: NodeExecutor = {
  types: ['TimeDelay'],
  async execute(ctx) {
    const seconds = Number(ctx.node.props.delaySeconds) || 0;
    return seconds > 0 ? { kind: 'sleep', seconds } : advance;
  },
};

/** CTA (WD-FLR-027): a tap-to-open button where the channel has one, labelled lines elsewhere. */
const cta: NodeExecutor = {
  types: ['CTA'],
  async execute(ctx) {
    const p = ctx.node.props;
    const actions = arr(p.actions)
      .map(obj)
      .filter((a) => str(a.value).trim() !== '');
    const header = ctx.render(p.headerText);
    const body = ctx.render(p.bodyText);
    const footer = ctx.render(p.footerText);
    const line = (a: Record<string, unknown>): string => {
      const t = str(a.type) || 'url';
      const label =
        str(a.label) ||
        (t === 'copy' ? 'Copy' : t === 'phone' || t === 'call_now' ? 'Call' : 'Visit');
      const value = ctx.render(a.value).trim();
      if (t === 'phone' || t === 'call_now') return `☏ ${label}: ${value.replace(/^tel:/i, '')}`;
      if (t === 'copy') return `${label}:\n\`${value}\``;
      return `${label}: ${value}`;
    };
    const urlAction = actions.find(
      (a) =>
        ['url', 'visit'].includes(str(a.type) || 'url') && /^https?:\/\//.test(ctx.render(a.value)),
    );
    let msg: OutboundMessage;
    if (urlAction) {
      const extra = actions
        .filter((a) => a !== urlAction)
        .slice(0, 2)
        .map(line)
        .join('\n');
      const text =
        [body, extra].filter(Boolean).join('\n').trim() || str(urlAction.label) || 'Visit';
      msg = {
        kind: 'cta_url',
        body: text,
        ...(header ? { header } : {}),
        ...(footer ? { footer } : {}),
        text: str(urlAction.label) || 'Visit',
        url: ctx.render(urlAction.value),
      };
    } else {
      let text = '';
      if (header) text += `*${header}*\n\n`;
      if (body) text += `${body}\n\n`;
      text += actions.map(line).join('\n\n');
      if (footer) text += `\n\n_${footer}_`;
      text = text.trim();
      if (!text) return advance;
      msg = { kind: 'text', body: text };
    }
    const out = await ctx.send(msg);
    if (!out.ok) {
      const stop = failed(out, 'skip', ctx);
      if (stop) return stop;
    }
    return advance;
  },
};

/** Location (WD-FLR-027): the pin, or a text with a maps link when the channel cannot send one. */
const location: NodeExecutor = {
  types: ['Location'],
  async execute(ctx) {
    const p = ctx.node.props;
    const latitude = Number(p.latitude) || 0;
    const longitude = Number(p.longitude) || 0;
    const name = ctx.render(p.title);
    const address = ctx.render(p.address);
    let out = await ctx.send({
      kind: 'location',
      latitude,
      longitude,
      ...(name ? { name } : {}),
      ...(address ? { address } : {}),
    });
    if (!out.ok && !out.halt) {
      const link = `https://maps.google.com/?q=${latitude},${longitude}`;
      out = await ctx.send({
        kind: 'text',
        body: [name ? `📍 *${name}*` : '📍 Location', address, link].filter(Boolean).join('\n'),
      });
    }
    if (!out.ok) {
      const stop = failed(out, 'skip', ctx);
      if (stop) return stop;
    }
    return advance;
  },
};

/** The start node and any type nobody has built an executor for: note it and move on (WD-FLR-016 rule 4). */
const passthrough: NodeExecutor = {
  types: ['Trigger'],
  async execute() {
    return advance;
  },
};

const end: NodeExecutor = {
  types: ['End', 'end'],
  async execute() {
    return { kind: 'end', reason: 'end_node' };
  },
};

export const CORE_EXECUTORS: readonly NodeExecutor[] = [
  message,
  media,
  ask,
  buttons,
  list,
  poll,
  condition,
  delay,
  cta,
  location,
  passthrough,
  end,
];

export { REPLY_BUTTONS_MAX };
