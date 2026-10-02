import { hash } from '@node-rs/argon2';
import { expect } from 'vitest';
import {
  Api,
  PASSWORD,
  bearer,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

export { Api, PASSWORD, bearer, startHarness, type Grant, type Harness, type Tenant };

export const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const DEAL_VIEWER: Grant[] = [['record.deals.read'], ['record.pipelines.read']];

export interface Stage {
  id: string;
  name: string;
  kind: 'open' | 'won' | 'lost';
  probability: number;
  rowVersion: number;
  sortOrder: number;
  dealCount: number;
}
export interface Pipeline {
  id: string;
  name: string;
  isDefault: boolean;
  currency: string;
  rowVersion: number;
  stages: Stage[];
}

/** Deals-specific helpers on top of the contacts harness (same app, same database, organizations of their own). */
export class DealsApi extends Api {
  async pipelines(token: string): Promise<Pipeline[]> {
    const res = await this.as(token).get('/v2/pipelines');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Pipeline[];
  }

  async defaultPipeline(
    token: string,
  ): Promise<{ pipeline: Pipeline; stage: Record<string, Stage> }> {
    const p = (await this.pipelines(token)).find((x) => x.isDefault)!;
    return { pipeline: p, stage: Object.fromEntries(p.stages.map((s) => [s.name, s])) };
  }

  /** A deal through the API as `token`. */
  async deal(token: string, body: Record<string, unknown>) {
    const res = await this.as(token).post('/v2/deals').send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as {
      id: string;
      title: string;
      status: 'open' | 'won' | 'lost';
      value: string;
      currency: string;
      rowVersion: number;
      stage: { id: string; name: string; kind: string };
      owner: { id: string; name: string } | null;
      contact: { id: string; name: string | null } | null;
      company: { id: string; name: string } | null;
      wonAt: string | null;
      lostAt: string | null;
      lostReason: string | null;
      source: string;
    };
  }

  /** A user of the organization holding an existing role by name ("Agent" is the editable preset sign-up creates). */
  async memberWithRole(
    t: Tenant,
    name: string,
    roleName: string,
  ): Promise<{ token: string; userId: number }> {
    const role = await this.h.owner.query(`SELECT id FROM roles WHERE org_id = $1 AND name = $2`, [
      t.orgId,
      roleName,
    ]);
    const email = `${name}${Date.now()}${Math.floor(Math.random() * 1e6)}@example.test`;
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
      .set(
        'x-forwarded-for',
        `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      )
      .send({ orgSlug: t.slug, email, password: PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBeLessThan(300);
    return { token: login.body.tokens.accessToken as string, userId };
  }

  async userUuid(userId: number): Promise<string> {
    return (await this.h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0]
      .uuid as string;
  }

  /** Counts of the audit rows and outbox events a module wrote for an org. */
  async count(orgId: number, sql: string, params: unknown[] = []): Promise<number> {
    const res = await this.h.owner.query(sql, [orgId, ...params]);
    return Number(res.rows[0].n);
  }

  async timeline(token: string, dealId: string) {
    const res = await this.as(token).get(`/v2/deals/${dealId}/activities?limit=200`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as Array<{
      id: string;
      type: string;
      body: string | null;
      done: boolean;
      dueAt: string | null;
      stageChange: { from: { name: string } | null; to: { name: string } } | null;
    }>;
  }

  /** Deals straight into the table, in a stage, for volume tests (the owner connection; arranging only). */
  async seedDeals(
    t: Tenant,
    pipelineId: string,
    stageId: string,
    rows: Array<{
      title: string;
      valueMinor?: number;
      currency?: string;
      ownerId?: number | null;
      sortOrder?: number;
      status?: 'open' | 'won' | 'lost';
      wonAt?: string | null;
      lostAt?: string | null;
      createdAt?: string;
      source?: string;
      lostReason?: string | null;
    }>,
  ): Promise<number[]> {
    const p = await this.h.owner.query(`SELECT id FROM pipelines WHERE org_id = $1 AND uuid = $2`, [
      t.orgId,
      pipelineId,
    ]);
    const s = await this.h.owner.query(
      `SELECT id FROM pipeline_stages WHERE org_id = $1 AND uuid = $2`,
      [t.orgId, stageId],
    );
    const ids: number[] = [];
    for (const r of rows) {
      const res = await this.h.owner.query(
        `INSERT INTO deals (org_id, pipeline_id, stage_id, title, value_minor, currency, owner_user_id, sort_order, status, won_at, lost_at, source, lost_reason, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::timestamptz,$12,$13, COALESCE($14::timestamptz, now())) RETURNING id`,
        [
          t.orgId,
          p.rows[0].id,
          s.rows[0].id,
          r.title,
          r.valueMinor ?? 0,
          r.currency ?? 'USD',
          r.ownerId ?? null,
          r.sortOrder ?? 0,
          r.status ?? 'open',
          r.wonAt ?? (r.status === 'won' ? new Date().toISOString() : null),
          r.lostAt ?? (r.status === 'lost' ? new Date().toISOString() : null),
          r.source ?? 'manual',
          r.lostReason ?? null,
          r.createdAt ?? null,
        ],
      );
      ids.push(Number(res.rows[0].id));
    }
    return ids;
  }
}
