import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import {
  ERROR_CODES,
  campaignSummarySchema,
  type CampaignSummary,
  type CampaignSummaryPeople,
  type CampaignSummaryPeopleQuery,
  type CampaignSummaryQuery,
  type SummaryFormRef,
  type SummaryFormsResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { pct } from '../campaign-rules';
import {
  CampaignSummaryRepository,
  type SummarySource,
} from './campaign-summary.repository';
import {
  SUMMARY_CACHE_SECONDS,
  SUMMARY_TIMEOUT_MS,
  cacheKey,
  caveatsOf,
  dayBuckets,
  decodeCursor,
  encodeCursor,
  secondsToHours,
  windowBounds,
} from './campaign-summary-rules';

const PERM_FORMS_READ = 'record.forms.read';
const PERM_SUBMISSIONS_READ = 'record.form-submissions.read';
/** The contract lists at most this many forms in `formsCounted`. */
const FORMS_LISTED = 50;
const PICKER_LIMIT = 200;

const isTimeout = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '57014' || e?.cause?.code === '57014';
};

/**
 * The director summary of a sent campaign or broadcast (an addition beyond Reference, which shows sent, delivered, read and failed,
 * and replies from the bridge). Counts are distinct people; "wrote back" is read live from the inbox. The finished summary is kept in
 * Redis for a minute per (workspace, campaign, window, forms, may-read-forms), so reopening it and a polling screen do not recompute.
 */
@Injectable()
export class CampaignSummaryService {
  private readonly logger = new Logger(CampaignSummaryService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CampaignSummaryRepository,
    private readonly rbac: RbacService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private canReadSubmissions(): boolean {
    const grants = RequestContextStore.require().grants ?? new Map();
    return this.rbac.can(grants, PERM_SUBMISSIONS_READ).allowed;
  }

  // -------------------------------------------------------------------------------------------------------------- summary

  async summary(
    source: SummarySource,
    uuid: string,
    q: CampaignSummaryQuery,
  ): Promise<CampaignSummary> {
    const { orgId } = RequestContextStore.require();
    const withForms = this.canReadSubmissions();
    // A viewer who may not read submissions gets (and fills) the entry that has no form figures, whatever forms they name.
    const formIds = withForms ? q.formIds : [];
    const key = `${cacheKey(orgId, source, uuid, q.cameBackDays, formIds)}:${withForms ? 'f' : 'n'}`;

    const hit = await this.cached(key);
    if (hit) return hit;

    const result = await this.compute(orgId, source, uuid, q.cameBackDays, formIds, withForms);
    await this.store(key, result);
    return result;
  }

  private async cached(key: string): Promise<CampaignSummary | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      const parsed = campaignSummarySchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      // Redis down or a stale shape: compute it again.
      return null;
    }
  }

  private async store(key: string, value: CampaignSummary): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', SUMMARY_CACHE_SECONDS);
    } catch (err) {
      this.logger.warn({ err: String(err) }, '[CAMP] summary cache write failed');
    }
  }

  private async compute(
    orgId: number,
    source: SummarySource,
    uuid: string,
    days: number,
    formIds: readonly string[],
    withForms: boolean,
  ): Promise<CampaignSummary> {
    try {
      return await this.db.tx(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('statement_timeout', ${String(SUMMARY_TIMEOUT_MS)}, true)`,
        );
        const head = await this.repo.header(tx, orgId, source, uuid);
        if (!head) throw AppError.notFound(source === 'campaign' ? 'Campaign' : 'Broadcast', uuid);

        const roll = await this.repo.rollup(tx, orgId, source, head.id);
        const bounds = windowBounds(roll.firstSentAt, roll.lastSentAt, days);

        // Which forms count. None picked = every form; a pick of forms that do not exist here counts nothing.
        let formsCounted: SummaryFormRef[] = [];
        let webForms: number[] | null = null;
        let waForms: number[] | null = null;
        if (withForms) {
          if (formIds.length > 0) {
            const picked = await this.repo.formsByUuid(tx, orgId, formIds);
            webForms = picked.filter((f) => f.kind === 'web').map((f) => f.id);
            waForms = picked.filter((f) => f.kind === 'whatsapp').map((f) => f.id);
            formsCounted = picked
              .slice(0, FORMS_LISTED)
              .map((f) => ({ id: f.uuid, kind: f.kind, name: f.name }));
          } else {
            const all = await this.repo.formsOf(
              tx,
              orgId,
              { web: true, whatsapp: true },
              FORMS_LISTED,
            );
            formsCounted = all
              .slice(0, FORMS_LISTED)
              .map((f) => ({ id: f.uuid, kind: f.kind, name: f.name }));
          }
        }

        const figures = bounds
          ? await this.repo.figures(tx, {
              orgId,
              source,
              id: head.id,
              days,
              from: bounds.from,
              to: bounds.to,
              webForms,
              waForms,
              withForms,
            })
          : null;

        const cameBack = figures?.cameBack ?? 0;
        const filled = figures?.filledForm ?? 0;
        return {
          id: uuid,
          kind: source,
          name: head.name,
          status: head.status,
          sentAt: roll.firstSentAt?.toISOString() ?? null,
          window: {
            days,
            from: bounds?.from.toISOString() ?? null,
            to: bounds?.to.toISOString() ?? null,
          },
          people: {
            messaged: roll.messaged,
            delivered: roll.delivered,
            read: roll.read,
            failed: roll.failed,
            notTrackable: figures?.notTrackable ?? 0,
          },
          cameBack: {
            count: cameBack,
            pctOfMessaged: pct(cameBack, roll.messaged),
            pctOfDelivered: pct(cameBack, roll.delivered),
            medianHoursToReply:
              figures?.medianSecs == null ? null : secondsToHours(figures.medianSecs),
          },
          filledForm: withForms
            ? {
                count: filled,
                pctOfMessaged: pct(filled, roll.messaged),
                alsoWroteBack: figures?.alsoWroteBack ?? 0,
                viaWebForm: figures?.viaWeb ?? 0,
                viaWhatsappForm: figures?.viaWhatsapp ?? 0,
                formsCounted,
                allForms: formIds.length === 0,
              }
            : null,
          cameBackByDay: dayBuckets(figures?.byDay ?? []),
          caveats: caveatsOf({
            notTrackable: figures?.notTrackable ?? 0,
            hasFilledForm: withForms,
            optedOutWroteBack: (figures?.optedOutWroteBack ?? 0) > 0,
            inOtherCampaigns: figures?.inOtherCampaigns ?? false,
          }),
        };
      });
    } catch (err) {
      if (isTimeout(err)) {
        throw new AppError(
          ERROR_CODES.INTERNAL,
          'The summary took too long to work out. Try again in a moment.',
          503,
        );
      }
      throw err;
    }
  }

  // --------------------------------------------------------------------------------------------------------------- people

  async people(
    source: SummarySource,
    uuid: string,
    q: CampaignSummaryPeopleQuery,
  ): Promise<CampaignSummaryPeople> {
    const { orgId } = RequestContextStore.require();
    if (q.kind === 'filled_form' && !this.canReadSubmissions()) {
      throw AppError.forbidden(PERM_SUBMISSIONS_READ);
    }
    const cursor = decodeCursor(q.cursor);
    try {
      return await this.db.tx(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('statement_timeout', ${String(SUMMARY_TIMEOUT_MS)}, true)`,
        );
        const head = await this.repo.header(tx, orgId, source, uuid);
        if (!head) throw AppError.notFound(source === 'campaign' ? 'Campaign' : 'Broadcast', uuid);

        const roll = await this.repo.rollup(tx, orgId, source, head.id);
        const bounds = windowBounds(roll.firstSentAt, roll.lastSentAt, q.cameBackDays);
        if (!bounds && q.kind !== 'not_reached') return { data: [], nextCursor: null, total: 0 };

        let webForms: number[] | null = null;
        let waForms: number[] | null = null;
        if (q.kind === 'filled_form' && q.formIds.length > 0) {
          const picked = await this.repo.formsByUuid(tx, orgId, q.formIds);
          webForms = picked.filter((f) => f.kind === 'web').map((f) => f.id);
          waForms = picked.filter((f) => f.kind === 'whatsapp').map((f) => f.id);
        }
        const now = new Date();
        const page = await this.repo.peoplePage(
          tx,
          {
            orgId,
            source,
            id: head.id,
            days: q.cameBackDays,
            from: bounds?.from ?? now,
            to: bounds?.to ?? now,
            webForms,
            waForms,
            withForms: q.kind === 'filled_form',
          },
          q.kind,
          cursor,
          q.limit,
        );
        const more = page.rows.length > q.limit;
        const rows = page.rows.slice(0, q.limit);
        const last = rows[rows.length - 1];
        return {
          data: rows.map((r) => ({
            contactId: r.contactUuid,
            name: r.name,
            phone: r.phone,
            at: r.at?.toISOString() ?? null,
            formName: r.formName,
          })),
          nextCursor: more && last ? encodeCursor({ at: last.atMicros, key: last.key }) : null,
          total: page.total,
        };
      });
    } catch (err) {
      if (isTimeout(err)) {
        throw new AppError(
          ERROR_CODES.INTERNAL,
          'The list took too long to work out. Try again in a moment.',
          503,
        );
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------------------------------------------- forms

  /**
   * The picker: the forms that can count as "an application". A kind is listed only to a viewer who may read it. WhatsApp forms have
   * no permission key of their own yet (their domain is not ported), so they follow the web forms' `record.forms.read`.
   */
  async forms(): Promise<SummaryFormsResponse> {
    const { orgId, grants } = RequestContextStore.require();
    const may = this.rbac.can(grants ?? new Map(), PERM_FORMS_READ).allowed;
    if (!may) return { data: [] };
    const rows = await this.db.tx((tx) =>
      this.repo.formsOf(tx, orgId, { web: true, whatsapp: true }, PICKER_LIMIT),
    );
    return {
      data: rows
        .map((f) => ({ id: f.uuid, kind: f.kind, name: f.name }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, PICKER_LIMIT),
    };
  }
}
