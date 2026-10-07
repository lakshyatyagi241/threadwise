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
  ContactResolverService,
  SegmentsRepository,
  SegmentsService,
  collectRuleRefs,
  compileRules,
  contactConditions,
  loadRuleContext,
  contactSelectionWhere,
  segmentContactsWhere,
  whereOf,
} from '../../crm';
import { countryOfPhone } from '../../wallet-message-billing';
import { WizardCsvService } from './wizard-csv.service';
import { csvContactsWhere, csvNewRowsWhere } from './wizard-csv-sql';

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
  /** The stored CSV upload the audience names (its numbers that are not contacts yet are counted apart), when it still exists. */
  csvUploadId: number | null;
  /** One condition per source the person filled in; `where` is their union. */
  sources: SQL[];
}

export interface SampleContact {
  id: number;
  uuid: string;
  name: string | null;
  phone: string | null;
}

/** `a, b, c` of uuid parameters, for an IN list. */
const uuidList = (ids: readonly string[]): SQL =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

const isTimeout = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '57014' || e?.cause?.code === '57014';
};

/**
 * Who a broadcast goes to, evaluated by ONE function for the count the wizard shows, the sample it resolves variables for and the
 * recipients a launch writes, so the number on screen is the list that is messaged. The audience is the UNION of every source the
 * person filled in: the contacts ticked one by one, "all contacts matching" a search and conditions (minus the ones un-ticked), the
 * members of the chosen groups, of the chosen segments, and the numbers of an uploaded CSV. A contact in several is one recipient.
 * Opted-out contacts and numbers WhatsApp cannot be asked to deliver to are removed last and counted apart.
 *
 * Segments and conditions are compiled by the CRM's own rule engine, so a rule means here exactly what it means on the segments
 * screen. CSV numbers that are not contacts yet cannot be a row of `contacts`: they are counted from the stored upload, and the launch
 * turns them into contacts (`materializeCsv`) before it lists the recipients.
 */
@Injectable()
export class WizardAudienceService {
  constructor(
    private readonly segments: SegmentsService,
    private readonly segmentsRepo: SegmentsRepository,
    private readonly csv: WizardCsvService,
    private readonly resolver: ContactResolverService,
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

    if (audience.contactIds.length > 0) {
      sources.push(sql`contacts.uuid IN (${uuidList(audience.contactIds)})`);
    }

    // The Contact Hub's "everything the view matched" hand-over (ticked rows arrive as contactIds).
    if (audience.selection)
      sources.push(await contactSelectionWhere(tx, orgId, audience.selection));

    if (audience.allMatching) {
      let segment: SQL | undefined;
      if (audience.allMatching.rules) {
        const rules = audience.allMatching.rules as unknown as SegmentGroup;
        const rc = await loadRuleContext(tx, orgId, collectRuleRefs(rules));
        const compiled = compileRules(orgId, rules, rc);
        segment = compiled.where;
        for (const p of compiled.invalid) invalid.push({ ...p, path: `allMatching.${p.path}` });
      }
      const matching = whereOf(
        contactConditions(
          orgId,
          {
            includeArchived: false,
            tagMode: 'any',
            q: audience.allMatching.search ?? undefined,
            segment,
          },
          undefined,
        ),
      );
      sources.push(
        audience.excludedContactIds.length > 0
          ? sql`(${matching} AND contacts.uuid NOT IN (${uuidList(audience.excludedContactIds)}))`
          : matching,
      );
    }

    let csvUploadId: number | null = null;
    if (audience.csv) {
      const up = await this.csv.find(tx, orgId, audience.csv.id);
      if (up) {
        csvUploadId = up.id;
        sources.push(csvContactsWhere(orgId, up.id));
      } else {
        invalid.push({
          path: 'csv',
          field: 'csv',
          reason: 'csv_missing',
          message: 'The uploaded CSV is gone (uploads are kept for a week). Upload it again.',
        });
      }
    }

    const rulesSql = sources.length === 0 ? sql`false` : sql`(${sql.join(sources, sql` OR `)})`;
    return { where: segmentContactsWhere(orgId, rulesSql), invalid, csvUploadId, sources };
  }

  async count(tx: Tx, orgId: number, audience: WizardAudience): Promise<WizardAudienceCount> {
    const { where, invalid, csvUploadId } = await this.where(tx, orgId, audience);
    const fresh = await this.newCsvNumbers(tx, orgId, csvUploadId);
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
        matching: Number(out.totals.matching) + fresh.total,
        optedOut: Number(out.totals.opted_out),
        invalidNumber: Number(out.totals.invalid_number),
        recipients: Number(out.totals.recipients) + fresh.total,
        newContacts: fresh.total,
        approximate: false,
        countries: this.countries([...out.byPrefix, ...fresh.byPrefix]),
        invalidConditions: invalid,
      };
    } catch (err) {
      if (!isTimeout(err)) throw err;
      const estimate = await this.estimate(tx, where);
      return {
        matching: estimate + fresh.total,
        optedOut: 0,
        invalidNumber: 0,
        recipients: estimate + fresh.total,
        newContacts: fresh.total,
        approximate: true,
        countries: [],
        invalidConditions: invalid,
      };
    }
  }

  /**
   * How many contacts of the audience are in more than one source (a group and a segment, a ticked contact and a group): they are
   * messaged once, so this is how many extra rows were merged. One scan, bounded like the count; null when it did not finish in time.
   */
  async overlap(tx: Tx, orgId: number, audience: WizardAudience): Promise<number | null> {
    const { where, sources: merged } = await this.where(tx, orgId, audience);
    // `where` joins every group into ONE source (the first); here each group counts on its own.
    const sources = merged.slice(audience.groupIds.length > 0 ? 1 : 0);
    if (audience.groupIds.length > 0) {
      const tree = (id: string) =>
        ({
          type: 'group',
          combinator: 'or',
          children: [{ type: 'condition', field: 'groups', operator: 'has_any', value: [id] }],
        }) as unknown as SegmentGroup;
      for (const id of audience.groupIds) {
        const rc = await loadRuleContext(tx, orgId, collectRuleRefs(tree(id)));
        sources.push(compileRules(orgId, tree(id), rc).where);
      }
    }
    if (sources.length < 2) return 0;
    const memberships = sql.join(
      sources.map((src) => sql`(CASE WHEN ${src} THEN 1 ELSE 0 END)`),
      sql` + `,
    );
    const before = (await tx.execute(sql`SELECT current_setting('statement_timeout') AS v`))
      .rows[0] as { v: string };
    try {
      const out = await tx.transaction(async (sp) => {
        await sp.execute(
          sql`SELECT set_config('statement_timeout', ${String(COUNT_TIMEOUT_MS)}, true)`,
        );
        return (
          await sp.execute(sql`
            SELECT coalesce(sum(m - 1), 0)::int AS merged
            FROM (SELECT ${memberships} AS m FROM contacts WHERE ${where} AND ${ELIGIBLE}) s`)
        ).rows[0] as { merged: number };
      });
      await tx.execute(sql`SELECT set_config('statement_timeout', ${before.v}, true)`);
      return Number(out.merged);
    } catch (err) {
      if (!isTimeout(err)) throw err;
      return null;
    }
  }

  /** The upload's valid numbers that are not contacts yet, with their country prefixes (all of them are deliverable: they passed the E.164 check). */
  private async newCsvNumbers(
    tx: Tx,
    orgId: number,
    uploadId: number | null,
  ): Promise<{ total: number; byPrefix: Array<{ prefix: string; n: number }> }> {
    if (uploadId === null) return { total: 0, byPrefix: [] };
    const rows = (
      await tx.execute(sql`
        SELECT left(r.digits, ${COUNTRY_PREFIX_DIGITS}) AS prefix, count(*)::int AS n
        FROM camp_wizard_csv_rows r WHERE ${csvNewRowsWhere(orgId, uploadId)} GROUP BY 1`)
    ).rows as Array<{ prefix: string; n: number }>;
    return { total: rows.reduce((n, r) => n + Number(r.n), 0), byPrefix: rows };
  }

  /** Numbers of the CSV that are not contacts yet, for the wallet's per-country estimate. */
  async newCsvPhones(
    tx: Tx,
    orgId: number,
    audience: WizardAudience,
    limit: number,
  ): Promise<string[]> {
    if (!audience.csv) return [];
    const up = await this.csv.find(tx, orgId, audience.csv.id);
    if (!up) return [];
    const rows = await this.csv.newNumbers(tx, orgId, up.id, 0, limit);
    return rows.map((r) => r.phone);
  }

  /**
   * Launch only, inside the launch transaction: every valid CSV number that is not a contact yet becomes one (find-or-create by phone,
   * so a repeat or a recurring run finds it again). A number the plan's contact cap refuses is not messaged; it is counted in `skipped`.
   * Idempotent. Call it before `recipientIds`, which then sees the new contacts.
   */
  async materializeCsv(
    tx: Tx,
    orgId: number,
    audience: WizardAudience,
  ): Promise<{ created: number; skipped: number }> {
    const out = { created: 0, skipped: 0 };
    if (!audience.csv) return out;
    const up = await this.csv.find(tx, orgId, audience.csv.id);
    if (!up) return out;
    let after = 0;
    for (;;) {
      const rows = await this.csv.newNumbers(tx, orgId, up.id, after, 500);
      if (rows.length === 0) break;
      for (const r of rows) {
        const link = await this.resolver.findOrCreateByPhone(tx, orgId, {
          phone: r.phone,
          name: r.name,
          source: 'broadcast_csv',
        });
        if (link.outcome === 'created') out.created += 1;
        else if (link.outcome === 'skipped') out.skipped += 1;
      }
      after = rows[rows.length - 1]!.line;
    }
    return out;
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
