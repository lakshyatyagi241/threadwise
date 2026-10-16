import { describe, expect, it } from 'vitest';
import { maskPersonalData } from '../../../src/modules/auth/guards/impersonation-mask.interceptor';
import { impersonationVerdict } from '../../../src/modules/auth/guards/impersonation-rules';

describe('act-as PII masking and export block', () => {
  it('masks phone, email, name and text but keeps ids and shape', () => {
    const out = maskPersonalData({
      id: 'abc',
      items: [
        { phone: '+919876543210', email: 'jane@acme.com', fullName: 'Jane Doe', notes: 'secret' },
      ],
    }) as { id: string; items: Array<Record<string, string>> };
    expect(out.id).toBe('abc');
    expect(out.items[0]).toEqual({
      phone: '+91 ******210',
      email: 'j***@acme.com',
      fullName: 'J*** D***',
      notes: '[hidden text]',
    });
  });

  it('refuses exports and downloads even on GET', () => {
    for (const url of [
      '/v2/contacts/export',
      '/v2/contacts/exports/1/download',
      '/v2/flows/1/export',
    ]) {
      expect(impersonationVerdict(url, 'GET', false)).toBe('forbidden');
    }
    expect(impersonationVerdict('/v2/contacts', 'POST', true)).toBe('read_only');
  });
});
