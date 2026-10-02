import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  PROVIDER_COST_MICROS_PER_CHAR,
  type TranslationProviderSlug,
  type TranslationUsageQuery,
  type TranslationUsageResponse,
} from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { PlatformStore } from '../auth';

export interface UsageEntry {
  providerSlug: string;
  sourceLang: string;
  targetLang: string;
  charsIn: number;
  charsOut: number;
  /** More than one provider was tried before this one answered. */
  wasFallback: boolean;
}

export const costMicros = (slug: string, charsIn: number): number =>
  (PROVIDER_COST_MICROS_PER_CHAR[slug as TranslationProviderSlug] ?? 0) * charsIn;

const DAY_MS = 86_400_000;

/**
 * The translation usage ledger and its report (TW-I18N-029, 030).
 *
 * One row per provider call that actually reached the wire; dictionary and cache hits are free and not recorded.
 * The ledger is a tenant table, so a row always carries the workspace it was spent for: calls with no workspace are
 * simply not recorded (Reference wrote NULL-workspace rows that no per-workspace screen could ever count).
 */
@Injectable()
export class TranslationUsageService {
  private readonly logger = new Logger(TranslationUsageService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly store: PlatformStore,
  ) {}

  /** Never throws: accounting must not turn a delivered translation into a failure. */
  async record(orgId: number | null, e: UsageEntry): Promise<void> {
    if (orgId === null) return;
    try {
      await this.db.txAs({ orgId, userId: null }, (tx) =>
        tx.execute(sql`
          INSERT INTO translation_usage (org_id, provider_slug, source_lang, target_lang, chars_in, chars_out, cost_micros, was_fallback)
          VALUES (${orgId}, ${e.providerSlug}, ${e.sourceLang}, ${e.targetLang}, ${e.charsIn}, ${e.charsOut},
                  ${costMicros(e.providerSlug, e.charsIn)}, ${e.wasFallback})
        `),
      );
    } catch (err) {
      this.logger.warn({ err, orgId }, 'could not record translation usage');
    }
  }

  /** Characters (in plus out) and calls a workspace spent since the start of the UTC month. */
  async monthToDate(orgId: number): Promise<{ characters: number; calls: number }> {
    const res = await this.db.txAs({ orgId, userId: null }, (tx) =>
      tx.execute(sql`
        SELECT COALESCE(SUM(chars_in + chars_out), 0) AS characters, COUNT(*) AS calls
        FROM translation_usage
        WHERE org_id = ${orgId} AND called_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      `),
    );
    const row = res.rows[0] as { characters: string; calls: string };
    return { characters: Number(row.characters), calls: Number(row.calls) };
  }

  /** The operator's report across every workspace. Both ends of the range are whole days (UTC). */
  async report(query: TranslationUsageQuery, now = new Date()): Promise<TranslationUsageResponse> {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : monthStart;
    const toInclusive = query.to ? new Date(`${query.to}T23:59:59.999Z`) : now;
    const toExclusive = new Date(toInclusive.getTime() + 1);
    // The chart shows the last 30 days of the range, not of today.
    const chartFrom = new Date(
      Math.max(from.getTime(), toInclusive.getTime() - 30 * DAY_MS),
    );

    const [totals, providers, timeline, top] = await this.store.tx(async (tx) =>
      Promise.all([
        tx.execute(sql`
          SELECT COUNT(*) AS calls, COALESCE(SUM(chars_in), 0) AS chars_in, COALESCE(SUM(chars_out), 0) AS chars_out,
                 COALESCE(SUM(cost_micros), 0) AS cost_micros, COUNT(*) FILTER (WHERE was_fallback) AS fallback_hits
          FROM translation_usage WHERE called_at >= ${from} AND called_at < ${toExclusive}
        `),
        tx.execute(sql`
          SELECT provider_slug, COUNT(*) AS calls, SUM(chars_in) AS chars_in, SUM(cost_micros) AS cost_micros
          FROM translation_usage WHERE called_at >= ${from} AND called_at < ${toExclusive}
          GROUP BY provider_slug ORDER BY calls DESC, provider_slug
        `),
        tx.execute(sql`
          SELECT to_char(called_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, SUM(chars_in) AS chars_in, SUM(cost_micros) AS cost_micros
          FROM translation_usage WHERE called_at >= ${chartFrom} AND called_at < ${toExclusive}
          GROUP BY day ORDER BY day
        `),
        tx.execute(sql`
          SELECT o.uuid AS workspace_id, o.name, COUNT(*) AS calls, SUM(u.chars_in) AS chars_in, SUM(u.cost_micros) AS cost_micros
          FROM translation_usage u JOIN organizations o ON o.id = u.org_id
          WHERE u.called_at >= ${from} AND u.called_at < ${toExclusive}
          GROUP BY o.uuid, o.name ORDER BY cost_micros DESC, chars_in DESC LIMIT 10
        `),
      ]),
    );

    const t = totals.rows[0] as Record<string, string>;
    return {
      range: { from: from.toISOString(), to: toInclusive.toISOString() },
      totals: {
        calls: Number(t.calls),
        charsIn: Number(t.chars_in),
        charsOut: Number(t.chars_out),
        costMicros: String(t.cost_micros),
        fallbackHits: Number(t.fallback_hits),
      },
      byProvider: (providers.rows as Array<Record<string, string>>).map((r) => ({
        providerSlug: r.provider_slug!,
        calls: Number(r.calls),
        charsIn: Number(r.chars_in),
        costMicros: String(r.cost_micros),
        ratePerMillionChars: String(
          (PROVIDER_COST_MICROS_PER_CHAR[r.provider_slug as TranslationProviderSlug] ?? 0) *
            1_000_000,
        ),
      })),
      timeline: (timeline.rows as Array<Record<string, string>>).map((r) => ({
        date: r.day!,
        charsIn: Number(r.chars_in),
        costMicros: String(r.cost_micros),
      })),
      topWorkspaces: (top.rows as Array<Record<string, string>>).map((r) => ({
        workspaceId: r.workspace_id!,
        name: r.name!,
        calls: Number(r.calls),
        charsIn: Number(r.chars_in),
        costMicros: String(r.cost_micros),
      })),
    };
  }
}
