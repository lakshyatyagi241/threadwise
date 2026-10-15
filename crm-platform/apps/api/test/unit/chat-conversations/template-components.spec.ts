import { describe, expect, it } from 'vitest';
import {
  envelopeOf,
  messageFieldsOf,
} from '../../../src/modules/chat-conversations/outbound-envelope';

const cid = '6f1c7a52-3d7a-4a53-9b6e-2f0d2c1a9e10';
const components = [
  { type: 'header', parameters: [{ type: 'image', image: { link: 'https://x.io/a.jpg' } }] },
  { type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: 'abc' }] },
];

describe('a template send with built components', () => {
  it('stores the components in the message meta', () => {
    const f = messageFieldsOf({
      kind: 'template',
      name: 'promo',
      language: 'en_US',
      variables: { '1': 'Ana' },
      body: 'Hi Ana',
      components,
    });
    expect(f.meta).toMatchObject({ templateComponents: components });
  });

  it('hands them to the provider as they are, and omits them when there are none', () => {
    const base = {
      kind: 'template' as const,
      body: 'Hi',
      mediaKey: null,
      mediaMime: null,
      mediaName: null,
      mediaSha256: null,
      latitude: null,
      longitude: null,
      clientMessageId: cid,
      uuid: cid,
    };
    const withC = envelopeOf(
      {
        ...base,
        meta: { templateName: 'promo', templateLanguage: 'en_US', templateComponents: components },
      },
      '919812345678',
      null,
      1,
    ) as { template: { components?: unknown[] } };
    expect(withC.template.components).toEqual(components);
    const without = envelopeOf(
      { ...base, meta: { templateName: 'promo', templateLanguage: 'en_US' } },
      '919812345678',
      null,
      1,
    ) as { template: { components?: unknown[] } };
    expect(without.template.components).toBeUndefined();
  });
});
