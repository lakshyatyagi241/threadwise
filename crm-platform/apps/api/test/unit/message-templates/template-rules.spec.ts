import { describe, expect, it } from 'vitest';
import { lintTemplate } from '../../../src/modules/message-templates/template-linter';
import {
  buildMetaTemplate,
  metaCategoryOf,
  normalizeTemplateName,
} from '../../../src/modules/message-templates/template-payload';
import {
  normalizePlaceholders,
  placeholderGaps,
  prepareText,
} from '../../../src/modules/message-templates/template-variables';

const codes = (i: ReturnType<typeof lintTemplate>) => i.map((x) => x.code);
const base = {
  name: 'promo',
  language: 'en_US',
  metaCategory: 'UTILITY',
  body: 'Hello {{1}}, your order is ready.',
};

describe('placeholders (TW-TPL-008)', () => {
  it('renumbers each distinct token by first appearance and keeps the attribute as the slot key', () => {
    const r = prepareText({ header: 'Hi {{name}}', body: '{{name}}, code {{code}}' });
    expect(r.header).toBe('Hi {{1}}');
    expect(r.body).toBe('{{1}}, code {{2}}');
    expect(r.variableMap).toEqual({
      header: [{ num: 1, key: 'name' }],
      body: [
        { num: 1, key: 'name' },
        { num: 2, key: 'code' },
      ],
    });
  });
  it('renumbers a lone {{2}} to {{1}} and is idempotent', () => {
    expect(normalizePlaceholders('Hello {{2}}').text).toBe('Hello {{1}}');
    expect(normalizePlaceholders('{{1}} {{2}}').text).toBe('{{1}} {{2}}');
  });
  it('leaves tokens with spaces or dots literal', () => {
    expect(normalizePlaceholders('Hi {{Phone Number}} {{a.b}}').text).toBe(
      'Hi {{Phone Number}} {{a.b}}',
    );
  });
  it('reports numbers that are not contiguous', () => {
    expect(placeholderGaps('{{1}} {{3}}')).toEqual([3]);
    expect(placeholderGaps('{{1}} {{2}}')).toEqual([]);
  });
});

describe('Meta create payload (TW-TPL-024)', () => {
  it('normalises the name', () => {
    expect(normalizeTemplateName('Spring Promo v3!')).toBe('spring_promo_v3');
    expect(normalizeTemplateName('!!!')).toBe('untitled_template');
  });
  it('guesses the category: auth, vertical, default', () => {
    expect(metaCategoryOf({ templateType: 'auth' })).toBe('AUTHENTICATION');
    expect(metaCategoryOf({ templateType: 'standard', category: 'festival' })).toBe('MARKETING');
    expect(metaCategoryOf({ templateType: 'standard', category: 'support' })).toBe('UTILITY');
    expect(metaCategoryOf({ templateType: 'standard', metaCategory: 'marketing' })).toBe(
      'MARKETING',
    );
  });
  it('builds text header, body example from real samples, footer and buttons', () => {
    const p = buildMetaTemplate({
      name: 'Summer Sale',
      metaCategory: 'MARKETING',
      templateType: 'standard',
      header: 'Hi {{1}}',
      body: 'Code {{1}} gives {{2}} off.',
      footer: 'Reply STOP',
      variableMap: {
        header: [{ num: 1, key: 'first_name', example: 'Asha' }],
        body: [
          { num: 1, key: 'code', example: 'SAVE20' },
          { num: 2, key: 'discount' },
        ],
      },
      buttons: [
        { type: 'quick_reply', text: 'Shop' },
        { type: 'url', text: 'Open', url: 'https://x.io/{{1}}', example: 'abc' },
      ],
    });
    expect(p).toMatchObject({
      name: 'summer_sale',
      category: 'MARKETING',
      language: 'en_US',
      allow_category_change: true,
      parameter_format: 'POSITIONAL',
    });
    expect(p.components).toEqual([
      { type: 'HEADER', format: 'TEXT', text: 'Hi {{1}}', example: { header_text: ['Asha'] } },
      {
        type: 'BODY',
        text: 'Code {{1}} gives {{2}} off.',
        example: { body_text: [['SAVE20', 'discount']] },
      },
      { type: 'FOOTER', text: 'Reply STOP' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Shop' },
          { type: 'URL', text: 'Open', url: 'https://x.io/{{1}}', example: ['abc'] },
        ],
      },
    ]);
  });
  it('falls back to "Sample N" and never to the literal word example', () => {
    const p = buildMetaTemplate({ name: 'a', templateType: 'standard', body: 'Hi {{1}} {{2}}' });
    expect(p.components[0]).toMatchObject({ example: { body_text: [['Sample 1', 'Sample 2']] } });
  });
  it('media header carries the handle; location has no example', () => {
    const img = buildMetaTemplate({
      name: 'a',
      templateType: 'media',
      attachmentType: 'image',
      headerHandle: '4::abc',
      body: 'x',
    });
    expect(img.components[0]).toEqual({
      type: 'HEADER',
      format: 'IMAGE',
      example: { header_handle: ['4::abc'] },
    });
    const loc = buildMetaTemplate({
      name: 'a',
      templateType: 'media',
      attachmentType: 'location',
      body: 'x',
    });
    expect(loc.components[0]).toEqual({ type: 'HEADER', format: 'LOCATION' });
  });
  it('authentication: body flag, expiry footer, one OTP button, ttl, no header', () => {
    const p = buildMetaTemplate({
      name: 'login otp',
      templateType: 'auth',
      body: '',
      header: 'ignored',
      codeExpirationMinutes: 10,
    });
    expect(p.category).toBe('AUTHENTICATION');
    expect(p.message_send_ttl_seconds).toBe(60);
    expect(p.components).toEqual([
      { type: 'BODY', add_security_recommendation: true },
      { type: 'FOOTER', code_expiration_minutes: 10 },
      { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] },
    ]);
  });
});

describe('pre-submit linter (TW-TPL-023)', () => {
  it('passes a clean template', () => {
    expect(
      lintTemplate({ ...base, variableMap: { body: [{ num: 1, key: 'n', example: 'Asha' }] } }),
    ).toEqual([]);
  });
  it('11 emojis: error for marketing, warning otherwise', () => {
    const body = 'Sale 🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉 {{1}} now on';
    const m = lintTemplate({ ...base, metaCategory: 'MARKETING', body });
    expect(m.find((i) => i.code === 'emoji_marketing')?.severity).toBe('error');
    const u = lintTemplate({ ...base, body });
    expect(u.find((i) => i.code === 'emoji_many')?.severity).toBe('warning');
  });
  it('adjacent variables are an error', () => {
    expect(codes(lintTemplate({ ...base, body: '{{1}} {{2}}' }))).toContain('adjacent_variables');
  });
  it('gaps list the offending numbers', () => {
    const i = lintTemplate({ ...base, body: 'a {{1}} b {{3}} c' }).find(
      (x) => x.code === 'placeholder_gap',
    );
    expect(i?.message).toContain('{{3}}');
  });
  it('trigger phrases warn but do not error', () => {
    const issues = lintTemplate({ ...base, body: 'Click here for {{1}} today ok' });
    expect(issues.find((i) => i.code === 'trigger_phrase')?.severity).toBe('warning');
    expect(issues.some((i) => i.severity === 'error')).toBe(false);
  });
  it('length, spaces, tab and header/footer limits', () => {
    expect(codes(lintTemplate({ ...base, body: 'a'.repeat(1025) }))).toContain('body_too_long');
    expect(codes(lintTemplate({ ...base, body: 'a    b' }))).toContain('body_spaces');
    expect(codes(lintTemplate({ ...base, body: 'a\tb' }))).toContain('body_tab');
    expect(codes(lintTemplate({ ...base, header: 'h'.repeat(61) }))).toContain('header_long');
    expect(codes(lintTemplate({ ...base, header: '{{1}} {{2}}' }))).toContain('header_variables');
    expect(codes(lintTemplate({ ...base, footer: 'hi {{1}}' }))).toContain('footer_variable');
  });
  it('named tokens are rejected in positional format and checked in named format', () => {
    expect(codes(lintTemplate({ ...base, body: 'Hi {{name}} there friend' }))).toContain(
      'named_in_positional',
    );
    expect(
      codes(lintTemplate({ ...base, parameterFormat: 'NAMED', body: 'Hi {{Name}} there friend' })),
    ).toContain('named_invalid');
  });
  it('quick replies must be contiguous and at an edge', () => {
    const qr = (text: string) => ({ type: 'QUICK_REPLY', text });
    const url = { type: 'URL', text: 'Go', url: 'https://x.io' };
    expect(codes(lintTemplate({ ...base, buttons: [qr('a'), qr('b'), url] }))).not.toContain(
      'quick_reply_position',
    );
    expect(codes(lintTemplate({ ...base, buttons: [qr('a'), url, qr('b')] }))).toContain(
      'quick_reply_position',
    );
    expect(codes(lintTemplate({ ...base, buttons: [url, qr('a'), url, qr('b'), url] }))).toContain(
      'quick_reply_position',
    );
  });
  it('invalid language and empty name are errors; media header without a file is an error', () => {
    expect(codes(lintTemplate({ ...base, language: 'english' }))).toContain('language_invalid');
    expect(codes(lintTemplate({ ...base, name: ' ' }))).toContain('name_empty');
    expect(codes(lintTemplate({ ...base, attachmentType: 'image' }))).toContain(
      'header_media_missing',
    );
    expect(
      codes(lintTemplate({ ...base, attachmentType: 'image', hasHeaderFile: true })),
    ).not.toContain('header_media_missing');
  });
});
