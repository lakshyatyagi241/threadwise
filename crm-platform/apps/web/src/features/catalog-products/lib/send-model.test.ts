import { describe, expect, it } from 'vitest';
import { sendCatalogSchema } from '@crm/contracts';
import {
  EMPTY_SEND_FORM,
  buildCollectionSend,
  buildSendRequest,
  countManual,
  filterContacts,
  groupByCategory,
  manualNumbers,
  overRecipientCap,
  recipientCount,
  sendFailed,
  setMode,
  toggleId,
  toggleProduct,
  type SendForm,
} from './send-model';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const form = (over: Partial<SendForm> = {}): SendForm => ({ ...EMPTY_SEND_FORM, ...over });

describe('manual numbers', () => {
  it('splits on whitespace, commas and semicolons and keeps tokens with 8 or more digits', () => {
    expect(manualNumbers('+1 555 0100 123\n919876543210, 12345; 00442071234567')).toEqual([
      '919876543210',
      '00442071234567',
    ]);
    expect(countManual('')).toBe(0);
    expect(countManual('  \n ')).toBe(0);
  });
  it('strips punctuation inside a token', () => {
    expect(manualNumbers('+91-98765-43210')).toEqual(['919876543210']);
  });
  it('does not de-duplicate (the server does)', () => {
    expect(countManual('919876543210\n919876543210')).toBe(2);
  });
});

describe('recipientCount', () => {
  const counts = new Map([
    ['g1', 10],
    ['g2', 5],
  ]);
  it('sums the group member counts', () => {
    expect(recipientCount(form({ recipientMode: 'groups', groupIds: ['g1', 'g2'] }), counts)).toBe(
      15,
    );
    expect(recipientCount(form({ recipientMode: 'groups', groupIds: ['gone'] }), counts)).toBe(0);
  });
  it('counts ticked contacts and manual numbers by the active source only', () => {
    expect(
      recipientCount(
        form({ recipientMode: 'contacts', contactIds: ['a', 'b'], groupIds: ['g1'] }),
        counts,
      ),
    ).toBe(2);
    expect(
      recipientCount(
        form({ recipientMode: 'manual', manual: '919876543210', groupIds: ['g1'] }),
        counts,
      ),
    ).toBe(1);
  });
  it('flags more than 500', () => {
    expect(overRecipientCap(500)).toBe(false);
    expect(overRecipientCap(501)).toBe(true);
  });
});

describe('filterContacts', () => {
  const contacts = [
    { name: 'Asha Rao', mobile: '919876543210' },
    { name: null, mobile: '14155550100' },
  ];
  it('matches the name or the number', () => {
    expect(filterContacts(contacts, 'asha')).toHaveLength(1);
    expect(filterContacts(contacts, '4155')).toHaveLength(1);
    expect(filterContacts(contacts, ' ')).toHaveLength(2);
    expect(filterContacts(contacts, 'zzz')).toHaveLength(0);
  });
});

describe('toggleProduct', () => {
  it('single product: checking another replaces the first', () => {
    const a = toggleProduct(form({ mode: 'spm' }), U(1));
    const b = toggleProduct(a.form, U(2));
    expect(b.form.productIds).toEqual([U(2)]);
    expect(b.refused).toBeNull();
  });
  it('list: adds up to 30 and refuses the 31st', () => {
    let f = form({ mode: 'mpm' });
    for (let i = 1; i <= 30; i++) f = toggleProduct(f, U(i)).form;
    expect(f.productIds).toHaveLength(30);
    const over = toggleProduct(f, U(31));
    expect(over.refused).toBe('max');
    expect(over.form.productIds).toHaveLength(30);
  });
  it('unchecking works even at the cap', () => {
    let f = form({ mode: 'mpm' });
    for (let i = 1; i <= 30; i++) f = toggleProduct(f, U(i)).form;
    expect(toggleProduct(f, U(5)).form.productIds).toHaveLength(29);
  });
});

describe('setMode', () => {
  it('keeps only the first product when switching to single', () => {
    expect(
      setMode(form({ mode: 'mpm', productIds: [U(1), U(2), U(3)] }), 'spm').productIds,
    ).toEqual([U(1)]);
  });
  it('keeps the picks for the list and the link', () => {
    expect(setMode(form({ mode: 'spm', productIds: [U(1)] }), 'mpm').productIds).toEqual([U(1)]);
    expect(setMode(form({ mode: 'mpm', productIds: [U(1), U(2)] }), 'link').productIds).toEqual([
      U(1),
      U(2),
    ]);
  });
});

describe('toggleId', () => {
  it('adds and removes', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('buildSendRequest', () => {
  it('posts only the active recipient source', () => {
    const req = buildSendRequest(
      form({
        recipientMode: 'contacts',
        contactIds: [U(1)],
        groupIds: [U(2)],
        manual: '919876543210',
        mode: 'mpm',
        productIds: [U(3)],
      }),
    );
    expect(req.contactIds).toEqual([U(1)]);
    expect(req.groupIds).toEqual([]);
    expect(req.manualNumbers).toBeUndefined();
    expect(sendCatalogSchema.safeParse(req).success).toBe(true);
  });
  it('drops products in link mode and leaves blank text out', () => {
    const req = buildSendRequest(
      form({
        recipientMode: 'manual',
        manual: '919876543210',
        mode: 'link',
        productIds: [U(3)],
        body: '  ',
      }),
    );
    expect(req.productIds).toEqual([]);
    expect(req.body).toBeUndefined();
    expect(req.manualNumbers).toBe('919876543210');
  });
  it('includes sender, shop, body, header and footer when set', () => {
    const req = buildSendRequest(
      form({
        sender: `waba:${U(9)}`,
        shopId: U(8),
        body: 'Hi',
        header: 'Look',
        footer: 'Bye',
        mode: 'mpm',
        productIds: [U(1)],
        groupIds: [U(2)],
      }),
    );
    expect(req).toMatchObject({
      sender: `waba:${U(9)}`,
      shopId: U(8),
      body: 'Hi',
      header: 'Look',
      footer: 'Bye',
      mode: 'mpm',
    });
    expect(sendCatalogSchema.safeParse(req).success).toBe(true);
  });
  it('posts a header only for a list and a footer never for a link', () => {
    const single = buildSendRequest(
      form({ mode: 'spm', header: 'H', footer: 'F', productIds: [U(1)], groupIds: [U(2)] }),
    );
    expect(single.header).toBeUndefined();
    expect(single.footer).toBe('F');
    const link = buildSendRequest(
      form({
        mode: 'link',
        header: 'H',
        footer: 'F',
        manual: '919876543210',
        recipientMode: 'manual',
      }),
    );
    expect(link.header).toBeUndefined();
    expect(link.footer).toBeUndefined();
  });
});

describe('buildCollectionSend', () => {
  it('is a list message to the pasted number', () => {
    const req = buildCollectionSend({
      number: ' 919876543210 ',
      header: ' Check ',
      sender: '',
      productIds: [U(1), U(2)],
    });
    expect(req).toMatchObject({
      mode: 'mpm',
      manualNumbers: '919876543210',
      header: 'Check',
      productIds: [U(1), U(2)],
    });
    expect(req.sender).toBeUndefined();
    expect(sendCatalogSchema.safeParse(req).success).toBe(true);
  });
});

describe('groupByCategory', () => {
  it('groups by category in first-seen order and names the rest', () => {
    const groups = groupByCategory(
      [
        { id: 1, category: 'Apparel' },
        { id: 2, category: null },
        { id: 3, category: 'Apparel' },
        { id: 4, category: ' ' },
        { id: 5, category: 'Home' },
      ],
      'Other',
    );
    expect(groups.map((g) => [g.name, g.items.map((i) => i.id)])).toEqual([
      ['Apparel', [1, 3]],
      ['Other', [2, 4]],
      ['Home', [5]],
    ]);
    expect(groupByCategory([], 'Other')).toEqual([]);
  });
});

describe('sendFailed', () => {
  it('is failure when no message went out', () => {
    expect(sendFailed({ ok: false, sent: 0, failed: 2, total: 2, errors: [] })).toBe(true);
    expect(sendFailed({ ok: true, sent: 1, failed: 1, total: 2, errors: ['x: y'] })).toBe(false);
  });
});
