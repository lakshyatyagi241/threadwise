import { canonicalizePhone } from '@crm/contracts';

/** Channel kinds whose peer is a phone number. The thread key is then the digits, so "+91 98765-43210" and "919876543210" are one thread. */
const PHONE_KINDS = new Set(['simulator', 'whatsapp_cloud', 'whatsapp_qr']);

const PEER_KEY_MAX = 128;

export const isPhoneChannel = (kind: string): boolean => PHONE_KINDS.has(kind);

/**
 * The key of a conversation's peer on a channel, normalised so every way a provider can write the same sender lands in one thread
 * (`UNIQUE (org_id, channel_id, peer_key)`). Null when there is nothing to key on.
 *
 *   phone channels  digits, through the same canonicaliser contacts use ("+91 98765 43210", "0091...", a WhatsApp jid
 *                   "919876543210@s.whatsapp.net" or "919876543210:12@s.whatsapp.net" all become "919876543210"). A number the
 *                   canonicaliser rejects (a short code, a local format) still gets its digits as key: an inbound message is
 *                   never dropped for how its sender wrote a number.
 *   email           the key as the adapter gave it (`t:<threadId>`, case kept), at most 128 characters.
 *   other channels  the channel's own thread id, trimmed and lower-cased (visitor and chat ids are case-insensitive tokens).
 */
export function normalizePeerKey(kind: string, raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (text === '') return null;

  if (isPhoneChannel(kind)) {
    // A jid is "<user>[:<device>]@<server>"; only the user part is the number.
    const user = (text.split('@')[0] ?? '').split(':')[0] ?? '';
    const canonical = canonicalizePhone({ number: user });
    if (canonical) return canonical.digits;
    const digits = user.replace(/\D/g, '');
    return digits.length >= 4 && digits.length <= 20 ? digits : null;
  }
  // An email thread is keyed by the provider's thread id (`t:<threadId>`), an opaque token: kept exactly as given.
  if (kind === 'email') return text.length <= PEER_KEY_MAX ? text : null;
  const key = text.toLowerCase();
  return key.length <= PEER_KEY_MAX ? key : null;
}

/** The contact identity a peer stands for, or null when the channel has no identity to match on (a webchat visitor). */
export function identityOfPeer(
  kind: string,
  peerKey: string,
): { kind: 'phone'; value: string } | null {
  if (!isPhoneChannel(kind)) return null;
  const canonical = canonicalizePhone({ number: `+${peerKey}` });
  return canonical ? { kind: 'phone', value: canonical.e164 } : null;
}

/** The title of an email thread whose first mail had no subject and no sender name. */
export const NO_SUBJECT_TITLE = '(no subject)';

/** What a thread is called until a contact is linked: the sender's own name, else the number as people write it. */
export function defaultTitle(kind: string, peerKey: string, peerName: string | null): string {
  const name = peerName?.trim();
  if (name) return name.slice(0, 200);
  if (kind === 'email') return NO_SUBJECT_TITLE;
  return isPhoneChannel(kind) ? `+${peerKey}` : peerKey;
}
