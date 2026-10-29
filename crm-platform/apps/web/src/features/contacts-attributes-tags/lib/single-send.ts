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

/** The contact details a template variable can be filled from. Custom properties come from the contact's own values. */
export const VARIABLE_FIELDS = ['name', 'first_name', 'last_name', 'email', 'phone'] as const;
export type VariableField = (typeof VARIABLE_FIELDS)[number];

/** Where a variable's value comes from: text typed here, or a detail of the contact with a fallback for a contact who has none. */
export type SlotSource =
  { kind: 'text'; text: string } | { kind: 'field'; field: string; fallback: string };

type SourceContact = { name: string; email: string; phone: string; custom: Record<string, string> };

/** What the contact has for a field: a detail of the contact, else one of its custom properties; empty when it has nothing. */
export function contactValue(contact: SourceContact, field: string): string {
  const parts = contact.name.trim().split(/\s+/).filter(Boolean);
  switch (field) {
    case 'name':
      return contact.name.trim();
    case 'first_name':
      return parts[0] ?? '';
    case 'last_name':
      return parts.slice(1).join(' ');
    case 'email':
      return contact.email.trim();
    case 'phone':
      return contact.phone.trim();
    default:
      return (contact.custom[field] ?? '').trim();
  }
}

/** The text one variable has for this contact: the typed text, or the contact's value, else the fallback. */
export function slotValue(source: SlotSource | undefined, contact: SourceContact): string {
  if (!source) return '';
  if (source.kind === 'text') return source.text.trim();
  return contactValue(contact, source.field) || source.fallback.trim();
}

/** Every variable of the template resolved for the contact; a variable with no source or no value is left out (it stays missing). */
export function resolveVariables(
  template: Pick<InboxTemplateOption, 'slots'>,
  sources: Readonly<Record<string, SlotSource>>,
  contact: SourceContact,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of template.slots) {
    const v = slotValue(sources[s.key], contact);
    if (v) out[s.key] = v;
  }
  return out;
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
