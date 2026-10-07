import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';

/** `record_id` is polymorphic per module, so a code and a referral with the same number need different modules. */
export type ReferralAuditModule = 'referrals' | 'referral_codes';

/**
 * The audit row of a referral change, written in the SAME transaction as the change (repo rule 6). It names the org explicitly
 * because the referral consumers run in the worker, with no request context, and the row belongs to the referrer's workspace.
 * `delta` holds ids and amounts only: never a referee's email or name.
 */
export async function recordReferralAudit(
  tx: Tx,
  e: {
    orgId: number;
    module: ReferralAuditModule;
    recordId: number;
    action: 'insert' | 'update';
    delta: Record<string, unknown>;
    actor?: { type: 'user' | 'system'; id: number | null };
  },
): Promise<void> {
  const ctx = RequestContextStore.peek();
  const actor = e.actor ?? { type: 'system' as const, id: null };
  await tx.execute(sql`
    INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
    VALUES (${e.orgId}, ${actor.id}, ${actor.type}, ${e.module}, ${e.recordId}, ${e.action},
      ${JSON.stringify(e.delta)}::jsonb, ${ctx?.requestId ?? null})`);
}
