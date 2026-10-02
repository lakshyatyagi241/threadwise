import { describe, expect, it } from 'vitest';
import {
  docCountsSchema,
  docRowPageSchema,
  eventListSchema,
  publicDocSchema,
  salesDocSchema,
  sendResultSchema,
  shareLinkSchema,
} from './schemas';

const ID = '294dca7c-5806-4548-9035-dcca9befc7b1';
const ID2 = '394dca7c-5806-4548-9035-dcca9befc7b2';
const NOW = '2026-10-01T10:00:00.000Z';

const totals = {
  subtotalMinor: '3100',
  discountMinor: '0',
  taxMinor: '310',
  totalMinor: '3410',
  subtotal: '31.00',
  discount: '0.00',
  tax: '3.10',
  total: '34.10',
};
const summary = {
  id: ID,
  kind: 'estimate',
  number: 'EST-0007',
  status: 'converted',
  title: 'Garden',
  buyerName: 'Tariq',
  contact: { id: ID2, name: 'Tariq Rahman' },
  company: null,
  deal: { id: ID2, title: 'Garden deal' },
  owner: { id: ID2, name: 'Priya' },
  currency: 'USD',
  totals,
  validUntil: '2026-12-01',
  overdue: false,
  sentAt: NOW,
  firstViewedAt: null,
  decidedAt: null,
  revision: 1,
  source: 'manual',
  rowVersion: 3,
  createdAt: NOW,
  updatedAt: NOW,
};
const line = {
  position: 0,
  description: 'Design',
  qty: '2',
  unitPrice: '15.50',
  unitPriceMinor: '1550',
  discount: { kind: 'percent', value: '10' },
  taxRate: '5',
  effectiveTaxRate: '5',
  grossMinor: '3100',
  discountMinor: '310',
  netMinor: '2790',
  taxMinor: '140',
};
const full = {
  ...summary,
  buyer: { name: 'Tariq', email: 'tariq@example.com', phone: null },
  exponent: 2,
  taxRate: '10',
  discount: { kind: 'amount', value: '1.50' },
  lines: [line, { ...line, position: 1, discount: null, taxRate: null, effectiveTaxRate: '10' }],
  notes: null,
  terms: 'Net 14',
  acceptedRevision: null,
  duplicatedFromId: null,
  invoice: { id: ID2 },
  createdBy: null,
  link: { active: true, expiresAt: null, revokedAt: null, viewCount: 2, lastViewedAt: NOW },
  actions: {
    edit: false,
    send: false,
    decide: false,
    revise: false,
    extend: false,
    convertInvoice: false,
    convertDeal: false,
    delete: false,
  },
};

describe('a list row from the wire', () => {
  const page = docRowPageSchema.parse({
    data: [summary],
    page: { nextCursor: 'abc', hasMore: true, limit: 25 },
  });
  const row = page.docs[0]!;

  it('keeps the page cursor and flattens the money to minor units', () => {
    expect(page).toMatchObject({ nextCursor: 'abc', hasMore: true });
    expect(row).toMatchObject({
      subtotalMinor: 3100,
      taxMinor: 310,
      totalMinor: 3410,
      currency: 'USD',
    });
  });

  it('flattens the refs and the date', () => {
    expect(row.deal).toEqual({ id: ID2, name: 'Garden deal' });
    expect(row.contact).toEqual({ id: ID2, name: 'Tariq Rahman' });
    expect(row.company).toBeNull();
    expect(row.validUntil).toBe('2026-12-01');
    expect(row.buyerName).toBe('Tariq');
    expect(row.status).toBe('converted');
    expect(row.kind).toBe('estimate');
  });

  it('refuses a row without money', () => {
    expect(() =>
      docRowPageSchema.parse({
        data: [{ ...summary, totals: undefined }],
        page: { nextCursor: null, hasMore: false, limit: 1 },
      }),
    ).toThrow();
  });
});

describe('a whole document from the wire', () => {
  const doc = salesDocSchema.parse(full);

  it('adds the buyer, the link and what the status allows', () => {
    expect(doc.buyer).toEqual({ name: 'Tariq', email: 'tariq@example.com', phone: '' });
    expect(doc.link.viewCount).toBe(2);
    expect(doc.actions.edit).toBe(false);
    expect(doc.invoice).toEqual({ id: ID2 });
    expect(doc.terms).toBe('Net 14');
    expect(doc.notes).toBe('');
  });

  it('reads rates as basis points and discounts as the form holds them', () => {
    expect(doc.defaultTaxBp).toBe(1000);
    expect(doc.discount).toEqual({ kind: 'amount', minor: 150 });
    expect(doc.items[0]).toMatchObject({
      unitPriceMinor: 1550,
      qty: '2',
      discount: { kind: 'percent', bp: 1000 },
      taxRateBp: 500,
      effectiveTaxBp: 500,
      netMinor: 2790,
      taxMinor: 140,
    });
    // a row with no rate of its own follows the document's
    expect(doc.items[1]).toMatchObject({ taxRateBp: null, effectiveTaxBp: 1000, discount: null });
  });
});

describe('counts', () => {
  it('reads the totals per status and the open value per currency in minor units', () => {
    const c = docCountsSchema.parse({
      total: 9,
      byStatus: {
        draft: 1,
        sent: 2,
        viewed: 1,
        accepted: 2,
        declined: 1,
        expired: 1,
        converted: 1,
      },
      openValue: [
        { currency: 'USD', amount: '1234.50' },
        { currency: 'JPY', amount: '5000' },
      ],
    });
    expect(c).toMatchObject({ all: 9, sent: 2, declined: 1, converted: 1 });
    expect(c.openValue).toEqual([
      { currency: 'USD', minor: 123450 },
      { currency: 'JPY', minor: 5000 },
    ]);
  });
});

describe('the activity', () => {
  it('names the actor and keeps the buyer evidence the page shows', () => {
    const base = {
      fromStatus: null,
      toStatus: null,
      revision: 1,
      channel: null,
      signerName: null,
      signerEmail: null,
      hasSignature: false,
      comment: null,
      ip: null,
      userAgent: null,
      meta: {},
    };
    const list = eventListSchema.parse({
      data: [
        {
          ...base,
          id: ID,
          type: 'accepted',
          actor: { kind: 'buyer', user: null },
          signerName: 'Ana',
          hasSignature: true,
          ip: '203.0.113.9',
          toStatus: 'accepted',
          createdAt: NOW,
        },
        {
          ...base,
          id: ID2,
          type: 'sent',
          actor: { kind: 'user', user: { id: ID, name: 'Priya' } },
          channel: 'email',
          createdAt: NOW,
        },
      ],
    });
    expect(list[0]).toMatchObject({
      type: 'accepted',
      actor: { kind: 'buyer', name: '' },
      signerName: 'Ana',
      hasSignature: true,
      ip: '203.0.113.9',
      to: 'accepted',
    });
    expect(list[1]).toMatchObject({
      type: 'sent',
      actor: { kind: 'user', name: 'Priya' },
      channel: 'email',
    });
  });
});

describe('sending and the link', () => {
  it('reads the share link without exposing the token', () => {
    const link = shareLinkSchema.parse({
      token: 'secret',
      path: '/q/secret',
      url: 'https://app.example/q/secret',
      active: true,
      expiresAt: null,
      revokedAt: null,
    });
    expect(link).toEqual({
      url: 'https://app.example/q/secret',
      path: '/q/secret',
      active: true,
      expiresAt: null,
      revokedAt: null,
    });
    expect(link).not.toHaveProperty('token');
  });

  it('reads how the send went along with the document', () => {
    const r = sendResultSchema.parse({
      document: full,
      delivery: { channel: 'whatsapp', status: 'queued', to: '+15550101234' },
      link: {
        token: 't',
        path: '/q/t',
        url: 'https://app.example/q/t',
        active: true,
        expiresAt: null,
        revokedAt: null,
      },
    });
    expect(r.delivery.status).toBe('queued');
    expect(r.doc.number).toBe('EST-0007');
  });
});

describe('the buyer page', () => {
  const pub = {
    kind: 'proposal',
    number: 'PRO-0001',
    title: null,
    status: 'sent',
    seller: { name: 'Acme' },
    buyer: { name: 'Ana', company: null },
    currency: 'eur',
    exponent: 2,
    taxRate: '18.5',
    discount: null,
    lines: [line],
    totals,
    notes: null,
    terms: null,
    validUntil: '2026-12-01',
    sentAt: NOW,
    canDecide: true,
    blockedReason: null,
    decision: null,
    revision: 1,
  };

  it('parses with no staff-only field and keeps what decides the buttons', () => {
    const doc = publicDocSchema.parse(pub);
    expect(doc).toMatchObject({
      kind: 'proposal',
      currency: 'EUR',
      defaultTaxBp: 1850,
      canDecide: true,
      blockedReason: null,
      decision: null,
    });
    expect(doc.buyer).toEqual({ name: 'Ana', company: '' });
    expect(doc.seller).toEqual({ name: 'Acme' });
    expect(doc).not.toHaveProperty('buyerEmail');
  });

  it('reads a recorded decision and an expired block', () => {
    const decided = publicDocSchema.parse({
      ...pub,
      status: 'accepted',
      canDecide: false,
      decision: { status: 'accepted', decidedAt: NOW, signerName: 'Ana Lopez' },
    });
    expect(decided.decision).toEqual({
      status: 'accepted',
      decidedAt: NOW,
      signerName: 'Ana Lopez',
    });
    const lapsed = publicDocSchema.parse({
      ...pub,
      status: 'expired',
      canDecide: false,
      blockedReason: 'expired',
    });
    expect(lapsed).toMatchObject({ canDecide: false, blockedReason: 'expired' });
  });
});
