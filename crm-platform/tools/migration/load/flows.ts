import { randomBytes } from 'node:crypto';
import { FLOWS_COLLECTION, resolveFlows, type FlowSettings } from '../flows/config';
import { buildFlowPlan } from '../flows/plan';
import {
  faqReplies,
  flowBots,
  flowChatbots,
  flowHeaders,
  flowNodes,
  flowVersions,
  flowWorkspace,
  widgetAssistants,
  widgetConfig,
  widgetTheme,
  widgets,
} from '../transform/flows';
import { faqKnowledge } from '../transform/faq';
import { writeFaqFallbacks, writeFaqSettings } from './faq';
import { uuidv5 } from '../util';
import { sql, withTenant, type Database } from './db';
import type { Env } from './engine';

/**
 * The loader half of the flows and widgets steps: pass 1 (the plan) before the first row is inserted, the record of the options the
 * run used, and the one thing the transform cannot do deterministically: the embed token of a widget. Nothing here writes a flow, a
 * widget or a keyword reply: the engine inserts them whole, and nothing is UPDATEd afterwards.
 */

/** keys of the contact fields of the organization (module contacts): the ask steps save into them */
export async function contactFieldKeys(db: Database, orgId: number): Promise<Set<string>> {
  const r = await withTenant(db, { orgId }, (tx) =>
    tx.execute(sql`SELECT key FROM fields WHERE org_id = ${orgId} AND module_key = 'contacts'`),
  );
  return new Set((r.rows as Array<{ key: string }>).map((x) => x.key));
}

/** The plan's caps for flows and chatbot widgets (0 = unlimited), the way PlanEntitlementService resolves a limit: override, else plan. */
export async function planCaps(
  db: Database,
  orgId: number,
): Promise<{ flowLimit: number; widgetLimit: number }> {
  const r = await withTenant(db, { orgId }, (tx) =>
    tx.execute(sql`
      SELECT p.limits, s.overrides
      FROM organizations o
      LEFT JOIN org_plan_state s ON s.org_id = o.id
      LEFT JOIN plans p ON p.slug = o.plan AND p.kind = 'plan'
      WHERE o.id = ${orgId}`),
  );
  const row = r.rows[0] as
    | {
        limits: Record<string, unknown> | null;
        overrides: { limits?: Record<string, unknown> } | null;
      }
    | undefined;
  const cap = (key: string): number => {
    const o = row?.overrides?.limits?.[key];
    const v = Number(o !== undefined && o !== null ? o : (row?.limits?.[key] ?? 0));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  };
  return { flowLimit: cap('flows'), widgetLimit: cap('chatbot_widgets') };
}

export async function planFlows(a: {
  env: Pick<Env, 'source' | 'client' | 'db' | 'orgId' | 'fallbackAt'>;
  settings: FlowSettings;
}) {
  return buildFlowPlan({
    source: a.env.source,
    client: a.env.client,
    settings: a.settings,
    fallbackAt: a.env.fallbackAt,
    contactFieldKeys: await contactFieldKeys(a.env.db, a.env.orgId),
  });
}

export async function recordedFlowOptions(
  db: Database,
  client: string,
): Promise<Record<string, unknown> | null> {
  const r = await db.execute(
    sql`SELECT counts FROM migration.run_log WHERE source_client = ${client} AND collection = ${FLOWS_COLLECTION} AND step = 'options'`,
  );
  return (r.rows[0] as { counts?: Record<string, unknown> } | undefined)?.counts ?? null;
}

export async function prepareFlows(env: Env): Promise<void> {
  if (env.flows) return;
  const caps = await planCaps(env.db, env.orgId);
  const given = env.flowSettings ?? resolveFlows();
  // the caps of the plan are read from the target unless the operator fixed them by hand
  const settings = resolveFlows({
    flowVersion: given.flowVersion,
    widgetsForWhatsappBots: given.widgetsForWhatsappBots,
    flowLimit: given.flowLimit || caps.flowLimit,
    widgetLimit: given.widgetLimit || caps.widgetLimit,
  });
  const plan = await planFlows({ env, settings });
  env.flows = plan;
  env.flowSettings = settings;
  await env.db.execute(sql`
    INSERT INTO migration.run_log (source_client, collection, step, run_id, last_key, state, counts)
    VALUES (${env.client}, ${FLOWS_COLLECTION}, 'options', ${env.runId}, 0, 'done', ${JSON.stringify(settings)}::jsonb)
    ON CONFLICT (source_client, collection, step) DO UPDATE SET counts = EXCLUDED.counts, updated_at = now()`);
  env.log(
    `  flows              ${plan.botOrder.length} bot(s); ${plan.widgetOrder.length} widget candidate(s); plan ${JSON.stringify(plan.tally)}`,
  );
}

// --- the embed token ----------------------------------------------------------------------------------------------------------

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** WaDesk's Str::random(48) as widget-rules.ts freshToken does it: 48 characters of [A-Za-z0-9] from a CSPRNG, no modulo bias. */
function csprngToken(length = 48): string {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= 248) continue;
      out += BASE62[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

let tokenSource: (length: number) => string = csprngToken;
/**
 * Tests only: a counter instead of the CSPRNG, so two runs can be compared byte for byte. The token is NEVER derived from the botid
 * or anything in the dump (the Waboo bot id is public in the old embed snippet, so a derived token could be guessed).
 */
export function setTokenSource(fn: ((length: number) => string) | null): void {
  tokenSource = fn ?? csprngToken;
}
export const freshEmbedToken = (): string => tokenSource(48);

/** Wires the loader hooks into the shared step specs (the specs are also used by the verifier, which needs none of this). */
export function installFlowsLoader(): void {
  for (const spec of [
    flowBots,
    flowChatbots,
    flowHeaders,
    flowVersions,
    flowNodes,
    flowWorkspace,
    faqReplies,
    faqKnowledge,
    widgetAssistants,
    widgets,
    widgetConfig,
    widgetTheme,
  ]) {
    spec.prepare = prepareFlows;
    spec.fingerprint = (env) => env.flows?.fingerprint ?? '';
  }
  // one settings row (switch OFF) per flow that owns a migrated FAQ, in the batch's transaction; a row that exists is never touched
  faqKnowledge.afterInsert = async (tx, ctx, table, rows) => {
    if (table !== 'faqs') return;
    await writeFaqSettings(tx, ctx.orgId, [
      ...new Set(rows.map((r) => Number(r.row.owner_flow_id))),
    ]);
  };
  // the token is made at insert time, inside the batch's transaction, and only for rows that do not exist yet
  // the bot's fallback message goes to the settings of its flow (the widget row carries flow_id; the text lives in the plan)
  widgets.afterInsert = async (tx, ctx, table, rows) => {
    if (table !== 'chatbot_widgets' || !ctx.flows) return;
    const byUuid = new Map<string, string>();
    for (const [botId, w] of ctx.flows.widgets)
      if (w.fallback !== null) byUuid.set(uuidv5(`${ctx.client}|widgets|${botId}`), w.fallback);
    const items = rows.flatMap((r) => {
      const message = byUuid.get(r.uuid);
      const flowId = Number(r.row.flow_id);
      return message !== undefined && Number.isFinite(flowId) ? [{ flowId, message }] : [];
    });
    await writeFaqFallbacks(tx, ctx.orgId, items);
  };
  widgets.beforeInsert = async (_tx, _ctx, table, rows) => {
    if (table !== 'chatbot_widgets') return;
    for (const r of rows) r.embed_token = freshEmbedToken();
  };
}
