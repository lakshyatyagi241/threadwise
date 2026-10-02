import { describe, expect, it } from 'vitest';
import { SALES_DOC_STATUSES, type SalesDocStatus } from '@crm/contracts';
import {
  actionsOf,
  addDays,
  canTransition,
  formatNumber,
  generateToken,
  hashToken,
  isDeletable,
  isOverdue,
  looksLikeToken,
  nextStatus,
  type SalesDocAction,
} from '../../../src/modules/crm/sales-docs/sales-doc-rules';
import { AppError } from '../../../src/common/errors/app-error';
import { composeQuoteMail } from '../../../src/modules/crm/sales-docs/sales-doc-mail';
import {
  esc,
  groupMajor,
  renderSalesDocHtml,
} from '../../../src/modules/crm/sales-docs/sales-doc-render';
import { maskRecipient } from '../../../src/modules/crm/sales-docs/sales-docs.service';

describe('status machine (WD-PROP-010, D-15)', () => {
  const table: Array<[SalesDocStatus, SalesDocAction, SalesDocStatus]> = [
    ['draft', 'send', 'sent'],
    ['draft', 'accept', 'accepted'],
    ['draft', 'decline', 'declined'],
    ['sent', 'view', 'viewed'],
    ['sent', 'send', 'sent'],
    ['viewed', 'send', 'viewed'],
    ['sent', 'accept', 'accepted'],
    ['viewed', 'accept', 'accepted'],
    ['sent', 'decline', 'declined'],
    ['viewed', 'decline', 'declined'],
    ['sent', 'expire', 'expired'],
    ['viewed', 'expire', 'expired'],
    ['sent', 'revise', 'draft'],
    ['viewed', 'revise', 'draft'],
    ['declined', 'revise', 'draft'],
    ['expired', 'revise', 'draft'],
    ['sent', 'extend', 'sent'],
    ['viewed', 'extend', 'viewed'],
    ['accepted', 'convert_invoice', 'converted'],
  ];

  it.each(table)('%s --%s--> %s', (from, action, to) => {
    expect(nextStatus(from, action)).toBe(to);
  });

  it('extending an expired document reopens it where it was: viewed if the buyer had opened it, else sent', () => {
    expect(nextStatus('expired', 'extend', { everViewed: true })).toBe('viewed');
    expect(nextStatus('expired', 'extend', { everViewed: false })).toBe('sent');
  });

  it('every other move is 409 SALESDOC_INVALID_TRANSITION (WaDesk allowed any status from any status)', () => {
    const allowed = new Set(table.map(([f, a]) => `${f}|${a}`).concat(['expired|extend']));
    const actions: SalesDocAction[] = [
      'send',
      'view',
      'accept',
      'decline',
      'expire',
      'revise',
      'extend',
      'convert_invoice',
    ];
    let checked = 0;
    for (const from of SALES_DOC_STATUSES) {
      for (const a of actions) {
        if (allowed.has(`${from}|${a}`)) continue;
        checked++;
        expect(canTransition(from, a)).toBe(false);
        let thrown: unknown;
        try {
          nextStatus(from, a);
        } catch (e) {
          thrown = e;
        }
        expect(thrown).toBeInstanceOf(AppError);
        expect((thrown as AppError).code).toBe('SALESDOC_INVALID_TRANSITION');
        expect((thrown as AppError).getStatus()).toBe(409);
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('accepted and converted are final for revision; a converted document allows nothing', () => {
    expect(canTransition('accepted', 'revise')).toBe(false);
    expect(canTransition('converted', 'revise')).toBe(false);
    expect(canTransition('converted', 'accept')).toBe(false);
  });

  it('actions mirror the machine: only a draft is editable, evidence is not deletable', () => {
    expect(actionsOf('draft', false)).toMatchObject({
      edit: true,
      send: true,
      decide: true,
      revise: false,
      delete: true,
      convertDeal: true,
    });
    expect(actionsOf('sent', true)).toMatchObject({
      edit: false,
      send: true,
      revise: true,
      extend: true,
      convertDeal: false,
    });
    expect(actionsOf('accepted', false)).toMatchObject({
      convertInvoice: true,
      delete: false,
      revise: false,
    });
    expect(actionsOf('converted', false)).toMatchObject({ convertInvoice: false, delete: false });
    expect(isDeletable('declined')).toBe(true);
    expect(isDeletable('accepted')).toBe(false);
  });
});

describe('numbering (WD-PROP-008, D-06)', () => {
  it('prefix, dash and a zero-padded counter; past the padding the number just grows', () => {
    expect(formatNumber('PRO', 4, 1)).toBe('PRO-0001');
    expect(formatNumber('EST', 4, 42)).toBe('EST-0042');
    expect(formatNumber('PRO', 4, 10000)).toBe('PRO-10000');
    expect(formatNumber('Q', 6, 7)).toBe('Q-000007');
  });
});

describe('public token (WD-PROP-009, D-16)', () => {
  it('is 256 random bits as 43 base64url characters, never repeated, and recognised by shape', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(looksLikeToken(a)).toBe(true);
    expect(looksLikeToken('short')).toBe(false);
    expect(looksLikeToken(`${a}!`)).toBe(false);
  });
  it('is looked up by its SHA-256 (64 hex characters), which is stable and differs per token', () => {
    const a = generateToken();
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(hashToken(generateToken()));
    expect(hashToken(a)).not.toContain(a);
  });
});

describe('expiry (WD-PROP-004, D-05)', () => {
  const now = new Date('2026-10-15T23:30:00Z');
  it('a document is valid through the whole of its valid-until day in the workspace zone', () => {
    // 23:30 UTC on the 15th is already the 16th in Tokyo (+9) and still the 15th in New York.
    expect(isOverdue('sent', '2026-10-15', 'UTC', now)).toBe(false);
    expect(isOverdue('sent', '2026-10-15', 'Asia/Tokyo', now)).toBe(true);
    expect(isOverdue('viewed', '2026-10-15', 'America/New_York', now)).toBe(false);
    expect(isOverdue('sent', '2026-10-14', 'UTC', now)).toBe(true);
  });
  it('only open documents lapse; no date never lapses; an unknown zone falls back to UTC', () => {
    expect(isOverdue('draft', '2020-01-01', 'UTC', now)).toBe(false);
    expect(isOverdue('accepted', '2020-01-01', 'UTC', now)).toBe(false);
    expect(isOverdue('declined', '2020-01-01', 'UTC', now)).toBe(false);
    expect(isOverdue('sent', null, 'UTC', now)).toBe(false);
    expect(isOverdue('sent', '2026-10-14', 'Not/AZone', now)).toBe(true);
  });
  it('addDays is calendar arithmetic across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-10-15', 30)).toBe('2026-11-14');
  });
});

describe('print page and mail (WD-PROP-030)', () => {
  const view = {
    kind: 'estimate' as const,
    number: 'EST-0001',
    title: '<script>alert(1)</script>',
    statusLabel: 'sent',
    sellerName: 'Acme & Sons',
    buyerName: 'Priya "P" <x>',
    buyerCompany: null,
    currency: 'USD',
    lines: [
      {
        position: 0,
        description: '<img src=x onerror=alert(1)>',
        qty: '2',
        unitPrice: '15.50',
        unitPriceMinor: '1550',
        discount: null,
        taxRate: null,
        effectiveTaxRate: '10',
        grossMinor: '3100',
        discountMinor: '0',
        netMinor: '3100',
        taxMinor: '310',
      },
    ],
    totals: {
      subtotalMinor: '3100',
      discountMinor: '0',
      taxMinor: '310',
      totalMinor: '3410',
      subtotal: '31.00',
      discount: '0.00',
      tax: '3.10',
      total: '34.10',
    },
    discount: null,
    taxRate: '10',
    notes: 'a <b>note</b>',
    terms: null,
    validUntil: '2026-11-01',
    signedBy: null,
  };
  it('escapes everything the buyer or the seller typed and carries no script', () => {
    const html = renderSalesDocHtml(view);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Acme &amp; Sons');
    expect(html).toContain('noindex');
    expect(html).toContain('USD&nbsp;34.10');
    expect(html).toContain('Tax (10%)');
  });
  it('groups thousands on the decimal string without floats', () => {
    expect(groupMajor('1234567.89')).toBe('1,234,567.89');
    expect(groupMajor('999')).toBe('999');
    expect(esc(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  });
  it('the mail carries the link, the total and the validity, and escapes the seller and the message', () => {
    const m = composeQuoteMail({
      kindLabel: 'Estimate',
      number: 'EST-0001',
      title: 'Website',
      sellerName: 'Acme <b>',
      buyerName: 'Priya',
      currency: 'USD',
      totalMajor: '1234.50',
      validUntil: '2026-11-01',
      link: 'https://app.example.test/q/abc',
      message: '<i>hi</i>',
    });
    expect(m.subject).toBe('Estimate EST-0001: Website from Acme <b>');
    expect(m.text).toContain('https://app.example.test/q/abc');
    expect(m.text).toContain('USD 1,234.50');
    expect(m.html).toContain('Acme &lt;b&gt;');
    expect(m.html).not.toContain('<i>hi</i>');
  });
  it('masks a recipient in the timeline', () => {
    expect(maskRecipient('priya@example.com')).toBe('pr***@example.com');
    expect(maskRecipient('+919876543210')).toBe('+91********10');
  });
});
