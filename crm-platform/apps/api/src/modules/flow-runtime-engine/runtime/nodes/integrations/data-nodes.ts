import type { AiCallPort } from '../../../../../infra/providers/flow-runtime-engine/ai-call.port';
import type { MysqlQueryPort } from '../../../../../infra/providers/flow-runtime-engine/mysql-query.port';
import type { SafeFetch } from '../../../../../infra/providers/node-bridge-runtime/safe-fetch';
import type { NodeContext, NodeResult } from '../../types';
import { flattenInto } from '../../variables';
import { runUserCode } from './code-sandbox';
import { dataOf, str } from './webhook-node';

const ADVANCE: NodeResult = { kind: 'advance', port: 1 };
const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Code node (TW-FLR-033). The code sees `previousResponse` (the node's variable as it was), `allResponses` (every variable) and
 * `functionArgs`; what it returns is saved under the node's variable and each top-level field as `<variable>.<key>`. A failure saves
 * `{ ok: false, error }` and the flow continues. The node never sends a message.
 */
export async function runCode(ctx: NodeContext): Promise<NodeResult> {
  const d = dataOf(ctx);
  const props = isRecord(d.properties) ? d.properties : {};
  const code = str(d.code ?? props.code);
  const saveAs = str(d.variable ?? props.variable, 'result').replace(/^@/, '') || 'result';
  const vars = ctx.run.vars;
  const r = await runUserCode(code, {
    previousResponse: vars[saveAs] ?? null,
    allResponses: vars,
    functionArgs: d.args ?? props.args ?? {},
  });
  let out: unknown;
  if (r.ok) out = r.result;
  else {
    ctx.note(`code failed: ${r.error}`);
    out = { ok: false, error: r.error };
  }
  vars[saveAs] = out;
  if (isRecord(out)) for (const [k, v] of Object.entries(out)) vars[`${saveAs}.${k}`] = v;
  return ADVANCE;
}

/** Reference's read-only guard: one SELECT or WITH, no file operations. Returns the cleaned statement or the reason it was refused. */
export function readOnlySql(raw: string): { sql: string } | { error: string } {
  const sql = raw.trim().replace(/[;\s]+$/, '');
  if (sql.length > 8000) return { error: 'The statement is longer than 8000 characters.' };
  if (sql.includes(';')) return { error: 'Only a single statement is allowed.' };
  if (!/^\s*(SELECT|WITH)\b/i.test(sql)) return { error: 'Only SELECT queries are allowed.' };
  if (/\b(INTO\s+(OUTFILE|DUMPFILE)|LOAD_FILE)\b/i.test(sql))
    return { error: 'File operations are not allowed.' };
  return { sql };
}

const MYSQL_ROW_CAP = 100;
const MYSQL_TIMEOUT_MS = 8_000;

/**
 * MySQL node (TW-FLR-034): a read-only query on the customer's own database, rows saved as JSON under the node's variable and
 * flattened (`rows.0.name`, `rows.length`). Unlike Reference the host must resolve to a public address (a flow author cannot aim the
 * server at its own network); the address that passed the check is the one connected to. Any failure leaves the variable empty.
 */
export async function runMysql(
  ctx: NodeContext,
  port: MysqlQueryPort,
  safeFetch: SafeFetch,
): Promise<NodeResult> {
  const d = dataOf(ctx);
  const saveAs = str(d.variable, 'rows');
  const host = str(d.host).trim();
  const database = str(d.database).trim();
  const statement = ctx.render(d.sql);
  if (host === '' || database === '' || statement.trim() === '') {
    ctx.note('mysql is missing host, database or sql: skipped');
    ctx.run.vars[saveAs] = '';
    return ADVANCE;
  }
  const checked = readOnlySql(statement);
  if ('error' in checked) {
    ctx.note(`mysql refused: ${checked.error}`);
    ctx.run.vars[saveAs] = '';
    return ADVANCE;
  }
  try {
    const target = await safeFetch.assertPublicHost(host);
    const rows = await port.query({
      host,
      address: target.address,
      port: Number(d.port) || 3306,
      database,
      username: str(d.username),
      password: str(d.password),
      sql: checked.sql,
      maxRows: MYSQL_ROW_CAP,
      timeoutMs: MYSQL_TIMEOUT_MS,
    });
    const capped = rows.slice(0, MYSQL_ROW_CAP);
    ctx.run.vars[saveAs] = JSON.stringify(capped);
    flattenInto(ctx.run.vars, saveAs, capped);
  } catch (e) {
    ctx.note(`mysql query failed: ${e instanceof Error ? e.message : String(e)}`);
    ctx.run.vars[saveAs] = '';
  }
  return ADVANCE;
}

/**
 * AI voice call node (TW-FLR-048): asks the calling domain to ring the flow's contact with an AI assistant, then leaves at once
 * (fire and advance: the call is placed asynchronously). A missing number or a refused call is a note, never a failed step.
 */
export async function runAiCall(ctx: NodeContext, calls: AiCallPort): Promise<NodeResult> {
  const to = ctx.run.peerKey.replace(/\D+/g, '');
  if (to.length < 8) {
    ctx.note(`ai call skipped: no usable number (${to})`);
    return ADVANCE;
  }
  const assistantId = Number(dataOf(ctx).assistantId) || null;
  try {
    const r = await calls.place({
      orgId: ctx.run.orgId,
      to,
      assistantId,
      conversationId: ctx.run.conversationId,
      key: ctx.stepKey,
    });
    if (!r.ok) ctx.note(`ai call not placed: ${r.error}`);
  } catch (e) {
    ctx.note(`ai call failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return ADVANCE;
}
