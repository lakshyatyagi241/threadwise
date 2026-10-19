import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ENTITLEMENTS_KEY } from '@/lib/use-unofficial-whatsapp';
import { ChannelTag } from './parts';

const messages = JSON.parse(
  readFileSync(join(__dirname, '../../../../messages/en/team-inbox-conversations.json'), 'utf8'),
);

const render = (kind: string, unofficial: boolean, full = false) => {
  const client = new QueryClient();
  if (unofficial) client.setQueryData(ENTITLEMENTS_KEY, { features: ['unofficial_whatsapp'] });
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={client}>
        <ChannelTag kind={kind} name="Shop line" full={full} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
};

describe('inbox channel badge', () => {
  it('draws no QR badge for a personal-number channel while the platform has unofficial WhatsApp off', () => {
    expect(render('whatsapp_qr', false)).toBe('');
  });

  it('draws it while the switch is on', () => {
    const html = render('whatsapp_qr', true);
    expect(html).toContain('data-channel-kind="whatsapp_qr"');
    expect(html).toContain('>QR<');
    expect(html).toContain('data-channel-type="unofficial"');
    expect(html).toContain('>Unofficial<');
  });

  it('says Official for the Cloud API number and spells the engine out in full mode', () => {
    expect(render('whatsapp_cloud', false)).toContain('>Official<');
    expect(render('whatsapp_cloud', false, true)).toContain('>Official (WhatsApp Cloud API)<');
    expect(render('whatsapp_qr', true, true)).toContain('>Unofficial (QR / Baileys)<');
  });

  it('never touches the official WhatsApp badge or other channels', () => {
    expect(render('whatsapp_cloud', false)).toContain('data-channel-kind="whatsapp_cloud"');
    expect(render('telegram', false)).toContain('>TEL<');
    expect(render('telegram', false)).not.toContain('data-channel-type');
  });

  it('marks a mailbox with EML, named by its address', () => {
    const html = render('email', false);
    expect(html).toContain('data-channel-kind="email"');
    expect(html).toContain('>EML<');
  });
});
