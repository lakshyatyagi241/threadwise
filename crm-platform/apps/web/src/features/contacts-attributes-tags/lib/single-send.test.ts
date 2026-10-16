import { describe, expect, it } from 'vitest';
import { missingSlots, previewOf, sendBlock, whatsappChannels } from './single-send';

const row = { phone: '+919800000001', email: 'a@b.co', optedOut: false };

describe('sendBlock', () => {
  it('lets every channel through for a reachable contact', () => {
    for (const c of ['whatsapp', 'sms', 'email', 'call'] as const)
      expect(sendBlock(c, row)).toBeNull();
  });
  it('needs a number for whatsapp, sms and call, and an address for email', () => {
    expect(sendBlock('whatsapp', { ...row, phone: ' ' })).toBe('noPhone');
    expect(sendBlock('call', { ...row, phone: '' })).toBe('noPhone');
    expect(sendBlock('email', { ...row, email: '' })).toBe('noEmail');
  });
  it('blocks written messages for an opted-out contact but not a call', () => {
    const out = { ...row, optedOut: true };
    expect(sendBlock('whatsapp', out)).toBe('optedOut');
    expect(sendBlock('sms', out)).toBe('optedOut');
    expect(sendBlock('email', out)).toBe('optedOut');
    expect(sendBlock('call', out)).toBeNull();
  });
});

describe('previewOf / missingSlots', () => {
  const tpl = {
    body: 'Hi {{1}}, order {{ order }} ships {{3}}',
    slots: [
      { key: '1', label: 'Name', example: null },
      { key: 'order', label: 'Order', example: null },
    ],
  };
  it('fills typed values and keeps empty markers', () => {
    expect(previewOf(tpl, { '1': 'Asha', order: ' 42 ' })).toBe('Hi Asha, order 42 ships {{3}}');
    expect(previewOf(tpl, {})).toBe('Hi {{1}}, order {{ order }} ships {{3}}');
  });
  it('lists the slots without a value', () => {
    expect(missingSlots(tpl, { '1': 'Asha', order: '  ' })).toEqual(['order']);
    expect(missingSlots(tpl, { '1': 'A', order: 'B' })).toEqual([]);
  });
});

describe('whatsappChannels', () => {
  it('keeps connected whatsapp numbers only', () => {
    const list = [
      { kind: 'whatsapp_cloud', status: 'connected' },
      { kind: 'whatsapp_cloud', status: 'error' },
      { kind: 'simulator', status: 'connected' },
    ];
    expect(whatsappChannels(list)).toEqual([list[0]]);
  });
});
