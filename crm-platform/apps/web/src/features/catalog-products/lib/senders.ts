import type { CatalogSender } from '@crm/contracts';

export type Engine = 'waba' | 'twilio' | 'baileys';

/**
 * The send engine the Setup tab words its "Ready to send" card for. WaDesk read the workspace's active engine; the overview
 * lists the connected senders, so an official number wins over a paired device, and a WABA number over Twilio.
 */
export function workspaceEngine(senders: Pick<CatalogSender, 'engine'>[]): Engine {
  if (senders.some((s) => s.engine === 'waba')) return 'waba';
  if (senders.some((s) => s.engine === 'twilio')) return 'twilio';
  return 'baileys';
}

export const isOfficialEngine = (engine: Engine): boolean => engine !== 'baileys';

/** Name or "Device #n" fallback, and the number or an empty string. */
export const senderPhone = (s: Pick<CatalogSender, 'phone'>): string => s.phone?.trim() ?? '';
