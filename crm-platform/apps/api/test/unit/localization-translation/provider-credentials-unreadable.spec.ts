import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { ProviderCredentials } from '../../../src/modules/localization-translation/provider-credentials';
import { ProvidersAdminService } from '../../../src/modules/localization-translation/providers-admin.service';

const crypto = (fill: number) =>
  new CryptoService({
    get: () => Buffer.alloc(32, fill).toString('base64'),
  } as unknown as ConfigService<never, true>);

const sealed = (fill: number, json: string) => crypto(fill).encrypt(json);

const creds = (fill: number) => new ProviderCredentials(crypto(fill));

describe('stored translation credentials that cannot be read (#1270)', () => {
  it('readStored returns null for a value sealed under another key, and decrypt keeps the empty map for display', () => {
    const stored = sealed(7, JSON.stringify({ endpoint: 'https://t.example.com', api_key: 'k' }));
    const reader = creds(9);
    expect(reader.readStored('libretranslate', stored)).toBeNull();
    expect(reader.decrypt('libretranslate', stored)).toEqual({});
  });

  it('readStored returns the map when the value is readable, and an empty map when nothing is stored', () => {
    const stored = sealed(7, JSON.stringify({ api_key: 'k' }));
    expect(creds(7).readStored('deepl', stored)).toEqual({ api_key: 'k' });
    expect(creds(7).readStored('deepl', null)).toEqual({});
  });

  describe('ProvidersAdminService.update', () => {
    const row = (credentials: string | null) => ({
      uuid: 'u-1',
      slug: 'libretranslate',
      name: 'LibreTranslate',
      description: null,
      is_active: false,
      is_default: false,
      credentials,
      sort_order: 1,
      row_version: 3,
    });

    /** A fake transaction: the first statement is the locking read, the second the UPDATE. */
    const build = (credentials: string | null) => {
      const execute = vi
        .fn()
        .mockResolvedValueOnce({ rows: [row(credentials)] })
        .mockResolvedValue({ rows: [{ ...row(credentials), credentials: 'written' }] });
      const tx = { execute };
      const store = { tx: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
      const audit = { record: vi.fn().mockResolvedValue(undefined) };
      const settings = { get: vi.fn().mockResolvedValue(false) };
      const router = { invalidate: vi.fn() };
      const service = new ProvidersAdminService(
        store as never,
        audit as never,
        settings as never,
        creds(9),
        router as never,
      );
      return { service, execute, audit };
    };

    const run = <T>(fn: () => Promise<T>) => RequestContextStore.run({ actorId: 42 } as never, fn);

    it('refuses a partial write over unreadable stored secrets and issues no UPDATE', async () => {
      const { service, execute, audit } = build(
        sealed(7, JSON.stringify({ endpoint: 'https://t.example.com', api_key: 'old' })),
      );
      await expect(
        run(() =>
          service.update('u-1', { rowVersion: 3, credentials: { api_key: 'new' } } as never),
        ),
      ).rejects.toMatchObject({
        code: 'I18N_PROVIDER_CREDENTIALS_MISSING',
        status: 409,
      });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('accepts a full re-entry over unreadable secrets and writes the supplied map', async () => {
      const { service, execute } = build(sealed(7, JSON.stringify({ api_key: 'old' })));
      await run(() =>
        service.update('u-1', {
          rowVersion: 3,
          credentials: { endpoint: 'https://t.example.com', api_key: 'new' },
        } as never),
      );
      expect(execute).toHaveBeenCalledTimes(2);
    });
  });
});
