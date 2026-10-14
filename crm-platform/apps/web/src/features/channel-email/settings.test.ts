import { describe, expect, it } from 'vitest';
import { nav } from './nav';
import { settings } from './settings';

describe('Email (Gmail) is a channel', () => {
  it('has its tile in Settings > Channels, locked (not hidden) when the plan lacks the feature', () => {
    expect(settings).toHaveLength(1);
    expect(settings[0]).toMatchObject({
      id: 'email',
      section: 'channels',
      href: '/email',
      gates: { permission: 'mail.mailboxes.read', planFeature: 'email_channel' },
    });
    expect(settings[0]?.gates).not.toHaveProperty('app');
  });

  it('keeps a hidden menu entry so /email shows the plan paywall, not the app-closed screen', () => {
    expect(nav).toHaveLength(1);
    expect(nav[0]).toMatchObject({
      href: '/email',
      inMenu: false,
      gates: { permission: 'mail.mailboxes.read', planFeature: 'email_channel' },
    });
    expect(nav[0]?.gates).not.toHaveProperty('app');
  });
});
