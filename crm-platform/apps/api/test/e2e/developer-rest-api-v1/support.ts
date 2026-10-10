import request from 'supertest';
import { expect } from 'vitest';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

export { Api, bearer, startHarness, type Harness, type Tenant };

/** A key minted through the console, the way a workspace admin does it. `secret` is the raw `wsk_...` key (shown once). */
export interface MintedKey {
  id: string;
  prefix: string;
  secret: string;
  /** What the console answered: empty is a full-access key. */
  scopes: string[];
}

/**
 * Mints a key as the tenant's admin (`POST /v2/developer/keys`). Fails the test when the console refuses. Without `scopes` the key is
 * full access, which is what the console form makes unless "Restrict this key" is on.
 */
export async function mintKey(
  api: Api,
  tenant: Tenant,
  name = 'e2e key',
  scopes?: string[],
): Promise<MintedKey> {
  const res = await api
    .http()
    .post('/v2/developer/keys')
    .set(bearer(tenant.admin))
    .send(scopes ? { name, scopes } : { name });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return {
    id: res.body.key.id,
    prefix: res.body.key.prefix,
    secret: res.body.secret,
    scopes: res.body.key.scopes,
  };
}

/** A caller of the customer API: every request carries the key as a bearer token. */
export function v1(h: Harness, secret: string) {
  const server = h.app.getHttpServer();
  const auth = { authorization: `Bearer ${secret}` };
  return {
    get: (path: string) => request(server).get(`/api/v1${path}`).set(auth),
    post: (path: string, body?: object) =>
      request(server).post(`/api/v1${path}`).set(auth).send(body),
    put: (path: string, body?: object) =>
      request(server).put(`/api/v1${path}`).set(auth).send(body),
    delete: (path: string) => request(server).delete(`/api/v1${path}`).set(auth),
    /** Any method, any headers: for the authentication edge cases. */
    raw: (method: 'get' | 'post' | 'put' | 'delete', path: string) =>
      request(server)[method](`/api/v1${path}`),
  };
}

/**
 * A tenant with a minted key, ready to call `/api/v1`. Each spec gets its own organization so nothing in one spec can see another's rows.
 * The one-key cap of the plan applies: a spec that needs two keys in one tenant revokes the first.
 */
export async function tenantWithKey(api: Api, label: string, scopes?: string[]) {
  const tenant = await api.signup(label);
  const key = await mintKey(api, tenant, 'e2e key', scopes);
  return { tenant, key, call: v1(api.h, key.secret) };
}
