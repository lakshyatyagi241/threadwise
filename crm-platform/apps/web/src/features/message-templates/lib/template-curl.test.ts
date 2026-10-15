import { describe, expect, it } from 'vitest';
import { curlAvailable, templateCurl, tokensOf } from './template-curl';

const base = {
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  status: 'approved' as const,
  templateType: 'standard',
  body: 'Hi {{1}}, your order {{2}} shipped.',
  header: null,
  attachmentType: 'none' as const,
  buttons: [],
  pausedUntil: null,
  qualityScore: null,
};

describe('copy cURL of a template', () => {
  it('reads the tokens once each, in order', () => {
    expect(tokensOf('a {{1}} b {{ 2 }} c {{1}}')).toEqual(['1', '2']);
    expect(tokensOf(null)).toEqual([]);
  });

  it('is offered for an approved template the send endpoint accepts', () => {
    expect(curlAvailable(base)).toBe(true);
    expect(curlAvailable({ ...base, body: 'No variables at all' })).toBe(true);
    expect(curlAvailable({ ...base, header: 'Plain header' })).toBe(true);
    expect(
      curlAvailable({ ...base, buttons: [{ type: 'URL', text: 'Open', url: 'https://x.test' }] }),
    ).toBe(true);
  });

  it('is not offered for what the endpoint refuses', () => {
    expect(curlAvailable({ ...base, status: 'pending' as never })).toBe(false);
    expect(curlAvailable({ ...base, templateType: 'auth' })).toBe(false);
    expect(curlAvailable({ ...base, body: 'Hi {{name}}' })).toBe(false);
    expect(curlAvailable({ ...base, header: 'Order {{1}}' })).toBe(false);
    expect(curlAvailable({ ...base, attachmentType: 'image' })).toBe(false);
    expect(curlAvailable({ ...base, qualityScore: 'RED' })).toBe(false);
    expect(
      curlAvailable({
        ...base,
        buttons: [{ type: 'URL', text: 'Track', url: 'https://x.test/{{1}}' }],
      }),
    ).toBe(false);
  });

  it('is not offered while Meta has the template paused, and is again once the pause is over', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    expect(curlAvailable({ ...base, pausedUntil: '2026-10-16T00:00:00.000Z' }, now)).toBe(false);
    expect(curlAvailable({ ...base, pausedUntil: '2026-10-14T00:00:00.000Z' }, now)).toBe(true);
  });

  it('builds the send request: key, a number to replace and one placeholder per body variable', () => {
    const c = templateCurl('https://api.example.com/api/v1', base);
    expect(c).toContain(`curl -X POST 'https://api.example.com/api/v1/templates/${base.id}/send'`);
    expect(c).toContain("-H 'Authorization: Bearer YOUR_API_KEY'");
    expect(c).toContain('<customer number with country code>');
    expect(c).toContain('<value for {{1}}>');
    expect(c).toContain('<value for {{2}}>');
    expect(c).not.toContain('header_');
    expect(c).not.toContain('buttons');
    expect(templateCurl('https://x/api/v1', { ...base, body: 'Hi' })).not.toContain('"body"');
  });

  it('puts a real key in when one is given, and quotes a single quote for the shell', () => {
    expect(templateCurl('https://x/api/v1', base, 'abc123')).toContain('Bearer abc123');
    expect(templateCurl('https://x/api/v1', base, "a'b")).toContain("Bearer a'\\''b");
  });
});
