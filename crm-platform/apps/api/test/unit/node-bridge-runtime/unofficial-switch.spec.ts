import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
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

describe('UnofficialWhatsappSwitch', () => {
  it('is OFF when nothing is stored', async () => {
    const { svc } = store([]);
    expect(await new UnofficialWhatsappSwitch(svc).isEnabled()).toBe(false);
  });

  it('is on only for a stored JSON true; false, strings and numbers stay off', async () => {
    for (const [value, want] of [
      [true, true],
      [false, false],
      ['true', false],
      [1, false],
      [null, false],
    ] as const) {
      const { svc } = store([{ key: UNOFFICIAL_WHATSAPP_KEY, value }]);
      expect(await new UnofficialWhatsappSwitch(svc).isEnabled(), String(value)).toBe(want);
    }
  });

  it('assertEnabled refuses with WA_UNOFFICIAL_DISABLED (422) while off and passes while on', async () => {
    const off = new UnofficialWhatsappSwitch(store([]).svc);
    await expect(off.assertEnabled()).rejects.toMatchObject({
      code: ERROR_CODES.WA_UNOFFICIAL_DISABLED,
      status: 422,
    });
    const on = new UnofficialWhatsappSwitch(
      store([{ key: UNOFFICIAL_WHATSAPP_KEY, value: true }]).svc,
    );
    await expect(on.assertEnabled()).resolves.toBeUndefined();
  });

  it('reads the table once inside the 5 s window and again after a write drops the snapshot', async () => {
    const { svc, reads } = store([{ key: UNOFFICIAL_WHATSAPP_KEY, value: true }]);
    const sw = new UnofficialWhatsappSwitch(svc);
    await sw.isEnabled();
    await sw.isEnabled();
    await sw.isEnabled();
    expect(reads.n).toBe(1);
    svc.invalidate();
    await sw.isEnabled();
    expect(reads.n).toBe(2);
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

  it('with the switch on a blank provider is still the unofficial engine, as in WaDesk', async () => {
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
