/**
 * Pure readers for the two coexistence webhooks that mirror the WhatsApp Business app into the workspace: the one-time chat
 * history push (TW-WABA-046) and the address-book sync (TW-WABA-045). No database, no network.
 */

type Raw = Record<string, unknown>;

/** Most messages taken from one delivery; Meta pushes history in chunks, so the rest arrives in later deliveries. */
export const HISTORY_CAP = 2000;

export interface EchoPayload {
  id?: string;
  to?: string;
  recipient_id?: string;
  context?: { from?: string };
  timestamp?: string | number;
  type?: string;
  text?: { body?: string };
  [file: string]: unknown;
}

const LABEL: Record<string, string> = {
  image: 'Photo',
  video: 'Video',
  audio: 'Voice message',
  document: 'Document',
  sticker: 'Sticker',
  location: 'Location',
  contacts: 'Contact',
};

/** The words a copied message shows on the thread: its text or caption; a file or place is described, its bytes are not copied. */
export function echoText(e: EchoPayload): string {
  if (e.type === 'text' || e.text?.body) return e.text?.body ?? '';
  const file = e.type ? (e[e.type] as { caption?: string } | undefined) : undefined;
  const label = `[${LABEL[e.type ?? ''] ?? 'Message'}]`;
  return file?.caption ? `${label} ${file.caption}` : label;
}

const digits = (v: unknown): string => String(v ?? '').replace(/\D+/g, '');

export interface HistoryItem {
  providerMessageId: string;
  /** The customer's number as digits. */
  customer: string;
  /** Written by the business (from one of the workspace's own numbers), not by the customer. */
  outgoing: boolean;
  text: string;
  at: Date;
}

/**
 * `value.history[].threads[].messages[]` as a flat list, oldest chunk first, capped. The customer is the thread id, else the party
 * that is not one of the workspace's own numbers; a message with no customer is skipped. Content is described, never downloaded
 * (Meta's history media ids are not fetchable).
 */
export function historyItems(
  value: Raw,
  ownDigits: ReadonlySet<string>,
  cap = HISTORY_CAP,
): { items: HistoryItem[]; capped: boolean } {
  const items: HistoryItem[] = [];
  for (const chunk of (value.history as Raw[] | undefined) ?? []) {
    for (const thread of (chunk.threads as Raw[] | undefined) ?? []) {
      const threadId = digits(thread.id);
      for (const msg of (thread.messages as Raw[] | undefined) ?? []) {
        if (items.length >= cap) return { items, capped: true };
        const id = String(msg.id ?? '');
        const from = digits(msg.from);
        const outgoing = from !== '' && ownDigits.has(from);
        let customer = threadId || digits(msg.to ?? msg.from);
        if (customer === '' || ownDigits.has(customer)) customer = outgoing ? digits(msg.to) : from;
        if (!id || !customer) continue;
        const seconds = Number(msg.timestamp);
        items.push({
          providerMessageId: id,
          customer,
          outgoing,
          text: echoText(msg as EchoPayload),
          at: seconds > 0 ? new Date(seconds * 1000) : new Date(),
        });
      }
    }
  }
  return { items, capped: false };
}

export interface SyncedContact {
  /** The number as Meta sent it, with a plus when it had none. */
  phone: string;
  name: string | null;
}

/**
 * `value.state_sync[]`: contacts the business has in its phone. Items of another type are skipped; `remove` is never applied (the
 * platform keeps what it has); a number with no digits is skipped; duplicates inside one batch collapse to the first.
 */
export function syncedContacts(value: Raw): { contacts: SyncedContact[]; removed: number } {
  const seen = new Set<string>();
  const contacts: SyncedContact[] = [];
  let removed = 0;
  for (const item of (value.state_sync as Raw[] | undefined) ?? []) {
    if ((item.type ?? 'contact') !== 'contact') continue;
    const contact = (item.contact ?? {}) as Raw;
    const d = digits(contact.phone_number);
    if (!d) continue;
    if ((item.action ?? 'add') === 'remove') {
      removed++;
      continue;
    }
    if (seen.has(d)) continue;
    seen.add(d);
    const full = contact.full_name;
    const name = (
      typeof full === 'string'
        ? full
        : full && typeof full === 'object'
          ? String((full as Raw).name ?? '')
          : `${String(contact.first_name ?? '')} ${String(contact.last_name ?? '')}`
    ).trim();
    contacts.push({ phone: `+${d}`, name: name || null });
  }
  return { contacts, removed };
}
