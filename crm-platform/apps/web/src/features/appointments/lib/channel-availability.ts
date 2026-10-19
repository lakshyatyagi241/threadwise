import type { AppointmentChannel, AppointmentChannelState } from '@crm/contracts';

/**
 * Which channels a booking type may use (BL-350). The owner switches a channel on (`enabled`) and a sender has to be connected
 * (`connection`); only both together make it usable. No React in here.
 */

export type ChannelUse = 'usable' | 'off' | 'not_connected' | 'coming_soon';

/** Where the owner connects each channel (Settings > Channels). Voice has no page yet. */
export const CONNECT_HREF: Record<AppointmentChannel, string | null> = {
  whatsapp: '/channels/whatsapp',
  sms: '/sms',
  email: '/email',
  voice: null,
};

/** The channels in the order the screens list them. */
export const CHANNEL_ORDER = [
  'whatsapp',
  'email',
  'sms',
  'voice',
] as const satisfies readonly AppointmentChannel[];

export function channelUseOf(state: AppointmentChannelState | undefined): ChannelUse {
  // Not loaded (yet, or the request failed): do not block the editor on a guess; the API refuses a channel that is not on.
  if (!state) return 'usable';
  if (state.connection === 'coming_soon') return 'coming_soon';
  if (!state.enabled) return 'off';
  if (state.connection !== 'connected') return 'not_connected';
  return 'usable';
}

export function stateOfChannel(
  states: readonly AppointmentChannelState[] | undefined,
  channel: AppointmentChannel,
): AppointmentChannelState | undefined {
  return states?.find((s) => s.channel === channel);
}

export function channelUse(
  states: readonly AppointmentChannelState[] | undefined,
  channel: AppointmentChannel,
): ChannelUse {
  return states === undefined ? 'usable' : channelUseOf(stateOfChannel(states, channel));
}

/** The channels a rule or message may be attached to right now, in the order given. */
export function usableChannels<T extends AppointmentChannel>(
  states: readonly AppointmentChannelState[] | undefined,
  among: readonly T[],
): T[] {
  return among.filter((c) => channelUse(states, c) === 'usable');
}
