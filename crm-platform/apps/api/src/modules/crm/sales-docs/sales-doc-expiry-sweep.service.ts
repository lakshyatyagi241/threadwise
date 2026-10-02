import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../../infra/db/database.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { resolveTimezone, todayIn } from '../deals/deal-calendar';
import { SALES_DOC_MODULE } from './sales-doc-rules';
import { SalesDocsRepository } from './sales-docs.repository';

const BATCH = 200;

/**
 * The expiry sweep (WD-PROP-004, D-05): sent and viewed documents whose valid-until date has gone by become `expired`, whether or
 * not anyone opens the list (WaDesk flipped them only when a staff member listed that type, and left the buyer's page showing an
 * open offer, so a lapsed price could still be accepted). The public page and the accept route also test the date at read time, so
 * the gap between two sweeps is never visible to a buyer.
 *
 * A document is valid through the WHOLE of its valid-until day in the workspace's time zone (`settings.timezone`, UTC when unset), so
 * each organization is swept against its own "today". Per organization it claims a batch with FOR UPDATE SKIP LOCKED, flips it, and
 * writes the timeline row, the audit row and the `salesdoc.expired` event in the same transaction: however many workers run, a
 * document expires once and is announced once. Drafts do not expire (an unsent document has nobody to be late to), and nothing
 * accepted, declined or converted ever does.
 *
 * Runs privileged: it spans every workspace by definition (one of the sanctioned uses). Imported by WorkersModule only.
 */
@Injectable()
export class SalesDocExpirySweepService {
  private readonly logger = new Logger(SalesDocExpirySweepService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
    private readonly repo: SalesDocsRepository,
  ) {}

  @Interval(5 * 60_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.sweep();
      if (n > 0) this.logger.debug({ expired: n }, 'sales document expiry sweep');
    } catch (err) {
      this.logger.error({ err }, 'sales document expiry sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** One pass over every organization with candidates. Returns how many documents were expired. */
  async sweep(now: Date = new Date(), limit = BATCH): Promise<number> {
    // Candidates under the loosest "today" any zone can have (UTC+14), so the per-organization test below is the exact one.
    const orgs = await this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT d.org_id, o.settings ->> 'timezone' AS tz
        FROM sales_docs d JOIN organizations o ON o.id = d.org_id
        WHERE d.status IN ('sent', 'viewed') AND d.valid_until IS NOT NULL
          AND d.valid_until < ((${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')::date + 2)
        GROUP BY d.org_id, o.settings ->> 'timezone'
      `);
      return res.rows as Array<{ org_id: number | string; tz: string | null }>;
    });
    let total = 0;
    for (const o of orgs) {
      const today = todayIn(resolveTimezone(o.tz), now);
      total += await this.expireOrg(Number(o.org_id), today, limit);
    }
    return total;
  }

  private async expireOrg(orgId: number, today: string, limit: number): Promise<number> {
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        WITH claimed AS (
          SELECT org_id, id, status AS old_status FROM sales_docs
          WHERE org_id = ${orgId} AND status IN ('sent', 'viewed') AND valid_until < ${today}::date
          ORDER BY valid_until, id LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        ), expired AS (
          UPDATE sales_docs d SET status = 'expired'
          FROM claimed c WHERE d.org_id = c.org_id AND d.id = c.id
          RETURNING d.org_id, d.id, d.uuid, d.doc_type, d.number, d.currency, d.total_minor, d.revision, d.valid_until,
                    d.owner_id, d.created_by, d.contact_id, d.company_id, d.deal_id, d.source, c.old_status
        )
        SELECT e.*, ou.uuid AS owner_uuid, cu.uuid AS created_by_uuid, c.uuid AS contact_uuid, co.uuid AS company_uuid,
               dl.uuid AS deal_uuid
        FROM expired e
        LEFT JOIN users ou ON ou.org_id = e.org_id AND ou.id = e.owner_id
        LEFT JOIN users cu ON cu.org_id = e.org_id AND cu.id = e.created_by
        LEFT JOIN contacts c ON c.org_id = e.org_id AND c.id = e.contact_id
        LEFT JOIN companies co ON co.org_id = e.org_id AND co.id = e.company_id
        LEFT JOIN deals dl ON dl.org_id = e.org_id AND dl.id = e.deal_id
      `);
      for (const r of res.rows as Array<Record<string, unknown>>) {
        const id = Number(r.id);
        await this.repo.insertEvent(tx, orgId, {
          docId: id,
          type: 'expired',
          actorKind: 'system',
          fromStatus: r.old_status as 'sent' | 'viewed',
          toStatus: 'expired',
          revision: Number(r.revision),
          meta: { validUntil: String(r.valid_until).slice(0, 10) },
        });
        await tx.execute(sql`
          INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta)
          VALUES (${orgId}, NULL, 'system', ${SALES_DOC_MODULE}, ${id}, 'update',
                  ${JSON.stringify({ status: { old: r.old_status, new: 'expired' } })}::jsonb)
        `);
        await this.outbox.emit(tx, {
          orgId,
          aggregateModule: SALES_DOC_MODULE,
          aggregateId: id,
          eventType: 'salesdoc.expired',
          payload: {
            uuid: r.uuid,
            kind: r.doc_type,
            number: r.number,
            status: 'expired',
            currency: r.currency,
            totalMinor: String(r.total_minor),
            revision: Number(r.revision),
            validUntil: String(r.valid_until).slice(0, 10),
            contactId: r.contact_uuid ?? null,
            companyId: r.company_uuid ?? null,
            dealId: r.deal_uuid ?? null,
            ownerId: r.owner_uuid ?? null,
            createdById: r.created_by_uuid ?? null,
            source: r.source,
          },
        });
      }
      return res.rows.length;
    });
  }
}
