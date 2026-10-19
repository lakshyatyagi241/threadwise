import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { PlanStore } from './plan-store';

/**
 * The tables a wipe empties, children before parents, mapped from Reference's list onto this schema (TW-PLAN-023). A table that does not
 * exist yet (its domain is not built) is skipped, so the list can name tables ahead of their migrations. Partitioned tables are emptied
 * through their parent. Rows are matched by `org_id` only.
 *
 * NOT wiped (as in Reference): the workspace, its owner and members, orders, subscriptions, the wallet, invoices, tags, companies, tasks,
 * custom field definitions, media files, integration settings. Reference's list also names `attributes`; its own rule 3 says custom fields
 * are kept, so field definitions are kept here (the contradiction is recorded in the inventory).
 */
export const WIPE_TABLES: readonly string[] = [
  'inbox_messages',
  'conversation_participants',
  'conversation_events',
  'conversation_notes',
  'conversation_tag',
  'broadcast_contacts',
  'messages',
  'scheduled_message_contacts',
  'scheduled_messages',
  'flow_retry_logs',
  'flow_subscribers',
  'flows',
  'keyword_reply_logs',
  'keyword_reply_contents',
  'auto_reply_lookups',
  'keyword_replies',
  'deal_activities',
  'deals',
  'wa_order_items',
  'wa_orders',
  'ai_agents',
  'ai_training_sources',
  'ai_chat_assistants',
  'ai_call_assistants',
  'appointments',
  'saved_replies',
  'chatbot_widget_visitors',
  'chatbot_widgets',
  'incoming_webhook_events',
  'incoming_webhooks',
  'contact_group_members',
  'contact_groups',
  'conversations',
  'broadcasts',
  'wa_templates',
  'contacts',
  'devices',
  'wa_provider_configs',
];

export interface WipeCandidate {
  orgId: number;
  slug: string;
  plan: string;
  planEndsAt: Date;
  retentionDays: number;
}

export interface WipeOutcome {
  orgId: number;
  slug: string;
  wiped: boolean;
  rows: Record<string, number>;
}

const MAX_PASSES = 4;

/**
 * Data-retention wipe of lapsed workspaces (TW-PLAN-023). A plan may carry `data_retention_days` (0 = never). A workspace whose PAID plan
 * ended more than that many days ago, and that was not wiped before, loses its data once. Destructive and opt-in per plan.
 *
 * Differences from Reference, all deliberate:
 *   - one workspace per transaction, so a failure rolls that workspace back whole (Reference could leave it half-deleted) and the next run retries it
 *   - dry run is a first-class mode and the default for the operator preview
 *   - every wipe is audited and emits `org.data_wiped` (Reference wrote nothing)
 *   - it runs from the worker's own schedule, not from a Node-bridge heartbeat
 *   - the plan is switched to the free plan instead of being set to NULL (`organizations.plan` is NOT NULL); the plan end date stays in the
 *     past, so the workspace remains lapsed and on the free plan's entitlements
 * A free-trial-expired workspace has no end date and is never wiped (rule 1).
 */
@Injectable()
export class PlanRetentionService {
  private readonly logger = new Logger(PlanRetentionService.name);

  constructor(
    private readonly store: PlanStore,
    private readonly outbox: OutboxService,
  ) {}

  /** Workspaces due for a wipe at `now`, oldest lapse first. */
  async candidates(now = new Date(), limit = 100): Promise<WipeCandidate[]> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT o.id, o.slug, o.plan, s.plan_ends_at, coalesce((s.overrides->>'dataRetentionDays')::int, p.data_retention_days) AS data_retention_days
        FROM org_plan_state s
        JOIN organizations o ON o.id = s.org_id
        JOIN plans p ON p.slug = o.plan AND p.kind = 'plan'
        WHERE s.data_wiped_at IS NULL AND s.plan_ends_at IS NOT NULL AND coalesce((s.overrides->>'dataRetentionDays')::int, p.data_retention_days) > 0
          AND NOT s.platform_owned
          -- A workspace with a legal hold (BL-295) is never wiped: the wipe would delete the held records too.
          AND NOT org_has_active_legal_hold(o.id)
          AND s.plan_ends_at < ${now.toISOString()}::timestamptz - (coalesce((s.overrides->>'dataRetentionDays')::int, p.data_retention_days) * interval '1 day')
        ORDER BY s.plan_ends_at, o.id LIMIT ${limit}`);
      return (
        res.rows as unknown as Array<{
          id: string | number;
          slug: string;
          plan: string;
          plan_ends_at: string;
          data_retention_days: number;
        }>
      ).map((r) => ({
        orgId: Number(r.id),
        slug: r.slug,
        plan: r.plan,
        planEndsAt: new Date(r.plan_ends_at),
        retentionDays: Number(r.data_retention_days),
      }));
    });
  }

  /** One pass: wipe (or, with `dryRun`, only count) every due workspace. */
  async sweep(opts: { dryRun?: boolean; now?: Date; limit?: number } = {}): Promise<WipeOutcome[]> {
    const due = await this.candidates(opts.now, opts.limit);
    const out: WipeOutcome[] = [];
    for (const c of due) {
      try {
        out.push(await this.wipe(c, opts.dryRun ?? false, opts.now ?? new Date()));
      } catch (err) {
        // One workspace failing must not stop the others; it rolled back whole and is retried on the next run.
        this.logger.error({ err, orgId: c.orgId }, 'data-retention wipe failed');
      }
    }
    return out;
  }

  async wipe(c: WipeCandidate, dryRun: boolean, now: Date): Promise<WipeOutcome> {
    return this.store
      .tx(async (tx) => {
        // Re-check under a lock: another worker may have wiped it, or the workspace may have renewed since the candidate list was read.
        const lock = await tx.execute(sql`
        SELECT s.plan_ends_at, s.data_wiped_at, coalesce((s.overrides->>'dataRetentionDays')::int, p.data_retention_days) AS data_retention_days
        FROM org_plan_state s JOIN organizations o ON o.id = s.org_id
        JOIN plans p ON p.slug = o.plan AND p.kind = 'plan'
        WHERE s.org_id = ${c.orgId} FOR UPDATE OF s`);
        const cur = lock.rows[0] as
          | {
              plan_ends_at: string | null;
              data_wiped_at: string | null;
              data_retention_days: number;
            }
          | undefined;
        const due =
          cur !== undefined &&
          cur.data_wiped_at === null &&
          cur.plan_ends_at !== null &&
          Number(cur.data_retention_days) > 0 &&
          new Date(cur.plan_ends_at).getTime() <
            now.getTime() - Number(cur.data_retention_days) * 86_400_000;
        if (!due) return { orgId: c.orgId, slug: c.slug, wiped: false, rows: {} };
        // A hold placed after the candidate list was read wins too (the hold takes this lock exclusively while it is placed).
        const held = await tx.execute(
          sql`SELECT pg_advisory_xact_lock_shared(7301995, ${Math.abs(c.orgId % 2147483647)}), org_has_active_legal_hold(${c.orgId}::bigint) AS held`,
        );
        if ((held.rows[0] as { held: boolean }).held) {
          this.logger.warn(
            { orgId: c.orgId, slug: c.slug },
            '[WIPE-EXPIRED] skipped: the workspace has a legal hold',
          );
          return { orgId: c.orgId, slug: c.slug, wiped: false, rows: {} };
        }

        const rows = await this.deleteAll(tx, c.orgId);
        if (dryRun) {
          // Nothing may survive a dry run: the transaction rolls back by throwing a marker the caller treats as success.
          throw new DryRun({ orgId: c.orgId, slug: c.slug, wiped: false, rows });
        }

        const free = await tx.execute(sql`
        SELECT slug FROM plans WHERE kind = 'plan' AND is_active AND NOT is_custom_quote AND (is_free OR amount = 0)
        ORDER BY sort_order, amount, slug LIMIT 1`);
        const freeSlug = (free.rows[0] as { slug: string } | undefined)?.slug ?? 'starter';
        await tx.execute(sql`UPDATE organizations SET plan = ${freeSlug} WHERE id = ${c.orgId}`);
        await tx.execute(
          sql`UPDATE org_plan_state SET data_wiped_at = now() WHERE org_id = ${c.orgId}`,
        );
        const total = Object.values(rows).reduce((a, b) => a + b, 0);
        await tx.execute(sql`
        INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta)
        VALUES (${c.orgId}, NULL, 'system', 'plans', ${c.orgId}, 'delete',
          ${JSON.stringify({ wiped: { old: null, new: true }, plan: { old: c.plan, new: freeSlug }, rows: { old: null, new: rows } })}::jsonb)`);
        await this.outbox.emit(tx, {
          aggregateModule: 'plans',
          aggregateId: c.orgId,
          eventType: 'org.data_wiped',
          orgId: c.orgId,
          payload: {
            plan: c.plan,
            retentionDays: c.retentionDays,
            planEndsAt: c.planEndsAt.toISOString(),
            rowsDeleted: total,
          },
        });
        this.logger.warn(
          { orgId: c.orgId, slug: c.slug, rowsDeleted: total },
          '[WIPE-EXPIRED] workspace data wiped',
        );
        return { orgId: c.orgId, slug: c.slug, wiped: true, rows };
      })
      .catch((err: unknown) => {
        if (err instanceof DryRun) return err.outcome;
        throw err;
      });
  }

  /**
   * Deletes the workspace's rows table by table. A foreign key that still points at rows of a table deleted later makes a DELETE fail;
   * each attempt runs in a savepoint and failed tables are retried after the others (up to MAX_PASSES), so the order above does not have
   * to be perfect and a new table with a reference cannot wedge the sweep. Anything still failing aborts the whole workspace.
   */
  private async deleteAll(tx: Tx, orgId: number): Promise<Record<string, number>> {
    const present = await tx.execute(sql`
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped
      WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND c.relname IN (${sql.join(
        WIPE_TABLES.map((t) => sql`${t}`),
        sql`, `,
      )})`);
    const existing = new Set((present.rows as Array<{ relname: string }>).map((r) => r.relname));
    let pending = WIPE_TABLES.filter((t) => existing.has(t));
    const counts: Record<string, number> = {};
    let lastError: unknown = null;

    for (let pass = 0; pass < MAX_PASSES && pending.length > 0; pass++) {
      const failed: string[] = [];
      for (const table of pending) {
        try {
          await tx.execute(sql`SAVEPOINT wipe_table`);
          const res = await tx.execute(
            sql`DELETE FROM ${sql.identifier(table)} WHERE org_id = ${orgId} RETURNING 1`,
          );
          await tx.execute(sql`RELEASE SAVEPOINT wipe_table`);
          counts[table] = (counts[table] ?? 0) + res.rows.length;
        } catch (err) {
          await tx.execute(sql`ROLLBACK TO SAVEPOINT wipe_table`);
          lastError = err;
          failed.push(table);
        }
      }
      pending = failed;
    }
    if (pending.length > 0) {
      throw new Error(
        `wipe could not delete from ${pending.join(', ')}: ${(lastError as Error | null)?.message ?? 'unknown'}`,
      );
    }
    return counts;
  }
}

class DryRun extends Error {
  constructor(readonly outcome: WipeOutcome) {
    super('dry run');
  }
}
