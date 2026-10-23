import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { FailureNote } from './failure-note';
import { ReconnectBanner } from './reconnect-banner';

// The real English strings, so a key the banner asks for that does not exist fails here instead of printing its path in the inbox.
const messages = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../../../messages/en/channel-whatsapp-cloud.json'),
    'utf8',
  ),
) as Record<string, unknown>;

const html = (el: React.ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );

const banner = (kind: string, status: string, canManage = true) =>
  html(
    <ReconnectBanner channel={{ name: 'sales@acme.test', kind, status }} canManage={canManage} />,
  );

describe('ReconnectBanner', () => {
  it('renders nothing for a connected channel', () => {
    expect(banner('email', 'connected')).toBe('');
  });

  it('talks about a mailbox, not a WhatsApp number, for an email channel', () => {
    const out = banner('email', 'disconnected');
    expect(out).toContain('This mailbox is disconnected.');
    expect(out).toContain('sales@acme.test is not connected');
    expect(out).toContain('Open the mailbox settings');
    expect(out).toContain('href="/email"');
    expect(out).toContain('data-channel-family="email"');
    expect(out).not.toMatch(/WhatsApp/);
  });

  it('says the mailbox needs reconnecting when its sign-in was refused', () => {
    const out = banner('email', 'needs_reauth');
    expect(out).toContain('This mailbox needs to be reconnected.');
    expect(out).not.toMatch(/WhatsApp/);
  });

  it('keeps the WhatsApp wording and screen for a WhatsApp Cloud number', () => {
    const out = banner('whatsapp_cloud', 'disconnected');
    expect(out).toContain('This WhatsApp number is switched off.');
    expect(out).toContain('Open the WhatsApp settings');
    expect(out).toContain('href="/channels/whatsapp"');
  });

  it('sends a WhatsApp QR device to the devices screen', () => {
    const out = banner('whatsapp_qr', 'error');
    expect(out).toContain('This WhatsApp number has a connection problem.');
    expect(out).toContain('href="/devices"');
  });

  it('uses neutral words and the channel own screen for the other kinds', () => {
    for (const [kind, href] of [
      ['telegram', '/telegram'],
      ['facebook', '/facebook'],
      ['instagram', '/instagram'],
      ['line', '/line'],
      ['viber', '/viber'],
      ['wechat', '/wechat'],
    ] as const) {
      const out = banner(kind, 'disconnected');
      expect(out, kind).toContain('This channel is switched off.');
      expect(out, kind).toContain('Open the channel settings');
      expect(out, kind).toContain(`href="${href}"`);
      expect(out, kind).not.toMatch(/WhatsApp/);
    }
  });

  it('tells a person who cannot manage channels to ask, with no link', () => {
    const out = banner('email', 'disconnected', false);
    expect(out).toContain('Ask someone who manages channels to reconnect it.');
    expect(out).not.toContain('href=');
  });

  it('marks an errored channel as danger and a switched-off one as a warning', () => {
    expect(banner('email', 'error')).toContain('text-danger');
    expect(banner('email', 'disconnected')).toContain('text-warning');
  });
});

describe('FailureNote link', () => {
  const note = (channelKind?: string) =>
    html(
      <FailureNote
        failure={{ code: 'CHANNEL_NEEDS_REAUTH', reason: null }}
        fallback="failed"
        canManage
        {...(channelKind ? { channelKind } : {})}
      />,
    );

  it('keeps the WhatsApp link by default', () => {
    const out = note();
    expect(out).toContain('Open the WhatsApp settings');
    expect(out).toContain('href="/channels/whatsapp"');
  });

  it('names the channel, not WhatsApp, for another kind', () => {
    const out = note('email');
    expect(out).toContain('Open the channel settings');
    expect(out).toContain('href="/email"');
    expect(out).not.toContain('Open the WhatsApp settings');
  });
});
