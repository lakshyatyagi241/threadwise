import type { GoogleWorkspacePort } from '../../../../../infra/providers/flow-runtime-engine/google-workspace.port';
import type { CustomDecision, InboundReply, NodeContext, NodeResult } from '../../types';
import { asText, resolveVariable } from '../../variables';
import { dataOf, str } from './webhook-node';

const ADVANCE: NodeResult = { kind: 'advance', port: 1 };
const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const TAG = /\{\{\s*([^{}]+?)\s*\}\}/g;
const failure = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A value as a cell or a line of text: a record becomes its human field (title, name, label...) or JSON; never "[object Object]". */
function flatten(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v))
    return v
      .map(flatten)
      .filter((s) => s !== '')
      .join(', ');
  if (isRecord(v)) {
    const pick = v.title ?? v.name ?? v.label ?? v.value ?? v.text ?? v.email ?? v.id;
    if (pick !== undefined && pick !== null && typeof pick !== 'object') return String(pick);
    return asText(v);
  }
  return String(v);
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** System tags, used only when the flow set no variable of that name, so an author's own `{{timestamp}}` still wins (UTC). */
function systemTag(key: string, at: Date): string | undefined {
  const date = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
  const time = `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}`;
  switch (key.trim().toLowerCase()) {
    case 'date':
      return date;
    case 'time':
      return time;
    case 'iso_timestamp':
      return at.toISOString();
    case 'timestamp':
    case 'execution_timestamp':
    case 'now':
      return `${date} ${time}`;
    default:
      return undefined;
  }
}

/** Renders the tags of a Google node's text: values flattened to readable text, system tags as a fallback, unset as empty. */
function subst(ctx: NodeContext, s: unknown): string {
  if (s === null || s === undefined) return '';
  if (typeof s === 'object') return flatten(s);
  return String(s).replace(TAG, (_, k: string) => {
    const own = resolveVariable(ctx.run.vars, k);
    if (own !== undefined && own !== null) return flatten(own);
    return systemTag(k, ctx.now()) ?? '';
  });
}

/** A column is a plain string (`{{name}}`) or `{ column, value }`; an object with no value is an empty cell, never the object. */
const cellSource = (c: unknown): unknown => {
  if (c === null || c === undefined) return '';
  if (isRecord(c)) return c.value ?? '';
  return Array.isArray(c) ? '' : c;
};

/** One sheet row from the node's column list. Exported for tests. */
export const sheetRow = (ctx: NodeContext, cols: unknown[]): string[] =>
  cols.map((c) => subst(ctx, cellSource(c)));

/** Tells the customer a Google step failed, in WaDesk's words; a refused send is only noted (WaDesk logged it and went on). */
async function apologise(ctx: NodeContext, text: string): Promise<void> {
  const r = await ctx.send({ kind: 'text', body: text });
  if (!r.ok) ctx.note(`could not send the apology: ${r.error}`);
}

async function sendText(ctx: NodeContext, body: string): Promise<boolean> {
  const r = await ctx.send({ kind: 'text', body });
  if (!r.ok) ctx.note(`send failed: ${r.error}`);
  return r.ok;
}

/**
 * Google Sheets node (WD-FLR-044). Write appends one row built from the node's columns (merge tags per cell, optionally placed under
 * the sheet's own headers); when a column reads `{{prefix.field}}` and an AI node left `prefix.__rows`, one row per record. Read looks
 * a row up by column and value and saves it as `<saveAs>` plus `<saveAs>.<header>`. Whatever Google answers, the flow moves on.
 */
export async function runSheets(
  ctx: NodeContext,
  google: GoogleWorkspacePort,
): Promise<NodeResult> {
  const d = dataOf(ctx);
  const mode = str(d.mode, 'write').toLowerCase();
  const sheetId = str(d.sheetId).trim();
  const tabName = str(d.tabName).trim();
  if (sheetId === '') {
    ctx.note('google sheets has no sheet: skipped');
    return ADVANCE;
  }
  const orgId = ctx.run.orgId;

  if (mode === 'read') {
    const saveAs = str(d.saveAs, 'sheet_row');
    const matchColumn = str(d.matchColumn);
    const matchValue = subst(ctx, d.matchValue);
    try {
      const rows = await google.readSheetRows(orgId, {
        sheetId,
        tabName,
        matchColumn,
        matchValue,
        limit: 1,
      });
      const row = rows[0];
      if (row) {
        ctx.run.vars[saveAs] = row;
        for (const [k, v] of Object.entries(row)) ctx.run.vars[`${saveAs}.${k}`] = String(v ?? '');
      } else {
        ctx.note(`google sheets: no row where ${matchColumn} = ${matchValue}`);
      }
    } catch (e) {
      ctx.note(`google sheets read failed: ${failure(e)}`);
    }
    return ADVANCE;
  }

  const cols = Array.isArray(d.columns) ? (d.columns as unknown[]) : [];
  if (cols.length === 0) {
    ctx.note('google sheets write has no columns: skipped');
    return ADVANCE;
  }
  const matchByHeader = d.matchByHeader === true;
  const columnHeaders = cols.map((c) => (isRecord(c) ? str(c.header) : ''));
  const write = async (values: string[]): Promise<boolean> => {
    try {
      await google.appendSheetRow(orgId, {
        sheetId,
        tabName,
        values,
        columnHeaders,
        matchByHeader,
      });
      return true;
    } catch (e) {
      ctx.note(`google sheets write failed: ${failure(e)}`);
      return false;
    }
  };

  let records: unknown[] | null = null;
  let prefix = '';
  for (const c of cols) {
    const m = /\{\{\s*([A-Za-z0-9_]+)\.[\w.]+\s*\}\}/.exec(str(cellSource(c)));
    const rows = m ? ctx.run.vars[`${m[1]}.__rows`] : undefined;
    if (m && Array.isArray(rows) && rows.length > 0) {
      records = rows;
      prefix = m[1]!;
      break;
    }
  }
  if (records) {
    let ok = 0;
    for (const rec of records) {
      if (isRecord(rec)) {
        for (const [k, v] of Object.entries(rec)) {
          ctx.run.vars[`${prefix}.${k}`] =
            v === null || v === undefined
              ? ''
              : typeof v === 'object'
                ? JSON.stringify(v)
                : String(v);
        }
      }
      if (await write(sheetRow(ctx, cols))) ok++;
    }
    ctx.note(`google sheets appended ${ok}/${records.length} rows`);
  } else {
    await write(sheetRow(ctx, cols));
  }
  return ADVANCE;
}

/**
 * Google Docs node (WD-FLR-045): copies the template, fills its `{{placeholders}}` from the flow's variables (text and numbers) and the
 * node's own placeholder list, shares it by link, saves the link as `doc_url` and the node's variable, and sends it. A failure
 * sends WaDesk's apology and the flow moves on.
 */
export async function runDocs(ctx: NodeContext, google: GoogleWorkspacePort): Promise<NodeResult> {
  const d = dataOf(ctx);
  const templateId = str(d.templateId).trim();
  if (templateId === '') {
    ctx.note('google docs has no template: skipped');
    return ADVANCE;
  }
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(ctx.run.vars)) {
    if (typeof v === 'string' || typeof v === 'number') vars[k] = String(v);
  }
  if (Array.isArray(d.placeholders)) {
    for (const p of d.placeholders as Array<Record<string, unknown>>) {
      const key = str(p?.key);
      if (key !== '') vars[key] = subst(ctx, p?.value);
    }
  }
  let url = '';
  try {
    ({ url } = await google.generateDoc(ctx.run.orgId, {
      templateId,
      newTitle: subst(ctx, str(d.newTitle, 'Document')),
      vars,
      shareable: d.shareable !== false,
    }));
  } catch (e) {
    ctx.note(`google docs failed: ${failure(e)}`);
  }
  if (url === '') {
    await apologise(
      ctx,
      "Sorry, couldn't generate your document right now. Please try again later.",
    );
    return ADVANCE;
  }
  ctx.run.vars[str(d.saveAs, 'doc_url')] = url;
  ctx.run.vars.doc_url = url;
  await sendText(ctx, subst(ctx, str(d.messageTemplate, "Here's your document: {{doc_url}}")));
  return ADVANCE;
}

/**
 * Google Meet node (WD-FLR-047): creates a Calendar event with a Meet link starting `leadMinutes` from now (default 5, lasting 30),
 * saves `meet_link`, `meet_start` and `meet_event_id`, and sends the author's message. No link: WaDesk's apology, then on.
 */
export async function runMeet(ctx: NodeContext, google: GoogleWorkspacePort): Promise<NodeResult> {
  const d = dataOf(ctx);
  const title = str(d.title, 'WhatsApp consultation');
  const duration = Math.max(5, Number(d.durationMinutes) || 30);
  const lead = Math.max(0, Number(d.leadMinutes) || 5);
  const startAt = new Date(ctx.now().getTime() + lead * 60_000);
  const endAt = new Date(startAt.getTime() + duration * 60_000);

  let meetUrl = '';
  let eventId = '';
  try {
    ({ meetUrl, eventId } = await google.createMeet(ctx.run.orgId, {
      title: subst(ctx, title),
      startAt,
      endAt,
      sendInvites: Boolean(d.sendCalendarInvite),
      timeZone: 'UTC',
      requestId: ctx.stepKey,
    }));
  } catch (e) {
    ctx.note(`google meet failed: ${failure(e)}`);
  }
  if (meetUrl === '') {
    await apologise(
      ctx,
      "Sorry, couldn't generate a meeting link right now. Please try again later.",
    );
    return ADVANCE;
  }
  const meetStart = `${startAt.toISOString().replace('T', ' ').substring(0, 16)} UTC`;
  Object.assign(ctx.run.vars, {
    meet_link: meetUrl,
    meet_start: meetStart,
    meet_event_id: eventId,
  });
  await sendText(
    ctx,
    subst(
      ctx,
      str(d.messageTemplate, 'Your meeting link: {{meet_link}}\nStarts at {{meet_start}}'),
    ),
  );
  return ADVANCE;
}

export const GOOGLE_FORM_HANDLER = 'GoogleForm';

/**
 * Google Form node (WD-FLR-046): sends the form's link and parks the run until the form's webhook reports a submission
 * (`FlowEngine.deliverExternal`, handled by `onGoogleFormReply`). The wait lasts `expiresInSec` (default a day) and then leaves by
 * the `timeout` port (2); WaDesk's run simply stopped answering. No form or no link: the apology, then out by `submitted`.
 */
export async function runForm(ctx: NodeContext, google: GoogleWorkspacePort): Promise<NodeResult> {
  const d = dataOf(ctx);
  const formId = str(d.formId).trim();
  if (formId === '') {
    ctx.note('google form has no form: skipped');
    return ADVANCE;
  }
  let url = '';
  try {
    ({ url } = await google.formResponderUrl(ctx.run.orgId, formId));
  } catch (e) {
    ctx.note(`google form failed: ${failure(e)}`);
  }
  if (url === '') {
    await apologise(ctx, 'Sorry, the form is unavailable right now. Please try again later.');
    return ADVANCE;
  }
  const body = `${subst(ctx, str(d.bodyText, 'Please fill out this short form:'))}\n\n${url}`;
  if (!(await sendText(ctx, body))) return ADVANCE;
  const expires = Math.min(Math.max(Math.trunc(Number(d.expiresInSec)) || 86_400, 60), 604_800);
  return {
    kind: 'wait',
    wait: {
      nodeId: ctx.node.id,
      variable: str(d.saveAs, 'google_form'),
      kind: 'Custom',
      handler: GOOGLE_FORM_HANDLER,
      data: { formId },
      timeoutSeconds: expires,
      timeoutPort: 2,
    },
  };
}

/** The submission: answers saved as the variable and as `<variable>.<question>` (lists joined), then out by `submitted`. */
export async function onGoogleFormReply(
  ctx: NodeContext,
  reply: InboundReply,
): Promise<CustomDecision> {
  if (reply.kind !== 'external') return { action: 'ignore' };
  const answers = isRecord(reply.data?.answers) ? reply.data.answers : {};
  const root = ctx.run.wait?.variable || 'google_form';
  const setVars: Record<string, unknown> = { [root]: answers };
  for (const [k, v] of Object.entries(answers)) {
    setVars[`${root}.${k}`] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
  }
  return { action: 'route', port: 1, setVars };
}
