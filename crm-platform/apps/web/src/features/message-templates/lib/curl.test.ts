import { describe, expect, it } from 'vitest';
import { apiBaseUrl, canSendViaApi, templateSendCurl } from './curl';

const base = {
  id: 'tpl-1',
  body: 'Hi',
  header: null,
  attachmentType: 'none' as const,
  buttons: [],
};

describe('templateSendCurl', () => {
  it('sends to the template endpoint with the key placeholder', () => {
    const c = templateSendCurl('https://x.io/api/v1', base);
    expect(c).toContain("curl -X POST 'https://x.io/api/v1/templates/tpl-1/send'");
    expect(c).toContain('Bearer YOUR_API_KEY');
    expect(c).not.toContain('"body"');
  });
  it('adds a slot per distinct body variable, media header and dynamic url button', () => {
    const c = templateSendCurl('https://x.io/api/v1', {
      ...base,
      body: 'Dear {{1}}, job {{2}} {{1}}',
      attachmentType: 'document',
      buttons: [{ type: 'URL', text: 'Open', url: 'https://a.io/{{1}}' }, { type: 'PHONE_NUMBER' }],
    });
    expect(c).toContain('"value_2"');
    expect(c).toContain('header_media_url');
    expect(c).toContain('"index": 0');
  });
  it('builds the base url and the sendable rule', () => {
    expect(apiBaseUrl('https://x.io/')).toBe('https://x.io/api/v1');
    expect(canSendViaApi({ status: 'approved', metaCategory: 'UTILITY' })).toBe(true);
    expect(canSendViaApi({ status: 'pending', metaCategory: 'UTILITY' })).toBe(false);
    expect(canSendViaApi({ status: 'approved', metaCategory: 'AUTHENTICATION' })).toBe(false);
  });
});
