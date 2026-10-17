import { describe, expect, it } from 'vitest';
import { maskLeadPayload, REDACTED } from '../../../src/modules/leads/lead-payload-mask';

/** A lead payload as the inbox shows it: personal data masked with the platform's own masks, secrets redacted, the shape kept. */

const mask = (payload: Record<string, unknown>) => maskLeadPayload(payload);

describe('maskLeadPayload', () => {
  it('masks a name, a phone and an email under their own keys and keeps what is not personal', () => {
    const { payload, masked } = mask({
      externalId: 'lead-100',
      fields: {
        'lead.full_name': 'Ada Lovelace',
        'lead.mobile': '+919876543210',
        'lead.email_address': 'ada@example.test',
        'lead.budget': '5000',
        'lead.city': 'Pune',
      },
      attribution: { campaign: 'Spring sale' },
    });
    expect(masked).toBe(true);
    expect(payload.externalId).toBe('lead-100');
    expect(payload.fields).toEqual({
      'lead.full_name': 'A*** L***',
      'lead.mobile': '+91 ******210',
      'lead.email_address': 'a***@example.test',
      'lead.budget': '5000',
      'lead.city': 'Pune',
    });
    expect(payload.attribution).toEqual({ campaign: 'Spring sale' });
  });

  it('walks the raw body, however deep, and masks by the key of each value', () => {
    const { payload } = mask({
      raw: {
        lead: { contact: { phone: '98765 43210', name: 'Ada Lovelace' }, notes: ['call me'] },
      },
    });
    expect(payload.raw).toEqual({
      lead: { contact: { phone: '******210', name: 'A*** L***' }, notes: ['[hidden text]'] },
    });
  });

  it('masks a form-field pair by the name of the pair and leaves the label readable', () => {
    const { payload } = mask({
      raw: {
        field_data: [
          { name: 'phone_number', values: ['+919876543210'] },
          { name: 'email', values: ['ada@example.test'] },
          { name: 'budget', values: ['5000'] },
        ],
      },
    });
    expect(payload.raw).toEqual({
      field_data: [
        { name: 'phone_number', values: ['+91 ******210'] },
        { name: 'email', values: ['a***@example.test'] },
        { name: 'budget', values: ['5000'] },
      ],
    });
  });

  it('masks a value that reads as an email or a phone number under an innocent key, and leaves ids alone', () => {
    const { payload } = mask({
      fields: {
        q1: 'ada@example.test',
        q2: '+919876543210',
        q3: '98765 43210',
        q4: 'write to ada@example.test or +919876543210 please',
        leadgen_id: '444444444444',
        lead_ids: ['123456789012'],
        pincode: '411001',
      },
    });
    const f = payload.fields as Record<string, unknown>;
    expect(f.q1).toBe('a***@example.test');
    expect(f.q2).toBe('+91 ******210');
    expect(f.q3).toBe('******210');
    expect(f.q4).toBe('write to a***@example.test or +91 ******210 please');
    expect(f.leadgen_id).toBe('444444444444');
    expect(f.lead_ids).toEqual(['123456789012']);
    // six digits is not a phone number
    expect(f.pincode).toBe('411001');
  });

  it('redacts a secret and a token however it is named or hidden in text', () => {
    const { payload, masked } = mask({
      raw: {
        api_key: 'k-12345',
        webhook_secret: 'abc',
        note: 'x',
        authorization: 'Bearer abcdefghijklmnop',
        comment: 'token eyJabcdefghijk.abcdefghijk.abcdefghi leaked',
      },
    });
    expect(masked).toBe(true);
    const raw = payload.raw as Record<string, unknown>;
    expect(raw.api_key).toBe(REDACTED);
    expect(raw.webhook_secret).toBe(REDACTED);
    expect(raw.authorization).toBe(REDACTED);
    expect(raw.comment).toBe('[hidden text]');
    expect(JSON.stringify(payload)).not.toContain('eyJ');
  });

  it('does not hide the wording of a consent, which is evidence and not a person message', () => {
    const { payload } = mask({
      consent: { given: true, text: 'I agree to receive offers on WhatsApp.', version: 'lp-3' },
    });
    expect(payload.consent).toEqual({
      given: true,
      text: 'I agree to receive offers on WhatsApp.',
      version: 'lp-3',
    });
  });

  it('reports nothing masked when there was nothing personal, and keeps empty values empty', () => {
    const r = mask({ fields: { campaign: 'Spring', phone: '', email: null } });
    expect(r.masked).toBe(false);
    expect(r.payload).toEqual({ fields: { campaign: 'Spring', phone: '', email: null } });
  });

  it('is bounded: a huge array and a deep nesting do not run away', () => {
    const deep: Record<string, unknown> = {};
    let cur = deep;
    for (let i = 0; i < 30; i++) {
      const next: Record<string, unknown> = {};
      cur.n = next;
      cur = next;
    }
    expect(JSON.stringify(mask({ raw: deep }).payload)).toContain('[too deep]');
    const big = mask({ raw: { rows: Array.from({ length: 500 }, (_, i) => `r${i}`) } });
    const rows = (big.payload.raw as { rows: unknown[] }).rows;
    expect(rows).toHaveLength(201);
    expect(rows[200]).toBe('... 300 more');
  });

  it('never mutates the stored payload', () => {
    const original = { fields: { phone: '+919876543210' } };
    const copy = JSON.parse(JSON.stringify(original));
    mask(original);
    expect(original).toEqual(copy);
  });
});
