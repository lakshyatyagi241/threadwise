import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';

export type LogSeverity = 'info' | 'warning' | 'error';
export type LogActorType = 'user' | 'platform_operator' | 'system';

export interface WalletEventInput {
  orgId: number;
  event: string;
  severity?: LogSeverity;
  message: string;
  actorType?: LogActorType;
  actorLabel?: string | null;
  subjectType?: string | null;
  subjectId?: number | null;
  payload?: Record<string, unknown>;
}

export interface PlatformLogInput {
  event: string;
  severity?: LogSeverity;
  message: string;
  operatorId?: number | null;
  actorLabel?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * The wallet's two trails, written in the transaction of the change they describe so the log and the change commit or roll back
 * together (a log line for a debit that was rolled back would be a lie):
 *
 *   wallet_events        what happened to ONE workspace's wallet (top-up credited, a charge settled in part, a refund, an alert
 *                        sent, a launch refused, a reconciliation mismatch). Tenant-scoped; operators read all of them.
 *   wallet_platform_log  what an operator changed for everyone (rates, imports, switches, settings). Operators only.
 *
 * Every row also goes to the process log as one structured line (`[WALLET] event key=value`), which is what an on-call reads at
 * 3am; the table is what support and finance read next week. Per-message routine charges are NOT rows here (they are the
 * `usage_charges` ledger itself); only the exceptions that need a human are: partial charges, unbilled messages, failures.
 */
@Injectable()
export class WalletLogService {
  private readonly logger = new Logger('Wallet');

  async event(tx: Tx, input: WalletEventInput): Promise<void> {
    const ctx = RequestContextStore.peek();
    const severity = input.severity ?? 'info';
    await tx.execute(sql`
      INSERT INTO wallet_events (org_id, event, severity, actor_type, actor_label, subject_type, subject_id, message, payload, request_id)
      VALUES (${input.orgId}, ${input.event}, ${severity}, ${input.actorType ?? 'system'}, ${input.actorLabel ?? null},
              ${input.subjectType ?? null}, ${input.subjectId ?? null}, ${input.message},
              ${JSON.stringify(input.payload ?? {})}::jsonb, ${ctx?.requestId ?? null})
    `);
    this.emit(
      severity,
      input.event,
      { orgId: input.orgId, ...(input.payload ?? {}) },
      input.message,
    );
  }

  async platform(tx: Tx, input: PlatformLogInput): Promise<void> {
    const ctx = RequestContextStore.peek();
    const severity = input.severity ?? 'info';
    await tx.execute(sql`
      INSERT INTO wallet_platform_log (event, severity, actor_label, operator_id, message, payload, request_id)
      VALUES (${input.event}, ${severity}, ${input.actorLabel ?? null}, ${input.operatorId ?? null}, ${input.message},
              ${JSON.stringify(input.payload ?? {})}::jsonb, ${ctx?.requestId ?? null})
    `);
    this.emit(severity, input.event, input.payload ?? {}, input.message);
  }

  /** A line in the process log only: for the routine path (a charge settled) where a table row per message would drown the table. */
  line(
    severity: LogSeverity,
    event: string,
    fields: Record<string, unknown>,
    message: string,
  ): void {
    this.emit(severity, event, fields, message);
  }

  private emit(
    severity: LogSeverity,
    event: string,
    fields: Record<string, unknown>,
    message: string,
  ): void {
    const data = { event, ...fields };
    if (severity === 'error') this.logger.error(data, message);
    else if (severity === 'warning') this.logger.warn(data, message);
    else this.logger.log(data, message);
  }
}
