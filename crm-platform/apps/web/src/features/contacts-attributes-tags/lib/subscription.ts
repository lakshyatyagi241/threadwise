import type { ContactRow } from '../api/schemas';

/**
 * A channel's opt-in as the list and the quick view say it, from what the contact row carries (no extra call per row):
 *
 * - `yes`: the channel's subscription label is "subscribed" and the contact has not opted out of marketing;
 * - `out`: the contact opted out of marketing (`isUnsubscribed`), which beats any label;
 * - `no`: no opt-in recorded for that channel.
 *
 * The label is what the contact record holds; the consent ledger (the Consent card) is the proof behind it.
 */
export type OptIn = 'yes' | 'no' | 'out';

export const OPT_IN_CHANNELS = ['whatsapp', 'email', 'sms'] as const;
export type OptInChannel = (typeof OPT_IN_CHANNELS)[number];

export function optInOf(label: string | null | undefined, optedOut: boolean): OptIn {
  if (optedOut) return 'out';
  return (label ?? '').trim().toLowerCase() === 'subscribed' ? 'yes' : 'no';
}

type Source = Pick<
  ContactRow,
  | 'whatsappSubscriptionStatus'
  | 'smsSubscriptionStatus'
  | 'emailSubscriptionStatus'
  | 'isUnsubscribed'
>;

const LABEL: Record<OptInChannel, keyof Source> = {
  whatsapp: 'whatsappSubscriptionStatus',
  sms: 'smsSubscriptionStatus',
  email: 'emailSubscriptionStatus',
};

/** One channel's opt-in for a contact row. */
export function channelOptIn(c: Source, channel: OptInChannel): OptIn {
  return optInOf(c[LABEL[channel]] as string | null, c.isUnsubscribed);
}

/** The three channels in the order the Subscription status card lists them. */
export function subscriptionRows(c: Source): Array<{ channel: OptInChannel; optIn: OptIn }> {
  return OPT_IN_CHANNELS.map((channel) => ({ channel, optIn: channelOptIn(c, channel) }));
}
