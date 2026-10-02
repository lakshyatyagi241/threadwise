import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../../infra/db/database.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';

const BATCH = 200;

/**
 * The overdue sweep (WD-INV-030, D-02): WaDesk stored `due_at` and never read it. Every ten minutes it claims issued invoices that
 * still have a balance and whose due DATE is before today IN THE WORKSPACE'S OWN CALENDAR, stamps `overdue_at` and writes one
 * `invoice.overdue` event and one timeline entry each, in one transaction: an invoice is announced once however many workers run,
 * and a crash between the stamp and the event cannot happen. The status itself is derived from the due date on every read, so the
 * sweep exists for the event (the hook a reminder consumer subscribes to), not to keep a status column honest.
 *
 * The event carries whether the workspace wants reminders, so the consumer decides without a second lookup.
 *
 * Runs privileged: it spans every workspace by definition (one of the sanctioned uses). Imported by WorkersModule only.
 */
@Injectable()
export class InvoiceOverdueSweepService {
  private readonly logger = new Logger(InvoiceOverdueSweepService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
  ) {}

  @Interval(600_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.sweep();
      if (n > 0) this.logger.debug({ overdue: n }, 'invoice overdue sweep');
    } catch (err) {
      this.logger.error({ err }, 'invoice overdue sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** One pass. Returns how many invoices were stamped and announced. */
  async sweep(limit = BATCH): Promise<number> {
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        WITH claimed AS (
          SELECT i.org_id, i.id FROM invoices i
          JOIN organizations o ON o.id = i.org_id
          WHERE i.status = 'issued' AND i.payment_status <> 'paid' AND i.overdue_at IS NULL AND i.due_date IS NOT NULL
            -- an unrecognised time zone name falls back to UTC instead of failing the sweep for everyone
            AND i.due_date < (now() AT TIME ZONE coalesce(
                  (SELECT n.name FROM pg_timezone_names n WHERE n.name = o.settings ->> 'timezone'), 'UTC'))::date
          ORDER BY i.due_date, i.id
          LIMIT ${limit}
          FOR UPDATE OF i SKIP LOCKED
        ), stamped AS (
          UPDATE invoices t SET overdue_at = now()
          FROM claimed WHERE t.org_id = claimed.org_id AND t.id = claimed.id
          RETURNING t.org_id, t.id, t.uuid, t.invoice_number, t.currency, t.currency_exponent, t.total_minor, t.paid_minor, t.credited_minor,
                    t.due_date, t.contact_id, t.deal_id, t.owner_id
        ), logged AS (
          INSERT INTO invoice_logs (org_id, invoice_id, event, detail, actor_kind)
          SELECT org_id, id, 'overdue', to_char(due_date, 'YYYY-MM-DD'), 'system' FROM stamped RETURNING invoice_id
        )
        SELECT s.org_id, s.id, s.uuid, s.invoice_number, s.currency, s.currency_exponent, (s.total_minor - s.paid_minor - s.credited_minor)::text AS balance,
               to_char(s.due_date, 'YYYY-MM-DD') AS due_date, c.uuid AS contact_uuid, d.uuid AS deal_uuid, u.uuid AS owner_uuid,
               coalesce((SELECT st.overdue_reminders FROM invoice_settings st WHERE st.org_id = s.org_id), true) AS reminders
        FROM stamped s
        LEFT JOIN contacts c ON c.org_id = s.org_id AND c.id = s.contact_id
        LEFT JOIN deals d ON d.org_id = s.org_id AND d.id = s.deal_id
        LEFT JOIN users u ON u.org_id = s.org_id AND u.id = s.owner_id
      `);
      for (const r of res.rows as Array<Record<string, unknown>>) {
        await this.outbox.emit(tx, {
          orgId: Number(r.org_id),
          aggregateModule: 'invoices',
          aggregateId: Number(r.id),
          eventType: 'invoice.overdue',
          payload: {
            uuid: r.uuid,
            number: r.invoice_number,
            currency: r.currency,
            balanceMinor: r.balance,
            currencyExponent: Number(r.currency_exponent),
            dueDate: r.due_date,
            contactId: r.contact_uuid ?? null,
            dealId: r.deal_uuid ?? null,
            ownerId: r.owner_uuid ?? null,
            remindersEnabled: r.reminders === true,
          },
        });
      }
      return res.rows.length;
    });
  }
}
