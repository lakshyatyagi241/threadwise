import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { assertNoPii, type AnalyticsEventInput, type AnalyticsProps } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import type { Env } from '../../config/env.schema';

const INT_FIELDS = [
  'channelKind',
  'direction',
  'status',
  'sourceKind',
  'k1',
  'k2',
  'channelId',
  'contactId',
  'conversationId',
  'campaignId',
  'flowId',
  'agentId',
  'templateId',
  'deviceId',
  'amountMinor',
  'durationMs',
  'tokens',
] as const;

/** One event as it will be inserted: defaults filled, ids checked. */
export interface EventRow {
  type: number;
  orgId: number;
  occurredAt: Date;
  qty: number;
  channelKind?: number;
  direction?: number;
  status?: number;
  sourceKind?: number;
  k1?: number;
  k2?: number;
  channelId?: number;
  contactId?: number;
  conversationId?: number;
  campaignId?: number;
  flowId?: number;
  agentId?: number;
  templateId?: number;
  deviceId?: number;
  amountMinor?: number;
  durationMs?: number;
  tokens?: number;
  props: AnalyticsProps | null;
}

/**
 * Turns a call site's input into a row: organization from the request unless named, business time now unless named, qty 1, every id and
 * measure a safe integer, props free of anything that looks like personal data. Pure, so it is unit tested without a database.
 */
export function toEventRow(input: AnalyticsEventInput, defaultOrgId: number, now: Date): EventRow {
  const row: EventRow = {
    type: input.type,
    orgId: input.orgId ?? defaultOrgId,
    occurredAt: input.occurredAt ?? now,
    qty: input.qty ?? 1,
    props: null,
  };
  if (!Number.isSafeInteger(row.qty)) {
    throw new Error(`analytics field qty must be an integer, got ${String(row.qty)}`);
  }
  for (const field of INT_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    if (!Number.isSafeInteger(value)) {
      throw new Error(`analytics field ${field} must be an integer, got ${String(value)}`);
    }
    row[field] = value;
  }
  assertNoPii(input.props);
  row.props = input.props ?? null;
  return row;
}

/**
 * Writes analytics events (docs/superpowers/specs/2026-10-16-event-based-analytics-design.md, section 4.2).
 *
 * It takes the caller's transaction, like `OutboxService.emit`: the event commits or rolls back with the business change. It is not the
 * outbox, which is a drained work queue; events are append-only with no consumer.
 *
 * It never throws. Analytics must not break the write it rides on, so a failure is logged and counted and the caller carries on. The
 * insert runs in a savepoint because a failed statement would otherwise abort the caller's whole transaction. A nightly job compares the
 * event counts with the business tables and flags a day with missing events.
 */
@Injectable()
export class AnalyticsEvents {
  private readonly logger = new Logger(AnalyticsEvents.name);
  private recorded = 0;
  private failures = 0;
  private readonly enabled: boolean;
  private readonly useSavepoint: boolean;

  constructor(@Optional() config?: ConfigService<Env, true>) {
    this.enabled = config?.get('ANALYTICS_EVENTS_ENABLED', { infer: true }) ?? true;
    this.useSavepoint = config?.get('ANALYTICS_EVENT_SAVEPOINT', { infer: true }) ?? true;
  }

  /** Counters since the process started, for the health check and the metrics endpoint. */
  stats(): { recorded: number; failures: number } {
    return { recorded: this.recorded, failures: this.failures };
  }

  record(tx: Tx, input: AnalyticsEventInput): Promise<boolean> {
    return this.recordMany(tx, [input]);
  }

  /** Returns true when the events were stored (or analytics is switched off), false when they were dropped. */
  async recordMany(tx: Tx, inputs: AnalyticsEventInput[]): Promise<boolean> {
    if (!this.enabled || inputs.length === 0) return true;
    try {
      const defaultOrgId = RequestContextStore.peek()?.orgId ?? 0;
      const now = new Date();
      const rows = inputs.map((input) => toEventRow(input, defaultOrgId, now));
      if (rows.some((r) => !r.orgId)) throw new Error('analytics event has no organization');
      if (this.useSavepoint) await tx.transaction((sp) => this.insert(sp as unknown as Tx, rows));
      else await this.insert(tx, rows);
      this.recorded += rows.length;
      return true;
    } catch (err) {
      this.failures += 1;
      this.logger.warn({ err, types: inputs.map((i) => i.type) }, 'analytics event not recorded');
      return false;
    }
  }

  private async insert(tx: Tx, rows: EventRow[]): Promise<void> {
    const values = rows.map(
      (r) => sql`(${r.orgId}, ${r.type}, ${r.occurredAt.toISOString()}::timestamptz,
        ${r.channelKind ?? null}, ${r.direction ?? null}, ${r.status ?? null}, ${r.sourceKind ?? null}, ${r.k1 ?? null}, ${r.k2 ?? null},
        ${r.channelId ?? null}, ${r.contactId ?? null}, ${r.conversationId ?? null}, ${r.campaignId ?? null}, ${r.flowId ?? null},
        ${r.agentId ?? null}, ${r.templateId ?? null}, ${r.deviceId ?? null},
        ${r.qty}, ${r.amountMinor ?? null}, ${r.durationMs ?? null}, ${r.tokens ?? null},
        ${r.props === null ? null : JSON.stringify(r.props)}::jsonb)`,
    );
    await tx.execute(sql`
      INSERT INTO an_events (org_id, type, occurred_at, channel_kind, direction, status, source_kind, k1, k2,
        channel_id, contact_id, conversation_id, campaign_id, flow_id, agent_id, template_id, device_id,
        qty, amount_minor, duration_ms, tokens, props)
      VALUES ${sql.join(values, sql`, `)}`);
  }
}
