import { expect } from 'vitest';
import {
  DealsApi,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../deals-pipelines/support';

export { DealsApi, startHarness, type Grant, type Harness, type Tenant };

let ipCounter = 1;
/** A different client address per call: the door's per-IP budget (120 a minute) is not what most tests are about. */
export const nextIp = (): string => `10.55.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;

export const LEAD_READ: Grant[] = [['leads.sources.read']];
export const LEAD_MANAGE: Grant[] = [['leads.sources.read'], ['leads.sources.manage']];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows are read by column name in assertions; a type per query would be noise
export type Row = Record<string, any>;

export interface CreatedSource {
  id: string;
  name: string;
  token: string;
  hookPath: string;
  tokenHint: string;
  rowVersion: number;
  hasSecret: boolean;
  status: string;
  defaults: Record<string, unknown>;
  mapping: Record<string, unknown>;
}

/** Lead-specific helpers on top of the deals harness (same app, same database, organizations of their own). */
export class LeadsApi extends DealsApi {
  /** A webhook source through the management API as `token`. */
  async source(token: string, body: Record<string, unknown> = {}): Promise<CreatedSource> {
    const name =
      (body.name as string | undefined) ?? `Source ${Math.random().toString(36).slice(2, 8)}`;
    const res = await this.as(token)
      .post('/v2/lead-sources')
      .send({ name, ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as CreatedSource;
  }

  /** One lead to the public door, JSON or form. */
  hook(
    hookPath: string,
    body: unknown,
    opts: { form?: boolean; ip?: string; headers?: Record<string, string> } = {},
  ) {
    let req = this.http()
      .post(hookPath)
      .set('x-forwarded-for', opts.ip ?? nextIp());
    for (const [k, v] of Object.entries(opts.headers ?? {})) req = req.set(k, v);
    return opts.form
      ? req.type('form').send(body as Record<string, string>)
      : req.send(body as object);
  }

  /** Rows of a table of this org, straight from the database (the owner connection; asserting only). */
  async rows(orgId: number, sqlText: string, params: unknown[] = []): Promise<Row[]> {
    return (await this.h.owner.query(sqlText, [orgId, ...params])).rows;
  }

  async contactsWithPhone(orgId: number, e164: string) {
    return this.rows(orgId, `SELECT * FROM contacts WHERE org_id = $1 AND phone = $2`, [e164]);
  }

  async leadEvents(orgId: number, sourceUuid?: string) {
    return this.rows(
      orgId,
      `SELECT e.*, s.uuid AS source_uuid FROM lead_events e JOIN lead_sources s ON s.org_id = e.org_id AND s.id = e.source_id
       WHERE e.org_id = $1 ${sourceUuid ? `AND s.uuid = $2::uuid` : ''} ORDER BY e.id`,
      sourceUuid ? [sourceUuid] : [],
    );
  }

  async eventsOfType(orgId: number, type: string) {
    return this.rows(
      orgId,
      `SELECT aggregate_id, payload FROM event_outbox WHERE org_id = $1 AND event_type = $2 ORDER BY id`,
      [type],
    );
  }

  async setOverrides(orgId: number, overrides: Record<string, unknown>) {
    await this.h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
      orgId,
      JSON.stringify(overrides),
    ]);
  }

  /** An internal user id to its uuid. */
  userUuidById(userId: number): Promise<string> {
    return this.userUuid(userId);
  }
}
