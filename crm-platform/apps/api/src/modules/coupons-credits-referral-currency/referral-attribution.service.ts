import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { CpnStore } from './cpn-store';
import { recordReferralAudit } from './referral-audit';
import { normalizeReferralCode } from './referral-code';

export interface AttributionInput {
  referrerUserUuid: string;
  referrerOrgUuid: string;
  referredUserUuid: string;
  referredOrgUuid: string;
  codeUsed: string;
}

export type AttributionOutcome = 'recorded' | 'already_attributed' | 'ignored';

interface UserRef {
  orgId: number;
  userId: number;
}

/**
 * Links a new account to the account whose code it arrived with, exactly once (WD-CPN-032). The sign-up resolves the code and
 * announces `referral.attributed`; this writes the row. At-least-once delivery is safe: the UNIQUE key on the referee turns a
 * redelivery into a no-op, and nothing here throws on a duplicate (WaDesk's racing duplicate threw).
 */
@Injectable()
export class ReferralAttributionService {
  private readonly logger = new Logger(ReferralAttributionService.name);

  constructor(private readonly store: CpnStore) {}

  attribute(input: AttributionInput): Promise<AttributionOutcome> {
    return this.store.tx((tx) => this.attributeIn(tx, input));
  }

  async attributeIn(tx: Tx, input: AttributionInput): Promise<AttributionOutcome> {
    const code = normalizeReferralCode(input.codeUsed);
    const [referrer, referred] = await Promise.all([
      this.user(tx, input.referrerOrgUuid, input.referrerUserUuid),
      this.user(tx, input.referredOrgUuid, input.referredUserUuid),
    ]);
    if (!referrer || !referred || !code) {
      this.logger.warn(
        { code: !!code },
        'referral attribution dropped: a user in the event is gone',
      );
      return 'ignored';
    }
    // Nobody refers themselves; the sign-up skips the same email, and the table has a CHECK as the last line.
    if (referrer.userId === referred.userId) return 'ignored';

    // The code must still be the referrer's: an event cannot credit a code that belongs to someone else.
    const owned = await tx.execute(sql`
      SELECT 1 FROM referral_codes
      WHERE owner_org_id = ${referrer.orgId} AND user_id = ${referrer.userId} AND upper(code) = ${code}`);
    if (owned.rows.length === 0) return 'ignored';

    const res = await tx.execute(sql`
      INSERT INTO referrals (referrer_org_id, referrer_user_id, referred_org_id, referred_user_id, code_used)
      VALUES (${referrer.orgId}, ${referrer.userId}, ${referred.orgId}, ${referred.userId}, ${code})
      ON CONFLICT (referred_user_id) DO NOTHING
      RETURNING id`);
    const row = res.rows[0] as unknown as { id: string | number } | undefined;
    if (!row) return 'already_attributed';

    await recordReferralAudit(tx, {
      module: 'referrals',
      orgId: referrer.orgId,
      recordId: Number(row.id),
      action: 'insert',
      delta: {
        referrerUserId: { old: null, new: referrer.userId },
        referredUserId: { old: null, new: referred.userId },
        codeUsed: { old: null, new: code },
      },
    });
    return 'recorded';
  }

  private async user(tx: Tx, orgUuid: string, userUuid: string): Promise<UserRef | null> {
    const res = await tx.execute(sql`
      SELECT u.org_id, u.id FROM users u JOIN organizations o ON o.id = u.org_id
      WHERE o.uuid = ${orgUuid}::uuid AND u.uuid = ${userUuid}::uuid`);
    const r = res.rows[0] as unknown as
      { org_id: string | number; id: string | number } | undefined;
    return r ? { orgId: Number(r.org_id), userId: Number(r.id) } : null;
  }
}
