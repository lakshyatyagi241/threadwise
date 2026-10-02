import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql, type SQL } from 'drizzle-orm';
import {
  ERROR_CODES,
  cmsContactSubmitRequestSchema,
  type CmsContactListQuery,
  type CmsContactListResponse,
  type CmsContactMessage,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage, decodeCursor } from '../../common/pagination/cursor';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import {
  MAIL_PORT,
  type MailPort,
} from '../../infra/providers/auth-registration-security/mail.port';
import {
  AuthAuditService,
  CaptchaService,
  PlatformSettingsService,
  RateLimitService,
} from '../auth';
import { CMS_EVENTS, iso, num, operatorId } from './cms-context';
import { escapeLike } from './cms-rules';
import { CmsStore } from './cms-store';

const SUBMISSIONS_PER_MINUTE = 6;

interface Row {
  id: string | number;
  uuid: string;
  name: string;
  email: string;
  company: string | null;
  topic: string | null;
  message: string;
  ip: string | null;
  user_agent: string | null;
  is_read: boolean;
  created_at: Date | string;
  created_iso: string;
  row_version: number;
}

const COLS =
  sql.raw(`id, uuid, name, email, company, topic, message, ip, user_agent, is_read, created_at,
  to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_iso, row_version`);

const toMessage = (r: Row): CmsContactMessage => ({
  id: r.uuid,
  name: r.name,
  email: r.email,
  company: r.company,
  topic: r.topic,
  message: r.message,
  ip: r.ip,
  userAgent: r.user_agent,
  isRead: r.is_read,
  createdAt: iso(r.created_at)!,
  rowVersion: num(r.row_version),
});

/**
 * The public contact form and the operator's inbox (WD-CMS-005/006/042/043).
 *
 * The visitor's request writes through the table's INSERT-only policy (no privilege, no RETURNING). The order of the
 * checks is WaDesk's: throttle, honeypot (silent success, nothing stored), captcha, validation, store, notify. A mail
 * failure never reaches the visitor: the message is already stored.
 */
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);
  private readonly brand: string;
  private readonly fallbackTo: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly store: CmsStore,
    private readonly audit: AuthAuditService,
    private readonly rate: RateLimitService,
    private readonly captcha: CaptchaService,
    private readonly settings: PlatformSettingsService,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    config: ConfigService<Env, true>,
  ) {
    this.brand = config.get('APP_NAME', { infer: true });
    this.fallbackTo = config.get('SMTP_FROM', { infer: true });
  }

  async submit(raw: unknown): Promise<void> {
    const ctx = RequestContextStore.peek();
    const ip = ctx?.ip ?? 'unknown';
    const window = await this.rate.hit(`cms:contact:${ip}`, 60);
    if (window.count > SUBMISSIONS_PER_MINUTE) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Too many messages. Please wait a minute and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    if (typeof body.website === 'string' && body.website.trim() !== '') return;

    await this.captcha.assert(
      typeof body.captchaToken === 'string' ? body.captchaToken : undefined,
      'contact',
    );

    const parsed = cmsContactSubmitRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.validation(
        'Please check the form and try again.',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    const m = parsed.data;
    await this.db.primary.execute(sql`
      INSERT INTO contact_messages (name, email, company, topic, message, ip, user_agent)
      VALUES (${m.name}, ${m.email}, ${m.company?.trim() || null}, ${m.topic ?? null}, ${m.message},
              ${ctx?.ip ?? null}, ${ctx?.userAgent?.slice(0, 255) ?? null})
    `);
    await this.notify(m).catch((err: unknown) =>
      this.logger.warn({ err }, 'contact notification mail failed; the message is stored'),
    );
  }

  private async notify(m: {
    name: string;
    email: string;
    company?: string | null;
    topic?: string | null;
    message: string;
  }) {
    const to = (await this.settings.get<string>('site.email_support')) || this.fallbackTo;
    if (!to) return;
    await this.mail.send({
      to,
      replyTo: m.email,
      subject: `[${this.brand}] Contact: ${m.topic ?? 'enquiry'} from ${m.name}`,
      text: [
        `Name: ${m.name}`,
        `Email: ${m.email}`,
        `Company: ${m.company ?? ''}`,
        `Topic: ${m.topic ?? ''}`,
        '',
        m.message,
      ].join('\n'),
    });
  }

  // --- operator inbox ---------------------------------------------------------------------------------------------------

  async list(q: CmsContactListQuery): Promise<CmsContactListResponse> {
    const conds: SQL[] = [sql`TRUE`];
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      conds.push(
        sql`(name ILIKE ${like} OR email ILIKE ${like} OR company ILIKE ${like} OR message ILIKE ${like})`,
      );
    }
    if (q.status) conds.push(sql`is_read = ${q.status === 'read'}`);
    if (q.topic) conds.push(sql`topic = ${q.topic}`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      conds.push(
        sql`(created_at, id) < (${c.createdAtIso ?? c.createdAt.toISOString()}::timestamptz, ${c.id})`,
      );
    }
    return this.store.tx(async (tx) => {
      const rows = await tx.execute(
        sql`SELECT ${COLS} FROM contact_messages WHERE ${sql.join(conds, sql` AND `)} ORDER BY created_at DESC, id DESC LIMIT ${q.limit + 1}`,
      );
      const kpi = await tx.execute(
        sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE NOT is_read)::int AS unread FROM contact_messages`,
      );
      const wrapped = (rows.rows as unknown as Row[]).map((r) => ({
        item: toMessage(r),
        id: num(r.id),
        createdAt: new Date(r.created_at),
        createdAtIso: r.created_iso,
      }));
      const { items, page } = buildPage(wrapped, q.limit);
      const k = kpi.rows[0] as { total: number; unread: number };
      return {
        data: items.map((w) => w.item),
        page,
        summary: { total: num(k.total), unread: num(k.unread) },
      };
    });
  }

  async setRead(uuid: string, isRead: boolean): Promise<CmsContactMessage> {
    operatorId();
    return this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`UPDATE contact_messages SET is_read = ${isRead} WHERE uuid = ${uuid} RETURNING ${COLS}`,
      );
      const row = res.rows[0] as unknown as Row | undefined;
      if (!row) throw AppError.notFound('Message', uuid);
      return toMessage(row);
    });
  }

  /** Every unread message becomes read (WD-CMS-043). Idempotent: a second call updates nothing. */
  async markAllRead(): Promise<{ updated: number }> {
    operatorId();
    return this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`UPDATE contact_messages SET is_read = TRUE WHERE NOT is_read RETURNING 1`,
      );
      return { updated: res.rows.length };
    });
  }

  async remove(uuid: string): Promise<void> {
    operatorId();
    await this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`DELETE FROM contact_messages WHERE uuid = ${uuid} RETURNING email`,
      );
      const row = res.rows[0] as { email: string } | undefined;
      if (!row) throw AppError.notFound('Message', uuid);
      // WaDesk labelled this audit row with the sender's address (WD-CMS-043 rule 3).
      await this.audit.record(tx, {
        event: CMS_EVENTS.contactDeleted,
        status: 'success',
        payload: { uuid, email: row.email },
      });
    });
  }
}
