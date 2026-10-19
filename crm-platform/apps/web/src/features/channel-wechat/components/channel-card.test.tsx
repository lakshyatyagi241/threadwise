import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type { WechatChannel } from '@crm/contracts';
import { ChannelCard } from './channel-card';

// The server-config request is the one thing that must not run in a render test: it is where the Token comes from.
const serverConfig = vi.fn();
vi.mock('../api/wechat', () => ({
  KEYS: { all: ['wechat'] },
  recheckChannel: vi.fn(),
  removeChannel: vi.fn(),
  toggleChannel: vi.fn(),
  useServerConfig: (...args: unknown[]) => {
    serverConfig(...args);
    return { data: undefined, isError: false };
  },
}));

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'wechat.json'), 'utf8'),
) as Record<string, unknown>;

const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

const channel = (over: Partial<WechatChannel> = {}): WechatChannel => ({
  id: 'c1b3a7a2-0000-4000-8000-000000000000',
  appId: 'wx0123456789abcdef',
  wxId: null,
  accountName: 'Aurora Cafe',
  encMode: 'compat',
  hasEncodingAesKey: false,
  active: true,
  connectedAt: '2026-10-01T10:00:00.000Z',
  lastInboundAt: null,
  lastError: null,
  webhookUrl: 'https://crm.example.com/v2/wechat/inbound/abc123',
  rowVersion: 1,
  ...over,
});

describe('a connected channel', () => {
  it('shows the name, the AppID, the address to paste into WeChat and the actions to a manager', () => {
    const out = html(<ChannelCard channel={channel()} canManage />);
    expect(out).toContain('Aurora Cafe');
    expect(out).toContain('wx0123456789abcdef');
    expect(out).toContain('Active');
    expect(out).toContain('Paste into WeChat → Server Config');
    expect(out).toContain('https://crm.example.com/v2/wechat/inbound/abc123');
    for (const label of ['Re-check', 'Pause', 'Remove', 'Show']) expect(out).toContain(label);
  });

  it('never fetches or shows the Token until the person asks for it', () => {
    serverConfig.mockClear();
    const out = html(<ChannelCard channel={channel()} canManage />);
    expect(out).toContain('hidden');
    expect(serverConfig).toHaveBeenCalledWith(expect.any(String), false);
  });

  it('a person who cannot manage the channel sees neither the Token nor any action', () => {
    serverConfig.mockClear();
    const out = html(<ChannelCard channel={channel()} canManage={false} />);
    expect(out).toContain('https://crm.example.com/v2/wechat/inbound/abc123');
    for (const label of ['Re-check', 'Pause', 'Remove', 'Show', 'Token:']) {
      expect(out).not.toContain(label);
    }
    expect(serverConfig).toHaveBeenCalledWith(expect.any(String), false);
  });

  it('a paused channel offers Enable, and an error from WeChat is shown under its name', () => {
    const out = html(
      <ChannelCard
        channel={channel({
          active: false,
          lastError: 'access_token: 40164 invalid ip',
          wxId: 'gh_1',
        })}
        canManage
      />,
    );
    expect(out).toContain('Paused');
    expect(out).toContain('Enable');
    expect(out).not.toContain('>Pause<');
    expect(out).toContain('access_token: 40164 invalid ip');
    expect(out).toContain('gh_1');
  });

  it('an account with no name falls back to a plain label', () => {
    expect(html(<ChannelCard channel={channel({ accountName: null })} canManage />)).toContain(
      'WeChat account',
    );
  });
});
