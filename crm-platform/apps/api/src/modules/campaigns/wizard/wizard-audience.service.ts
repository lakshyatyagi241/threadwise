import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type {
  SegmentGroup,
  WizardAudience,
  WizardAudienceCount,
  WizardCountryCount,
} from '@crm/contracts';
import {
  SegmentsRepository,
  SegmentsService,
  collectRuleRefs,
  compileRules,
  loadRuleContext,
  contactSelectionWhere,
  segmentContactsWhere,
} from '../../crm';
import { countryOfPhone } from '../../wallet-message-billing';

/** A count that is not done in this long is answered with the planner's estimate (the same ceiling segment counts use). */
const COUNT_TIMEOUT_MS = 3000;
/** How many digits of a number say which country it is in (the dial code is at most 3, a NANP area code 4 with the leading 1). */
const COUNTRY_PREFIX_DIGITS = 5;

/** The digits of a contact's number, from the normalized column when there is one. */
const DIGITS = sql.raw(
  `regexp_replace(coalesce(contacts.normalized_phone, contacts.phone, ''), '\\D', '', 'g')`,
);
/** A number WhatsApp can be asked to deliver to: 8 to 15 digits, no leading zero (E.164). */
export const VALID_NUMBER = sql`${DIGITS} ~ '^[1-9][0-9]{7,14}$'`;
/** Opted-out contacts and unusable numbers are never messaged. */
export const ELIGIBLE = sql`(NOT contacts.is_unsubscribed AND ${VALID_NUMBER})`;

export interface AudienceWhere {
  /** A condition over `contacts`: the organization, not archived, and the audience. */
  where: SQL;
  invalid: WizardAudienceCount['invalidConditions'];
}

export interface SampleContact {
  id: number;
  uuid: string;
  name: string | null;
  phone: string | null;
}

const isTimeout = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '57014' || e?.cause?.code === '57014';
};

/**
 * Who a broadcast goes to, evaluated by ONE function for the count the wizard shows, the sample it resolves variables for and the
 * recipients a launch writes, so the number on screen is the list that is messaged. The audience is the contacts of the chosen groups and
 * segments (any of them) that also match the condition rules; with no group or segment the rules select from every contact; with
 * neither, nobody. Opted-out contacts and numbers WhatsApp cannot be asked to deliver to are removed last and counted apart.
 *
 * Segments and the condition rules are compiled by the CRM's own rule engine, so a rule means here exactly what it means on the
 * segments screen.
 */
@Injectable()
export class WizardAudienceService {
  constructor(
    private readonly segments: SegmentsService,
    private readonly segmentsRepo: SegmentsRepository,
  ) {}

  async where(tx: Tx, orgId: number, audience: WizardAudience): Promise<AudienceWhere> {
    const invalid: AudienceWhere['invalid'] = [];
    const sources: SQL[] = [];

    if (audience.groupIds.length > 0) {
      // One condition per group, so a deleted group blanks only itself.
      const tree = {
        type: 'group',
        combinator: 'or',
        children: audience.groupIds.map((id) => ({
          type: 'condition',
          field: 'groups',
          operator: 'has_any',
          value: [id],
        })),
      } as unknown as SegmentGroup;
      const rc = await loadRuleContext(tx, orgId, collectRuleRefs(tree));
      const compiled = compileRules(orgId, tree, rc);
      sources.push(compiled.where);
      for (const p of compiled.invalid) invalid.push({ ...p, path: `groups.${p.path}` });
    }

    for (const uuid of audience.segmentIds) {
      const row = await this.segmentsRepo.findByUuid(tx, orgId, uuid);
      if (!row) {
        // A segment that is gone matches nobody; say so rather than failing the whole audience.
        sources.push(sql`false`);
        invalid.push({
          path: `segments.${uuid}`,
          field: 'segment',
          reason: 'segment_deleted',
          message: 'A segment used here does not exist (it may have been deleted).',
        });
        continue;
      }
      const compiled = await this.segments.compile(tx, orgId, row);
      sources.push(compiled.where);
      for (const p of compiled.invalid) invalid.push({ ...p, path: `segments.${uuid}.${p.path}` });
    }

    if (audience.selection)
      sources.push(await contactSelectionWhere(tx, orgId, audience.selection));

    const parts: SQL[] = [];
    if (sources.length > 0) parts.push(sql`(${sql.join(sources, sql` OR `)})`);
    if (audience.rules) {
      const rules = audience.rules as unknown as SegmentGroup;
      const rc = await loadRuleContext(tx, orgId, collectRuleRefs(rules));
      const compiled = compileRules(orgId, rules, rc);
      parts.push(compiled.where);
      for (const p of compiled.invalid) invalid.push({ ...p, path: `rules.${p.path}` });
    }
    const rulesSql = parts.length === 0 ? sql`false` : sql`(${sql.join(parts, sql` AND `)})`;
    return { where: segmentContactsWhere(orgId, rulesSql), invalid };
  }

  async count(tx: Tx, orgId: number, audience: WizardAudience): Promise<WizardAudienceCount> {
    const { where, invalid } = await this.where(tx, orgId, audience);
    // The count runs in a savepoint: a cancelled statement aborts only that, and the timeout is undone with it.
    const before = (await tx.execute(sql`SELECT current_setting('statement_timeout') AS v`))
      .rows[0] as {
      v: string;
    };
    try {
      const out = await tx.transaction(async (sp) => {
        await sp.execute(
          sql`SELECT set_config('statement_timeout', ${String(COUNT_TIMEOUT_MS)}, true)`,
        );
        const totals = (
          await sp.execute(sql`
            SELECT count(*)::int AS matching,
                   count(*) FILTER (WHERE contacts.is_unsubscribed)::int AS opted_out,
                   count(*) FILTER (WHERE NOT contacts.is_unsubscribed AND NOT ${VALID_NUMBER})::int AS invalid_number,
                   count(*) FILTER (WHERE ${ELIGIBLE})::int AS recipients
            FROM contacts WHERE ${where}`)
        ).rows[0] as {
          matching: number;
          opted_out: number;
          invalid_number: number;
          recipients: number;
        };
        const byPrefix = (
          await sp.execute(sql`
            SELECT left(${DIGITS}, ${COUNTRY_PREFIX_DIGITS}) AS prefix, count(*)::int AS n
            FROM contacts WHERE ${where} AND ${ELIGIBLE}
            GROUP BY 1`)
        ).rows as Array<{ prefix: string; n: number }>;
        return { totals, byPrefix };
      });
      await tx.execute(sql`SELECT set_config('statement_timeout', ${before.v}, true)`);
      return {
        matching: Number(out.totals.matching),
        optedOut: Number(out.totals.opted_out),
        invalidNumber: Number(out.totals.invalid_number),
        recipients: Number(out.totals.recipients),
        approximate: false,
        countries: this.countries(out.byPrefix),
        invalidConditions: invalid,
      };
    } catch (err) {
      if (!isTimeout(err)) throw err;
      const estimate = await this.estimate(tx, where);
      return {
        matching: estimate,
        optedOut: 0,
        invalidNumber: 0,
        recipients: estimate,
        approximate: true,
        countries: [],
        invalidConditions: invalid,
      };
    }
  }

  /** Recipients by destination country, largest first. */
  private countries(rows: Array<{ prefix: string; n: number }>): WizardCountryCount[] {
    const by = new Map<string | null, number>();
    for (const r of rows) {
      // The prefix is padded so a short one still reads as a number to the country lookup.
      const country = countryOfPhone(r.prefix.padEnd(10, '0'));
      by.set(country, (by.get(country) ?? 0) + Number(r.n));
    }
    return [...by.entries()]
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count || String(a.country).localeCompare(String(b.country)));
  }

  /** The planner's row estimate for the same WHERE: free, and good enough to say "about this many". */
  private async estimate(tx: Tx, where: SQL): Promise<number> {
    try {
      const res = await tx.execute(
        sql`EXPLAIN (FORMAT JSON) SELECT 1 FROM contacts WHERE ${where}`,
      );
      const plan = (res.rows[0] as Record<string, Array<{ Plan?: { 'Plan Rows'?: number } }>>)[
        'QUERY PLAN'
      ];
      return Math.max(0, Math.round(Number(plan?.[0]?.Plan?.['Plan Rows'] ?? 0)));
    } catch {
      return 0;
    }
  }

  /** A few messageable contacts, oldest first: what the sample messages are resolved for. */
  async sample(
    tx: Tx,
    orgId: number,
    audience: WizardAudience,
    limit: number,
  ): Promise<SampleContact[]> {
    const { where } = await this.where(tx, orgId, audience);
    const res = await tx.execute(sql`
      SELECT contacts.id, contacts.uuid, contacts.name, contacts.phone
      FROM contacts WHERE ${where} AND ${ELIGIBLE}
      ORDER BY contacts.id LIMIT ${limit}`);
    return (
      res.rows as Array<{
        id: number | string;
        uuid: string;
        name: string | null;
        phone: string | null;
      }>
    ).map((r) => ({ id: Number(r.id), uuid: r.uuid, name: r.name, phone: r.phone }));
  }

  /** The messageable contacts' ids after `afterId`, in id order, for writing the recipient rows in chunks. */
  async recipientIds(
    tx: Tx,
    orgId: number,
    audience: WizardAudience,
    afterId: number,
    limit: number,
  ): Promise<number[]> {
    const { where } = await this.where(tx, orgId, audience);
    const res = await tx.execute(sql`
      SELECT contacts.id FROM contacts
      WHERE ${where} AND ${ELIGIBLE} AND contacts.id > ${afterId}::bigint
      ORDER BY contacts.id LIMIT ${limit}`);
    return (res.rows as Array<{ id: number | string }>).map((r) => Number(r.id));
  }
}
