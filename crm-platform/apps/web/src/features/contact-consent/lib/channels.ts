import { INTAKE_CHANNELS, type IntakeChannel } from '@crm/contracts';

/** What a widget or booking notice covers when it was saved before the channels could be chosen: WhatsApp and email. */
export const LEGACY_NOTICE_CHANNELS: readonly IntakeChannel[] = ['whatsapp', 'email'];

/** The channels a saved notice covers: the chosen ones, else the old rule. */
export function effectiveChannels(saved: readonly IntakeChannel[]): IntakeChannel[] {
  return INTAKE_CHANNELS.filter((c) =>
    (saved.length > 0 ? saved : LEGACY_NOTICE_CHANNELS).includes(c),
  );
}

/** Tick or untick a channel. The last one cannot be unticked: the line must name at least one. */
export function toggleChannel(
  current: readonly IntakeChannel[],
  channel: IntakeChannel,
  on: boolean,
): IntakeChannel[] {
  const next = on ? [...current, channel] : current.filter((c) => c !== channel);
  const unique = INTAKE_CHANNELS.filter((c) => next.includes(c));
  return unique.length === 0 ? [...current] : unique;
}

/** The consent sentence for the chosen channels: `statement` holds a `{channels}` placeholder ("WhatsApp, SMS, and email"). */
export function channelStatement(
  statement: string,
  channels: readonly IntakeChannel[],
  names: Record<IntakeChannel, string>,
  locale: string,
): string {
  const items = INTAKE_CHANNELS.filter((c) => channels.includes(c)).map((c) => names[c]);
  let list: string;
  try {
    list = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items);
  } catch {
    list = items.join(', ');
  }
  return statement.replace('{channels}', list);
}
