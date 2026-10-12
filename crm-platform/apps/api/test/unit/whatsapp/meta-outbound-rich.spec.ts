import { describe, expect, it } from 'vitest';
import { outboundEnvelopeSchema } from '../../../src/infra/providers/chat-conversations/channel.port';
import { buildMessageBody } from '../../../src/infra/providers/whatsapp/meta-outbound';

const common = { to: '919876543210', clientReference: 'c1', attempt: 1 };
const body = (e: Record<string, unknown>) =>
  buildMessageBody(outboundEnvelopeSchema.parse({ ...common, ...e })) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('Meta payloads for what the composer shares', () => {
  it('a contacts message carries every card with phones, emails and company', () => {
    const b = body({
      kind: 'contacts',
      contacts: [
        {
          name: 'Asha Rao',
          phones: [{ phone: '+91 98765 43210' }],
          emails: ['a@x.io'],
          org: 'Acme',
        },
        { name: 'Bob', phones: [], emails: [] },
      ],
    });
    expect(b.type).toBe('contacts');
    expect(b.contacts[0]).toMatchObject({
      name: { formatted_name: 'Asha Rao', first_name: 'Asha' },
      phones: [{ phone: '+91 98765 43210', type: 'CELL', wa_id: '919876543210' }],
      emails: [{ email: 'a@x.io' }],
      org: { company: 'Acme' },
    });
    expect(b.contacts[1]).toEqual({ name: { formatted_name: 'Bob', first_name: 'Bob' } });
  });

  it('reply buttons keep the ids the composer made, header and footer included', () => {
    const b = body({
      kind: 'interactive',
      interactive: {
        type: 'buttons',
        body: 'Pick one',
        header: 'Order 42',
        footer: 'Thanks',
        buttons: [
          { id: 'btn-1', title: 'Yes' },
          { id: 'btn-2', title: 'No' },
        ],
      },
    });
    expect(b.interactive).toMatchObject({
      type: 'button',
      header: { type: 'text', text: 'Order 42' },
      body: { text: 'Pick one' },
      footer: { text: 'Thanks' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'btn-1', title: 'Yes' } },
          { type: 'reply', reply: { id: 'btn-2', title: 'No' } },
        ],
      },
    });
  });

  it('a link button becomes a cta_url action', () => {
    const b = body({
      kind: 'interactive',
      interactive: { type: 'cta_url', body: 'Pay now', text: 'Open', url: 'https://x.io/p' },
    });
    expect(b.interactive).toMatchObject({
      type: 'cta_url',
      action: { name: 'cta_url', parameters: { display_text: 'Open', url: 'https://x.io/p' } },
    });
  });

  it('a list keeps its sections, row ids and opening button', () => {
    const b = body({
      kind: 'interactive',
      interactive: {
        type: 'list',
        body: 'Choose',
        button: 'Sizes',
        sections: [
          { title: 'Shirts', rows: [{ id: 'row-1', title: 'Small', description: 'Fits 6-8' }] },
        ],
      },
    });
    expect(b.interactive).toMatchObject({
      type: 'list',
      body: { text: 'Choose' },
      action: {
        button: 'Sizes',
        sections: [
          { title: 'Shirts', rows: [{ id: 'row-1', title: 'Small', description: 'Fits 6-8' }] },
        ],
      },
    });
  });
});
