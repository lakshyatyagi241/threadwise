import type { CatalogSender } from '@crm/contracts';

export type Engine = 'waba' | 'twilio' | 'baileys';

/**
 * The send engine the Setup tab words its "Ready to send" card for. Reference read the workspace's active engine; the overview
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

/** The senders grouped by engine in the order each engine first appears (the picker draws one group per engine when there are several). */
export function senderGroups<T extends Pick<CatalogSender, 'engine'>>(
  senders: T[],
): Array<{ engine: Engine; items: T[] }> {
  const groups = new Map<Engine, T[]>();
  for (const s of senders) {
    const engine: Engine = s.engine === 'waba' || s.engine === 'twilio' ? s.engine : 'baileys';
    const list = groups.get(engine);
    if (list) list.push(s);
    else groups.set(engine, [s]);
  }
  return [...groups].map(([engine, items]) => ({ engine, items }));
}
