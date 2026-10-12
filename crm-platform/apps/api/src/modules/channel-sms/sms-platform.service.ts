import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { SmsPlatformState, UpdateSmsPlatformInput } from '@crm/contracts';
import { AuthAuditService, PlatformSettingsService } from '../auth';
import { SmsAvailability, SMS_ENABLED_KEY } from './sms-availability.service';

/**
 * The operator console's switch for the SMS channel (TW-SMS-025), written the way the unofficial WhatsApp switch is. Idempotent:
 * setting the state it already has still writes an audit row, so an operator's click is always on record. No sender, send or
 * workspace data is touched either way; the switch only hides entry points.
 */
@Injectable()
export class SmsPlatformService {
  constructor(
    private readonly store: PlatformSettingsService,
    private readonly audit: AuthAuditService,
    private readonly availability: SmsAvailability,
  ) {}

  async read(): Promise<SmsPlatformState> {
    // Show what a write on another instance just stored, not this process's 5-second snapshot.
    this.store.invalidate();
    return { enabled: await this.availability.platformEnabled() };
  }

  async update(input: UpdateSmsPlatformInput, operatorId: number): Promise<SmsPlatformState> {
    await this.store.inTx(async (tx) => {
      const found = await tx.execute(
        sql`SELECT value FROM platform_settings WHERE key = ${SMS_ENABLED_KEY} FOR UPDATE`,
      );
      const stored = (found.rows[0] as { value: unknown } | undefined)?.value;
      const before = stored === true || stored === 1 || stored === '1' || stored === 'true';
      const json = JSON.stringify(input.enabled);
      await tx.execute(sql`
        INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
        VALUES (${SMS_ENABLED_KEY}, ${json}::jsonb, false, ${operatorId}, now())
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, is_secret = false,
              updated_by = EXCLUDED.updated_by, updated_at = now()`);
      await this.audit.record(tx, {
        event: 'platform.sms_updated',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { before: { enabled: before }, after: { enabled: input.enabled } },
      });
    });
    // inTx dropped the snapshot, so this read sees the new value.
    return { enabled: await this.availability.platformEnabled() };
  }
}
