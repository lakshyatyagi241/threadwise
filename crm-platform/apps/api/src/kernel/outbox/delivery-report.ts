import {
  MESSAGE_DELIVERY_EVENT,
  isBillableStatus,
  isFailureStatus,
  walletDeliveryReportedSchema,
  type WalletDeliveryReported,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import type { OutboxService } from './outbox.service';

/** Maps an engine/channel name to the provider the billing engine knows; null for anything that is not billed per message. */
export function deliveryProviderOf(
  engine: string | null | undefined,
): 'waba' | 'twilio' | 'baileys' | null {
  switch (engine) {
    case 'waba':
    case 'whatsapp_cloud':
      return 'waba';
    case 'twilio':
      return 'twilio';
    case 'baileys':
      return 'baileys';
    default:
      return null;
  }
}

/**
 * Reports what a provider said about an outbound message to the wallet (TW-WALLET-012), in the caller's transaction so the status
 * change and the report commit or roll back together. Only a status the billing engine acts on is written (a charge or a refund):
 * a bare `sent` from a Cloud/Twilio engine settles nothing, and at campaign volume it would only drown the outbox. Call it ONLY on a
 * real transition (never for a repeated report) and never for an inbound message. Returns whether an event was written.
 */
export async function emitDeliveryReported(
  outbox: OutboxService,
  tx: Tx,
  o: {
    orgId: number;
    aggregateModule: string;
    aggregateId: number;
    report: WalletDeliveryReported;
  },
): Promise<boolean> {
  const parsed = walletDeliveryReportedSchema.safeParse(o.report);
  if (!parsed.success) return false;
  const r = parsed.data;
  if (!isBillableStatus(r.provider, r.status) && !isFailureStatus(r.status)) return false;
  await outbox.emit(tx, {
    orgId: o.orgId,
    aggregateModule: o.aggregateModule,
    aggregateId: o.aggregateId,
    eventType: MESSAGE_DELIVERY_EVENT,
    payload: r,
  });
  return true;
}
