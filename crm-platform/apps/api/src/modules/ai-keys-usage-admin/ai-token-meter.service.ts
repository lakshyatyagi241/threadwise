import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, PLAN_UPGRADE_PATH } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { clampTokens, monthStart, monthlyTokenLimit } from './ai-rules';

export interface TokenUsage {
  provider: string;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  /** Which side paid: the `source` AiKeyResolver reported. */
  billedAgainst: 'admin' | 'workspace';
}

/**
 * The AI token ledger and the monthly cap (TW-AIADM-016..018). Every AI call, in any domain, records its tokens here
 * after the vendor answers; `guard` is asked before a call starts.
 *
 * Only tokens billed to the PLATFORM's key count against the cap: a workspace on its own key spends whatever its own
 * vendor account allows. Reference wrote the guard but never called it, so the cap was displayed and never enforced.
 * Here it is an operation any caller can invoke (the AI-using domains must call it before they call a vendor).
 */
@Injectable()
export class AiTokenMeter {
  constructor(
    private readonly db: DatabaseService,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  /**
   * Writes one ledger row. Counts are clamped to whole non-negative numbers; the total is their sum. Pass `tx` to
   * write in the caller's own transaction, else it opens one for the workspace.
   */
  async record(orgId: number, usage: TokenUsage, tx?: Tx): Promise<void> {
    const prompt = clampTokens(usage.promptTokens);
    const completion = clampTokens(usage.completionTokens);
    const total = clampTokens(prompt + completion);
    const write = (t: Tx) =>
      t.execute(sql`
        INSERT INTO ai_token_usage (org_id, provider, model, prompt_tokens, completion_tokens, total_tokens, billed_against)
        VALUES (${orgId}, ${usage.provider.trim().toLowerCase()}, ${usage.model}, ${prompt}, ${completion}, ${total},
                ${usage.billedAgainst})
      `);
    if (tx) await write(tx);
    else await this.db.txAs({ orgId, userId: null }, write);
  }

  /** Tokens this workspace has spent against the platform's keys this calendar month (UTC). */
  async usedThisMonth(orgId: number, now: Date = new Date()): Promise<number> {
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT COALESCE(sum(total_tokens), 0)::bigint AS used FROM ai_token_usage
        WHERE org_id = ${orgId} AND billed_against = 'admin' AND created_at >= ${monthStart(now)}
      `);
      return Number((res.rows[0] as { used: string | number }).used);
    });
  }

  /** The workspace's monthly platform-key cap, or null when it has none. */
  async monthlyLimit(orgId: number): Promise<number | null> {
    const e = await this.entitlements.forOrg(orgId);
    return e ? monthlyTokenLimit(e) : null;
  }

  /** Throws 422 PLAN_LIMIT_REACHED once the workspace has used its monthly cap. Call before a platform-key call. */
  async guard(orgId: number, now: Date = new Date()): Promise<void> {
    const limit = await this.monthlyLimit(orgId);
    if (limit === null) return;
    const used = await this.usedThisMonth(orgId, now);
    if (used < limit) return;
    throw new AppError(
      ERROR_CODES.PLAN_LIMIT_REACHED,
      `You have used this month's AI token allowance (${limit}). Upgrade your plan, or add your own provider keys to keep using AI features.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      [
        { path: 'limit', message: 'ai_token_limit_monthly' },
        { path: 'reason', message: 'limit_reached' },
        { path: 'used', message: String(used) },
        { path: 'limitValue', message: String(limit) },
        { path: 'upgradeUrl', message: PLAN_UPGRADE_PATH },
      ],
    );
  }
}
