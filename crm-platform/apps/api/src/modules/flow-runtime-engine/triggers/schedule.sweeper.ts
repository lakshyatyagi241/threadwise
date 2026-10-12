import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import {
  flbTriggerConfig,
  type FlbDateFieldMatchConfig,
  type FlbScheduleConfig,
} from '@crm/contracts';
import { DatabaseService } from '../../../infra/db/database.service';
import { SegmentsService } from '../../crm';
import { dueDay, dueOccurrence, localMoment } from './schedule-rules';
import { FlowTriggerService } from './trigger.service';

/** The most people one occurrence starts the flow for: a schedule is not a broadcast (those have their own limits and billing). */
export const SCHEDULE_AUDIENCE_CAP = 5000;

type Rows = { rows: Array<Record<string, unknown>> };

const shiftDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The two triggers that start on the clock, not on an event (the team's workflow gap list):
 *
 *  - `schedule`: at a time of day on chosen days (once, daily, weekly, monthly), for everyone, a list or a segment.
 *  - `date_field_match`: a day before, on or after a date held in a contact field (a birthday, a renewal), at a time of day; the
 *    month and day only, when it repeats yearly.
 *
 * Each minute every live flow of those kinds is checked against its zone's wall clock (the flow's own zone, else the workspace's).
 * The occurrence is claimed first with a compare-and-set on `flows.trigger_last_occurrence`, so two workers, or a restart in the
 * middle, fire it once. A person's run is its own reason (`<kind>:<flow>:<day>`), so a recurring flow runs again for the same person.
 * Opted-out and archived contacts, and contacts with no number, are left out. Runs privileged: flows span every tenant.
 */
@Injectable()
export class FlowScheduleSweeper {
  private readonly logger = new Logger(FlowScheduleSweeper.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly triggers: FlowTriggerService,
    private readonly segments: SegmentsService,
  ) {}

  @Interval(60_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.tickOnce();
    } catch (err) {
      this.logger.error({ err }, '[FLR] schedule sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** Public for tests. */
  async tickOnce(now: Date = new Date()): Promise<{ fired: number; started: number }> {
    const flows = await this.db.privileged(async (tx) => {
      const res = (await tx.execute(sql`
        SELECT f.id, f.org_id, f.trigger_kind, f.trigger_config, f.trigger_last_occurrence,
               coalesce(ws.timezone, 'UTC') AS tz
          FROM flows f LEFT JOIN workspace_settings ws ON ws.org_id = f.org_id
         WHERE f.is_published AND f.is_active AND f.trigger_kind IN ('schedule', 'date_field_match')
         ORDER BY f.id`)) as unknown as Rows;
      return res.rows;
    });
    let fired = 0;
    let started = 0;
    for (const f of flows) {
      const orgId = Number(f.org_id);
      const flowId = Number(f.id);
      try {
        const kind = String(f.trigger_kind);
        const raw =
          f.trigger_config !== null && typeof f.trigger_config === 'object'
            ? (f.trigger_config as Record<string, unknown>)
            : {};
        const cfg = flbTriggerConfig(kind, raw);
        if (!cfg) continue;
        const last = (f.trigger_last_occurrence as string | null) ?? null;
        const zone =
          (kind === 'schedule' ? (cfg as FlbScheduleConfig).timezone : '') || String(f.tz);
        const at = localMoment(now, zone);
        const key =
          kind === 'schedule'
            ? dueOccurrence(cfg as FlbScheduleConfig, at, last)
            : dueDay((cfg as FlbDateFieldMatchConfig).time, at, last);
        if (key === null) continue;
        const claimed = await this.db.privileged(async (tx) => {
          const res = (await tx.execute(sql`
            UPDATE flows SET trigger_last_occurrence = ${key}
             WHERE org_id = ${orgId} AND id = ${flowId} AND trigger_last_occurrence IS NOT DISTINCT FROM ${last} RETURNING id`)) as unknown as Rows;
          return res.rows.length > 0;
        });
        if (!claimed) continue;
        fired++;
        const people =
          kind === 'schedule'
            ? await this.audience(orgId, cfg as FlbScheduleConfig)
            : await this.dateMatches(orgId, cfg as FlbDateFieldMatchConfig, at.date);
        started += await this.triggers.enrolContacts(
          orgId,
          flowId,
          people,
          kind === 'schedule' ? 'schedule' : 'date_field_match',
          `${kind}:${flowId}:${key}`,
        );
      } catch (err) {
        this.logger.warn(
          { orgId, flowId, err: (err as Error).message },
          '[FLR] scheduled trigger failed',
        );
      }
    }
    return { fired, started };
  }

  private async audience(orgId: number, cfg: FlbScheduleConfig): Promise<number[]> {
    const { kind, ref } = cfg.audience;
    if (kind === 'segment') {
      return ref === '' ? [] : this.segments.memberIdsFromFlow(orgId, ref, SCHEDULE_AUDIENCE_CAP);
    }
    return this.db.txAs({ orgId }, async (tx) => {
      const res = (await (kind === 'group'
        ? tx.execute(sql`
            SELECT c.id FROM contact_group_members m
              JOIN contact_groups g ON g.org_id = m.org_id AND g.id = m.group_id AND g.uuid::text = ${ref}
              JOIN contacts c ON c.org_id = m.org_id AND c.id = m.contact_id
             WHERE m.org_id = ${orgId} AND NOT c.is_archived AND NOT c.is_unsubscribed AND c.phone IS NOT NULL
             ORDER BY c.id LIMIT ${SCHEDULE_AUDIENCE_CAP}`)
        : tx.execute(sql`
            SELECT id FROM contacts
             WHERE org_id = ${orgId} AND NOT is_archived AND NOT is_unsubscribed AND phone IS NOT NULL
             ORDER BY id LIMIT ${SCHEDULE_AUDIENCE_CAP}`))) as unknown as Rows;
      return res.rows.map((r) => Number(r.id));
    });
  }

  /**
   * Contacts whose date field, moved by the flow's offset, is today. Compared as text (a bad date in a custom field cannot fail the
   * query): the whole `YYYY-MM-DD`, or only `MM-DD` when it repeats yearly. "Before" means the check runs N days before the date.
   */
  private async dateMatches(
    orgId: number,
    cfg: FlbDateFieldMatchConfig,
    today: string,
  ): Promise<number[]> {
    if (cfg.field === '') return [];
    const target = shiftDays(
      today,
      cfg.direction === 'before' ? cfg.days : cfg.direction === 'after' ? -cfg.days : 0,
    );
    return this.db.txAs({ orgId }, async (tx) => {
      const res = (await tx.execute(
        cfg.yearly
          ? sql`SELECT id FROM contacts
                 WHERE org_id = ${orgId} AND NOT is_archived AND NOT is_unsubscribed AND phone IS NOT NULL
                   AND (data->>${cfg.field}) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND substr(data->>${cfg.field}, 6, 5) = ${target.slice(5)}
                 ORDER BY id LIMIT ${SCHEDULE_AUDIENCE_CAP}`
          : sql`SELECT id FROM contacts
                 WHERE org_id = ${orgId} AND NOT is_archived AND NOT is_unsubscribed AND phone IS NOT NULL
                   AND left(data->>${cfg.field}, 10) = ${target}
                 ORDER BY id LIMIT ${SCHEDULE_AUDIENCE_CAP}`,
      )) as unknown as Rows;
      return res.rows.map((r) => Number(r.id));
    });
  }
}
