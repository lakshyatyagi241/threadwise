import request from 'supertest';
import { expect } from 'vitest';
import {
  Api,
  bearer,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

export { Api, bearer, startHarness, type Grant, type Harness, type Tenant };

export const SHEETS_SCOPES = ['contacts.read', 'contacts.write', 'catalog.read', 'catalog.write'];

/** The permissions a member needs for everything the add-on does. */
export const FULL_GRANTS: Grant[] = [
  ['app.google-sheets.use'],
  ['record.contacts.read'],
  ['record.contacts.create'],
  ['record.contacts.update'],
  ['cat.products.read'],
  ['cat.products.create'],
  ['cat.products.update'],
  ['store.storefront.read'],
  ['store.shops.manage'],
];

/** A role that may use the add-on and read, but write nothing. */
export const VIEWER_GRANTS: Grant[] = [
  ['app.google-sheets.use'],
  ['record.contacts.read'],
  ['cat.products.read'],
  ['store.storefront.read'],
];

/**
 * Installs the Google Sheets listing in a workspace the way the Marketplace does (one `workspace_app_installations` row), straight with the
 * owner connection: the listing is a draft until the operator publishes it, and the install flow itself belongs to the Marketplace suite.
 */
export async function installSheets(
  h: Harness,
  t: Tenant,
  scopes: string[] = SHEETS_SCOPES,
  status: 'active' | 'disabled' | 'killed' = 'active',
): Promise<void> {
  const res = await h.owner.query(
    `INSERT INTO workspace_app_installations (org_id, app_id, installed_version_id, granted_scopes, status, installed_by)
     SELECT $1, a.id, v.id, $2::text[], $3, $4
     FROM marketplace_apps a JOIN marketplace_app_versions v ON v.app_id = a.id
     WHERE a.slug = 'google-sheets' ORDER BY v.id LIMIT 1
     ON CONFLICT (org_id, app_id) DO UPDATE SET status = EXCLUDED.status, granted_scopes = EXCLUDED.granted_scopes`,
    [t.orgId, scopes, status, t.adminUserId],
  );
  expect(res.rowCount).toBe(1);
}

export async function uninstallSheets(h: Harness, t: Tenant): Promise<void> {
  await h.owner.query(
    `DELETE FROM workspace_app_installations WHERE org_id = $1
       AND app_id = (SELECT id FROM marketplace_apps WHERE slug = 'google-sheets')`,
    [t.orgId],
  );
}

/** The member's own call to create a key, as their session. Fails the test when it is refused. */
export async function generateKey(api: Api, token: string): Promise<string> {
  const res = await api.http().post('/v2/extension/sheets/key').set(bearer(token));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.key as string;
}

/** A member with these grants, with a Sheets key (the workspace must already have the add-on installed). */
export async function memberWithKey(
  api: Api,
  t: Tenant,
  name: string,
  grants: Grant[] = FULL_GRANTS,
): Promise<{ userId: number; session: string; key: string }> {
  const m = await api.member(t, name, grants);
  return { userId: m.userId, session: m.token, key: await generateKey(api, m.token) };
}

let ipCounter = 40;
const nextIp = () => `10.77.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;

/** A caller of the add-on API. Each caller gets its own address, so one spec's failures never lock out another's. */
export function addon(h: Harness, key: string | null, ip = nextIp()) {
  const server = h.app.getHttpServer();
  const headers = (): Record<string, string> => ({
    'x-forwarded-for': ip,
    ...(key ? { authorization: `Bearer ${key}` } : {}),
  });
  const base = '/api/v1/sheets-addon';
  return {
    ip,
    get: (path: string) => request(server).get(`${base}${path}`).set(headers()),
    post: (path: string, body?: object) =>
      request(server).post(`${base}${path}`).set(headers()).send(body),
    /** Any method and any headers, for the authentication edge cases. */
    raw: (method: 'get' | 'post' | 'put' | 'delete', path: string) =>
      request(server)[method](`${base}${path}`).set('x-forwarded-for', ip),
  };
}

/** Rows of a table for a tenant, through the owner connection (RLS bypassed). */
export const rows = async (h: Harness, table: string, t: Tenant, where = 'true') =>
  (
    await h.owner.query(`SELECT * FROM ${table} WHERE org_id = $1 AND ${where} ORDER BY id`, [
      t.orgId,
    ])
  ).rows;
