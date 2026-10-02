import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';

/**
 * The ledger aggregates both usage screens read (TW-AIADM-020..023, 025, 027). `orgId` narrows to one workspace
 * (the workspace screen, which also runs under that workspace's row-level security); omit it for the platform-wide
 * figures, which must run in a privileged transaction.
 */

const num = (v: unknown): number => Number(v ?? 0);

export interface LedgerFigures {
  tokens: number;
  calls: number;
  platformTokens: number;
  ownKeyTokens: number;
  providers: number;
  models: number;
  workspaces: number;
  byProvider: Array<{ provider: string; tokens: number; calls: number }>;
  daily: Array<{ date: string; tokens: number }>;
}

const scope = (orgId?: number): SQL => (orgId === undefined ? sql`TRUE` : sql`org_id = ${orgId}`);

export async function readLedger(tx: Tx, from: Date, orgId?: number): Promise<LedgerFigures> {
  const where = sql`created_at >= ${from} AND ${scope(orgId)}`;

  const totals = (
    await tx.execute(sql`
      SELECT COALESCE(sum(total_tokens), 0)::bigint AS tokens,
             count(*)::bigint AS calls,
             COALESCE(sum(total_tokens) FILTER (WHERE billed_against = 'admin'), 0)::bigint AS platform_tokens,
             COALESCE(sum(total_tokens) FILTER (WHERE billed_against = 'workspace'), 0)::bigint AS own_tokens,
             count(DISTINCT provider)::int AS providers,
             count(DISTINCT model)::int AS models,
             count(DISTINCT org_id)::int AS workspaces
      FROM ai_token_usage WHERE ${where}
    `)
  ).rows[0] as Record<string, unknown>;

  const byProvider = (
    await tx.execute(sql`
      SELECT provider, sum(total_tokens)::bigint AS tokens, count(*)::bigint AS calls
      FROM ai_token_usage WHERE ${where}
      GROUP BY provider ORDER BY tokens DESC, provider
    `)
  ).rows as Array<Record<string, unknown>>;

  const daily = (
    await tx.execute(sql`
      SELECT to_char((created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS date, sum(total_tokens)::bigint AS tokens
      FROM ai_token_usage WHERE ${where}
      GROUP BY 1 ORDER BY 1
    `)
  ).rows as Array<Record<string, unknown>>;

  return {
    tokens: num(totals.tokens),
    calls: num(totals.calls),
    platformTokens: num(totals.platform_tokens),
    ownKeyTokens: num(totals.own_tokens),
    providers: num(totals.providers),
    models: num(totals.models),
    workspaces: num(totals.workspaces),
    byProvider: byProvider.map((r) => ({
      provider: String(r.provider || 'unknown'),
      tokens: num(r.tokens),
      calls: num(r.calls),
    })),
    daily: daily.map((r) => ({ date: String(r.date), tokens: num(r.tokens) })),
  };
}

export interface ModelRow {
  model: string | null;
  provider: string;
  tokens: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

/** The busiest models, with the prompt/completion split, most tokens first. */
export async function readModels(
  tx: Tx,
  from: Date,
  limit: number,
  orgId?: number,
): Promise<ModelRow[]> {
  const res = await tx.execute(sql`
    SELECT model, provider, sum(total_tokens)::bigint AS tokens, count(*)::bigint AS calls,
           sum(prompt_tokens)::bigint AS prompt_tokens, sum(completion_tokens)::bigint AS completion_tokens
    FROM ai_token_usage WHERE created_at >= ${from} AND ${scope(orgId)}
    GROUP BY model, provider ORDER BY tokens DESC, provider, model LIMIT ${limit}
  `);
  return (res.rows as Array<Record<string, unknown>>).map((r) => ({
    model: (r.model as string | null) ?? null,
    provider: String(r.provider),
    tokens: num(r.tokens),
    calls: num(r.calls),
    promptTokens: num(r.prompt_tokens),
    completionTokens: num(r.completion_tokens),
  }));
}
