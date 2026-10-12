import { describe, expect, it } from 'vitest';
import { vcardOf } from '../../../src/modules/node-bridge-runtime/inbox/qr-channel.adapter';

describe('vCard for a contact shared from a QR number', () => {
  it('has the name, company, phones with waid and emails', () => {
    const v = vcardOf({
      name: 'Asha Rao',
      org: 'Acme',
      phones: [{ phone: '+91 98765 43210' }],
      emails: ['a@x.io'],
    });
    expect(v).toBe(
      [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:Asha Rao',
        'ORG:Acme',
        'TEL;type=CELL;waid=919876543210:+919876543210',
        'EMAIL:a@x.io',
        'END:VCARD',
      ].join('\n'),
    );
  });

  it('escapes separators and line breaks so a name cannot add a field', () => {
    const v = vcardOf({ name: 'Evil;TEL:1\nEND:VCARD', phones: [], emails: [] });
    expect(v.split('\n')).toHaveLength(4);
    expect(v).toContain(String.raw`FN:Evil\;TEL:1\nEND:VCARD`);
  });
});
