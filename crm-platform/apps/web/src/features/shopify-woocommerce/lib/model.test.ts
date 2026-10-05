import { describe, expect, it } from 'vitest';
import type { DashboardSender, DashboardTemplate } from '@crm/contracts';
import {
  AUTOMATION_GROUPS,
  autoKey,
  barHeight,
  isHealthy,
  missingTemplate,
  money,
  parseTab,
  parseVarCsv,
  statusTone,
  templatesFor,
  toInput,
  type AutomationDraft,
} from './model';

const tpl = (name: string, engine: string, account: string | null = null): DashboardTemplate => ({
  uuid: '00000000-0000-4000-8000-000000000001',
  name,
  category: null,
  language: 'en_US',
  engine,
  senderAccount: account,
  paramCount: 0,
});

describe('the store screens model (WD-ECOM-004, 009, 023)', () => {
  it('reads the tab from the address and falls back to the overview', () => {
    expect(parseTab('orders')).toBe('orders');
    expect(parseTab('events')).toBe('events');
    expect(parseTab('invoices')).toBe('overview');
    expect(parseTab('nope')).toBe('overview');
    expect(parseTab(null)).toBe('overview');
  });

  it('tones a status', () => {
    expect(statusTone('sent')).toBe('good');
    expect(statusTone('processed')).toBe('good');
    expect(statusTone('failed')).toBe('bad');
    expect(statusTone('skipped')).toBe('muted');
    expect(statusTone('received')).toBe('warn');
  });

  it('calls the webhooks healthy for a delivery under a day old', () => {
    const now = new Date('2026-03-10T12:00:00Z').getTime();
    const log = (iso: string) => [
      { id: 1, eventType: 'x', status: 'sent', recipient: null, error: null, createdAt: iso },
    ];
    expect(isHealthy(log('2026-03-10T00:00:00Z'), now)).toBe(true);
    expect(isHealthy(log('2026-03-09T11:00:00Z'), now)).toBe(false);
    expect(isHealthy([], now)).toBe(false);
  });

  it('formats money with a currency and thousands separators', () => {
    expect(money(1234.5, 'USD')).toBe('USD 1,234.50');
    expect(money(1234.5, 'USD', 0)).toBe('USD 1,235');
    expect(money(0, '')).toBe('0.00');
  });

  it('makes translation-safe automation keys', () => {
    expect(autoKey('order.on-hold')).toBe('order_on_hold');
    expect(autoKey('cart/step2')).toBe('cart_step2');
    expect(autoKey('orders/create')).toBe('orders_create');
  });

  it("shows WaDesk's automations: 16 for Shopify, 15 for WooCommerce, each once", () => {
    const count = (k: 'shopify' | 'woocommerce') => AUTOMATION_GROUPS[k].flatMap((g) => g.topics);
    expect(count('shopify')).toHaveLength(16);
    expect(count('woocommerce')).toHaveLength(15);
    for (const k of ['shopify', 'woocommerce'] as const)
      expect(new Set(count(k)).size).toBe(count(k).length);
  });

  it('narrows templates to the chosen sender', () => {
    const all = [
      tpl('a', 'waba', 'acct-1'),
      tpl('b', 'waba', 'acct-2'),
      tpl('c', 'baileys'),
      tpl('d', 'twilio'),
    ];
    const sender = (key: string, engine: string): DashboardSender => ({ key, engine, label: key });
    expect(templatesFor(all, undefined).map((t) => t.name)).toEqual(['a', 'b', 'c', 'd']);
    expect(templatesFor(all, sender('waba:acct-1', 'waba')).map((t) => t.name)).toEqual(['a']);
    expect(templatesFor(all, sender('baileys:x', 'baileys')).map((t) => t.name)).toEqual(['c']);
    expect(templatesFor(all, sender('twilio:x', 'twilio')).map((t) => t.name)).toEqual(['d']);
    expect(templatesFor(all, sender('sms:x', 'sms')).map((t) => t.name)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('builds the request for an automation', () => {
    const d: AutomationDraft = {
      eventType: 'orders/create',
      isActive: true,
      templateUuid: '',
      varMap: ['name', ''],
      sendTo: 'customer',
      adminNumber: ' 123 ',
      delaySeconds: 0,
    };
    expect(toInput(d)).toEqual({
      eventType: 'orders/create',
      isActive: true,
      templateUuid: null,
      varMap: ['name'],
      sendTo: 'customer',
      adminNumber: null,
      delaySeconds: 0,
    });
    expect(toInput({ ...d, sendTo: 'both', templateUuid: 'u' })).toMatchObject({
      templateUuid: 'u',
      adminNumber: '123',
    });
    expect(toInput({ ...d, sendTo: 'admin', adminNumber: '  ' }).adminNumber).toBeNull();
  });

  it('finds automations switched on without a template', () => {
    const base: AutomationDraft = {
      eventType: 'a',
      isActive: true,
      templateUuid: '',
      varMap: [],
      sendTo: 'customer',
      adminNumber: '',
      delaySeconds: 0,
    };
    expect(
      missingTemplate([
        base,
        { ...base, eventType: 'b', templateUuid: 'u' },
        { ...base, eventType: 'c', isActive: false },
      ]),
    ).toEqual(['a']);
  });

  it('parses the advanced field list and scales trend bars', () => {
    expect(parseVarCsv(' name, ,order_name ,total')).toEqual(['name', 'order_name', 'total']);
    expect(parseVarCsv('')).toEqual([]);
    expect(barHeight(0, 100)).toBe(3);
    expect(barHeight(50, 100)).toBe(50);
    expect(barHeight(5, 0)).toBe(100);
  });
});
