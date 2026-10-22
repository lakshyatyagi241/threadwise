import { describe, expect, it } from 'vitest';
import { widgetBaseUrl } from '../../../src/modules/chatbot-widget/widget-rules';

// What the API sees behind the website's proxy: its own container name as the Host, the visitor's protocol forwarded.
const req = (host: string) => ({
  protocol: 'https',
  get: (n: string) => (n.toLowerCase() === 'host' ? host : undefined),
});

describe('the address a widget embed points back at', () => {
  it('is the configured widget address, then APP_URL, never the API container host', () => {
    const behindProxy = req('desk-api-green:3000');
    expect(
      widgetBaseUrl(
        { widgetPublicBase: 'https://widgets.example/', appUrl: 'https://desk.wabo.ai' },
        behindProxy,
      ),
    ).toBe('https://widgets.example');
    expect(widgetBaseUrl({ appUrl: 'https://desk.wabo.ai/' }, behindProxy)).toBe(
      'https://desk.wabo.ai',
    );
    expect(
      widgetBaseUrl({ widgetPublicBase: '', appUrl: 'https://desk.wabo.ai' }, behindProxy),
    ).toBe('https://desk.wabo.ai');
  });

  it('falls back to the request host only when nothing is configured', () => {
    expect(widgetBaseUrl({}, req('localhost:3000'))).toBe('https://localhost:3000');
  });
});
