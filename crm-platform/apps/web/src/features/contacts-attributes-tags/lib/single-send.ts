import type { InboxTemplateOption } from '@crm/contracts';

/** The channels the contact list can send one message on (TW-CON single send). */
export type SendChannel = 'whatsapp' | 'sms' | 'email' | 'call';

/** Why a channel cannot be used for this contact; null when it can. Opt-out blocks messages, not the person's own phone. */
export type SendBlock = 'noPhone' | 'noEmail' | 'optedOut';

export function sendBlock(
  channel: SendChannel,
  row: { phone: string; email: string; optedOut: boolean },
): SendBlock | null {
  if (channel === 'email') return row.email.trim() ? (row.optedOut ? 'optedOut' : null) : 'noEmail';
  if (!row.phone.trim()) return 'noPhone';
  // A call is a conversation the person starts; only written messages honour the opt-out.
  return channel !== 'call' && row.optedOut ? 'optedOut' : null;
}

/** The template body with every `{{key}}` replaced by what was typed; a slot still empty stays as its `{{key}}` marker. */
export function previewOf(
  template: Pick<InboxTemplateOption, 'body'>,
  vars: Readonly<Record<string, string>>,
): string {
  return template.body.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (whole, key: string) => {
    const v = vars[key]?.trim();
    return v ? v : whole;
  });
}

/** Slot keys with no value yet: Send stays off until none is left. */
export function missingSlots(
  template: Pick<InboxTemplateOption, 'slots'>,
  vars: Readonly<Record<string, string>>,
): string[] {
  return template.slots.filter((s) => !(vars[s.key] ?? '').trim()).map((s) => s.key);
}

/** The WhatsApp numbers that are connected, in the order the API lists them. */
export function whatsappChannels<T extends { kind: string; status: string }>(
  channels: readonly T[],
): T[] {
  return channels.filter((c) => c.status === 'connected' && c.kind.startsWith('whatsapp'));
}

/** The mailboxes that are connected, in the order the API lists them. */
export function emailChannels<T extends { kind: string; status: string }>(
  channels: readonly T[],
): T[] {
  return channels.filter((c) => c.status === 'connected' && c.kind === 'email');
}
