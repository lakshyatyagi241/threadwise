import { describe, expect, it } from 'vitest';
import { readWabaEnv } from '../../../src/config/domains/whatsapp-cloud-api-waba.env';
import { WabaConfigService } from '../../../src/modules/whatsapp-cloud-api-waba/waba-config.service';

const saved = (
  over: Record<string, unknown>,
  secrets: Record<string, string | null> = {},
  isSaved = true,
) => ({
  isSaved: async () => isSaved,
  values: async () => ({
    appId: '',
    configId: '',
    coexistence: false,
    graphVersion: '',
    defaultProvider: 'interakt',
    solutionId: '',
    systemUserId: '',
    businessId: '',
    requireSignature: false,
    ...over,
  }),
  secret: async (_g: string, f: string) => secrets[f] ?? null,
});

const make = (envRaw: Record<string, unknown>, settings: ReturnType<typeof saved>) => {
  const env = readWabaEnv(envRaw);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new WabaConfigService(env, settings as any);
  return { env, svc };
};

describe('WabaConfigService (WD-WABA-001)', () => {
  it('leaves the environment alone when nothing is saved', async () => {
    const { env, svc } = make({ META_APP_ID: '111' }, saved({ appId: '999' }, {}, false));
    await svc.refresh();
    expect(env.META_APP_ID).toBe('111');
  });

  it('a saved non-empty value wins over the environment; a blank one falls back to it', async () => {
    const { env, svc } = make(
      { META_APP_ID: '111', META_EMBEDDED_CONFIG_ID: '555', META_API_VERSION: 'v24.0' },
      saved({ appId: '222', configId: '', graphVersion: 'v26.0' }, { appSecret: 'sek' }),
    );
    await svc.refresh();
    expect(env.META_APP_ID).toBe('222');
    expect(env.META_EMBEDDED_CONFIG_ID).toBe('555');
    expect(env.META_API_VERSION).toBe('v26.0');
    expect(env.INTERAKT_API_VERSION).toBe('v26.0');
    expect(env.META_APP_SECRET).toBe('sek');
  });

  it('applies secrets and the verify token, and clearing a saved value restores the environment', async () => {
    const settings = saved({ appId: '222' }, { verifyToken: 'handshake', partnerAuthKey: 'pk' });
    const { env, svc } = make(
      { META_APP_ID: '111', INTERAKT_PARTNER_AUTH_KEY: 'envkey' },
      settings,
    );
    await svc.refresh();
    expect(env.WABA_VERIFY_TOKEN).toBe('handshake');
    expect(env.INTERAKT_PARTNER_AUTH_KEY).toBe('pk');

    settings.values = saved({ appId: '' }).values;
    settings.secret = async () => null;
    await svc.refresh();
    expect(env.META_APP_ID).toBe('111');
    expect(env.INTERAKT_PARTNER_AUTH_KEY).toBe('envkey');
    expect(env.WABA_VERIFY_TOKEN).toBeUndefined();
  });

  it('a saved page decides coexistence and the default route; an env signature requirement is never loosened', async () => {
    const { env, svc } = make(
      { WABA_REQUIRE_INTERAKT_SIGNATURE: 'true', WABA_DEFAULT_PROVIDER: 'interakt' },
      saved({ coexistence: true, defaultProvider: 'meta', requireSignature: false }),
    );
    await svc.refresh();
    expect(env.WABA_COEXISTENCE).toBe(true);
    expect(env.WABA_DEFAULT_PROVIDER).toBe('meta');
    expect(env.WABA_REQUIRE_INTERAKT_SIGNATURE).toBe(true);
  });

  it('keeps what is in memory when the settings store fails', async () => {
    const { env, svc } = make(
      { META_APP_ID: '111' },
      {
        ...saved({}),
        isSaved: async () => {
          throw new Error('db down');
        },
      },
    );
    await expect(svc.refresh()).resolves.toBeUndefined();
    expect(env.META_APP_ID).toBe('111');
  });
});
