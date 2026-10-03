import { describe, expect, it } from 'vitest';
import { renderHeaderTemplates } from '@crm/contracts';
import { readWabaEnv } from '../../../src/config/domains/whatsapp-cloud-api-waba.env';
import { authOf } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import {
  WabaHttp,
  type FetchLike,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';
import {
  providerKeyOf,
  WabaRegistryRoutes,
  type WabaRegistryProvider,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-registry-routes';

const provider = (over: Partial<WabaRegistryProvider> = {}): WabaRegistryProvider => ({
  key: 'pinnacle',
  builtin: null,
  status: 'active',
  baseUrl: 'https://api.pinnacle.io/wa/',
  apiVersion: 'v24.0',
  authScheme: 'custom_headers',
  headerTemplates: {
    'x-api-key': '{{providerToken}}',
    'x-waba-id': '{{wabaId}}',
    'x-phone-number-id': '{{phoneNumberId}}',
  },
  credentialMode: 'platform_token',
  webhookMode: 'number_level_override',
  signatureScheme: 'meta_app_secret_sha256',
  signatureHeaderName: null,
  capabilities: { mediaUpload: true },
  providerToken: 'partner-token-1234',
  ...over,
});

const routes = (...p: WabaRegistryProvider[]) => {
  const r = new WabaRegistryRoutes();
  r.replace(p);
  return r;
};

describe('header templates', () => {
  it('render the connection’s own values into the provider’s own header names', () => {
    expect(
      renderHeaderTemplates(provider().headerTemplates, {
        providerToken: 'partner-token-1234',
        wabaId: '100200',
        phoneNumberId: '555',
      }),
    ).toEqual({
      'x-api-key': 'partner-token-1234',
      'x-waba-id': '100200',
      'x-phone-number-id': '555',
    });
  });

  it('leave out a header whose value is not known on this call instead of sending a literal placeholder', () => {
    expect(
      renderHeaderTemplates(provider().headerTemplates, {
        providerToken: 'partner-token-1234',
        wabaId: '100200',
      }),
    ).toEqual({ 'x-api-key': 'partner-token-1234', 'x-waba-id': '100200' });
  });

  it('refuse a value that could forge a header (a line break in a token)', () => {
    expect(() =>
      renderHeaderTemplates(provider().headerTemplates, {
        providerToken: 'tok\r\nx-evil: 1',
        wabaId: '1',
      }),
    ).toThrow();
  });
});

describe('the route of a connection on a registry provider', () => {
  const values = { wabaId: '100200', phoneNumberId: '555', accessToken: 'number-token-9999' };

  it('platform token mode: the provider’s token and the number’s ids, address and version of the provider', () => {
    const auth = routes(provider()).authFor('pinnacle', values)!;
    expect(auth).toMatchObject({
      provider: 'registry',
      providerKey: 'pinnacle',
      baseUrl: 'https://api.pinnacle.io/wa',
      apiVersion: 'v24.0',
      credentialMode: 'platform_token',
      webhookMode: 'number_level_override',
      headers: {
        'x-api-key': 'partner-token-1234',
        'x-waba-id': '100200',
        'x-phone-number-id': '555',
      },
    });
    // The number's own token is not the credential in this mode.
    expect(JSON.stringify(auth)).not.toContain('number-token-9999');
  });

  it('channel token mode with the bearer scheme: the number’s own token', () => {
    const auth = routes(
      provider({
        credentialMode: 'channel_token',
        authScheme: 'bearer',
        headerTemplates: {},
        providerToken: undefined,
      }),
    ).authFor('pinnacle', values)!;
    expect(auth.headers).toEqual({ authorization: 'Bearer number-token-9999' });
  });

  it('channel token mode with custom headers: {{channelToken}} is the number’s token', () => {
    const auth = routes(
      provider({
        credentialMode: 'channel_token',
        headerTemplates: { 'x-token': '{{channelToken}}', 'x-waba-id': '{{wabaId}}' },
      }),
    ).authFor('pinnacle', values)!;
    expect(auth.headers).toEqual({ 'x-token': 'number-token-9999', 'x-waba-id': '100200' });
  });

  it('has no route when the credential its mode needs is missing', () => {
    expect(routes(provider({ providerToken: undefined })).authFor('pinnacle', values)).toBeNull();
    expect(
      routes(provider({ credentialMode: 'channel_token', authScheme: 'bearer' })).authFor(
        'pinnacle',
        {
          wabaId: '1',
        },
      ),
    ).toBeNull();
  });

  it('has no route for an unknown or archived provider, and never routes the built-in keys from the registry', () => {
    expect(routes().authFor('pinnacle', values)).toBeNull();
    expect(routes(provider({ status: 'archived' })).authFor('pinnacle', values)).toBeNull();
    expect(routes(provider({ key: 'meta', builtin: 'meta' })).authFor('meta', values)).toBeNull();
    expect(
      routes(provider({ key: 'interakt', builtin: 'interakt' })).authFor('interakt', values),
    ).toBeNull();
  });

  it('a DISABLED provider still routes: disabling must not stop the numbers already on it', () => {
    expect(routes(provider({ status: 'disabled' })).authFor('pinnacle', values)).not.toBeNull();
  });

  it('refuses to forge a header from a token that holds a line break', () => {
    expect(routes(provider({ providerToken: 'a\r\nb' })).authFor('pinnacle', values)).toBeNull();
  });

  it('connection authOf returns the registry route when there is one', () => {
    const registry = routes(provider()).authFor('pinnacle', values)!;
    expect(authOf({ provider: 'meta', wabaId: '1', phoneNumberId: '2', registry })).toBe(registry);
    expect(authOf({ provider: 'meta', wabaId: '1', phoneNumberId: '2', accessToken: 't' })).toEqual(
      {
        provider: 'meta',
        accessToken: 't',
      },
    );
  });

  it('collects the verify tokens of non-archived registry providers for the GET handshake', () => {
    const r = routes(
      provider({ verifyToken: 'verify-pinnacle' }),
      provider({ key: 'gone', status: 'archived', verifyToken: 'verify-gone' }),
      provider({ key: 'meta', builtin: 'meta', verifyToken: 'verify-builtin' }),
    );
    expect(r.verifyTokens()).toEqual(['verify-pinnacle']);
  });
});

describe('a connection’s provider key', () => {
  it('is meta_json.provider_key, else the legacy provider value', () => {
    expect(providerKeyOf({ provider_key: 'pinnacle', provider: 'meta' })).toBe('pinnacle');
    expect(providerKeyOf({ provider: 'interakt' })).toBe('interakt');
    expect(providerKeyOf({ provider: 'meta' })).toBe('meta');
    // Rows from the manual connect predate both and were direct.
    expect(providerKeyOf({})).toBe('meta');
    expect(providerKeyOf(null)).toBe('meta');
    expect(providerKeyOf({ provider_key: '', provider: 'interakt' })).toBe('interakt');
  });
});

describe('WabaHttp through a registry route', () => {
  const make = (guard?: (url: string) => Promise<void>) => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const http = new WabaHttp(readWabaEnv({}));
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, headers: init?.headers as Record<string, string> });
      return new Response('{"ok":true}', { status: 200 });
    };
    http.fetchImpl = fetchImpl;
    if (guard) http.assertProviderUrl = guard;
    return { http, calls };
  };
  const auth = routes(provider()).authFor('pinnacle', { wabaId: '100200', phoneNumberId: '555' })!;

  it('sends to the provider’s address and version with its rendered headers, nothing from Meta or Interakt', async () => {
    const { http, calls } = make(async () => undefined);
    await http.call(auth, { method: 'GET', path: '/555/messages', query: { fields: 'id' } });
    expect(calls[0]!.url).toBe('https://api.pinnacle.io/wa/v24.0/555/messages?fields=id');
    expect(calls[0]!.headers).toMatchObject({
      'x-api-key': 'partner-token-1234',
      'x-waba-id': '100200',
    });
    expect(calls[0]!.headers.authorization).toBeUndefined();
  });

  it('honours a per-call API version', async () => {
    const { http, calls } = make(async () => undefined);
    await http.call(auth, { method: 'GET', path: '/x', apiVersion: 'v17.0' });
    expect(calls[0]!.url).toBe('https://api.pinnacle.io/wa/v17.0/x');
  });

  it('checks the address before every call and sends nothing when it is refused', async () => {
    const { http, calls } = make(async () => {
      throw new Error('refused');
    });
    await expect(http.call(auth, { method: 'GET', path: '/x' })).rejects.toThrow('refused');
    expect(calls).toHaveLength(0);
  });

  it('the built-in routes are not address-checked and keep their own headers', async () => {
    const { http, calls } = make(async () => {
      throw new Error('must not be called');
    });
    await http.call({ provider: 'meta', accessToken: 'tok' }, { method: 'GET', path: '/x' });
    await http.call(
      { provider: 'interakt', authKey: 'k', wabaId: 'w', phoneNumberId: 'p' },
      { method: 'GET', path: '/x' },
    );
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v25.0/x');
    expect(calls[0]!.headers.authorization).toBe('Bearer tok');
    expect(calls[1]!.url).toBe('https://amped-express.interakt.ai/api/v25.0/x');
    expect(calls[1]!.headers).toMatchObject({
      'x-access-token': 'k',
      'x-waba-id': 'w',
      'x-phone-number-id': 'p',
    });
  });
});
