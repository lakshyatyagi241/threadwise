import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, UNOFFICIAL_WHATSAPP_FEATURE_KEY } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { BillingService } from '../../../src/modules/plans-subscriptions-trials/billing.service';
import { PlatformSettingsService } from '../../../src/modules/auth/platform/platform-settings.service';
import {
  UnofficialWhatsappSwitch,
  UNOFFICIAL_WHATSAPP_KEY,
} from '../../../src/modules/auth/platform/unofficial-whatsapp-switch';
import { SenderResolver } from '../../../src/modules/node-bridge-runtime/outbound/sender-resolver.service';
import { SqlSenderDirectory } from '../../../src/modules/broadcasts/_shims/sql-sender-directory';
import { BaileysTransport } from '../../../src/modules/node-bridge-runtime/outbound/baileys.transport';
import { gate, GATE_OFF, GATE_ON } from '../../support/unofficial-gate';

/** A PlatformStore whose one table holds `rows`; counts how many times the table was read. */
function store(rows: Array<{ key: string; value: unknown }>) {
  const reads = { n: 0 };
  const fake = {
    tx: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: async () => {
          reads.n++;
          return { rows: rows.map((r) => ({ ...r, is_secret: false })) };
        },
      }),
  };
  return { svc: new PlatformSettingsService(fake as never, {} as never), reads };
}

/** A PlatformStore whose allow-list table holds `orgIds`; counts reads. */
function allowStore(orgIds: number[]) {
  const reads = { n: 0 };
  const ids = [...orgIds];
  const fake = {
    tx: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: async () => {
          reads.n++;
          return { rows: ids.map((org_id) => ({ org_id, n: ids.length })) };
        },
      }),
  };
  return { fake: fake as never, reads, ids };
}

const makeSwitch = (platform: unknown, orgIds: number[] = []) => {
  const { svc } = store(
    platform === undefined ? [] : [{ key: UNOFFICIAL_WHATSAPP_KEY, value: platform }],
  );
  const allow = allowStore(orgIds);
  return { sw: new UnofficialWhatsappSwitch(svc, allow.fake), svc, ...allow };
};

describe('UnofficialWhatsappSwitch (platform level)', () => {
  it('is OFF when nothing is stored', async () => {
    expect(await makeSwitch(undefined).sw.isEnabled()).toBe(false);
  });

  it('is on only for a stored JSON true; false, strings and numbers stay off', async () => {
    for (const [value, want] of [
      [true, true],
      [false, false],
      ['true', false],
      [1, false],
      [null, false],
    ] as const) {
      expect(await makeSwitch(value).sw.isEnabled(), String(value)).toBe(want);
    }
  });

  it('assertEnabled refuses with WA_UNOFFICIAL_DISABLED (422) while off and passes while on', async () => {
    await expect(makeSwitch(undefined).sw.assertEnabled()).rejects.toMatchObject({
      code: ERROR_CODES.WA_UNOFFICIAL_DISABLED,
      status: 422,
    });
    await expect(makeSwitch(true).sw.assertEnabled()).resolves.toBeUndefined();
  });

  it('reads the table once inside the 5 s window and again after a write drops the snapshot', async () => {
    const { svc, reads } = store([{ key: UNOFFICIAL_WHATSAPP_KEY, value: true }]);
    const sw = new UnofficialWhatsappSwitch(svc, allowStore([]).fake);
    await sw.isEnabled();
    await sw.isEnabled();
    await sw.isEnabled();
    expect(reads.n).toBe(1);
    svc.invalidate();
    await sw.isEnabled();
    expect(reads.n).toBe(2);
  });
});

describe('UnofficialWhatsappSwitch (per workspace)', () => {
  it('platform off: nobody, even a listed workspace', async () => {
    const { sw } = makeSwitch(undefined, [1, 2]);
    expect(await sw.isEnabledFor(1)).toBe(false);
    expect(await sw.isEnabledFor(2)).toBe(false);
    expect([...(await sw.enabledOrgIds())]).toEqual([]);
  });

  it('platform on but the workspace is not listed: off; listed: on', async () => {
    const { sw } = makeSwitch(true, [1]);
    expect(await sw.isEnabledFor(1)).toBe(true);
    expect(await sw.isEnabledFor(2)).toBe(false);
    expect([...(await sw.enabledOrgIds())]).toEqual([1]);
  });

  it('assertEnabledFor throws the 422 WA_UNOFFICIAL_DISABLED for an unlisted workspace and passes for a listed one', async () => {
    const { sw } = makeSwitch(true, [1]);
    await expect(sw.assertEnabledFor(1)).resolves.toBeUndefined();
    await expect(sw.assertEnabledFor(2)).rejects.toMatchObject({
      code: ERROR_CODES.WA_UNOFFICIAL_DISABLED,
      status: 422,
    });
    await expect(makeSwitch(false, [1]).sw.assertEnabledFor(1)).rejects.toMatchObject({
      code: ERROR_CODES.WA_UNOFFICIAL_DISABLED,
    });
  });

  it('a nobody-listed platform with the switch on allows nobody (the default after the owner decision)', async () => {
    const { sw } = makeSwitch(true, []);
    expect(await sw.isEnabledFor(1)).toBe(false);
  });

  it('caches the allow-list inside the window for every workspace and re-reads after invalidateAllowList', async () => {
    const { sw, reads, ids } = makeSwitch(true, [1]);
    await sw.isEnabledFor(1);
    await sw.isEnabledFor(2);
    await sw.isEnabledFor(3);
    expect(reads.n).toBe(1);
    ids.push(2);
    expect(await sw.isEnabledFor(2)).toBe(false); // still the cached list
    sw.invalidateAllowList();
    expect(await sw.isEnabledFor(2)).toBe(true);
    expect(reads.n).toBe(2);
  });

  it('a read that was in flight when the list was invalidated does not overwrite the fresh read', async () => {
    const { svc } = store([{ key: UNOFFICIAL_WHATSAPP_KEY, value: true }]);
    let release: (() => void) | undefined;
    let call = 0;
    const slowThenFresh = {
      tx: async (fn: (tx: unknown) => Promise<unknown>) => {
        const mine = ++call;
        if (mine === 1) await new Promise<void>((r) => (release = r));
        return fn({ execute: async () => ({ rows: mine === 1 ? [] : [{ org_id: 5 }] }) });
      },
    };
    const sw = new UnofficialWhatsappSwitch(svc, slowThenFresh as never);
    const stale = sw.isEnabledFor(5); // first read starts and waits
    await new Promise((r) => setTimeout(r, 5));
    sw.invalidateAllowList(); // a write landed
    expect(await sw.isEnabledFor(5)).toBe(true); // a fresh read sees it
    release?.();
    await stale;
    expect(await sw.isEnabledFor(5)).toBe(true); // the stale result was not cached over it
  });

  it('allowedCount reads fresh', async () => {
    const { sw } = makeSwitch(false, [1, 2, 3]);
    expect(await sw.allowedCount()).toBe(3);
  });
});

/** A transaction that records the SQL it was given and answers every query with `rows`. */
function tx(rows: unknown[] = []) {
  const seen: string[] = [];
  return {
    seen,
    tx: {
      execute: async (q: { queryChunks?: unknown[] }) => {
        seen.push(JSON.stringify(q.queryChunks ?? q));
        return { rows };
      },
    } as never,
  };
}

describe('SenderResolver with the switch off', () => {
  it('a blank provider resolves to the Cloud API, never to devices', async () => {
    const t = tx([{ id: 7, phone_number: '+919800000001', label: 'WABA' }]);
    const sender = await new SenderResolver(GATE_OFF).resolve(t.tx, 1, {
      provider: null,
      deviceId: null,
    });
    expect(sender).toMatchObject({ engine: 'waba', id: 7 });
    expect(t.seen.join('')).toContain('wa_provider_configs');
    expect(t.seen.join('')).not.toContain('FROM devices');
  });

  it('a row that names baileys has no sender, and the devices table is not read', async () => {
    const t = tx([{ id: 3, phone_number: '9800000001', label: 'Phone' }]);
    expect(
      await new SenderResolver(GATE_OFF).resolve(t.tx, 1, { provider: 'baileys', deviceId: 3 }),
    ).toBeNull();
    expect(t.seen).toHaveLength(0);
  });

  it('with the switch on a blank provider is still the unofficial engine, as in Reference', async () => {
    const t = tx([{ id: 3, country_code: '91', phone_number: '9800000001', label: 'Phone' }]);
    const sender = await new SenderResolver(GATE_ON).resolve(t.tx, 1, {
      provider: null,
      deviceId: null,
    });
    expect(sender).toMatchObject({ engine: 'baileys', id: 3 });
  });
});

const UUID = '3f1c2d4e-5a6b-4c7d-8e9f-a0b1c2d3e4f5';

describe('the broadcast sender directory with the switch off', () => {
  it('drops a baileys key and keeps a Cloud API key', async () => {
    const t = tx([{ id: 9, label: 'Meta' }]);
    const dir = new SqlSenderDirectory(GATE_OFF);
    const out = await dir.resolve(t.tx, 1, [`baileys:${UUID}`, `waba:${UUID}`]);
    expect(out.map((s) => s.key)).toEqual([`waba:${UUID}`]);
    expect(t.seen.join('')).not.toContain('FROM devices');
  });

  it('the default engine is waba when nothing is set or when the workspace stored baileys', async () => {
    const dir = new SqlSenderDirectory(GATE_OFF);
    expect(await dir.defaultEngine(tx([]).tx, 1)).toBe('waba');
    expect(await dir.defaultEngine(tx([{ default_engine: 'baileys' }]).tx, 1)).toBe('waba');
    expect(await dir.defaultEngine(tx([{ default_engine: 'twilio' }]).tx, 1)).toBe('twilio');
  });

  it('the default engine stays baileys for an empty setting when the switch is on', async () => {
    expect(await new SqlSenderDirectory(GATE_ON).defaultEngine(tx([]).tx, 1)).toBe('baileys');
  });

  it('a stored broadcast naming baileys has no sender; a blank one goes to the Cloud API', async () => {
    const dir = new SqlSenderDirectory(GATE_OFF);
    expect(
      await dir.resolveForDispatch(tx([{ id: 1 }]).tx, 1, { provider: 'baileys', deviceId: 1 }),
    ).toBeNull();
    const t = tx([{ id: 4, phone_number: '+919800000002', label: 'Meta' }]);
    expect(await dir.resolveForDispatch(t.tx, 1, { provider: null, deviceId: null })).toMatchObject(
      { engine: 'waba', id: 4 },
    );
  });
});

describe('BaileysTransport', () => {
  it('refuses to open while the switch is off, before it touches the device control', async () => {
    const control = { sendMessage: vi.fn() };
    const registry = { register: vi.fn() };
    const transport = new BaileysTransport(registry as never, control as never, GATE_OFF);
    await expect(
      transport.open(1, { engine: 'baileys', id: 1, phoneDigits: '91', label: 'x' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.WA_UNOFFICIAL_DISABLED });
    expect(control.sendMessage).not.toHaveBeenCalled();
  });

  it('opens while on', async () => {
    const transport = new BaileysTransport({ register: vi.fn() } as never, {} as never, gate(true));
    await expect(
      transport.open(1, { engine: 'baileys', id: 1, phoneDigits: '91', label: 'x' }),
    ).resolves.toHaveProperty('send');
  });
});

describe("per-workspace decisions use the row's own workspace", () => {
  it('SenderResolver: a blank provider is baileys for the allowed workspace and the Cloud API for the other', async () => {
    const g = gate(true, [1]);
    const dev = tx([{ id: 3, country_code: '91', phone_number: '9800000001', label: 'Phone' }]);
    expect(
      await new SenderResolver(g).resolve(dev.tx, 1, { provider: null, deviceId: null }),
    ).toMatchObject({ engine: 'baileys', id: 3 });
    const other = tx([{ id: 7, phone_number: '+919800000001', label: 'WABA' }]);
    expect(
      await new SenderResolver(g).resolve(other.tx, 2, { provider: null, deviceId: null }),
    ).toMatchObject({ engine: 'waba', id: 7 });
    expect(other.seen.join('')).not.toContain('FROM devices');
    const named = tx([{ id: 3 }]);
    expect(
      await new SenderResolver(g).resolve(named.tx, 2, { provider: 'baileys', deviceId: 3 }),
    ).toBeNull();
    expect(named.seen).toHaveLength(0);
  });

  it('the broadcast directory drops a baileys key for the workspace that is not allowed only', async () => {
    const dir = new SqlSenderDirectory(gate(true, [1]));
    const t1 = tx([{ id: 9, label: 'Phone' }]);
    expect((await dir.resolve(t1.tx, 1, [`baileys:${UUID}`])).map((s) => s.key)).toEqual([
      `baileys:${UUID}`,
    ]);
    const t2 = tx([{ id: 9, label: 'Phone' }]);
    expect(await dir.resolve(t2.tx, 2, [`baileys:${UUID}`])).toEqual([]);
    expect(await dir.defaultEngine(tx([]).tx, 2)).toBe('waba');
    expect(await dir.defaultEngine(tx([]).tx, 1)).toBe('baileys');
  });

  it('BaileysTransport opens for the allowed workspace and refuses the other', async () => {
    const transport = new BaileysTransport(
      { register: vi.fn() } as never,
      { sendMessage: vi.fn() } as never,
      gate(true, [1]),
    );
    const sender = { engine: 'baileys', id: 1, phoneDigits: '91', label: 'x' } as const;
    await expect(transport.open(1, sender)).resolves.toHaveProperty('send');
    await expect(transport.open(2, sender)).rejects.toMatchObject({
      code: ERROR_CODES.WA_UNOFFICIAL_DISABLED,
    });
  });

  it('entitlements carry unofficial_whatsapp only when the platform switch is on AND the workspace is allowed', async () => {
    const make = (g: ReturnType<typeof gate>) => {
      const svc = new BillingService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        g,
      );
      (svc as unknown as { mustResolve: () => Promise<unknown> }).mustResolve = async () => ({
        platformOwned: true, // no special treatment for a platform-owned workspace (owner decision 2026-10-06)
      });
      return svc;
    };
    const keys = (org: number, g: ReturnType<typeof gate>) =>
      RequestContextStore.run(
        {
          requestId: 'r',
          orgId: org,
          actorType: 'user',
          actorId: 1,
          userId: 1,
          grants: [],
        } as never,
        async () => (await make(g).entitlementKeys()).features,
      );
    expect(await keys(1, gate(true, [1]))).toContain(UNOFFICIAL_WHATSAPP_FEATURE_KEY);
    expect(await keys(2, gate(true, [1]))).not.toContain(UNOFFICIAL_WHATSAPP_FEATURE_KEY);
    expect(await keys(1, gate(false, [1]))).not.toContain(UNOFFICIAL_WHATSAPP_FEATURE_KEY);
    expect(await keys(1, gate(true, []))).not.toContain(UNOFFICIAL_WHATSAPP_FEATURE_KEY);
  });
});
