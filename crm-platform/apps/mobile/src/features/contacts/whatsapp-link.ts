/**
 * The link that opens a WhatsApp chat with a number, or null when there is no number. wa.me wants the digits alone, without the
 * plus sign; it is the same link the web app's WhatsApp shortcut on a contact uses.
 */
export function whatsappLink(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits === '' ? null : `https://wa.me/${digits}`;
}
