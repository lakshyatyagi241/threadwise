import { describe, expect, it } from 'vitest';
import { shareLinks } from './share';

const COPY = { text: 'Check out my shop: Acme & Sons', subject: 'Check out my shop · Acme & Sons' };

describe('shareLinks', () => {
  const links = shareLinks('https://app.test/s/acme', 'Acme & Sons', COPY);
  it('builds the WaDesk message', () => {
    expect(links.text).toBe('Check out my shop: Acme & Sons\nhttps://app.test/s/acme');
  });
  it('encodes each target', () => {
    expect(links.whatsapp).toBe(`https://wa.me/?text=${encodeURIComponent(links.text)}`);
    expect(links.email.startsWith('mailto:?subject=')).toBe(true);
    expect(links.email).toContain(encodeURIComponent('Check out my shop · Acme & Sons'));
    expect(links.telegram).toBe(
      `https://t.me/share/url?url=${encodeURIComponent('https://app.test/s/acme')}&text=${encodeURIComponent('Acme & Sons')}`,
    );
  });
});
