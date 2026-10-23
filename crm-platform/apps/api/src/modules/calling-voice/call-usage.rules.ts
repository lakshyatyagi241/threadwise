import { createHash } from 'node:crypto';
import type { WalletUsageReported } from '@crm/contracts';
import { billedMinutes } from '../wallet-message-billing';
import { telephonyExternalId } from './logging/call-logging.rules';

/**
 * What a call costs the customer's wallet, as the `usage.reported` report the wallet's worker prices (`emitUsageReported`). Pure, so the
 * money rules of calling have plain unit tests: which calls are billed, the unit (every started minute), and the id that makes a call
 * charge once however many times it is reported.
 *
 * Only calls the PLATFORM carried are billed: a WhatsApp call through Meta, and a call a customer's telephony provider reported as
 * completed. A call a person typed in or a phone app reported is a record of something the platform did not do and is never billed
 * (they do not come through here).
 */

/** The longest usage id the wallet accepts (`walletUsageReportedSchema.usageId`). */
const USAGE_ID_MAX = 191;

/**
 * A WhatsApp call (either direction) that Meta ended, or null when it has nothing to bill. The unit is the started minute. A call
 * nobody answered has no duration and is NOT reported: the wallet claims a call id on its first report and charges each id once, so a
 * zero-minute report would close the call as free for good, and a later terminate carrying the real duration would be ignored.
 * `usageId` is Meta's call id: a repeated `terminate` reports the same call.
 */
export function whatsappCallUsage(c: {
  metaCallId: string;
  /** The customer's number, for the country of the charge. */
  customerPhone: string | null;
  durationSec: number;
}): WalletUsageReported | null {
  const units = billedMinutes(c.durationSec);
  if (units === 0) return null;
  return {
    kind: 'whatsapp_call',
    usageId: c.metaCallId,
    status: 'used',
    units,
    recipient: c.customerPhone,
    source: 'inbox',
    provider: 'meta',
  };
}

/**
 * The id a provider-reported call is charged under: the entry's own external id (`<connection>:<provider call id>`), which is unique per
 * workspace. A provider call id may be up to 160 characters, so the joined id can pass the wallet's limit; then the call id is replaced by
 * its SHA-256, which is as stable and as unique.
 */
export function telephonyUsageId(connectionUuid: string, callId: string): string {
  const id = telephonyExternalId(connectionUuid, callId);
  if (id.length <= USAGE_ID_MAX) return id;
  return `${connectionUuid}:${createHash('sha256').update(callId).digest('hex')}`;
}

/**
 * A call the customer's telephony provider reported. Billed only when the provider says it COMPLETED and it had talk time: a busy,
 * declined, unanswered, cancelled, failed or voicemail call costs nothing, and null here means "do not report it".
 */
export function telephonyCallUsage(c: {
  connectionUuid: string;
  callId: string;
  /** The provider's status of the call (`completed`, `busy`, ...). */
  status: string;
  durationSec: number;
  customerPhone: string | null;
  /** The connection's provider key (`twilio`, `exotel`...): the vendor that carried it. */
  provider: string;
}): WalletUsageReported | null {
  if (c.status !== 'completed') return null;
  const units = billedMinutes(c.durationSec);
  if (units === 0) return null;
  return {
    kind: 'voice_call',
    usageId: telephonyUsageId(c.connectionUuid, c.callId),
    status: 'used',
    units,
    recipient: c.customerPhone,
    source: 'telephony',
    provider: c.provider,
  };
}
