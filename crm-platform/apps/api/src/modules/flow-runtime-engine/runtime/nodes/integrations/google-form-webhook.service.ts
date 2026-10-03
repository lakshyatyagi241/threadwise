import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Env } from '../../../../../config/env.schema';
import { DatabaseService } from '../../../../../infra/db/database.service';
import { FlowEngine } from '../../engine.service';
import { GOOGLE_FORM_HANDLER } from './google-nodes';

/** What the form's Apps Script posts on every submission (WD-FLR-046). */
export const googleFormResponseSchema = z.object({
  form_id: z.string().min(1).max(128),
  response_id: z.string().max(128).nullish(),
  respondent: z.string().max(255).nullish(),
  submitted_at: z.string().max(64).nullish(),
  answers: z.record(z.unknown()),
});
export type GoogleFormResponse = z.infer<typeof googleFormResponseSchema>;

/**
 * The submission side of the Google Form node (WD-FLR-046). The Apps Script on the customer's form posts the answers with this
 * workspace's token; the newest run still waiting on that form resumes through the engine. WaDesk kept a `google_form_sessions` table
 * for this; here the waiting run is the session (its wait carries the form id), so nothing extra is stored and an answered or
 * expired wait cannot be answered twice.
 *
 * The token is `<orgId>.<hmac>`, stateless: it names the workspace and cannot be forged without the server key. Rotating the server
 * key invalidates every token (hand out new scripts).
 */
@Injectable()
export class GoogleFormWebhookService {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly db: DatabaseService,
    private readonly engine: FlowEngine,
  ) {}

  private mac(orgId: number): string {
    const key = this.config.get('CREDENTIALS_ENCRYPTION_KEY', { infer: true });
    return createHmac('sha256', key).update(`google-form:${orgId}`).digest('hex');
  }

  /** The token to paste into a workspace's Apps Script. */
  tokenFor(orgId: number): string {
    return `${orgId}.${this.mac(orgId)}`;
  }

  /** The workspace a token belongs to, or null when it is not one of ours. */
  orgOf(token: string): number | null {
    const m = /^(\d{1,15})\.([0-9a-f]{64})$/.exec(token);
    if (!m) return null;
    const orgId = Number(m[1]);
    const given = Buffer.from(m[2]!, 'hex');
    const want = Buffer.from(this.mac(orgId), 'hex');
    return given.length === want.length && timingSafeEqual(given, want) ? orgId : null;
  }

  /** `matched: false` when no run waits on the form (answered, expired, never started): WaDesk answered ok in that case too. */
  async receive(token: string, body: GoogleFormResponse): Promise<{ matched: boolean }> {
    const orgId = this.orgOf(token);
    if (orgId === null) throw new UnauthorizedException('Unknown form webhook token');
    const runId = await this.db.txAs({ orgId }, async (tx) => {
      const res = (await tx.execute(
        sql`SELECT id FROM flow_runs
            WHERE org_id = ${orgId} AND status = 'waiting' AND wait->>'handler' = ${GOOGLE_FORM_HANDLER}
              AND wait->'data'->>'formId' = ${body.form_id}
            ORDER BY id DESC LIMIT 1`,
      )) as unknown as { rows: Array<{ id: string | number }> };
      return res.rows[0] ? Number(res.rows[0].id) : null;
    });
    if (runId === null) return { matched: false };
    const result = await this.engine.deliverExternal(orgId, runId, GOOGLE_FORM_HANDLER, {
      answers: body.answers,
      responseId: body.response_id ?? null,
      respondent: body.respondent ?? null,
    });
    return { matched: result !== 'not_waiting' };
  }
}
