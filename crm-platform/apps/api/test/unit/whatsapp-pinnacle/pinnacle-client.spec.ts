import { describe, expect, it } from 'vitest';
import { readWabaEnv } from '../../../src/config/domains/whatsapp-cloud-api-waba.env';
import {
  PinnacleError,
  PinnaclePartnerClient,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/pinnacle-partner.client';
import {
  WabaHttp,
  type FetchLike,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';

const route = { baseUrl: 'https://partners.example-bsp.com', partnerKey: 'partner-key-1' };

function make(status: number, body: unknown) {
  const calls: Array<{ url: string; headers: Record<string, string>; json: unknown }> = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({
      url,
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      json: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(body), { status });
  };
  const http = new WabaHttp(readWabaEnv({}));
  http.fetchImpl = impl;
  const guarded: string[] = [];
  http.assertProviderUrl = async (u) => {
    guarded.push(u);
  };
  return { calls, guarded, client: new PinnaclePartnerClient(http) };
}

const account = {
  templateNamespace: 'ns',
  wabaId: '1',
  wabaNumber: '+91',
  email: 'a@b.co',
  firstName: 'A',
  lastName: 'B',
  mobileNo: '9',
};

describe('PinnaclePartnerClient', () => {
  it('creates an account with the partner key and returns the client key', async () => {
    const { client, calls, guarded } = make(200, {
      code: 200,
      data: { apikey: 'client-key', username: 'u', password: 'p' },
    });
    await expect(client.createAccount(route, account)).resolves.toEqual({
      apiKey: 'client-key',
      username: 'u',
      password: 'p',
    });
    expect(calls[0]!.url).toBe('https://partners.example-bsp.com/create-user-account');
    expect(calls[0]!.headers.apikey).toBe('partner-key-1');
    expect(guarded).toEqual(['https://partners.example-bsp.com/create-user-account']);
  });

  it("turns a refusal into Pinnacle's own words, not a secret", async () => {
    const { client } = make(200, {
      code: 409,
      message: 'WABA already onboarded',
      data: { apikey: 'LEAK' },
    });
    const err = await client.createAccount(route, account).catch((e) => e);
    expect(err).toBeInstanceOf(PinnacleError);
    expect(err.message).toBe('WABA already onboarded');
    expect(err.transient).toBe(false);
  });

  it('treats an HTTP 5xx as retryable and reads its message', async () => {
    const { client } = make(503, { message: 'maintenance' });
    const err = await client
      .shareCreditLine(route, { businessId: 'b', wabaId: 'w' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(PinnacleError);
    expect(err.transient).toBe(true);
    expect(err.message).toBe('maintenance');
  });

  it('refuses an address the guard refuses, before sending the key', async () => {
    const { client, calls } = make(200, { code: 200 });
    // replace the guard on the shared http
    const http = (client as unknown as { http: WabaHttp }).http;
    http.assertProviderUrl = async () => {
      throw new Error('private address');
    };
    await expect(
      client.sendEmbeddedDetails(route, {
        wabaId: '1',
        phoneNumberId: '2',
        configId: '3',
        accessToken: 't',
        solutionId: '4',
        businessId: 'b',
      }),
    ).rejects.toThrow('private address');
    expect(calls).toHaveLength(0);
  });
});
