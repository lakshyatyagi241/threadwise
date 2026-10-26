// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChannelResponse } from '@crm/contracts';
import { id } from '../lib/fixtures';
import { ChannelKindOptions } from './channel-kind-options';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'team-inbox-conversations.json'), 'utf8'),
) as Record<string, unknown>;

function channel(n: number, kind: ChannelResponse['kind'], name: string): ChannelResponse {
  return { id: id(n), kind, name } as ChannelResponse;
}

let root: Root | null = null;
let host: HTMLElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
});

async function show(channels: ChannelResponse[]) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <select>
          <ChannelKindOptions channels={channels} />
        </select>
      </NextIntlClientProvider>,
    );
  });
}

describe('the inbox channel box, chat channels', () => {
  it('puts each channel kind under its own labelled group, in the order the list gives', async () => {
    await show([
      channel(1, 'whatsapp_cloud', 'Sales line'),
      channel(2, 'webchat', 'Web bot'),
      channel(3, 'whatsapp_cloud', 'Support line'),
      channel(4, 'instagram', 'Brand page'),
    ]);
    const groups = [...document.querySelectorAll('optgroup')];
    expect(groups.map((g) => g.label)).toEqual(['WhatsApp Cloud API', 'Website chat', 'Instagram']);
    expect(groups[0].querySelectorAll('option').length).toBe(2);
    expect(groups[0].querySelector('option')?.textContent).toBe('Sales line');
    expect(document.querySelector('[data-testid="inbox-webchat-group"]')).not.toBeNull();
  });

  it('leaves email mailboxes out, they have their own group', async () => {
    await show([channel(1, 'email', 'madinkteam@gmail.com'), channel(2, 'telegram', 'Bot')]);
    expect(document.querySelectorAll('option').length).toBe(1);
    expect(document.querySelector('option')?.textContent).toBe('Bot');
  });

  it('renders nothing when there are no chat channels', async () => {
    await show([]);
    expect(document.querySelectorAll('optgroup').length).toBe(0);
  });
});
