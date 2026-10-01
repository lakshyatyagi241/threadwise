import { describe, expect, it } from 'vitest';
import {
  isBot,
  isTokenShape,
  isTrackableUrl,
  linkTtlDays,
  makeToken,
  replaceUrlsInText,
} from '../../../src/modules/broadcasts/tracking/link-rules';

describe('makeToken', () => {
  it('is the length asked for and base62 only', () => {
    for (const n of [12, 20]) expect(makeToken(n)).toMatch(new RegExp(`^[A-Za-z0-9]{${n}}$`));
  });
  it('uses the random source it is given', () => {
    expect(makeToken(3, () => 0)).toBe('AAA');
    expect(makeToken(2, () => 61)).toBe('99');
  });
});

describe('isTokenShape', () => {
  it('accepts a real token and rejects anything else before the database is asked', () => {
    expect(isTokenShape('aB3dE5gH7jK9')).toBe(true);
    for (const t of ['short', 'has-dash-in-it1', 'a'.repeat(33), '../etc/passwd', ''])
      expect(isTokenShape(t)).toBe(false);
  });
});

describe('isTrackableUrl', () => {
  it('wraps http and https only', () => {
    expect(isTrackableUrl('https://shop.example.com/p/1?x=1')).toBe(true);
    expect(isTrackableUrl('http://shop.example.com')).toBe(true);
    for (const u of [
      'tel:+911234567890',
      'mailto:a@b.c',
      'javascript:alert(1)',
      'ftp://x.test',
      'not a url',
      '',
    ]) {
      expect(isTrackableUrl(u)).toBe(false);
    }
  });
});

describe('isBot (TW-BCAST-018 acceptance)', () => {
  it('recognises the link-preview crawlers and tools', () => {
    for (const ua of [
      'WhatsApp/2.23.20 A',
      'facebookexternalhit/1.1',
      'Meta-ExternalFetcher/1.1',
      'Slackbot-LinkExpanding',
      'curl/8.4.0',
      'python-requests/2.31',
    ]) {
      expect(isBot(ua), ua).toBe(true);
    }
  });
  it('lets a real browser through', () => {
    expect(
      isBot(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
      ),
    ).toBe(false);
    expect(isBot(null)).toBe(false);
    expect(isBot('')).toBe(false);
  });
});

describe('linkTtlDays', () => {
  it('is the setting, never below 7', () => {
    expect(linkTtlDays(90)).toBe(90);
    expect(linkTtlDays(3)).toBe(7);
    expect(linkTtlDays(Number.NaN)).toBe(90);
  });
});

describe('replaceUrlsInText', () => {
  const wrap = async (u: string) => `T(${u})`;
  it('replaces every link and keeps the text around it', async () => {
    expect(await replaceUrlsInText('See https://a.test/x and http://b.test/y now', wrap)).toBe(
      'See T(https://a.test/x) and T(http://b.test/y) now',
    );
  });
  it('leaves sentence punctuation outside the link', async () => {
    expect(await replaceUrlsInText('Buy at https://a.test/x.', wrap)).toBe(
      'Buy at T(https://a.test/x).',
    );
    expect(await replaceUrlsInText('(https://a.test/x), ok', wrap)).toBe(
      '(T(https://a.test/x)), ok',
    );
  });
  it('is the text itself when there is no link', async () => {
    expect(await replaceUrlsInText('no links here', wrap)).toBe('no links here');
  });
});
