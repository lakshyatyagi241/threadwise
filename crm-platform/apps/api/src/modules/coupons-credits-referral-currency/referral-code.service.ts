import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { PlatformStore } from '../auth';
import { generateReferralCode } from './referral-rules';

/**
 * Every user's referral code (TW-CPN-029). One code per user, never rotated, drawn from a confusion-free alphabet with a
 * cryptographic random and re-drawn on the (rare) collision. Codes are written on the privileged connection (the table has no
 * tenant write policy); a tenant reads its own.
 */
@Injectable()
export class ReferralCodeService {
  constructor(private readonly store: PlatformStore) {}

  /** The user's code, created on first ask (the account page, the share panel, a legacy user with none). */
  ensure(orgId: number, userId: number): Promise<string> {
    return this.store.tx((tx) => this.ensureIn(tx, orgId, userId));
  }

  async ensureIn(tx: Tx, orgId: number, userId: number): Promise<string> {
    const existing = await tx.execute(
      sql`SELECT code FROM referral_codes WHERE owner_org_id = ${orgId} AND user_id = ${userId}`,
    );
    const found = (existing.rows[0] as { code: string } | undefined)?.code;
    if (found) return found;
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generateReferralCode();
      // ON CONFLICT DO NOTHING covers both races: the same user created concurrently, and a code another user drew first.
      const res = await tx.execute(sql`
        INSERT INTO referral_codes (owner_org_id, user_id, code) VALUES (${orgId}, ${userId}, ${code})
        ON CONFLICT DO NOTHING RETURNING code`);
      const made = (res.rows[0] as { code: string } | undefined)?.code;
      if (made) return made;
      const again = await tx.execute(
        sql`SELECT code FROM referral_codes WHERE owner_org_id = ${orgId} AND user_id = ${userId}`,
      );
      const theirs = (again.rows[0] as { code: string } | undefined)?.code;
      if (theirs) return theirs;
    }
    throw new Error('Could not draw a unique referral code.');
  }
}
