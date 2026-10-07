import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { CpnStore } from './cpn-store';
import { recordReferralAudit } from './referral-audit';
import { generateReferralCode } from './referral-code';

/** Ten draws of a 31^10 space: a collision is astronomically rare, so running out means the random source is broken. */
const MAX_DRAWS = 10;

/**
 * Referral codes (WD-CPN-029): one per user, issued once and never changed. WaDesk generated it in the user model's creating hook
 * and again lazily for users that predate the column; here the sign-up consumer issues it on `auth.signup_completed` and the
 * first read of the affiliate API issues it for everyone else (that lazy path IS the backfill: no migration guesses codes).
 * Idempotent and race-safe: `UNIQUE (owner_org_id, user_id)` makes two concurrent callers end with one row.
 */
@Injectable()
export class ReferralCodeService {
  constructor(private readonly store: CpnStore) {}

  /** The user's code, issuing it first when they have none. Opens its own transaction. */
  ensure(orgId: number, userId: number): Promise<string> {
    return this.store.tx(async (tx) => (await this.ensureIn(tx, orgId, userId)).code);
  }

  /** Same, inside the caller's (privileged) transaction; `created` says whether this call issued it. */
  async ensureIn(
    tx: Tx,
    orgId: number,
    userId: number,
    rand?: (maxExclusive: number) => number,
  ): Promise<{ code: string; created: boolean }> {
    const existing = await this.find(tx, orgId, userId);
    if (existing) return { code: existing, created: false };

    for (let draw = 0; draw < MAX_DRAWS; draw++) {
      const code = generateReferralCode(rand);
      // No conflict target: either unique key may be the one that collides (the code with someone else's, or the user with a
      // concurrent caller), and both mean "do not insert".
      const res = await tx.execute(sql`
        INSERT INTO referral_codes (owner_org_id, user_id, code)
        VALUES (${orgId}, ${userId}, ${code})
        ON CONFLICT DO NOTHING
        RETURNING id`);
      const row = res.rows[0] as unknown as { id: string | number } | undefined;
      if (row) {
        await recordReferralAudit(tx, {
          orgId,
          module: 'referral_codes',
          recordId: Number(row.id),
          action: 'insert',
          delta: { userId: { old: null, new: userId }, code: { old: null, new: code } },
        });
        return { code, created: true };
      }
      // A concurrent caller issued this user's code between our read and our insert: theirs is the code.
      const raced = await this.find(tx, orgId, userId);
      if (raced) return { code: raced, created: false };
    }
    throw new Error('referral code could not be issued: every draw collided');
  }

  private async find(tx: Tx, orgId: number, userId: number): Promise<string | null> {
    const res = await tx.execute(sql`
      SELECT code FROM referral_codes WHERE owner_org_id = ${orgId} AND user_id = ${userId}`);
    return (res.rows[0] as unknown as { code: string } | undefined)?.code ?? null;
  }
}
