/**
 * VAPT manual-check suite (Sheet3 #25). Attacks a LOCAL API that tools/security/vapt.sh boots with a throwaway database.
 * Skipped unless VAPT_BASE_URL is set, and refuses any host that is not localhost. Run it with
 *   VAPT_BASE_URL=http://localhost:3922 pnpm --filter @crm/api exec vitest run --dir test/security/vapt
 * Identities (all password Passw0rd!): tenant A admin + viewer, tenant B admin.
 * Already covered elsewhere and NOT repeated here: SSRF (test/unit/security/ssrf-*.spec.ts, test/unit/ssrf), CSRF/CORS/headers
 * (test/unit/security/headers-cors.spec.ts), fuzzing (test/fuzz, test/unit/security/fuzz-*), tenancy/RLS (tools/tenancy-audit).
 */
import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it, beforeAll } from 'vitest';

const BASE = process.env.VAPT_BASE_URL;
const local = BASE && ['localhost', '127.0.0.1', '::1'].includes(new URL(BASE).hostname);
if (BASE && !local) throw new Error(`VAPT refuses non-local target ${BASE}`);
const PW = process.env.VAPT_PASSWORD ?? 'Passw0rd!';
const WHO = {
  adminA: process.env.VAPT_ADMIN_A ?? 'nachiket.challawar@geta.ai',
  adminB: process.env.VAPT_ADMIN_B ?? 'nachiket.challawar+ten@geta.ai',
  viewerA: process.env.VAPT_VIEWER_A ?? 'viewer@admin.test',
};
const GHOST = '00000000-0000-4000-8000-000000000001';

/** The JSON bodies these checks read: a login's tokens, the id of a created record, and a refresh rotation's new token. */
interface JsonBody {
  id: string;
  tokens?: { accessToken: string; refreshToken: string };
  refreshToken?: string;
}
interface Res {
  status: number;
  headers: Headers;
  text: string;
  json: JsonBody | undefined;
}
const call = async (
  method: string,
  path: string,
  token?: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Res> => {
  const h: Record<string, string> = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  if (method !== 'GET') h['idempotency-key'] ??= randomUUID();
  const r = await fetch(BASE + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await r.text();
  let json: JsonBody | undefined;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: r.status, headers: r.headers, text, json };
};
const login = async (email: string) => {
  const r = await call('POST', '/v2/auth/login', undefined, { email, password: PW });
  return {
    access: r.json?.tokens?.accessToken as string,
    refresh: r.json?.tokens?.refreshToken as string,
  };
};
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString());

describe.skipIf(!local)('VAPT live checks', () => {
  let A = '';
  let B = '';
  let V = '';
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    A = (await login(WHO.adminA)).access;
    B = (await login(WHO.adminB)).access;
    V = (await login(WHO.viewerA)).access;
    expect(A && B && V, 'seeded identities must log in').toBeTruthy();
    const mk = async (k: string, path: string, body: unknown) => {
      const r = await call('POST', path, A, body);
      expect(r.status, `${path} -> ${r.text}`).toBe(201);
      ids[k] = r.json!.id;
    };
    await mk('contacts', '/v2/contacts', {
      name: 'Vapt IDOR',
      phone: '+919000000077',
      email: 'idor@vapt.test',
    });
    await mk('companies', '/v2/companies', { name: 'Vapt IDOR Co' });
    await mk('deals', '/v2/deals', { title: 'Vapt IDOR deal' });
    await mk('tasks', '/v2/tasks', { title: 'Vapt IDOR task' });
  });

  describe('cross-tenant object access (IDOR)', () => {
    for (const mod of ['contacts', 'companies', 'deals', 'tasks']) {
      it(`${mod}: tenant B cannot read, change or delete tenant A's record, nor see it listed`, async () => {
        const id = ids[mod]!;
        expect([403, 404]).toContain((await call('GET', `/v2/${mod}/${id}`, B)).status);
        expect([403, 404]).toContain(
          (
            await call(
              'PATCH',
              `/v2/${mod}/${id}`,
              B,
              mod === 'deals' || mod === 'tasks'
                ? { title: 'pwn', rowVersion: 1 }
                : { name: 'pwn', rowVersion: 1 },
            )
          ).status,
        );
        expect([403, 404]).toContain((await call('DELETE', `/v2/${mod}/${id}`, B)).status);
        const list = await call('GET', `/v2/${mod}`, B);
        expect(list.text).not.toContain(id);
        expect((await call('GET', `/v2/${mod}/${id}`, A)).status, 'owner still has it').toBe(200);
      });
    }
  });

  describe('privilege escalation', () => {
    it('a viewer cannot create, change or delete records', async () => {
      expect(
        (await call('POST', '/v2/contacts', V, { name: 'viewer-made', phone: '+919000000078' }))
          .status,
      ).toBe(403);
      expect([403, 404]).toContain(
        (await call('PATCH', `/v2/contacts/${ids.contacts}`, V, { name: 'x' })).status,
      );
      expect((await call('DELETE', `/v2/contacts/${ids.contacts}`, V)).status).toBe(403);
      expect(
        (await call('POST', '/v2/webhooks', V, { url: 'https://example.com/h', events: [] }))
          .status,
      ).toBe(403);
    });
    it('a tenant admin cannot reach platform-operator routes', async () => {
      for (const p of [
        '/v2/platform/settings/export',
        '/v2/platform/billing/orders/export',
        '/v2/platform/webhook-targets',
      ]) {
        expect([401, 403], p).toContain((await call('GET', p, A)).status);
      }
    });
    it('mass assignment: tenant and identity fields in a body are ignored or refused', async () => {
      const r = await call('POST', '/v2/contacts', A, {
        name: 'Mass Assign',
        phone: '+919000000079',
        orgId: 2,
        org_id: 2,
        id: GHOST,
        createdBy: GHOST,
      });
      expect(r.status === 201 || r.status === 422).toBe(true);
      if (r.status === 201) {
        expect(r.json!.id).not.toBe(GHOST);
        expect((await call('GET', `/v2/contacts/${r.json!.id}`, B)).status).toBe(404);
      }
    });
  });

  describe('JWT tampering and sessions', () => {
    it('rejects alg=none, a forged signature, a tampered tenant claim, an expired claim and garbage', async () => {
      const c = claims(A);
      const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(c)}.`;
      const forged = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(c)}.${createHmac('sha256', 'guess').update('x').digest('base64url')}`;
      const otherTenant = `${A.split('.')[0]}.${b64({ ...c, org: 2 })}.${A.split('.')[2]}`;
      const expired = `${A.split('.')[0]}.${b64({ ...c, exp: 1 })}.${A.split('.')[2]}`;
      for (const t of [none, forged, otherTenant, expired, 'x.y.z', 'Bearer']) {
        expect((await call('GET', '/v2/contacts', t)).status, t.slice(0, 20)).toBe(401);
      }
    });
    it('a replayed refresh token (two rotations old) is refused and revokes the whole session', async () => {
      // One step behind within 30 s is the designed two-tabs grace; anything older is theft.
      const s = await login(WHO.adminA);
      const r1 = await call('POST', '/v2/auth/refresh', undefined, { refreshToken: s.refresh });
      expect(r1.status).toBe(201);
      const r2 = await call('POST', '/v2/auth/refresh', undefined, {
        refreshToken: r1.json!.tokens?.refreshToken ?? r1.json!.refreshToken,
      });
      expect(r2.status).toBe(201);
      expect(
        (await call('POST', '/v2/auth/refresh', undefined, { refreshToken: s.refresh })).status,
      ).toBe(401);
      const live = r2.json!.tokens?.refreshToken ?? r2.json!.refreshToken;
      expect(
        (await call('POST', '/v2/auth/refresh', undefined, { refreshToken: live })).status,
        'session revoked after reuse',
      ).toBe(401);
    });
    it('a refresh token is not accepted as an access token', async () => {
      const s = await login(WHO.adminA);
      expect((await call('GET', '/v2/contacts', s.refresh)).status).toBe(401);
    });
    it('password reset: unknown address answers like a known one, a made-up token is refused every time', async () => {
      const unknown = await call('POST', '/v2/auth/forgot-password', undefined, {
        email: 'ghost@vapt.test',
      });
      const known = await call('POST', '/v2/auth/forgot-password', undefined, {
        email: WHO.viewerA,
      });
      expect(unknown.status).toBe(known.status);
      for (let i = 0; i < 2; i++) {
        const r = await call('POST', '/v2/auth/reset-password', undefined, {
          token: 'a'.repeat(43),
          password: 'N3w-Passw0rd!xyz',
        });
        expect(r.status).toBeGreaterThanOrEqual(400);
        expect(r.status).toBeLessThan(500);
      }
    });
  });

  describe('public tokenised URLs', () => {
    const paths = [
      '/v2/public/invoices/TOKEN',
      '/v2/public/invoices/TOKEN/pdf',
      '/v2/public/sales-docs/TOKEN',
      '/v2/public/booking-manage/TOKEN',
      '/v2/public/booking-manage/TOKEN/slots',
      '/v2/public/consent/unsubscribe/TOKEN',
    ];
    it('guessed or malformed tokens are refused with 4xx, never 2xx or 5xx', async () => {
      for (const p of paths) {
        const a = await call('GET', p.replace('TOKEN', 'a'.repeat(32)));
        const b = await call('GET', p.replace('TOKEN', encodeURIComponent("1' OR '1'='1")));
        expect(a.status, p).toBeGreaterThanOrEqual(400);
        expect(a.status, p).toBeLessThan(500);
        expect(b.status, p).toBeGreaterThanOrEqual(400);
        expect(b.status, p).toBeLessThan(500);
      }
    });
    it('state-changing public actions refuse a guessed token', async () => {
      for (const p of [
        '/v2/public/invoices/TOKEN/pay',
        '/v2/public/sales-docs/TOKEN/accept',
        '/v2/public/booking-manage/TOKEN/cancel',
      ]) {
        const r = await call('POST', p.replace('TOKEN', 'b'.repeat(32)), undefined, {});
        expect([400, 401, 403, 404, 422], p).toContain(r.status);
      }
    });
  });

  describe('webhook signature bypass', () => {
    it('unsigned or wrongly signed payloads to payment webhooks are refused', async () => {
      const body = {
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_x', order_id: 'o', status: 'captured' } } },
      };
      for (const p of [
        `/v2/payments/webhook/razorpay`,
        `/v2/public/webhooks/invoice-payments/${GHOST}`,
        `/v2/store-public/webhooks/gateway/${GHOST}`,
      ]) {
        for (const sig of [
          {},
          { 'x-razorpay-signature': 'deadbeef' },
          { 'stripe-signature': 't=1,v1=00' },
        ]) {
          const r = await call('POST', p, undefined, body, sig as Record<string, string>);
          expect(r.status, `${p} ${JSON.stringify(sig)}`).toBeGreaterThanOrEqual(400);
          expect(r.status, p).toBeLessThan(500);
        }
      }
    });
  });

  describe('exports and uploads', () => {
    it('CSV export neutralises formula cells', async () => {
      const r = await call('POST', '/v2/companies', A, {
        name: '=HYPERLINK("http://evil.example","x")',
      });
      expect(r.status).toBe(201);
      const csv = await call('GET', '/v2/companies/export', A);
      expect(csv.status).toBe(200);
      expect(csv.text).toContain(`"'=HYPERLINK(`);
      expect(csv.text).not.toMatch(/(^|\n)"?=HYPERLINK/);
    });
    it('media upload refuses a non-media content type and an oversized body', async () => {
      const form = (type: string, bytes: number) => {
        const f = new FormData();
        f.append('file', new Blob([Buffer.alloc(bytes, 65)], { type }), 'x.bin');
        return f;
      };
      const up = async (f: FormData) =>
        (
          await fetch(`${BASE}/v2/inbox/media`, {
            method: 'POST',
            headers: { authorization: `Bearer ${A}`, 'idempotency-key': randomUUID() },
            body: f,
          })
        ).status;
      const exe = await up(form('application/x-msdownload', 64));
      const big = await up(form('image/png', 60 * 1024 * 1024));
      expect(exe, 'executable content type').toBeGreaterThanOrEqual(400);
      expect(exe).toBeLessThan(500);
      expect(big, 'oversized body').toBeGreaterThanOrEqual(400);
      expect(big).toBeLessThan(500);
    });
  });

  describe('login brute force (kept LAST: it trips the per-IP ceiling for 5 minutes)', () => {
    it('spraying made-up addresses hits 429 at the per-IP ceiling', async () => {
      let hit = false;
      for (let i = 0; i < 45 && !hit; i++) {
        hit =
          (
            await call('POST', '/v2/auth/login', undefined, {
              email: `nobody${i}@vapt.test`,
              password: `wrong-${i}`,
            })
          ).status === 429;
      }
      expect(hit).toBe(true);
    });
  });

  describe('response hygiene', () => {
    it('does not advertise the framework (X-Powered-By)', async () => {
      const r = await call('GET', '/v2/auth/password-policy');
      expect(r.headers.get('x-powered-by')).toBeNull();
    });
    it('errors carry no stack trace or file path', async () => {
      const r = await call('POST', '/v2/contacts', A, '{"name":');
      expect(r.text).not.toMatch(/node_modules|\.ts:\d+|\n\s+at /);
    });
  });
});
