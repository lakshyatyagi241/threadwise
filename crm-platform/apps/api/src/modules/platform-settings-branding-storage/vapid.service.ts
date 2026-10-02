import { createECDH } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AuthAuditService, PlatformSettingsService } from '../auth';
import { VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY } from './settings.service';

/** A P-256 key pair in the form Web Push (RFC 8292) wants: base64url of the uncompressed point and of the scalar. */
export function generateVapidKeyPair(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: ecdh.getPrivateKey().toString('base64url'),
  };
}

/**
 * The Team Inbox app's push keys (WD-SET-038). Generated once, idempotently: when both halves exist the stored public
 * key is returned and nothing changes. The private half is stored as a secret and never returned.
 */
@Injectable()
export class VapidService {
  constructor(
    private readonly store: PlatformSettingsService,
    private readonly audit: AuthAuditService,
  ) {}

  async status(): Promise<{ ready: boolean; publicKey: string }> {
    this.store.invalidate();
    const publicKey = (await this.store.get<string>(VAPID_PUBLIC_KEY)) ?? '';
    const ready = publicKey !== '' && (await this.store.hasSecret(VAPID_PRIVATE_KEY));
    return { ready, publicKey };
  }

  async generate(operatorId: number): Promise<{ ok: true; ready: true; publicKey: string }> {
    const existing = await this.status();
    if (existing.ready) return { ok: true, ready: true, publicKey: existing.publicKey };

    const pair = generateVapidKeyPair();
    const sealed = JSON.stringify(this.store.seal(pair.privateKey));
    const publicKey = await this.store.inTx(async (tx) => {
      // Two operators clicking at once must end with one pair: serialise, then look again.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('set.tiPwa.vapid'))`);
      const have = await tx.execute(
        sql`SELECT key, value FROM platform_settings WHERE key IN (${VAPID_PUBLIC_KEY}, ${VAPID_PRIVATE_KEY})`,
      );
      const rows = have.rows as Array<{ key: string; value: unknown }>;
      const pub = rows.find((r) => r.key === VAPID_PUBLIC_KEY)?.value;
      if (typeof pub === 'string' && pub !== '' && rows.some((r) => r.key === VAPID_PRIVATE_KEY)) {
        return pub;
      }
      // A half-written pair is replaced as a whole, so the two always match.
      await tx.execute(sql`
        INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
        VALUES (${VAPID_PUBLIC_KEY}, ${JSON.stringify(pair.publicKey)}::jsonb, false, ${operatorId}, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`);
      await tx.execute(sql`
        INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
        VALUES (${VAPID_PRIVATE_KEY}, ${sealed}::jsonb, true, ${operatorId}, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, is_secret = true, updated_by = EXCLUDED.updated_by, updated_at = now()`);
      await this.audit.record(tx, {
        event: 'platform.settings.tiPwa_keys_generated',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { fields: ['vapidPublic', 'vapidPrivate'] },
      });
      return pair.publicKey;
    });
    return { ok: true, ready: true, publicKey };
  }
}
