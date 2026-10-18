import type { GoogleWorkspacePort } from '../../../../../infra/providers/flow-runtime-engine/google-workspace.port';
import type { CustomDecision, InboundReply, NodeContext, NodeResult } from '../../types';
import { evalRule } from '../../condition';
import { asText, resolveVariable } from '../../variables';
import { GoogleAccountError } from '../../../../../infra/providers/flow-runtime-engine/google-workspace.port';
import { googleFailureText } from './google-failure';
import { dataOf, str } from './webhook-node';

const ADVANCE: NodeResult = { kind: 'advance', port: 1 };
const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const TAG = /\{\{\s*([^{}]+?)\s*\}\}/g;
/**
 * A Google step that could not use Google FAILS the run at that step, visibly, with the stable `GOOGLE_*` code and what to do about it
 * (the run log and the run view show both): no account, a missing permission, a disabled API, a revoked grant, or an error Google answered.
 * Reference noted it and went on; that silence is what hid a workspace with no Google account. The Google nodes have no error exit to route
 * to (only Form has its own two), so the run ends here; "Retry" on the run resumes it after the account is fixed.
 *
 * What is NOT a failure, as in Reference: a step the author left half empty (no sheet, no columns, no template, no form) is noted in the
 * run log and skipped (the checks take their "no" branch), and a lookup that finds no row is an ordinary empty result.
 */
function failed(e: unknown): NodeResult {
  const code = e instanceof GoogleAccountError ? e.code : 'GOOGLE_UNAVAILABLE';
  return { kind: 'fail', code, reason: googleFailureText(e) };
}

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

/** Tells the customer a Google step failed, in Reference's words; a refused send is only noted (Reference logged it and went on). */
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
 * Google Sheets node (TW-FLR-044). Write appends one row built from the node's columns (merge tags per cell, optionally placed under
 * the sheet's own headers); when a column reads `{{prefix.field}}` and an AI node left `prefix.__rows`, one row per record. Read looks
 * a row up by column and value and saves it as `<saveAs>` plus `<saveAs>.<header>`. When Google cannot do the work the step fails (see `failed`).
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
      return failed(e);
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
  /** ALL the rows of this step in one append: a step that fails wrote nothing, so a retry cannot duplicate rows that went in. */
  const write = async (rows: string[][]): Promise<void> => {
    await google.appendSheetRows(orgId, { sheetId, tabName, rows, columnHeaders, matchByHeader });
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
  try {
    if (records) {
      const rows: string[][] = [];
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
        rows.push(sheetRow(ctx, cols));
      }
      await write(rows);
      ctx.note(`google sheets appended ${rows.length}/${records.length} rows`);
    } else {
      await write([sheetRow(ctx, cols)]);
    }
  } catch (e) {
    return failed(e);
  }
  return ADVANCE;
}

/**
 * Google Docs node (TW-FLR-045): copies the template, fills its `{{placeholders}}` from the flow's variables (text and numbers) and the
 * node's own placeholder list, shares it by link, saves the link as `doc_url` and the node's variable, and sends it. A failure
 * sends Reference's apology and then fails the step.
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
    const made = await google.generateDoc(ctx.run.orgId, {
      templateId,
      newTitle: subst(ctx, str(d.newTitle, 'Document')),
      vars,
      shareable: d.shareable !== false,
    });
    url = made.url;
    // The copy exists: a fill or a share that failed is a note, never a lost link (Reference carried on past both).
    for (const w of made.warnings ?? []) {
      ctx.note(
        w.startsWith('share')
          ? `google docs: the document was made but could not be shared by link (${w.slice(6)})`
          : `google docs: the document was made but its placeholders could not be filled (${w.slice(5)})`,
      );
    }
  } catch (e) {
    // The customer is told (Reference's apology), and the step fails with the reason for whoever runs the flow.
    await apologise(
      ctx,
      "Sorry, couldn't generate your document right now. Please try again later.",
    );
    return failed(e);
  }
  ctx.run.vars[str(d.saveAs, 'doc_url')] = url;
  ctx.run.vars.doc_url = url;
  await sendText(ctx, subst(ctx, str(d.messageTemplate, "Here's your document: {{doc_url}}")));
  return ADVANCE;
}

/**
 * Google Meet node (TW-FLR-047): creates a Calendar event with a Meet link starting `leadMinutes` from now (default 5, lasting 30),
 * saves `meet_link`, `meet_start` and `meet_event_id`, and sends the author's message. No link: Reference's apology, then the step fails.
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
    await apologise(
      ctx,
      "Sorry, couldn't generate a meeting link right now. Please try again later.",
    );
    return failed(e);
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
 * Google Form node (TW-FLR-046): sends the form's link and parks the run until the form's submission is read through the
 * connected Google account (`GoogleFormPollService` hands it to `FlowEngine.deliverExternal`, handled by `onGoogleFormReply`). The wait lasts `expiresInSec` (default a day) and then leaves by
 * the `timeout` port (2); Reference's run simply stopped answering. No form or no link: the apology, then the step fails.
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
    await apologise(ctx, 'Sorry, the form is unavailable right now. Please try again later.');
    return failed(e);
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

const YES: NodeResult = { kind: 'advance', port: 1, branch: true };
const NO: NodeResult = { kind: 'advance', port: 2, branch: true };

/** The first sheet row where `matchColumn` equals the (rendered) match value (`row` null: none, noted), or the failed step. */
async function sheetRowOf(
  ctx: NodeContext,
  google: GoogleWorkspacePort,
  d: Record<string, unknown>,
): Promise<{ row: Record<string, string> | null } | { failure: NodeResult }> {
  const sheetId = str(d.sheetId).trim();
  if (sheetId === '') {
    ctx.note('google sheets has no sheet: skipped');
    return { row: null };
  }
  const matchColumn = str(d.matchColumn);
  const matchValue = subst(ctx, d.matchValue);
  try {
    const rows = await google.readSheetRows(ctx.run.orgId, {
      sheetId,
      tabName: str(d.tabName).trim(),
      matchColumn,
      matchValue,
      limit: 1,
    });
    if (!rows[0]) ctx.note(`google sheets: no row where ${matchColumn} = ${matchValue}`);
    return { row: rows[0] ?? null };
  } catch (e) {
    return { failure: failed(e) };
  }
}

/**
 * "Check Google Sheet field": yes (port 1) when the cell in `checkColumn` of the matching row meets the operator and value (the
 * Condition node's operators), no (port 2) when it does not or when there is no matching row. When Google cannot be read the step fails (it must not answer "no" for a problem).
 */
export async function runSheetCheck(
  ctx: NodeContext,
  google: GoogleWorkspacePort,
): Promise<NodeResult> {
  const d = dataOf(ctx);
  const column = str(d.checkColumn).trim();
  const found = column === '' ? { row: null } : await sheetRowOf(ctx, google, d);
  if ('failure' in found) return found.failure;
  const row = found.row;
  if (!row) return NO;
  const met = evalRule(
    { cell: row[column] ?? '' },
    { variable: 'cell', operator: d.operator, value: subst(ctx, d.value) },
  );
  ctx.note(met ? 'sheet cell condition true' : 'sheet cell condition false');
  return met ? YES : NO;
}

/**
 * "Save contact from Google Sheet": the matching row's cells go into the run's contact, one `{ column, field }` pair each (a contact
 * column or a custom property). The run's variables follow, so a Condition after it sees them. It updates the contact the run belongs
 * to; it does not create contacts from new rows (that needs a sheet-row trigger, which needs a Google account store).
 */
export async function runSheetContact(
  ctx: NodeContext,
  google: GoogleWorkspacePort,
  save: (field: string, value: string) => Promise<boolean>,
): Promise<NodeResult> {
  const d = dataOf(ctx);
  const pairs = (Array.isArray(d.map) ? d.map : [])
    .filter(isRecord)
    .map((m) => ({ column: str(m.column).trim(), field: str(m.field).trim() }))
    .filter((m) => m.column !== '' && m.field !== '');
  if (pairs.length === 0) {
    ctx.note('save contact from sheet has no columns chosen: skipped');
    return ADVANCE;
  }
  if (ctx.run.contactId === null) {
    ctx.note('this run has no contact to save the row to: skipped');
    return ADVANCE;
  }
  const found = await sheetRowOf(ctx, google, d);
  if ('failure' in found) return found.failure;
  const row = found.row;
  if (!row) return ADVANCE;
  let saved = 0;
  for (const m of pairs) {
    const value = row[m.column];
    if (value === undefined) continue;
    if (await save(m.field, value)) {
      ctx.run.vars[m.field] = value;
      saved++;
    } else {
      ctx.note(`field "${m.field}" could not be set`);
    }
  }
  ctx.note(`${saved} contact field${saved === 1 ? '' : 's'} saved from the sheet`);
  return ADVANCE;
}
