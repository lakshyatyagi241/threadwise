import { describe, expect, it } from 'vitest';
import { buildCreditsPlan } from '../credits/plan';
import type { CreditSettings } from '../credits/config';
import type { Source } from '../extract/source';
import { appendSettings, changedTables } from '../load/usageappend';
import { creditTokens, usageCharges } from '../transform/credits';
import type { Ctx } from '../transform/types';
import type { Doc } from '../util';

const NOW = '2026-10-12T13:44:27.710Z';
const mem = (c: Record<string, Doc[]>): Source =>
  ({
    clients: () => ['t'],
    collections: () => Object.keys(c),
    read: async function* (_cl: string, name: string) {
      for (const d of c[name] ?? []) yield d;
    },
    fileOf: () => null,
    badLines: () => [],
  }) as unknown as Source;

const wb = (id: string, msg: string | null, extra: Doc = {}): Doc => ({
  _id: id,
  id: `w-${id}`,
  message_id: msg,
  source: 'automation',
  template_category: 'Marketing',
  amount: 0.35,
  reseller_amount: 0.05,
  cost: 0.3,
  created_time: new Date('2026-10-11T08:00:00.000Z'),
  ...extra,
});
const log = (id: string, ws: string): Doc => ({
  _id: id,
  workspace_id: ws,
  credits_deducted: 0.5,
  input_tokens: 5,
  output_tokens: 7,
  tokens_used: 12,
  type: 'openai_api',
  model: 'openai/gpt-4o-mini',
  created_time: new Date('2026-10-11T09:00:00.000Z'),
});

const dump = {
  whatsapp_broadcasting_data: [
    wb('a1', 'wamid.1'),
    wb('a2', 'wamid.2'),
    wb('a3', 'wamid.1'), // duplicate wamid: excluded, first wins
    wb('a4', null), // no message id: counted quarantine
    wb('a5', 'wamid.5', { source: 'broadcast', broadcast_id: 'b1' }), // a campaign recipient: not this step's
  ],
  credit_logs: [log('c1', 'ws-1'), log('c2', 'ws-2')],
};

const OPENING = {
  minor: 10000n,
  amountText: '100.00',
  currency: 'INR',
  asOf: '2026-10-12T00:00:00.000Z',
  confirmedBy: 'test',
  note: null,
  sha256: 'x',
};
const settingsWallet: CreditSettings = { wallet: true, opening: OPENING, workspaceId: 'ws-1' };

describe('usage-charges-append: the plan', () => {
  it('takes the recorded workspace and switches the wallet part off', () => {
    expect(appendSettings({ workspaceId: 'ws-1' })).toEqual({ wallet: false, opening: null, workspaceId: 'ws-1' });
    expect(appendSettings({ workspaceId: null })).toEqual({ wallet: false, opening: null, workspaceId: null });
    expect(appendSettings(null).workspaceId).toBeNull();
  });

  it('needs no opening file and does not stop on two workspaces (the wallet part is where that matters)', async () => {
    const plan = await buildCreditsPlan({
      source: mem(dump),
      client: 't',
      settings: appendSettings({}),
      referenceAt: NOW,
    });
    expect(plan.opening).toBeNull();
    expect(plan.wallet.size).toBe(0);
    expect(plan.stats.usageRows).toBe(2);
    expect(plan.stats.usageDuplicates).toBe(1);
  });

  it('decides the billing log exactly as the first load did (same first-wins set, same months)', async () => {
    const a = await buildCreditsPlan({ source: mem(dump), client: 't', settings: settingsWallet, referenceAt: NOW });
    const b = await buildCreditsPlan({ source: mem(dump), client: 't', settings: appendSettings({ workspaceId: 'ws-1' }), referenceAt: NOW });
    expect([...b.usageFirst].sort()).toEqual([...a.usageFirst].sort());
    expect(b.months).toEqual(a.months);
    expect(b.stats.tokenRows).toBe(a.stats.tokenRows);
  });

  it('writes the same usage_charges and ai_token_usage rows with the wallet part on or off', async () => {
    const mk = async (s: CreditSettings): Promise<Ctx> =>
      ({
        client: 't',
        orgId: 1,
        credits: await buildCreditsPlan({ source: mem(dump), client: 't', settings: s, referenceAt: NOW }),
        ref: () => undefined,
      }) as unknown as Ctx;
    const on = await mk(settingsWallet);
    const off = await mk(appendSettings({ workspaceId: 'ws-1' }));
    for (const d of dump.whatsapp_broadcasting_data) {
      if (d.source === 'broadcast') continue;
      expect(usageCharges.transform(d, off)).toEqual(usageCharges.transform(d, on));
    }
    for (const d of dump.credit_logs) expect(creditTokens.transform(d, off)).toEqual(creditTokens.transform(d, on));
  });

  it('a charge is free and inert: no credits, no revenue, no wallet link; the billed amount stays exact text', async () => {
    const ctx = {
      client: 't',
      orgId: 1,
      credits: await buildCreditsPlan({ source: mem(dump), client: 't', settings: appendSettings({}), referenceAt: NOW }),
      ref: () => undefined,
    } as unknown as Ctx;
    const out = usageCharges.transform(dump.whatsapp_broadcasting_data[0]!, ctx);
    if (out.kind !== 'rows') throw new Error('expected rows');
    const row = out.rows[0]!.row;
    expect(row).toMatchObject({ provider: 'waba', wamid: 'wamid.1', category: 'marketing', status: 'free', credits: 0, revenue_minor: 0 });
    expect(JSON.parse(String(row.meta)).legacy.waboo).toMatchObject({ amount: '0.35', reseller_amount: '0.05', cost: '0.3' });
    expect(usageCharges.tables.usage_charges!.constants).toMatchObject({ wallet_tx_id: null, currency: null });
    // an unkeyable row is a counted quarantine, never a guess
    const bad = usageCharges.transform(dump.whatsapp_broadcasting_data[3]!, ctx);
    expect(bad).toMatchObject({ kind: 'quarantine', code: 'NO_MESSAGE_ID' });
  });
});

describe('usage-charges-append: the side-effect guard', () => {
  it('names exactly the tables whose rows changed', () => {
    const before = { wallet_transactions: ['a', 'b'], wallets: ['w'], event_outbox: [] as string[] };
    expect(changedTables(before, { ...before })).toEqual([]);
    expect(changedTables(before, { ...before, wallets: ['w2'] })).toEqual(['wallets']);
    expect(changedTables(before, { ...before, event_outbox: ['x'], wallet_transactions: ['a'] })).toEqual([
      'event_outbox',
      'wallet_transactions',
    ]);
    // a table that had no rows and has none is not "present on one side only"
    expect(changedTables({}, { notifications: [] })).toEqual([]);
  });
});
