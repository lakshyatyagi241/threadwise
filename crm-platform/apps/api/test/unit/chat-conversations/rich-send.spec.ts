import { describe, expect, it } from 'vitest';
import { sendMessageSchema } from '@crm/contracts';
import { outboundEnvelopeSchema } from '../../../src/infra/providers/chat-conversations/channel.port';
import {
  envelopeOf,
  messageFieldsOf,
} from '../../../src/modules/chat-conversations/outbound-envelope';
import { toMessageResponse } from '../../../src/modules/chat-conversations/message.mapper';
import type { MessageRow } from '../../../src/modules/chat-conversations/messages.repository';

const cid = '6f1c7a52-3d7a-4a53-9b6e-2f0d2c1a9e10';
const base = { clientMessageId: cid };

/** What the service stores for a content, read back the way a retry reads it. */
function stored(content: Parameters<typeof messageFieldsOf>[0]) {
  const f = messageFieldsOf(content);
  return {
    kind: f.kind,
    body: f.body,
    mediaKey: null,
    mediaMime: null,
    mediaName: null,
    mediaSha256: null,
    meta: f.meta,
    latitude: f.latitude ?? null,
    longitude: f.longitude ?? null,
    clientMessageId: cid,
    uuid: cid,
  };
}
const envelope = (row: ReturnType<typeof stored>) =>
  outboundEnvelopeSchema.parse(envelopeOf(row, '919876543210', null, 1));

describe('send body: location, contacts, buttons', () => {
  it('location needs in-range coordinates', () => {
    const ok = { ...base, kind: 'location', latitude: 28.6, longitude: 77.2, name: 'Office' };
    expect(sendMessageSchema.safeParse(ok).success).toBe(true);
    expect(sendMessageSchema.safeParse({ ...ok, latitude: 91 }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ ...ok, longitude: -181 }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ ...base, kind: 'location', latitude: 1 }).success).toBe(
      false,
    );
  });

  it('contacts needs a name per card, at most 10 cards, valid emails', () => {
    const card = { name: 'Asha', phones: ['+91 98765 43210'] };
    expect(
      sendMessageSchema.safeParse({ ...base, kind: 'contacts', contacts: [card] }).success,
    ).toBe(true);
    expect(sendMessageSchema.safeParse({ ...base, kind: 'contacts', contacts: [] }).success).toBe(
      false,
    );
    expect(
      sendMessageSchema.safeParse({ ...base, kind: 'contacts', contacts: [{ phones: [] }] })
        .success,
    ).toBe(false);
    expect(
      sendMessageSchema.safeParse({
        ...base,
        kind: 'contacts',
        contacts: [{ ...card, emails: ['not-an-email'] }],
      }).success,
    ).toBe(false);
    expect(
      sendMessageSchema.safeParse({
        ...base,
        kind: 'contacts',
        contacts: Array.from({ length: 11 }, () => card),
      }).success,
    ).toBe(false);
  });

  it('buttons: 1 to 3 titles of at most 20 characters; link button needs an http(s) url', () => {
    const buttons = (titles: string[]) => ({
      ...base,
      kind: 'interactive',
      interactive: {
        type: 'buttons',
        body: 'Pick one',
        buttons: titles.map((title) => ({ title })),
      },
    });
    expect(sendMessageSchema.safeParse(buttons(['Yes', 'No'])).success).toBe(true);
    expect(sendMessageSchema.safeParse(buttons([])).success).toBe(false);
    expect(sendMessageSchema.safeParse(buttons(['a', 'b', 'c', 'd'])).success).toBe(false);
    expect(sendMessageSchema.safeParse(buttons(['x'.repeat(21)])).success).toBe(false);
    const cta = (url: string) => ({
      ...base,
      kind: 'interactive',
      interactive: { type: 'cta_url', body: 'Pay now', text: 'Open', url },
    });
    expect(sendMessageSchema.safeParse(cta('https://pay.example.com/x')).success).toBe(true);
    expect(sendMessageSchema.safeParse(cta('javascript:alert(1)')).success).toBe(false);
    expect(sendMessageSchema.safeParse(cta('ftp://example.com')).success).toBe(false);
  });
});

describe('stored row -> provider envelope (first send and retry read the same row)', () => {
  it('location keeps coordinates in columns and the place in meta', () => {
    const row = stored({
      kind: 'location',
      latitude: 28.6,
      longitude: 77.2,
      name: 'Office',
      address: 'CP',
    });
    expect(row).toMatchObject({ kind: 'location', body: null, latitude: 28.6, longitude: 77.2 });
    expect(envelope(row)).toMatchObject({
      kind: 'location',
      location: { latitude: 28.6, longitude: 77.2, name: 'Office', address: 'CP' },
    });
  });

  it('contacts shows the first name in the thread and sends every card', () => {
    const row = stored({
      kind: 'contacts',
      contacts: [
        { name: 'Asha', phones: ['+919876543210'], emails: ['a@x.io'], org: 'Acme' },
        { name: 'Bob', phones: [], emails: [] },
      ],
    });
    expect(row).toMatchObject({ kind: 'contact', body: 'Asha' });
    expect(envelope(row)).toMatchObject({
      kind: 'contacts',
      contacts: [
        { name: 'Asha', phones: [{ phone: '+919876543210' }], emails: ['a@x.io'], org: 'Acme' },
        { name: 'Bob', phones: [], emails: [] },
      ],
    });
  });

  it('buttons carry their ids to the provider and draw as buttons in the thread', () => {
    const row = stored({
      kind: 'interactive',
      interactive: {
        type: 'buttons',
        body: 'Pick one',
        footer: 'Thanks',
        buttons: [
          { id: 'btn-1', title: 'Yes' },
          { id: 'btn-2', title: 'No' },
        ],
      },
    });
    expect(row).toMatchObject({ kind: 'interactive', body: 'Pick one' });
    expect(envelope(row)).toMatchObject({
      kind: 'interactive',
      interactive: {
        type: 'buttons',
        buttons: [
          { id: 'btn-1', title: 'Yes' },
          { id: 'btn-2', title: 'No' },
        ],
      },
    });
    const wire = toMessageResponse(
      { ...row, direction: 'out', createdAt: new Date(0) } as unknown as MessageRow,
      () => null,
    );
    expect(wire.sentInteractive).toEqual({
      type: 'buttons',
      header: null,
      body: 'Pick one',
      footer: 'Thanks',
      buttons: [
        { title: 'Yes', url: null },
        { title: 'No', url: null },
      ],
    });
    expect(wire.interactive).toBeNull();
  });

  it('a link button is read back as one button with its url', () => {
    const row = stored({
      kind: 'interactive',
      interactive: { type: 'cta_url', body: 'Pay now', text: 'Open', url: 'https://x.io/p' },
    });
    const wire = toMessageResponse(
      { ...row, direction: 'out', createdAt: new Date(0) } as unknown as MessageRow,
      () => null,
    );
    expect(wire.sentInteractive?.buttons).toEqual([{ title: 'Open', url: 'https://x.io/p' }]);
  });
});

describe('list message', () => {
  const list = (sections: unknown) => ({
    ...base,
    kind: 'interactive',
    interactive: { type: 'list', body: 'Choose', button: 'Options', sections },
  });
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Row ${i + 1}` }));

  it('needs a button, a section and at least one row', () => {
    expect(sendMessageSchema.safeParse(list([{ title: 'A', rows: rows(2) }])).success).toBe(true);
    expect(sendMessageSchema.safeParse(list([])).success).toBe(false);
    expect(sendMessageSchema.safeParse(list([{ rows: [] }])).success).toBe(false);
  });

  it('holds at most 10 rows in total, across sections', () => {
    expect(sendMessageSchema.safeParse(list([{ rows: rows(10) }])).success).toBe(true);
    expect(sendMessageSchema.safeParse(list([{ rows: rows(6) }, { rows: rows(5) }])).success).toBe(
      false,
    );
  });

  it('limits row titles to 24 characters and descriptions to 72', () => {
    expect(sendMessageSchema.safeParse(list([{ rows: [{ title: 'x'.repeat(25) }] }])).success).toBe(
      false,
    );
    expect(
      sendMessageSchema.safeParse(list([{ rows: [{ title: 'ok', description: 'x'.repeat(73) }] }]))
        .success,
    ).toBe(false);
  });

  it('is stored with row ids, sent as a list and drawn with its sections', () => {
    const row = stored({
      kind: 'interactive',
      interactive: {
        type: 'list',
        body: 'Choose',
        button: 'Options',
        sections: [
          { title: 'Sizes', rows: [{ id: 'row-1', title: 'Small', description: 'Fits 6-8' }] },
          { rows: [{ id: 'row-2', title: 'Large' }] },
        ],
      },
    });
    expect(envelope(row)).toMatchObject({
      kind: 'interactive',
      interactive: {
        type: 'list',
        button: 'Options',
        sections: [
          { title: 'Sizes', rows: [{ id: 'row-1', title: 'Small', description: 'Fits 6-8' }] },
          { rows: [{ id: 'row-2', title: 'Large' }] },
        ],
      },
    });
    const wire = toMessageResponse(
      { ...row, direction: 'out', createdAt: new Date(0) } as unknown as MessageRow,
      () => null,
    );
    expect(wire.sentInteractive).toMatchObject({
      type: 'list',
      buttons: [{ title: 'Options', url: null }],
      sections: [
        { title: 'Sizes', rows: [{ title: 'Small', description: 'Fits 6-8' }] },
        { title: null, rows: [{ title: 'Large', description: null }] },
      ],
    });
  });

  it('a migrated button message whose header file made it an image keeps its buttons', () => {
    const row = stored({ kind: 'interactive', interactive: { type: 'buttons', body: 'Hi', buttons: [{ id: 'a', title: 'Welcome' }] } });
    const wire = toMessageResponse(
      {
        ...row,
        kind: 'image',
        direction: 'out',
        createdAt: new Date(0),
        meta: { sentInteractive: { type: 'buttons', body: 'Hi', buttons: [{ title: 'Welcome' }] } },
      } as unknown as MessageRow,
      () => null,
    );
    expect(wire.kind).toBe('image');
    expect(wire.sentInteractive?.buttons).toEqual([{ title: 'Welcome', url: null }]);
  });
});
