import request from 'supertest';
import { hash } from '@node-rs/argon2';
import { expect } from 'vitest';
import { withContractWatch } from '../../support/contract';
import { startHarness, type Harness } from '../auth-registration-security/harness';

export { startHarness, type Harness };

export const PASSWORD = 'Str0ngPassw0rd#1';

let ipCounter = 10;
const nextIp = () => `10.31.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;
let counter = 0;

export const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

export interface Tenant {
  orgId: number;
  slug: string;
  /** The organization admin (every capability key, record scope all). */
  admin: string;
  adminUserId: number;
}

export type Grant = [key: string, scope?: 'all' | 'team' | 'team_and_below' | 'own'];

export class Api {
  constructor(readonly h: Harness) {}
  http() {
    return request(this.h.app.getHttpServer());
  }

  /** A new organization with its admin signed in. */
  async signup(label = 'con'): Promise<Tenant> {
    const email = `${label}${Date.now()}${counter++}@example.test`;
    const res = await this.http()
      .post('/v2/auth/signup')
      .set('x-forwarded-for', nextIp())
      .send({
        orgName: `Org ${label} ${counter}`,
        fullName: 'Admin Person',
        email,
        password: PASSWORD,
        acceptTerms: true,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const access = res.body.tokens.accessToken as string;
    const session = await this.http().get('/v2/auth/session').set(bearer(access));
    const slug = session.body.org.slug as string;
    const org = await this.h.owner.query(`SELECT id FROM organizations WHERE slug = $1`, [slug]);
    const user = await this.h.owner.query(`SELECT id FROM users WHERE email = $1`, [email]);
    return {
      orgId: Number(org.rows[0].id),
      slug,
      admin: access,
      adminUserId: Number(user.rows[0].id),
    };
  }

  /**
   * A second member of the organization with exactly these grants, signed in. The role is
   * created with the owner connection (the migration role), the way a settings screen would.
   */
  async member(
    t: Tenant,
    name: string,
    grants: Grant[],
  ): Promise<{ token: string; userId: number }> {
    const email = `${name}${Date.now()}${counter++}@example.test`;
    const role = await this.h.owner.query(
      `INSERT INTO roles (org_id, name) VALUES ($1, $2) RETURNING id`,
      [t.orgId, `${name}-${counter}`],
    );
    for (const [key, scope] of grants) {
      await this.h.owner.query(
        `INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope) VALUES ($1,$2,$3,'allow',$4)`,
        [t.orgId, role.rows[0].id, key, scope ?? 'all'],
      );
    }
    const user = await this.h.owner.query(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,$2,$3,$4) RETURNING id`,
      [t.orgId, email, name, await hash(PASSWORD)],
    );
    const userId = Number(user.rows[0].id);
    await this.h.owner.query(
      `INSERT INTO user_roles (org_id, user_id, role_id) VALUES ($1,$2,$3)`,
      [t.orgId, userId, role.rows[0].id],
    );
    await this.h.owner.query(
      `INSERT INTO user_security (org_id, user_id, email_verified_at, password_changed_at) VALUES ($1,$2,now(),now())`,
      [t.orgId, userId],
    );
    const login = await this.http()
      .post('/v2/auth/login')
      .set('x-forwarded-for', nextIp())
      .send({ orgSlug: t.slug, email, password: PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBeLessThan(300);
    return { token: login.body.tokens.accessToken as string, userId };
  }

  /** Contacts straight into the table (the owner connection), for arranging a test. Newest last. */
  async seedContacts(
    t: Tenant,
    rows: Array<{
      name: string;
      phone?: string | null;
      email?: string | null;
      ownerId?: number | null;
      isUnsubscribed?: boolean;
      /** The WhatsApp subscription label (`subscribed`): what the Subscribed tile and filter count. Unset: no label recorded. */
      whatsappSubscriptionStatus?: string | null;
      countryCode?: string | null;
      data?: Record<string, unknown>;
      source?: string | null;
      createdAt?: string;
    }>,
  ): Promise<string[]> {
    const ids: string[] = [];
    let n = 0;
    for (const r of rows) {
      const res = await this.h.owner.query(
        `INSERT INTO contacts (org_id, name, phone, email, owner_id, is_unsubscribed, country_code, data, source, created_at, whatsapp_subscription_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9, COALESCE($10::timestamptz, now() + ($11 || ' seconds')::interval), $12)
         RETURNING uuid`,
        [
          t.orgId,
          r.name,
          r.phone ?? null,
          r.email ?? null,
          r.ownerId ?? null,
          r.isUnsubscribed ?? false,
          r.countryCode ?? null,
          JSON.stringify(r.data ?? {}),
          r.source ?? null,
          r.createdAt ?? null,
          String(n++),
          r.whatsappSubscriptionStatus ?? null,
        ],
      );
      ids.push(res.rows[0].uuid as string);
    }
    return ids;
  }

  /** As a bearer token: `api.as(token).get('/v2/contacts')`. */
  as(token: string) {
    const http = () => this.http();
    // `withContractWatch` does nothing unless QA_CONTRACT is set; then every error an awaited request gets is checked against
    // the problem+json envelope (test/support/contract.ts), which turns every existing e2e request into a contract check.
    return {
      get: (path: string) => withContractWatch(http().get(path).set(bearer(token))),
      post: (path: string) => withContractWatch(http().post(path).set(bearer(token))),
      patch: (path: string) => withContractWatch(http().patch(path).set(bearer(token))),
      put: (path: string) => withContractWatch(http().put(path).set(bearer(token))),
      delete: (path: string) => withContractWatch(http().delete(path).set(bearer(token))),
    };
  }

  /** The outbox rows of a type for an org, oldest first. */
  async events(orgId: number, type: string): Promise<Array<Record<string, unknown>>> {
    const res = await this.h.owner.query(
      `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = $2 ORDER BY id`,
      [orgId, type],
    );
    return res.rows.map((r) => r.payload as Record<string, unknown>);
  }

  async auditCount(orgId: number, module: string, action: string): Promise<number> {
    const res = await this.h.owner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = $2 AND action = $3`,
      [orgId, module, action],
    );
    return res.rows[0].n as number;
  }
}
