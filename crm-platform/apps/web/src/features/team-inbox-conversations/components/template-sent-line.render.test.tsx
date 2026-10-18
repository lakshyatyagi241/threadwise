import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MessageResponse } from '@crm/contracts';
import { outbound } from '../lib/fixtures';
import { TemplateSentLine } from './message-stream';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'team-inbox-conversations.json'), 'utf8'),
) as Record<string, unknown>;

const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      {el}
    </NextIntlClientProvider>,
  );

const sent = (over: Partial<MessageResponse> = {}): MessageResponse =>
  outbound(1, {
    kind: 'template',
    status: 'sent',
    template: { name: 'welcome', language: 'en', variables: {} },
    ...over,
  } as Partial<MessageResponse>);

describe('template sent line', () => {
  it('names the template and the Official engine on a Cloud API channel', () => {
    const out = html(<TemplateSentLine message={sent()} channelKind="whatsapp_cloud" />);
    expect(out).toContain('data-testid="inbox-template-sent"');
    expect(out).toContain('Template “welcome” sent via Official (WhatsApp Cloud API)');
  });

  it('names the Unofficial engine on a QR channel', () => {
    const out = html(<TemplateSentLine message={sent()} channelKind="whatsapp_qr" />);
    expect(out).toContain('Template “welcome” sent via Unofficial (QR / Baileys)');
  });

  it('drops the engine for any other channel', () => {
    const out = html(<TemplateSentLine message={sent()} channelKind="telegram" />);
    expect(out).toContain('Template “welcome” sent');
    expect(out).not.toContain('via');
  });

  it('draws nothing for a queued or failed template, inbound, or a plain text message', () => {
    for (const m of [
      sent({ status: 'queued' }),
      sent({ status: 'failed' }),
      sent({ direction: 'in' }),
      outbound(2, { kind: 'text', status: 'sent' }),
    ]) {
      expect(html(<TemplateSentLine message={m} channelKind="whatsapp_cloud" />)).toBe('');
    }
  });
});
