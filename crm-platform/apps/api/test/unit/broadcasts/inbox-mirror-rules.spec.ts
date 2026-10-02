import { describe, expect, it } from 'vitest';
import {
  digitsOf,
  readableTemplateBody,
  resolveBodyTokens,
  srcKey,
} from '../../../src/modules/broadcasts/inbox-mirror-rules';

describe('inbox mirror rules (TW-BCAST-028)', () => {
  it('the readable text is header, body, footer, one blank line apart, empty parts left out', () => {
    expect(
      readableTemplateBody({ header: ' Sale ', templateBody: 'Hi {{1}}', footer: 'Reply STOP' }),
    ).toBe('Sale\n\nHi {{1}}\n\nReply STOP');
    expect(readableTemplateBody({ header: null, templateBody: 'Hi', footer: '' })).toBe('Hi');
  });

  it('tokens come from the variable map, a blank name reads "there", other blanks are empty', () => {
    const map = {
      body: [
        { num: 1, key: 'first_name' },
        { num: 2, key: 'city' },
      ],
    };
    const pull = (k: string) => ({ first_name: 'Asha', city: '' })[k] ?? '';
    expect(resolveBodyTokens('Hi {{1}} from {{2}}.', map, pull)).toBe('Hi Asha from .');
    expect(resolveBodyTokens('Hi {{1}},  welcome', map, () => '')).toBe('Hi there, welcome');
  });

  it('a token the map does not know is looked up as written; a flat map works too', () => {
    expect(resolveBodyTokens('Hello {{email}}', {}, (k) => (k === 'email' ? 'a@b.co' : ''))).toBe(
      'Hello a@b.co',
    );
    expect(resolveBodyTokens('{{1}}', { '1': 'name' }, (k) => (k === 'name' ? 'Ravi' : ''))).toBe(
      'Ravi',
    );
  });

  it('digits and the dedupe key are deterministic', () => {
    expect(digitsOf('+91 98765-43210')).toBe('919876543210');
    expect(digitsOf(null)).toBe('');
    expect(srcKey(5, 9)).toBe('broadcast:5:contact:9');
  });
});
