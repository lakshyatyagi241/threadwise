import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { OtpSenderView } from '@crm/contracts';
import { OtpSenderRegistryService } from '../../../src/modules/auth/platform/otp-sender-registry.service';

class FakeSettings {
  docs = new Map<string, unknown>();
  secrets = new Map<string, string>();
  async get<T>(key: string) {
    return this.docs.get(key) as T | undefined;
  }
  async set(key: string, value: unknown) {
    this.docs.set(key, JSON.parse(JSON.stringify(value)));
  }
  async setSecret(key: string, v: string) {
    this.secrets.set(key, v);
  }
  async clearSecret(key: string) {
    this.secrets.delete(key);
  }
  async hasSecret(key: string) {
    return this.secrets.has(key);
  }
  async getSecret(key: string) {
    return this.secrets.get(key) ?? null;
  }
}

const make = (env = 'test') => {
  const settings = new FakeSettings();
  const config = { get: () => env } as unknown as ConfigService<never, true>;
  return { settings, registry: new OtpSenderRegistryService(settings as never, config as never) };
};
const refOf = (s: OtpSenderView) => `${s.kind}:${s.id}`;

describe('OTP sender registry', () => {
  it('creates a sender, stores its secret apart and never returns it', async () => {
    const { registry, settings } = make();
    const { sender } = await registry.create(
      {
        kind: 'waba',
        label: 'Main number',
        phoneNumberId: '100200300',
        wabaId: '555666777',
        secret: 'EAAG-the-token',
      },
      1,
    );
    expect(sender).toMatchObject({
      kind: 'waba',
      graphBaseUrl: 'https://graph.facebook.com/v23.0',
      hasSecret: true,
    });
    expect(JSON.stringify(sender)).not.toContain('EAAG-the-token');
    expect(JSON.stringify(await registry.list())).not.toContain('EAAG-the-token');
    expect(JSON.stringify(settings.docs.get('otp.senders'))).not.toContain('EAAG-the-token');
    expect(settings.secrets.get(`otp.sender.${sender.id}.secret`)).toBe('EAAG-the-token');
    expect(sender.id).toMatch(/^[a-z0-9]{8}$/);
  });

  it('normalises numbers and strips trailing slashes from addresses', async () => {
    const { registry } = make();
    const t = (
      await registry.create(
        {
          kind: 'twilio',
          label: 'T',
          accountSid: 'AC' + 'b'.repeat(32),
          fromNumber: '+1 (415) 523-8886',
          apiBaseUrl: 'https://api.example.test/',
          secret: 's3cret',
        },
        1,
      )
    ).sender;
    expect(t).toMatchObject({ fromNumber: '+14155238886', apiBaseUrl: 'https://api.example.test' });
    const d = (
      await registry.create(
        {
          kind: 'device',
          label: 'D',
          bridgeUrl: 'http://127.0.0.1:3003/',
          senderNumber: '+91 90000 00001',
          secret: 'tok',
        },
        1,
      )
    ).sender;
    expect(d).toMatchObject({ bridgeUrl: 'http://127.0.0.1:3003', senderNumber: '919000000001' });
  });

  it('refuses addresses with credentials, cloud-metadata hosts and a bad scheme', async () => {
    const { registry } = make();
    const create = (bridgeUrl: string) =>
      registry.create(
        { kind: 'device', label: 'D', bridgeUrl, senderNumber: '919000000001', secret: 'tok' },
        1,
      );
    await expect(create('http://user:pw@127.0.0.1:3003')).rejects.toThrow();
    await expect(create('http://169.254.169.254/latest')).rejects.toThrow();
    await expect(create('ftp://host/x')).rejects.toThrow();
    await expect(create('not a url')).rejects.toThrow();
    expect(await registry.list()).toEqual([]);
  });

  it('requires https for Meta and Twilio addresses in production, but not for the bridge', async () => {
    const { registry } = make('production');
    await expect(
      registry.create(
        {
          kind: 'waba',
          label: 'W',
          phoneNumberId: '100200300',
          wabaId: '555666777',
          graphBaseUrl: 'http://graph.example.test',
          secret: 't',
        },
        1,
      ),
    ).rejects.toThrow(/https/);
    await expect(
      registry.create(
        {
          kind: 'device',
          label: 'D',
          bridgeUrl: 'http://10.0.0.5:3003',
          senderNumber: '919000000001',
          secret: 't',
        },
        1,
      ),
    ).resolves.toBeTruthy();
  });

  it('allows the dev (log) sender only outside production', async () => {
    const dev = make('development');
    const created = (await dev.registry.create({ kind: 'dev', label: 'Log' }, 1)).sender;
    expect(await dev.registry.stateOf(refOf(created))).toBe('ok');
    expect(dev.registry.devAllowed).toBe(true);

    const prod = make('production');
    await expect(prod.registry.create({ kind: 'dev', label: 'Log' }, 1)).rejects.toThrow(
      /production/,
    );
    // a leftover entry from before is refused too
    prod.settings.docs.set('otp.senders', { senders: [{ id: 'log', kind: 'dev', label: 'Log' }] });
    expect(await prod.registry.stateOf('dev:log')).toBe('dev_in_production');
    expect(await prod.registry.resolve('dev:log')).toBeNull();
  });

  it('keeps the stored secret when an update leaves it blank, replaces it, and clears it on request', async () => {
    const { registry, settings } = make();
    const { sender } = await registry.create(
      {
        kind: 'device',
        label: 'D',
        bridgeUrl: 'http://127.0.0.1:1',
        senderNumber: '919000000001',
        secret: 'first',
      },
      1,
    );
    const key = `otp.sender.${sender.id}.secret`;

    const blank = await registry.update(sender.id, { label: 'Renamed', secret: '   ' }, 1);
    expect(blank.changed).toEqual(['label']);
    expect(settings.secrets.get(key)).toBe('first');

    await registry.update(sender.id, { secret: 'second' }, 1);
    expect(settings.secrets.get(key)).toBe('second');

    const cleared = await registry.update(sender.id, { clearSecret: true }, 1);
    expect(cleared.sender.hasSecret).toBe(false);
    expect(await registry.stateOf(refOf(sender))).toBe('incomplete');
    expect(await registry.resolve(refOf(sender))).toBeNull();
  });

  it("rejects a field that is not of the sender's kind", async () => {
    const { registry } = make();
    const { sender } = await registry.create(
      {
        kind: 'device',
        label: 'D',
        bridgeUrl: 'http://127.0.0.1:1',
        senderNumber: '919000000001',
        secret: 'x',
      },
      1,
    );
    await expect(registry.update(sender.id, { wabaId: '12345' }, 1)).rejects.toThrow(
      /not a field/i,
    );
    await expect(registry.update('nope', { label: 'x' }, 1)).rejects.toThrow(/not found/i);
  });

  it('resolves a complete sender with its secret, and nothing for a missing or wrong-kind ref', async () => {
    const { registry } = make();
    const { sender } = await registry.create(
      {
        kind: 'device',
        label: 'D',
        bridgeUrl: 'http://127.0.0.1:1',
        senderNumber: '919000000001',
        secret: 'tok',
      },
      1,
    );
    expect(await registry.resolve(refOf(sender))).toMatchObject({
      kind: 'device',
      bridgeUrl: 'http://127.0.0.1:1',
      token: 'tok',
    });
    expect(await registry.resolve(`waba:${sender.id}`)).toBeNull();
    expect(await registry.resolve('device:zzzz')).toBeNull();
    expect(await registry.resolve(null)).toBeNull();
    expect(await registry.stateOf('garbage')).toBe('missing');
  });

  it('removes the sender together with its secret', async () => {
    const { registry, settings } = make();
    const { sender } = await registry.create(
      {
        kind: 'device',
        label: 'D',
        bridgeUrl: 'http://127.0.0.1:1',
        senderNumber: '919000000001',
        secret: 'tok',
      },
      1,
    );
    await registry.remove(sender.id, 1);
    expect(await registry.list()).toEqual([]);
    expect(settings.secrets.size).toBe(0);
    await expect(registry.remove(sender.id, 1)).rejects.toThrow(/not found/i);
  });
});
