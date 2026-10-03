import { describe, expect, it } from 'vitest';
import { normaliseAllowedDomains, widgetFieldsSchema } from '@crm/contracts';
import {
  cookieValue,
  freshToken,
  isTokenShape,
  originAllowed,
  phpUrlencode,
  slugBase,
  slugify,
  toTranscriptEntry,
  uniqueSlug,
  usesAi,
  usesWhatsApp,
  visitorDisplayName,
  whatsappUrl,
} from '../../../src/modules/chatbot-widget/widget-rules';

describe('embed token and slug (WD-WGT-006)', () => {
  it('WD-WGT-006: a token is 48 base62 characters, unique, and passes the public route shape', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = freshToken();
      expect(t).toMatch(/^[A-Za-z0-9]{48}$/);
      expect(isTokenShape(t)).toBe(true);
      seen.add(t);
    }
    expect(seen.size).toBe(200);
  });

  it('WD-WGT-022 #1: a token outside 16..80 alphanumerics is not a token', () => {
    expect(isTokenShape('short')).toBe(false);
    expect(isTokenShape('a'.repeat(15))).toBe(false);
    expect(isTokenShape('a'.repeat(16))).toBe(true);
    expect(isTokenShape('a'.repeat(80))).toBe(true);
    expect(isTokenShape('a'.repeat(81))).toBe(false);
    expect(isTokenShape(`${'a'.repeat(20)}-x`)).toBe(false);
  });

  it('WD-WGT-006: the slug follows the name; a name without Latin letters falls back to widget-<random>', () => {
    expect(slugify('Pricing page')).toBe('pricing-page');
    expect(slugify('Café Rouge & Co.')).toBe('cafe-rouge-co');
    expect(slugify('  --Hello__World--  ')).toBe('hello-world');
    expect(slugify('你好')).toBe('');
    expect(slugBase('你好', () => 'abc123')).toBe('widget-abc123');
  });

  it('WD-WGT-006 #2: two widgets named Support get support and support-2; the counter skips taken ones', () => {
    expect(uniqueSlug('support', new Set())).toBe('support');
    expect(uniqueSlug('support', new Set(['support']))).toBe('support-2');
    expect(uniqueSlug('support', new Set(['support', 'support-2', 'support-3']))).toBe('support-4');
  });
});

describe('allowed domains (WD-WGT-006 #3, WD-WGT-021)', () => {
  it('WD-WGT-006: trims, lower-cases, drops blanks, strips scheme and path, de-duplicates in order', () => {
    expect(normaliseAllowedDomains(['HTTPS://Acme.com/path', 'acme.com', ''])).toEqual([
      'acme.com',
    ]);
    expect(normaliseAllowedDomains(['Shop.Acme.com', ' b.com:8080/x/y ', 'http://c.io'])).toEqual([
      'shop.acme.com',
      'b.com:8080',
      'c.io',
    ]);
  });

  it('WD-WGT-021: more than 50 entries are refused, an entry over 253 characters too', () => {
    const base = {
      name: 'x',
      mode: 'whatsapp',
      position: 'bottom_right',
      buttonColor: '#075E54',
      headerTitle: 't',
      headerBg: '#075E54',
      headerTextColor: '#FFFFFF',
      messageBubbleColor: '#FFFFFF',
      messageTextColor: '#222222',
      bodyBgKind: 'color',
      bodyBgColor: '#ECE5DD',
      buttonLabel: 'Send',
      actionButtonBg: '#075E54',
      actionButtonTextColor: '#FFFFFF',
    };
    const many = Array.from({ length: 51 }, (_, i) => `h${i}.com`);
    expect(widgetFieldsSchema.safeParse({ ...base, allowedDomains: many }).success).toBe(false);
    expect(
      widgetFieldsSchema.safeParse({ ...base, allowedDomains: many.slice(0, 50) }).success,
    ).toBe(true);
    expect(
      widgetFieldsSchema.safeParse({ ...base, allowedDomains: ['a'.repeat(254)] }).success,
    ).toBe(false);
  });
});

describe('origin allow-list (WD-WGT-020)', () => {
  it('WD-WGT-020: an empty list allows every origin', () => {
    expect(originAllowed('https://anything.example', [])).toBe(true);
  });

  it('WD-WGT-020: no origin is not allowed by this rule (the caller skips the check when there is none)', () => {
    expect(originAllowed(undefined, [])).toBe(false);
    expect(originAllowed('', ['acme.com'])).toBe(false);
  });

  it('WD-WGT-020: host match is case-insensitive; www and ports are different hosts; no wildcards', () => {
    const list = ['acme.com', 'shop.acme.com:8443'];
    expect(originAllowed('https://Acme.com', list)).toBe(true);
    expect(originAllowed('https://www.acme.com', list)).toBe(false);
    expect(originAllowed('https://shop.acme.com:8443', list)).toBe(true);
    expect(originAllowed('https://shop.acme.com', list)).toBe(false);
    expect(originAllowed('https://evil.acme.com', ['*.acme.com'])).toBe(false);
    expect(originAllowed('not a url', list)).toBe(false);
  });

  it('WD-WGT-020: an entry stored with a scheme or path still matches', () => {
    expect(originAllowed('https://acme.com', ['https://acme.com/'])).toBe(true);
  });
});

describe('engine helpers and the WhatsApp link (WD-WGT-003, 013)', () => {
  const wa = {
    mode: 'both',
    assistantId: null,
    targetWhatsappCc: '+91',
    targetWhatsappNumber: '9876543210',
    prefilledMessage: 'Hi there',
  };

  it('WD-WGT-013: mode both, +91 and 9876543210 with "Hi there" gives wa.me/919876543210?text=Hi+there', () => {
    expect(whatsappUrl(wa)).toBe('https://wa.me/919876543210?text=Hi+there');
  });

  it('WD-WGT-013: mode ai gives no link; mode whatsapp with no number gives none', () => {
    expect(whatsappUrl({ ...wa, mode: 'ai' })).toBeNull();
    expect(whatsappUrl({ ...wa, mode: 'whatsapp', targetWhatsappNumber: '' })).toBeNull();
    expect(whatsappUrl({ ...wa, mode: 'whatsapp', targetWhatsappNumber: null })).toBeNull();
  });

  it('WD-WGT-013: the text is only appended when there is one, and is encoded the way PHP urlencode does', () => {
    expect(whatsappUrl({ ...wa, prefilledMessage: null })).toBe('https://wa.me/919876543210');
    expect(phpUrlencode("Hi, I'd like to know more.")).toBe('Hi%2C+I%27d+like+to+know+more.');
    expect(phpUrlencode('a~b*c(d)')).toBe('a%7Eb%2Ac%28d%29');
  });

  it('WD-WGT-003 #1: usesAi needs the mode AND a linked assistant; usesWhatsApp needs the mode AND a number', () => {
    expect(usesAi({ mode: 'ai', assistantId: 3 })).toBe(true);
    expect(usesAi({ mode: 'both', assistantId: 3 })).toBe(true);
    expect(usesAi({ mode: 'ai', assistantId: null })).toBe(false);
    expect(usesAi({ mode: 'whatsapp', assistantId: 3 })).toBe(false);
    expect(usesWhatsApp({ mode: 'whatsapp', targetWhatsappNumber: '1' })).toBe(true);
    expect(usesWhatsApp({ mode: 'ai', targetWhatsappNumber: '1' })).toBe(false);
    expect(usesWhatsApp({ mode: 'both', targetWhatsappNumber: '' })).toBe(false);
  });
});

describe('visitors and the transcript (WD-WGT-011, 012, 015)', () => {
  it('WD-WGT-015: the conversation title is the name, else the email, else "Visitor " and six characters', () => {
    const uuid = '33183b51-0e73-46d4-9d44-0b94ee4d2b86';
    expect(visitorDisplayName({ name: 'Asha', email: 'a@b.c', visitorUuid: uuid })).toBe('Asha');
    expect(visitorDisplayName({ name: null, email: 'a@b.c', visitorUuid: uuid })).toBe('a@b.c');
    expect(visitorDisplayName({ name: null, email: null, visitorUuid: uuid })).toBe(
      'Visitor 33183b',
    );
  });

  it('WD-WGT-012 #1: directions are flipped to the widget point of view and the author is labelled', () => {
    expect(toTranscriptEntry({ id: 1, direction: 'in', body: 'hi', agentId: null })).toEqual({
      id: 1,
      dir: 'out',
      body: 'hi',
      from: 'visitor',
    });
    expect(toTranscriptEntry({ id: 2, direction: 'out', body: 'yo', agentId: null })).toMatchObject(
      {
        dir: 'in',
        from: 'assistant',
      },
    );
    expect(toTranscriptEntry({ id: 3, direction: 'out', body: 'yo', agentId: 9 })).toMatchObject({
      dir: 'in',
      from: 'agent',
    });
  });

  it('WD-WGT-011: the cookie reader finds the visitor cookie among others and survives malformed values', () => {
    expect(cookieValue('a=1; wgt_vid_x=abc%20d; b=2', 'wgt_vid_x')).toBe('abc d');
    expect(cookieValue('a=1', 'wgt_vid_x')).toBeNull();
    expect(cookieValue(undefined, 'x')).toBeNull();
    expect(cookieValue('x=%E0%A4%A', 'x')).toBeNull();
  });
});
