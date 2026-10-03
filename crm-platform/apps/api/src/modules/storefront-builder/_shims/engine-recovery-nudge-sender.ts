import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { DatabaseService } from '../../../infra/db/database.service';
import {
  BRIDGE_TEXT_PORT,
  type BridgeTextPort,
} from '../../../infra/providers/storefront-builder/bridge-text.client';
import {
  WHATSAPP_PROVIDER,
  type WhatsAppProvider,
} from '../../../infra/providers/whatsapp/whatsapp.port';
import type { RecoveryNudgeSender, RecoverySender } from './tokens';

/**
 * Sends the nudge by the workspace's engine:
 *  - `baileys`: the Node bridge (`POST /api/send-message/<number>`), the same call the OTP sender makes.
 *  - `waba`: the shared Meta provider with the credentials stored (encrypted) on the number's `wa_provider_configs` row. A
 *    plain-text message only delivers inside Meta's 24-hour window (a Meta rule Reference shared).
 *  - `twilio`: BLOCKED. No Twilio sender exists in this repo yet; it throws and the sweep logs it, as Reference logged "no sender".
 */
@Injectable()
export class EngineRecoveryNudgeSender implements RecoveryNudgeSender {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    @Inject(WHATSAPP_PROVIDER) private readonly meta: WhatsAppProvider,
    @Inject(BRIDGE_TEXT_PORT) private readonly bridge: BridgeTextPort,
  ) {}

  async send(orgId: number, sender: RecoverySender, toDigits: string, body: string): Promise<void> {
    if (sender.engine === 'baileys') {
      await this.bridge.sendText({ to: toDigits, fromDigits: sender.fromDigits, body });
      return;
    }
    if (sender.engine === 'waba') {
      const { accessToken, senderId } = await this.wabaCredentials(orgId, sender.id);
      await this.meta.sendText(
        { senderId, accessToken },
        {
          to: toDigits,
          body,
          clientReference: `store-recovery:${orgId}:${toDigits}`,
          screen: { source: 'storefront-recovery' },
        },
      );
      return;
    }
    throw new Error(
      `No sender adapter for the "${sender.engine}" engine yet (blocked on the channel domain).`,
    );
  }

  private async wabaCredentials(
    orgId: number,
    configId: number,
  ): Promise<{ accessToken: string; senderId: string }> {
    const row = await this.db.txAs({ orgId }, async (tx) => {
      const res = await tx.execute(
        sql`SELECT credentials_json, meta_json FROM wa_provider_configs WHERE org_id = ${orgId} AND id = ${configId}`,
      );
      return res.rows[0] as
        { credentials_json: string | null; meta_json: Record<string, unknown> | null } | undefined;
    });
    let creds: Record<string, unknown> = {};
    if (row?.credentials_json) {
      try {
        creds = JSON.parse(this.crypto.decrypt(row.credentials_json)) as Record<string, unknown>;
      } catch {
        throw new Error('The WhatsApp Cloud API credentials of this number cannot be read.');
      }
    }
    const accessToken = String(creds.access_token ?? '');
    const senderId = String(creds.phone_number_id ?? row?.meta_json?.phone_number_id ?? '');
    if (!accessToken || !senderId) {
      throw new Error('This WhatsApp Cloud API number has no access token or phone number id.');
    }
    return { accessToken, senderId };
  }
}
