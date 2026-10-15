import { createPath } from '@/features/campaigns/lib/create-flow';

export type ChannelCardId = 'whatsapp' | 'sms' | 'telegram' | 'facebook' | 'instagram';

export interface ChannelCard {
  id: ChannelCardId;
  href: string;
}

/**
 * The cards of the "Pick a channel" chooser, in Reference's order: WhatsApp always, then the channels this workspace has switched on.
 * WhatsApp and SMS open the campaign builder (SMS on its own sender); Telegram, Facebook and Instagram keep their own composers, as
 * they do in Reference. With only WhatsApp there is nothing to choose and the caller goes straight to the builder.
 */
export function channelCards(c: {
  telegram: boolean;
  facebook: boolean;
  instagram: boolean;
  sms: string | null;
}): ChannelCard[] {
  const cards: ChannelCard[] = [{ id: 'whatsapp', href: createPath() }];
  if (c.sms) cards.push({ id: 'sms', href: createPath({ sender: c.sms }) });
  if (c.telegram) cards.push({ id: 'telegram', href: '/telegram/broadcasts' });
  if (c.facebook) cards.push({ id: 'facebook', href: '/facebook/broadcasts' });
  if (c.instagram) cards.push({ id: 'instagram', href: '/instagram/broadcast' });
  return cards;
}
