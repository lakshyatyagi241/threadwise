import type { LineChannelResponse, SaveLineRotationInput } from '@crm/contracts';

/** What the channel card decides without the network. Pure. */

export type ChannelHealth = 'live' | 'paused' | 'attention';

/** Active and clean is live, switched off is paused, switched on with a recorded error needs attention. */
export function channelHealth(c: Pick<LineChannelResponse, 'active' | 'lastError'>): ChannelHealth {
  if (!c.active) return 'paused';
  return c.lastError ? 'attention' : 'live';
}

/** Both credentials are needed before the form can be submitted. */
export const connectReady = (token: string, secret: string): boolean =>
  token.trim() !== '' && secret.trim() !== '';

/**
 * The numeric Channel ID is asked for when the channel has only the bot user id LINE reported on connect (it starts with `U`):
 * rotation is signed with the numeric one.
 */
export const needsChannelId = (c: Pick<LineChannelResponse, 'lineChannelId'>): boolean =>
  !/^\d+$/.test(c.lineChannelId ?? '');

/** Blank key id or key turns rotation off, so both are sent trimmed and the Channel ID only when it was typed. */
export function rotationBody(form: {
  kid: string;
  key: string;
  channelId: string;
}): SaveLineRotationInput {
  const channelId = form.channelId.trim();
  return {
    assertionKid: form.kid.trim(),
    assertionPrivateKey: form.key.trim(),
    ...(channelId !== '' ? { channelId } : {}),
  };
}

/** "Enable rotation" until it is on, then "Re-issue / update". */
export const rotationActionKey = (
  c: Pick<LineChannelResponse, 'rotationEnabled'>,
): 'enableRotation' | 'reissue' => (c.rotationEnabled ? 'reissue' : 'enableRotation');

/** Whether the form would turn rotation off (nothing in the key id or key). */
export const turnsRotationOff = (form: { kid: string; key: string }): boolean =>
  form.kid.trim() === '' || form.key.trim() === '';

const shorten = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
/** The address shown under a channel, cut to fit. */
export const shortWebhook = (url: string): string => shorten(url, 64);
