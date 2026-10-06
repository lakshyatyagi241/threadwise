import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ENTITLEMENTS_KEY } from '@/lib/use-unofficial-whatsapp';
import { ChannelTag } from './parts';

const render = (kind: string, unofficial: boolean) => {
  const client = new QueryClient();
  if (unofficial) client.setQueryData(ENTITLEMENTS_KEY, { features: ['unofficial_whatsapp'] });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ChannelTag kind={kind} name="Shop line" />
    </QueryClientProvider>,
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
  });

  it('never touches the official WhatsApp badge or other channels', () => {
    expect(render('whatsapp_cloud', false)).toContain('data-channel-kind="whatsapp_cloud"');
    expect(render('telegram', false)).toContain('>TEL<');
  });
});
