import { resolveLegalUrl } from './legal-url';

const WEB = 'https://app.example.com';

describe('resolveLegalUrl', () => {
  it('joins a site path to the web address', () => {
    expect(resolveLegalUrl('/legal/terms', WEB)).toBe('https://app.example.com/legal/terms');
  });

  it('cannot open a site path when the web address is not configured', () => {
    expect(resolveLegalUrl('/legal/terms', undefined)).toBeNull();
  });

  it('opens an https address as it is', () => {
    expect(resolveLegalUrl(' https://example.com/privacy ', undefined)).toBe(
      'https://example.com/privacy',
    );
  });

  it('refuses plain http, unless this is a development build on a local network', () => {
    expect(resolveLegalUrl('http://example.com/p', WEB)).toBeNull();
    expect(resolveLegalUrl('/legal/terms', 'http://192.168.1.5:3001')).toBeNull();
    expect(resolveLegalUrl('http://example.com/p', WEB, { allowHttp: true })).toBe(
      'http://example.com/p',
    );
    expect(resolveLegalUrl('/legal/terms', 'http://192.168.1.5:3001', { allowHttp: true })).toBe(
      'http://192.168.1.5:3001/legal/terms',
    );
  });

  it('never turns anything else into a link, whatever the options', () => {
    const open = { allowHttp: true };
    expect(resolveLegalUrl('javascript:alert(1)', WEB, open)).toBeNull();
    expect(resolveLegalUrl('data:text/html,<b>x</b>', WEB, open)).toBeNull();
    expect(resolveLegalUrl('//evil.example.com/x', WEB, open)).toBeNull();
    expect(resolveLegalUrl('https://exa mple.com', WEB, open)).toBeNull();
    expect(resolveLegalUrl('terms', WEB, open)).toBeNull();
  });

  it('copes with nothing', () => {
    expect(resolveLegalUrl(null, WEB)).toBeNull();
    expect(resolveLegalUrl('   ', WEB)).toBeNull();
  });
});
