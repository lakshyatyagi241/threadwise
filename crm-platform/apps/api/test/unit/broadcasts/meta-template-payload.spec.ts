import { describe, expect, it } from 'vitest';
import { buildTemplateMessage } from '../../../src/infra/providers/whatsapp/meta-template-payload';

const base = {
  to: '+91 98765 43210',
  templateName: 'promo',
  language: 'en_US',
  clientReference: 'r',
};

describe('buildTemplateMessage', () => {
  it('sends to digits only', () => {
    expect(buildTemplateMessage({ ...base, variables: {} }).to).toBe('919876543210');
  });

  it('has no components for a template without variables', () => {
    expect(buildTemplateMessage({ ...base, variables: {} }).template).toEqual({
      name: 'promo',
      language: { code: 'en_US' },
    });
  });

  it('fills body variables in numeric key order, not insertion order', () => {
    const msg = buildTemplateMessage({
      ...base,
      variables: { '10': 'ten', '2': 'two', '1': 'one' },
    });
    expect(msg.template.components).toEqual([
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'one' },
          { type: 'text', text: 'two' },
          { type: 'text', text: 'ten' },
        ],
      },
    ]);
  });
});
