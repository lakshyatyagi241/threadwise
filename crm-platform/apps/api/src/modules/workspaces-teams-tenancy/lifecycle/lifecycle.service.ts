import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_ARCHIVE_AFTER_DAYS,
  DEFAULT_DELETE_AFTER_DAYS,
  type ListOrgLifecycleQuery,
  type OrgLifecycleLogEntry,
  type OrgLifecycleResponse,
  type RestoreOrgInput,
  type SetOrgLegalHoldInput,
  type SetOrgRetentionExemptInput,
  type UpdateOrgRetentionPolicyInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../../common/errors/app-error';
import type { Env } from '../../../config/env.schema';
import { DatabaseService } from '../../../infra/db/database.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { SessionService } from '../../auth';
import {
  MIN_DELETE_GAP_DAYS,
  daysBetween,
  decide,
  effectiveDays,
  scheduledDates,
  type LifecycleDecision,
  type LifecycleOrgState,
} from './lifecycle.policy';
import { LifecycleRepository, type LifecycleRow } from './lifecycle.repository';

export interface Actor {
  type: 'platform_operator' | 'system';
  /** Opaque reference, e.g. 'platform_operator:42'. Never an email address. */
  ref: string | null;
}
export const SYSTEM_ACTOR: Actor = { type: 'system', ref: null };

export interface SweepSummary {
  scanned: number;
  reminders: number;
  archived: number;
  deleted: number;
  dryRun: boolean;
}

const toState = (r: LifecycleRow): LifecycleOrgState => ({
  status: r.status,
  lastActivityAt: new Date(r.last_activity_at),
  archivedAt: r.archived_at ? new Date(r.archived_at) : null,
  deletedAt: r.deleted_at ? new Date(r.deleted_at) : null,
  archiveAfterDays: r.archive_after_days,
  deleteAfterDays: r.delete_after_days,
  retentionExempt: r.retention_exempt,
  retentionExemptUntil: r.retention_exempt_until ? new Date(r.retention_exempt_until) : null,
  legalHold: r.legal_hold,
  exemptByPlan: r.exempt_by_plan,
  remindersSent: { archive: r.reminders_archive, delete: r.reminders_delete },
  lastReminderAt: r.last_reminder_at ? new Date(r.last_reminder_at) : null,
});

/**
 * Workspace inactivity lifecycle: remind, archive, erase. See ADR-0028.
 *
 * Every state change writes org_lifecycle_log in the SAME transaction as the
 * change, and the customer-facing events go through the transactional outbox,
 * so "archived but nobody was told" cannot happen.
 *
 * The sweep re-evaluates the policy INSIDE a row lock before acting: the
 * candidate list is a hint, never a decision.
 */
@Injectable()
export class LifecycleService {
  private readonly logger = new Logger(LifecycleService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: LifecycleRepository,
    private readonly outbox: OutboxService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ---- sweep (worker) -------------------------------------------------------

  async sweep(now = new Date()): Promise<SweepSummary> {
    const dryRun = this.config.get('ORG_LIFECYCLE_DRY_RUN', { infer: true });
    const summary: SweepSummary = { scanned: 0, reminders: 0, archived: 0, deleted: 0, dryRun };
    let afterId = 0;

    for (;;) {
      const ids = await this.db.privileged((tx) => this.repo.candidateIds(tx, afterId, 200));
      if (ids.length === 0) break;
      afterId = ids[ids.length - 1]!;

      for (const id of ids) {
        summary.scanned += 1;
        try {
          const revoked: string[] = [];
          const outcome = await this.db.privileged((tx) =>
            this.processOne(tx, id, now, dryRun, revoked),
          );
          // After commit: the access tokens of the revoked sessions stop working at once, not at their expiry.
          await Promise.all(revoked.map((sid) => this.sessions.tombstone(sid)));
          if (outcome === 'reminder') summary.reminders += 1;
          if (outcome === 'archive') summary.archived += 1;
          if (outcome === 'delete') summary.deleted += 1;
        } catch (err) {
          // One bad org must not stop the sweep for the rest.
          this.logger.error({ err, orgId: id }, 'lifecycle step failed');
        }
      }
    }
    // The platform's own sales records are kept for the legal period, then removed.
    if (!dryRun) {
      try {
        const purged = await this.db.privileged((tx) => this.repo.purgeExpiredFinancialRecords(tx));
        if (purged > 0) this.logger.log({ purged }, 'expired financial records removed');
      } catch (err) {
        this.logger.error({ err }, 'financial record expiry failed');
      }
    }
    return summary;
  }

  private async processOne(
    tx: Tx,
    id: number,
    now: Date,
    dryRun: boolean,
    revoked: string[],
  ): Promise<LifecycleDecision['action']> {
    let row = await this.repo.findById(tx, id, true);
    if (!row) return 'none'; // locked by another worker, or gone
    // Message traffic is activity too: fold it in, and if the clock moved the workspace is not idle after all.
    if (!dryRun && (await this.repo.foldInMessageActivity(tx, id))) {
      row = await this.repo.findById(tx, id, true);
      if (!row) return 'none';
    }
    const decision = decide(toState(row), now);
    if (decision.action === 'none') return 'none';

    if (dryRun) {
      this.logger.log({ orgUuid: row.uuid, decision }, 'lifecycle dry run');
      return 'none';
    }

    switch (decision.action) {
      case 'reminder': {
        const limits = effectiveDays(toState(row));
        const inserted = await this.repo.writeLog(tx, {
          orgId: row.id,
          orgUuid: row.uuid,
          eventType: 'reminder_sent',
          stage: decision.stage,
          reminderNo: decision.reminderNo,
          daysInactive: decision.daysInactive,
        });
        if (!inserted) return 'none';
        const dueAt = scheduledDates(toState(row), now);
        await this.outbox.emit(tx, {
          orgId: row.id,
          aggregateModule: 'organizations',
          aggregateId: row.id,
          eventType: 'org.lifecycle.reminder',
          payload: {
            stage: decision.stage,
            reminderNo: decision.reminderNo,
            daysInactive: decision.daysInactive,
            archiveAfterDays: limits.archive,
            deleteAfterDays: limits.delete,
            actionAt:
              (decision.stage === 'archive' ? dueAt.archiveAt : dueAt.deleteAt)?.toISOString() ??
              null,
          },
        });
        return 'reminder';
      }
      case 'archive': {
        await this.repo.archive(tx, row.id);
        revoked.push(...(await this.repo.revokeSessions(tx, row.id, 'workspace_archived')));
        await this.repo.writeLog(tx, {
          orgId: row.id,
          orgUuid: row.uuid,
          eventType: 'archived',
          daysInactive: decision.daysInactive,
        });
        await this.outbox.emit(tx, {
          orgId: row.id,
          aggregateModule: 'organizations',
          aggregateId: row.id,
          eventType: 'org.archived',
          payload: {
            daysInactive: decision.daysInactive,
            deleteAfterDays: effectiveDays(toState(row)).delete,
          },
        });
        return 'archive';
      }
      case 'delete': {
        if (!this.config.get('ORG_LIFECYCLE_DELETE_ENABLED', { infer: true })) {
          await this.repo.writeLog(tx, {
            orgId: row.id,
            orgUuid: row.uuid,
            eventType: 'delete_blocked',
            daysInactive: decision.daysInactive,
            details: { reason: 'ORG_LIFECYCLE_DELETE_ENABLED is off' },
          });
          return 'none';
        }
        await this.eraseNow(tx, row, decision.daysInactive, SYSTEM_ACTOR, decision.cause);
        return 'delete';
      }
    }
  }

  private async eraseNow(
    tx: Tx,
    row: LifecycleRow,
    daysInactive: number,
    actor: Actor,
    cause?: 'owner_deleted',
  ): Promise<void> {
    // Tombstone first, inside the same transaction as the erasure: proof it
    // happened exists iff the data is gone. No personal data in it.
    await this.repo.writeLog(tx, {
      orgId: row.id,
      orgUuid: row.uuid,
      eventType: 'deleted',
      daysInactive,
      actorType: actor.type,
      actorRef: actor.ref,
      details: {
        plan: row.plan,
        daysArchived: row.archived_at ? daysBetween(new Date(row.archived_at), new Date()) : null,
        remindersSent: { archive: row.reminders_archive, delete: row.reminders_delete },
        cause: cause ?? 'inactivity',
      },
    });
    const retainYears = this.config.get('FINANCIAL_RECORD_RETENTION_YEARS', { infer: true });
    const { filesQueued, ordersKept } = await this.repo.erase(tx, row.id, row.uuid, retainYears);
    this.logger.log({ orgUuid: row.uuid, filesQueued, ordersKept }, 'workspace erased');
  }

  // ---- platform admin operations -------------------------------------------

  async list(q: ListOrgLifecycleQuery): Promise<{
    data: OrgLifecycleResponse[];
    page: { nextCursor: string | null; hasMore: boolean; limit: number };
  }> {
    const cursor = q.cursor ? decodeCursor(q.cursor) : undefined;
    const now = new Date();
    const rows = await this.db.privileged((tx) =>
      this.repo.list(tx, {
        status: q.status,
        minDaysInactive: q.minDaysInactive,
        exempt: q.exempt === undefined ? undefined : q.exempt === 'true',
        limit: q.limit,
        cursor,
        asc: q.order === 'asc',
      }),
    );
    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      data: page.map((r) => this.toResponse(r, now)),
      page: {
        nextCursor: hasMore && last ? encodeCursor(new Date(last.last_activity_at), last.id) : null,
        hasMore,
        limit: q.limit,
      },
    };
  }

  async get(uuid: string): Promise<OrgLifecycleResponse> {
    const row = await this.db.privileged((tx) => this.repo.findByUuid(tx, uuid));
    if (!row) throw AppError.notFound('Workspace', uuid);
    return this.toResponse(row, new Date());
  }

  async history(uuid: string, limit = 100): Promise<OrgLifecycleLogEntry[]> {
    const rows = await this.db.privileged((tx) => this.repo.log(tx, uuid, limit));
    return rows.map((r) => ({
      eventType: r.event_type as string,
      stage: (r.stage as 'archive' | 'delete' | null) ?? null,
      reminderNo: (r.reminder_no as number | null) ?? null,
      daysInactive: (r.days_inactive as number | null) ?? null,
      actorType: r.actor_type as string,
      actorRef: (r.actor_ref as string | null) ?? null,
      details: (r.details as Record<string, unknown>) ?? {},
      createdAt: new Date(r.created_at as string).toISOString(),
    }));
  }

  async updatePolicy(
    uuid: string,
    input: UpdateOrgRetentionPolicyInput,
    actor: Actor,
  ): Promise<OrgLifecycleResponse> {
    return this.mutate(uuid, actor, async (tx, row) => {
      const next = {
        archiveAfterDays:
          input.archiveAfterDays === undefined ? row.archive_after_days : input.archiveAfterDays,
        deleteAfterDays:
          input.deleteAfterDays === undefined ? row.delete_after_days : input.deleteAfterDays,
      };
      const archive = next.archiveAfterDays ?? DEFAULT_ARCHIVE_AFTER_DAYS;
      const del = next.deleteAfterDays ?? DEFAULT_DELETE_AFTER_DAYS;
      if (del < archive + MIN_DELETE_GAP_DAYS) {
        throw AppError.validation(
          `delete must be at least ${MIN_DELETE_GAP_DAYS} days after archive`,
          [{ path: 'deleteAfterDays', message: `effective archive ${archive}, delete ${del}` }],
        );
      }
      await this.repo.setPolicy(tx, row.id, input);
      await this.repo.writeLog(tx, {
        orgId: row.id,
        orgUuid: row.uuid,
        eventType: 'policy_changed',
        actorType: actor.type,
        actorRef: actor.ref,
        details: {
          reason: input.reason,
          from: {
            archiveAfterDays: row.archive_after_days,
            deleteAfterDays: row.delete_after_days,
          },
          to: next,
        },
      });
    });
  }

  async setExempt(
    uuid: string,
    input: SetOrgRetentionExemptInput,
    actor: Actor,
  ): Promise<OrgLifecycleResponse> {
    return this.mutate(uuid, actor, async (tx, row) => {
      const until = input.exempt && input.until ? new Date(input.until) : null;
      if (until && until.getTime() <= Date.now()) {
        throw AppError.validation('until must be in the future', [
          { path: 'until', message: 'in the past' },
        ]);
      }
      await this.repo.setExempt(tx, row.id, {
        exempt: input.exempt,
        reason: input.reason,
        until,
        by: actor.ref ?? actor.type,
      });
      await this.repo.writeLog(tx, {
        orgId: row.id,
        orgUuid: row.uuid,
        eventType: input.exempt ? 'exemption_set' : 'exemption_cleared',
        actorType: actor.type,
        actorRef: actor.ref,
        details: { reason: input.reason, until: until?.toISOString() ?? null },
      });
    });
  }

  async setLegalHold(
    uuid: string,
    input: SetOrgLegalHoldInput,
    actor: Actor,
  ): Promise<OrgLifecycleResponse> {
    return this.mutate(uuid, actor, async (tx, row) => {
      await this.repo.setLegalHold(tx, row.id, input.legalHold);
      await this.repo.writeLog(tx, {
        orgId: row.id,
        orgUuid: row.uuid,
        eventType: input.legalHold ? 'legal_hold_set' : 'legal_hold_cleared',
        actorType: actor.type,
        actorRef: actor.ref,
        details: { reason: input.reason },
      });
    });
  }

  async restore(uuid: string, input: RestoreOrgInput, actor: Actor): Promise<OrgLifecycleResponse> {
    return this.mutate(uuid, actor, async (tx, row) => {
      if (row.status !== 'archived')
        throw AppError.validation('only an archived workspace can be restored');
      await this.repo.restore(tx, row.id);
      await this.repo.writeLog(tx, {
        orgId: row.id,
        orgUuid: row.uuid,
        eventType: 'restored',
        actorType: actor.type,
        actorRef: actor.ref,
        details: { reason: input.reason },
      });
      await this.outbox.emit(tx, {
        orgId: row.id,
        aggregateModule: 'organizations',
        aggregateId: row.id,
        eventType: 'org.restored',
        payload: { restoredBy: actor.type },
      });
    });
  }

  private async mutate(
    uuid: string,
    _actor: Actor,
    fn: (tx: Tx, row: LifecycleRow) => Promise<void>,
  ): Promise<OrgLifecycleResponse> {
    const row = await this.db.privileged(async (tx) => {
      const locked = await this.repo.findByUuid(tx, uuid, true);
      if (!locked) throw AppError.notFound('Workspace', uuid);
      await fn(tx, locked);
      return (await this.repo.findByUuid(tx, uuid))!;
    });
    return this.toResponse(row, new Date());
  }

  // ---- mapping --------------------------------------------------------------

  private toResponse(r: LifecycleRow, now: Date): OrgLifecycleResponse {
    const state = toState(r);
    const limits = effectiveDays(state);
    const due = scheduledDates(state, now);
    return {
      id: r.uuid,
      name: r.name,
      slug: r.slug,
      status: r.status as OrgLifecycleResponse['status'],
      lastActivityAt: state.lastActivityAt.toISOString(),
      daysInactive: daysBetween(state.lastActivityAt, now),
      archivedAt: state.archivedAt?.toISOString() ?? null,
      archiveAfterDays: limits.archive,
      deleteAfterDays: limits.delete,
      archiveOverride: r.archive_after_days,
      deleteOverride: r.delete_after_days,
      scheduledArchiveAt: due.archiveAt?.toISOString() ?? null,
      scheduledDeleteAt: due.deleteAt?.toISOString() ?? null,
      retentionExempt: r.retention_exempt,
      retentionExemptReason: r.retention_exempt_reason,
      retentionExemptUntil: state.retentionExemptUntil?.toISOString() ?? null,
      retentionExemptBy: r.retention_exempt_by,
      legalHold: r.legal_hold,
      exemptByPlan: r.exempt_by_plan,
      remindersSent: { archive: r.reminders_archive, delete: r.reminders_delete },
    };
  }
}

function encodeCursor(at: Date, id: number): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}
function decodeCursor(c: string): { at: Date; id: number } | undefined {
  const [a, i] = Buffer.from(c, 'base64url').toString('utf8').split('|');
  const at = new Date(a ?? '');
  const id = Number.parseInt(i ?? '', 10);
  return Number.isNaN(at.getTime()) || Number.isNaN(id) ? undefined : { at, id };
}
