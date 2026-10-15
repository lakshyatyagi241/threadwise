import { describe, expect, it } from 'vitest';
import {
  DENIED_HEADER_NAMES,
  HeaderRenderError,
  MAX_HEADER_TEMPLATES,
  MAX_HEADER_VALUE_LENGTH,
  headerTemplateProblems,
  headerTemplatesSchema,
  placeholdersOf,
  renderHeaderTemplates,
  secretValuesIn,
} from '@crm/contracts';

/**
 * Header templates of a custom-header WhatsApp provider (QA task 5). An operator types them and they end up in every outbound request,
 * so these are the rules that keep a template from adding a second header, hijacking the connection or leaking a secret.
 */

const ok = { 'x-access-token': '{{providerToken}}', 'x-waba-id': '{{wabaId}}' };

describe('placeholdersOf', () => {
  it('lists the names inside {{ }}, tolerating spaces, in order', () => {
    expect(placeholdersOf('{{ wabaId }} and {{providerToken}}')).toEqual([
      'wabaId',
      'providerToken',
    ]);
  });
  it('finds nothing in plain text, a half open brace or a name with digits', () => {
    expect(placeholdersOf('plain')).toEqual([]);
    expect(placeholdersOf('{{wabaId')).toEqual([]);
    expect(placeholdersOf('{{waba2}}')).toEqual([]);
  });
});

describe('headerTemplateProblems', () => {
  it('has no complaint about a sound template map', () => {
    expect(headerTemplateProblems(ok)).toEqual([]);
    expect(headerTemplateProblems({})).toEqual([]);
  });
  it('refuses a name that is not letters, digits and hyphens', () => {
    expect(headerTemplateProblems({ 'bad name': 'x' })).toEqual([
      'Header name "bad name" is not a valid name (letters, digits and hyphens)',
    ]);
    expect(headerTemplateProblems({ 'x:a': 'x' })).toHaveLength(1);
    expect(headerTemplateProblems({ '': 'x' })).toHaveLength(1);
  });
  it.each([
    'host',
    'Host',
    'COOKIE',
    'content-length',
    'transfer-encoding',
    'x-forwarded-for',
    'sec-fetch-mode',
    'proxy-foo',
  ])('refuses the connection-owned header "%s", in any letter case', (name) => {
    expect(headerTemplateProblems({ [name]: 'x' })).toEqual([
      `Header "${name.toLowerCase()}" is managed by the connection and cannot be set`,
    ]);
  });
  it('denies every name on the list it exports', () => {
    for (const name of DENIED_HEADER_NAMES)
      expect(headerTemplateProblems({ [name]: 'x' }), name).toHaveLength(1);
  });
  it('treats names as equal ignoring case, so a second header cannot hide behind a capital', () => {
    expect(headerTemplateProblems({ 'X-Token': 'a', 'x-token': 'b' })).toEqual([
      'Header "x-token" appears twice',
    ]);
  });
  it('needs a non-empty string value', () => {
    expect(headerTemplateProblems({ 'x-a': '' })).toEqual(['Header "x-a" needs a value']);
    expect(headerTemplateProblems({ 'x-a': 5 })).toEqual(['Header "x-a" needs a value']);
    expect(headerTemplateProblems({ 'x-a': null })).toEqual(['Header "x-a" needs a value']);
  });
  it('refuses a value that could smuggle a second header or is not plain ASCII', () => {
    for (const bad of ['a\r\nSet-Cookie: x=1', 'a\nb', 'a\tb', 'a\u0000b', 'café']) {
      expect(headerTemplateProblems({ 'x-a': bad }), JSON.stringify(bad)).toEqual([
        'Header "x-a" holds a control or non-ASCII character',
      ]);
    }
  });
  it('limits the value length', () => {
    expect(headerTemplateProblems({ 'x-a': 'x'.repeat(MAX_HEADER_VALUE_LENGTH) })).toEqual([]);
    expect(headerTemplateProblems({ 'x-a': 'x'.repeat(MAX_HEADER_VALUE_LENGTH + 1) })).toEqual([
      `Header "x-a" is longer than ${MAX_HEADER_VALUE_LENGTH} characters`,
    ]);
  });
  it('refuses a placeholder that does not exist, once per name', () => {
    expect(headerTemplateProblems({ 'x-a': '{{secret}} {{secret}} {{apiKey}}' })).toEqual([
      'Header "x-a" uses an unknown placeholder: secret, apiKey',
    ]);
  });
  it('refuses a stray brace, which would be sent literally', () => {
    expect(headerTemplateProblems({ 'x-a': 'abc{' })).toEqual([
      'Header "x-a" has a stray brace; placeholders look like {{wabaId}}',
    ]);
    expect(headerTemplateProblems({ 'x-a': '{{wabaId}}}' })).toHaveLength(1);
    expect(headerTemplateProblems({ 'x-a': 'Bearer {{providerToken}}' })).toEqual([]);
  });
  it('limits how many headers a template map may hold', () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_HEADER_TEMPLATES + 1 }, (_, i) => [`x-h${i}`, 'v']),
    );
    expect(headerTemplateProblems(many)).toEqual([
      `At most ${MAX_HEADER_TEMPLATES} headers are allowed`,
    ]);
    expect(
      headerTemplateProblems(
        Object.fromEntries(Object.entries(many).slice(0, MAX_HEADER_TEMPLATES)),
      ),
    ).toEqual([]);
  });
});

describe('headerTemplatesSchema', () => {
  it('lower-cases the names and accepts a sound map', () => {
    expect(headerTemplatesSchema.parse({ 'X-Access-Token': '{{providerToken}}' })).toEqual({
      'x-access-token': '{{providerToken}}',
    });
  });
  it('rejects what headerTemplateProblems lists, with its message', () => {
    const r = headerTemplatesSchema.safeParse({ Host: 'x' });
    expect(r.success).toBe(false);
    if (!r.success)
      expect(r.error.issues[0]!.message).toBe(
        'Header "host" is managed by the connection and cannot be set',
      );
  });
});

describe('secretValuesIn (what to scrub from errors and logs)', () => {
  it('returns the two tokens when they are long enough to be worth scrubbing', () => {
    expect(secretValuesIn({ providerToken: 'abcdef', channelToken: 'ghijklm' })).toEqual([
      'abcdef',
      'ghijklm',
    ]);
  });
  it('leaves out a token under six characters (it would scrub ordinary words), an empty one, and the ids', () => {
    expect(
      secretValuesIn({ providerToken: 'abcde', channelToken: undefined, wabaId: '1234567890' }),
    ).toEqual([]);
    expect(secretValuesIn({})).toEqual([]);
  });
});

describe('renderHeaderTemplates', () => {
  it('fills the placeholders and lower-cases the names', () => {
    expect(
      renderHeaderTemplates(
        { 'X-Token': 'Bearer {{providerToken}}', 'x-waba-id': '{{wabaId}}' },
        { providerToken: 'tok123', wabaId: 'W_1' },
      ),
    ).toEqual({
      'x-token': 'Bearer tok123',
      'x-waba-id': 'W_1',
    });
  });
  it('leaves a header out when one of its values is missing, so a literal {{...}} is never sent', () => {
    expect(
      renderHeaderTemplates(
        { 'x-phone': '{{phoneNumberId}}', 'x-waba-id': '{{wabaId}}' },
        { wabaId: 'W_1' },
      ),
    ).toEqual({ 'x-waba-id': 'W_1' });
    expect(
      renderHeaderTemplates({ 'x-phone': '{{phoneNumberId}}' }, { phoneNumberId: '' }),
    ).toEqual({});
  });
  it('refuses a value that is present but unsafe, naming the placeholder, instead of sending a forged header', () => {
    expect(() =>
      renderHeaderTemplates({ 'x-t': '{{providerToken}}' }, { providerToken: 'abc\r\nX-Evil: 1' }),
    ).toThrow(HeaderRenderError);
    try {
      renderHeaderTemplates({ 'x-w': '{{wabaId}}' }, { wabaId: 'has space' });
    } catch (e) {
      expect((e as HeaderRenderError).placeholder).toBe('wabaId');
    }
  });
});
