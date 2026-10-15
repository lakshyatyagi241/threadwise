import { canonicalizePhone } from '../../../packages/contracts/src/contacts-attributes-tags/phone';

/**
 * The live inbox's thread key, title and preview rules, written again here because apps/api/src/modules/chat-conversations/peer-key.ts
 * and message-rules.ts import `@crm/contracts` (a workspace alias this tool cannot resolve). The phone canonicaliser itself is imported
 * by relative path, so there is one implementation of that. `test/chat.spec.ts` pins the behaviour with vectors and checks that the two
 * app files still carry the constants copied here: if the app changes its rule, that test fails and this file must follow.
 * R1 (spec A): a thread migrated under a different key than the live path produces would be split in two at cutover.
 */
export const PHONE_KINDS = new Set(['simulator', 'whatsapp_cloud', 'whatsapp_qr']);
export const PEER_KEY_MAX = 128;
export const PREVIEW_MAX = 200;

export const isPhoneChannel = (kind: string): boolean => PHONE_KINDS.has(kind);

export function normalizePeerKey(kind: string, raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (text === '') return null;
  if (isPhoneChannel(kind)) {
    const user = (text.split('@')[0] ?? '').split(':')[0] ?? '';
    const canonical = canonicalizePhone({ number: user });
    if (canonical) return canonical.digits;
    const digits = user.replace(/\D/g, '');
    return digits.length >= 4 && digits.length <= 20 ? digits : null;
  }
  const key = text.toLowerCase();
  return key.length <= PEER_KEY_MAX ? key : null;
}

export function defaultTitle(kind: string, peerKey: string, peerName: string | null): string {
  const name = peerName?.trim();
  if (name) return name.slice(0, 200);
  return isPhoneChannel(kind) ? `+${peerKey}` : peerKey;
}

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function previewOf(m: { kind: string; body?: string | null }): string {
  const body = (m.body ?? '').replace(/\s+/g, ' ').trim();
  if (body !== '') return body.slice(0, PREVIEW_MAX);
  if (m.kind === 'location') return '📍 Location';
  if (m.kind === 'text' || m.kind === 'system') return '';
  return `📎 ${capitalise(String(m.kind))}`;
}
