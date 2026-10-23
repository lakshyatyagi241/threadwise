import { CHANNEL_KINDS } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { channelFamily, channelSettingsHref, channelState, sendBlocked } from './status';

describe('channelState', () => {
  it('names the four states a person cares about', () => {
    expect(channelState('connected')).toBe('connected');
    expect(channelState('needs_reauth')).toBe('needs_reconnect');
    expect(channelState('error')).toBe('error');
    expect(channelState('disconnected')).toBe('not_connected');
    expect(channelState('something-new')).toBe('not_connected');
  });

  it('blocks sending for everything but a connected channel', () => {
    expect(sendBlocked('connected')).toBe(false);
    expect(sendBlocked('disconnected')).toBe(true);
  });
});

describe('channelFamily', () => {
  it('says "WhatsApp" only for the WhatsApp kinds', () => {
    expect(channelFamily('whatsapp_cloud')).toBe('whatsapp');
    expect(channelFamily('whatsapp_qr')).toBe('whatsapp');
  });

  it('gives email its own words and every other kind the neutral ones', () => {
    expect(channelFamily('email')).toBe('email');
    for (const kind of CHANNEL_KINDS.filter((k) => !k.startsWith('whatsapp') && k !== 'email')) {
      expect(channelFamily(kind)).toBe('other');
    }
    expect(channelFamily('a-kind-added-later')).toBe('other');
  });
});

describe('channelSettingsHref', () => {
  it('sends each kind to its own screen', () => {
    expect(channelSettingsHref('whatsapp_cloud')).toBe('/channels/whatsapp');
    expect(channelSettingsHref('whatsapp_qr')).toBe('/devices');
    expect(channelSettingsHref('email')).toBe('/email');
    expect(channelSettingsHref('telegram')).toBe('/telegram');
  });

  it('falls back to the inbox channel list for a kind with no screen of its own', () => {
    expect(channelSettingsHref('simulator')).toBe('/inbox/channels');
    expect(channelSettingsHref('a-kind-added-later')).toBe('/inbox/channels');
  });

  it('has a screen for every kind but the simulator', () => {
    for (const kind of CHANNEL_KINDS.filter((k) => k !== 'simulator')) {
      expect(channelSettingsHref(kind), kind).not.toBe('/inbox/channels');
    }
  });
});
