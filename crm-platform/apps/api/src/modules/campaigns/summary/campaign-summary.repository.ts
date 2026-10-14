import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { AGG, AGG_DELIVERED, AGG_READ, AGG_SENT } from '../campaigns.repository';
import type { SummaryCursor } from './campaign-summary-rules';

/**
 * The director summary's SQL. Every figure is one statement over a chain of materialised CTEs, so a 100,000-recipient campaign is a
 * handful of set-based passes, never a query per recipient:
 *
 *   rcp       the campaign's (or broadcast's) recipient rows, one shape for both sources
 *   resolved  the messaged rows, each with the contact it belongs to (the row's own, else found by phone digits or phone identity)
 *   persons   one row per distinct person, with the first send to them
 *   pconv     their inbox threads that took a customer message after that send
 *   repl      each person's first customer message inside their own window
 *   fh        the form submissions inside the same window
 *
 * A statement only runs the CTEs it names, so the people pages do not pay for the form figures and the other way round.
 */

export type SummarySource = 'campaign' | 'broadcast';

/** A contact's phone as digits, spelled as the wizard's CSV matching spells it. */
const CONTACT_DIGITS = sql.raw(
  `regexp_replace(coalesce(k2.normalized_phone, k2.phone, ''), '\\D', '', 'g')`,
);
const IDENTITY_DIGITS = sql.raw(`regexp_replace(ci.value, '\\D', '', 'g')`);
/** The recipient's number as digits: the row's own, else the contact's (a broadcast row has none of its own). */
const recipientDigits = (source: SummarySource) =>
  sql.raw(
    `nullif(regexp_replace(coalesce(${source === 'campaign' ? 'r.phone_number, ' : ''}k.normalized_phone, k.phone, ''), '\\D', '', 'g'), '')`,
  );

/** A web submission is an application once it was accepted: not spam, not failed, not still received or waiting for a person. */
const ACCEPTED_WEB = sql.raw(`('created','updated','paid','awaiting_payment')`);

/** A timestamp as exact microseconds since the epoch, for a cursor that loses nothing to floating point. */
const micros = (col: string) =>
  sql.raw(
    `(extract(epoch FROM date_trunc('second', ${col}))::bigint * 1000000 + (extract(microseconds FROM ${col})::bigint % 1000000))`,
  );

const idList = (ids: readonly number[]) =>
  sql.join(
    ids.map((v) => sql`${v}::bigint`),
    sql`, `,
  );

/** `null` = no form was picked (any form counts); an empty list = forms were picked but none exists here (nothing counts). */
const pick = (col: string, ids: readonly number[] | null): SQL =>
  ids === null
    ? sql`true`
    : ids.length === 0
      ? sql`false`
      : sql`${sql.raw(col)} IN (${idList(ids)})`;

export interface SummaryScope {
  orgId: number;
  source: SummarySource;
  /** The campaign's or broadcast's internal id. */
  id: number;
  days: number;
  /** Constant bounds on `messages.created_at`, so the monthly partitions that cannot hold a reply are never opened. */
  from: Date;
  to: Date;
  /** Internal ids of the picked forms per kind; null = every form of that kind. */
  webForms: readonly number[] | null;
  waForms: readonly number[] | null;
  /** False for a viewer who may not read form submissions: the form figures are then neither computed nor cached for them. */
  withForms: boolean;
}

export interface SummaryHeader {
  id: number;
  name: string;
  status: string;
}

export interface SummaryRollup {
  messaged: number;
  delivered: number;
  read: number;
  failed: number;
  firstSentAt: Date | null;
  lastSentAt: Date | null;
}

export interface SummaryFigures {
  cameBack: number;
  medianSecs: number | null;
  optedOutWroteBack: number;
  notTrackable: number;
  byDay: Array<{ day: string; count: number }>;
  filledForm: number;
  viaWeb: number;
  viaWhatsapp: number;
  alsoWroteBack: number;
  inOtherCampaigns: boolean;
}

export interface PersonRow {
  key: string;
  contactUuid: string | null;
  name: string | null;
  phone: string | null;
  at: Date | null;
  /** Exact microseconds of `at` for the cursor. */
  atMicros: string | null;
  formName: string | null;
}

const date = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string));

@Injectable()
export class CampaignSummaryRepository {
  // --------------------------------------------------------------------------------------------------------------- header

  async header(
    tx: Tx,
    orgId: number,
    source: SummarySource,
    uuid: string,
  ): Promise<SummaryHeader | undefined> {
    const res = await tx.execute(
      source === 'campaign'
        ? sql`SELECT id, campaign_name AS name, status FROM wpcampaigns WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`
        : sql`SELECT id, name, status FROM broadcasts WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as { id: number | string; name: string; status: string } | undefined;
    return r ? { id: Number(r.id), name: r.name, status: r.status } : undefined;
  }

  /** The recipient rows in one shape for both sources (the broadcast has no reply, click or opt-out columns of its own). */
  private rcp(orgId: number, source: SummarySource, id: number): SQL {
    return source === 'campaign'
      ? sql`SELECT r.id, r.contact_id, coalesce(r.recipient_name, k.name) AS rname, coalesce(r.phone_number, k.phone) AS rphone,
                   ${recipientDigits(source)} AS digits, r.status, r.sent_at, r.delivered_at, r.read_at, r.responded_at,
                   r.clicked, r.clicked_at, (r.status = 'unsubscribed' OR r.is_unsubscribed) AS opted_out, r.updated_at
              FROM wp_campaign_contacts r
              LEFT JOIN contacts k ON k.org_id = r.org_id AND k.id = r.contact_id
             WHERE r.org_id = ${orgId} AND r.campaign_id = ${id}`
      : sql`SELECT r.id, r.contact_id, k.name AS rname, k.phone AS rphone,
                   ${recipientDigits(source)} AS digits, r.status, r.sent_at, r.delivered_at, r.read_at,
                   NULL::timestamptz AS responded_at, false AS clicked, NULL::timestamptz AS clicked_at,
                   (r.status = 'unsubscribed' OR k.is_unsubscribed) AS opted_out, r.updated_at
              FROM broadcast_contacts r
              JOIN contacts k ON k.org_id = r.org_id AND k.id = r.contact_id
             WHERE r.org_id = ${orgId} AND r.broadcast_id = ${id}`;
  }

  /** The CTE chain up to and including `persons`. */
  private people(s: SummaryScope): SQL {
    return sql`
      rcp AS MATERIALIZED (${this.rcp(s.orgId, s.source, s.id)}),
      -- Recipients with no contact are matched in one pass over the contacts (and phone identities), never a lookup per row: under
      -- row-level security an expression index on a non-leakproof function such as regexp_replace is not usable, so a per-row probe
      -- would scan the whole table once per recipient.
      nc AS MATERIALIZED (
        SELECT DISTINCT digits FROM rcp WHERE contact_id IS NULL AND digits IS NOT NULL AND sent_at IS NOT NULL
      ),
      cmatch AS MATERIALIZED (
        SELECT nc.digits, min(k2.id) AS cid FROM nc
          JOIN contacts k2 ON k2.org_id = ${s.orgId} AND ${CONTACT_DIGITS} = nc.digits
         GROUP BY nc.digits
      ),
      imatch AS MATERIALIZED (
        SELECT nc.digits, min(ci.contact_id) AS cid FROM nc
          JOIN contact_identities ci ON ci.org_id = ${s.orgId} AND ci.kind IN ('phone', 'whatsapp')
           AND ${IDENTITY_DIGITS} = nc.digits
         GROUP BY nc.digits
      ),
      resolved AS MATERIALIZED (
        SELECT x.*, coalesce(x.contact_id, cm.cid, im.cid) AS eff
          FROM rcp x
          LEFT JOIN cmatch cm ON x.contact_id IS NULL AND cm.digits = x.digits
          LEFT JOIN imatch im ON x.contact_id IS NULL AND im.digits = x.digits
         WHERE x.sent_at IS NOT NULL
      ),
      persons AS MATERIALIZED (
        SELECT coalesce(eff::text, 'p:' || digits) AS pkey, eff AS contact_id, max(digits) AS digits, max(rname) AS rname,
               max(rphone) AS rphone, min(sent_at) AS sent_at, bool_or(opted_out) AS opted_out
          FROM resolved
         WHERE eff IS NOT NULL OR digits IS NOT NULL
         GROUP BY 1, 2
      )`;
  }

  /** `repl`: each person's first customer message after their own send and inside the window, from the inbox. */
  private replies(s: SummaryScope): SQL {
    return sql`
      pconv AS MATERIALIZED (
        SELECT p.pkey, cv.id AS conv_id, p.sent_at
          FROM persons p
          JOIN conversations cv ON cv.org_id = ${s.orgId} AND cv.contact_id = p.contact_id
         WHERE p.contact_id IS NOT NULL AND cv.last_inbound_at > p.sent_at AND cv.peer_key NOT LIKE 'g:%'
        UNION
        SELECT p.pkey, cv.id, p.sent_at
          FROM persons p
          JOIN conversations cv ON cv.org_id = ${s.orgId} AND cv.peer_key = p.digits
         WHERE p.digits IS NOT NULL AND cv.last_inbound_at > p.sent_at AND cv.peer_key NOT LIKE 'g:%'
      ),
      repl AS MATERIALIZED (
        SELECT pc.pkey, min(m.created_at) AS replied_at
          FROM pconv pc
          JOIN messages m ON m.org_id = ${s.orgId} AND m.conversation_id = pc.conv_id
           AND m.created_at >= ${s.from.toISOString()}::timestamptz AND m.created_at <= ${s.to.toISOString()}::timestamptz
           AND m.created_at > pc.sent_at AND m.created_at <= pc.sent_at + make_interval(days => ${s.days})
           AND m.direction = 'in' AND m.sender_kind = 'customer' AND m.kind <> 'reaction' AND m.deleted_at IS NULL
         GROUP BY pc.pkey
      )`;
  }

  /** `fh`: accepted submissions of the picked forms by the contact messaged, inside the window. */
  private forms(s: SummaryScope): SQL {
    if (!s.withForms)
      return sql`fh AS MATERIALIZED (SELECT NULL::text AS pkey, NULL::timestamptz AS at, NULL::text AS src, NULL::text AS form_name WHERE false)`;
    return sql`
      fh AS MATERIALIZED (
        SELECT p.pkey, w.created_at AS at, 'web'::text AS src, f.name AS form_name
          FROM persons p
          JOIN web_form_submissions w ON w.org_id = ${s.orgId} AND w.contact_id = p.contact_id
           AND w.status IN ${ACCEPTED_WEB}
           AND w.created_at > p.sent_at AND w.created_at <= p.sent_at + make_interval(days => ${s.days})
           AND ${pick('w.form_id', s.webForms)}
          JOIN web_forms f ON f.org_id = w.org_id AND f.id = w.form_id
         WHERE p.contact_id IS NOT NULL
        UNION ALL
        SELECT p.pkey, coalesce(a.submitted_at, a.created_at), 'whatsapp'::text, g.title
          FROM persons p
          JOIN wa_form_submissions a ON a.org_id = ${s.orgId} AND a.contact_id = p.contact_id
           AND coalesce(a.submitted_at, a.created_at) > p.sent_at
           AND coalesce(a.submitted_at, a.created_at) <= p.sent_at + make_interval(days => ${s.days})
           AND ${pick('a.form_id', s.waForms)}
          JOIN wa_forms g ON g.org_id = a.org_id AND g.id = a.form_id
         WHERE p.contact_id IS NOT NULL
      )`;
  }

  // ---------------------------------------------------------------------------------------------------------------- rollup

  /**
   * The recipients' roll-up and the send range, in one pass. Messaged, delivered and read count distinct PEOPLE (a number listed twice
   * is one person), with the same conditions as `AGG`, so they share a base with the people-based figures (wrote back, filled a form).
   * Failed stays the list's row count.
   */
  async rollup(tx: Tx, orgId: number, source: SummarySource, id: number): Promise<SummaryRollup> {
    const person = `coalesce(r.contact_id::text, 'p:' || r.digits, 'r:' || r.id::text)`;
    const res = await tx.execute(sql`
      WITH rcp AS MATERIALIZED (${this.rcp(orgId, source, id)})
      SELECT ${AGG},
             count(DISTINCT ${sql.raw(person)}) FILTER (WHERE ${sql.raw(AGG_SENT)})::int AS p_sent,
             count(DISTINCT ${sql.raw(person)}) FILTER (WHERE ${sql.raw(AGG_DELIVERED)})::int AS p_delivered,
             count(DISTINCT ${sql.raw(person)}) FILTER (WHERE ${sql.raw(AGG_READ)})::int AS p_read,
             min(r.sent_at) AS first_sent_at, max(r.sent_at) AS last_sent_at FROM rcp r`);
    const r = res.rows[0] as Record<string, unknown>;
    return {
      messaged: Number(r.p_sent),
      delivered: Number(r.p_delivered),
      read: Number(r.p_read),
      failed: Number(r.a_failed),
      firstSentAt: date(r.first_sent_at),
      lastSentAt: date(r.last_sent_at),
    };
  }

  /** The first and last send only: all a people page needs to bound its probes (the full roll-up is for the summary). */
  async sendRange(
    tx: Tx,
    orgId: number,
    source: SummarySource,
    id: number,
  ): Promise<{ firstSentAt: Date | null; lastSentAt: Date | null }> {
    const res = await tx.execute(
      source === 'campaign'
        ? sql`SELECT min(sent_at) AS a, max(sent_at) AS b FROM wp_campaign_contacts WHERE org_id = ${orgId} AND campaign_id = ${id}`
        : sql`SELECT min(sent_at) AS a, max(sent_at) AS b FROM broadcast_contacts WHERE org_id = ${orgId} AND broadcast_id = ${id}`,
    );
    const r = res.rows[0] as { a: unknown; b: unknown };
    return { firstSentAt: date(r.a), lastSentAt: date(r.b) };
  }

  // --------------------------------------------------------------------------------------------------------------- figures

  /** Every figure of the summary in a single statement. */
  async figures(tx: Tx, s: SummaryScope): Promise<SummaryFigures> {
    const other = s.source === 'campaign' ? sql`o.campaign_id <> ${s.id}` : sql`true`;
    const otherBc = s.source === 'broadcast' ? sql`o.broadcast_id <> ${s.id}` : sql`true`;
    const res = await tx.execute(sql`
      WITH ${this.people(s)}, ${this.replies(s)}, ${this.forms(s)},
      cb AS MATERIALIZED (
        SELECT p.pkey, p.contact_id, p.sent_at, r.replied_at, p.opted_out FROM repl r JOIN persons p USING (pkey)
      ),
      counted AS MATERIALIZED (
        SELECT pkey, contact_id, sent_at FROM cb WHERE NOT opted_out
        UNION
        SELECT p.pkey, p.contact_id, p.sent_at FROM persons p WHERE p.pkey IN (SELECT pkey FROM fh)
      )
      SELECT
        (SELECT count(*)::int FROM cb WHERE NOT opted_out) AS came_back,
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM replied_at - sent_at)::float8)
           FROM cb WHERE NOT opted_out) AS median_secs,
        (SELECT count(*)::int FROM cb WHERE opted_out) AS opted_out_wrote_back,
        (SELECT count(*)::int FROM resolved WHERE eff IS NULL AND digits IS NULL)
          + (SELECT count(*)::int FROM persons p WHERE p.contact_id IS NULL
               AND NOT EXISTS (SELECT 1 FROM conversations cv WHERE cv.org_id = ${s.orgId} AND cv.peer_key = p.digits)) AS not_trackable,
        (SELECT coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'count', d.n) ORDER BY d.day), '[]'::jsonb)
           FROM (SELECT to_char(replied_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS n
                   FROM cb WHERE NOT opted_out GROUP BY 1 ORDER BY 1 LIMIT 31) d) AS by_day,
        (SELECT count(DISTINCT pkey)::int FROM fh) AS filled_form,
        (SELECT count(DISTINCT pkey)::int FROM fh WHERE src = 'web') AS via_web,
        (SELECT count(DISTINCT pkey)::int FROM fh WHERE src = 'whatsapp') AS via_whatsapp,
        (SELECT count(DISTINCT f.pkey)::int FROM fh f JOIN cb ON cb.pkey = f.pkey WHERE NOT cb.opted_out) AS also_wrote_back,
        EXISTS (
          SELECT 1 FROM counted c
           WHERE c.contact_id IS NOT NULL
             AND (EXISTS (SELECT 1 FROM wp_campaign_contacts o
                           WHERE o.org_id = ${s.orgId} AND o.contact_id = c.contact_id AND ${other} AND o.sent_at IS NOT NULL
                             AND o.sent_at > c.sent_at - make_interval(days => ${s.days})
                             AND o.sent_at < c.sent_at + make_interval(days => ${s.days}))
               OR EXISTS (SELECT 1 FROM broadcast_contacts o
                           WHERE o.org_id = ${s.orgId} AND o.contact_id = c.contact_id AND ${otherBc} AND o.sent_at IS NOT NULL
                             AND o.sent_at > c.sent_at - make_interval(days => ${s.days})
                             AND o.sent_at < c.sent_at + make_interval(days => ${s.days})))
        ) AS in_other_campaigns`);
    const r = res.rows[0] as Record<string, unknown>;
    return {
      cameBack: Number(r.came_back),
      medianSecs: r.median_secs === null ? null : Number(r.median_secs),
      optedOutWroteBack: Number(r.opted_out_wrote_back),
      notTrackable: Number(r.not_trackable),
      byDay: (r.by_day as Array<{ day: string; count: number }>).map((d) => ({
        day: d.day,
        count: Number(d.count),
      })),
      filledForm: Number(r.filled_form),
      viaWeb: Number(r.via_web),
      viaWhatsapp: Number(r.via_whatsapp),
      alsoWroteBack: Number(r.also_wrote_back),
      inOtherCampaigns: Boolean(r.in_other_campaigns),
    };
  }

  // ------------------------------------------------------------------------------------------------------------ the forms

  /** The forms of the workspace by uuid: web forms and WhatsApp forms, newest first. */
  async formsOf(
    tx: Tx,
    orgId: number,
    kinds: { web: boolean; whatsapp: boolean },
    limit: number,
  ): Promise<Array<{ id: number; uuid: string; kind: 'web' | 'whatsapp'; name: string }>> {
    const out: Array<{ id: number; uuid: string; kind: 'web' | 'whatsapp'; name: string }> = [];
    if (kinds.web) {
      const res = await tx.execute(
        sql`SELECT id, uuid, name FROM web_forms WHERE org_id = ${orgId} ORDER BY id DESC LIMIT ${limit}`,
      );
      for (const r of res.rows as Array<{ id: number | string; uuid: string; name: string }>)
        out.push({ id: Number(r.id), uuid: r.uuid, kind: 'web', name: r.name });
    }
    if (kinds.whatsapp) {
      const res = await tx.execute(
        sql`SELECT id, uuid, title AS name FROM wa_forms WHERE org_id = ${orgId} ORDER BY id DESC LIMIT ${limit}`,
      );
      for (const r of res.rows as Array<{ id: number | string; uuid: string; name: string }>)
        out.push({ id: Number(r.id), uuid: r.uuid, kind: 'whatsapp', name: r.name });
    }
    return out;
  }

  /** The picked forms (any of the two kinds) by uuid, as they exist in this workspace. */
  async formsByUuid(
    tx: Tx,
    orgId: number,
    uuids: readonly string[],
  ): Promise<Array<{ id: number; uuid: string; kind: 'web' | 'whatsapp'; name: string }>> {
    if (uuids.length === 0) return [];
    const list = sql.join(
      uuids.map((u) => sql`${u}::uuid`),
      sql`, `,
    );
    const web = await tx.execute(
      sql`SELECT id, uuid, name FROM web_forms WHERE org_id = ${orgId} AND uuid IN (${list})`,
    );
    const wa = await tx.execute(
      sql`SELECT id, uuid, title AS name FROM wa_forms WHERE org_id = ${orgId} AND uuid IN (${list})`,
    );
    const row =
      (kind: 'web' | 'whatsapp') => (r: { id: number | string; uuid: string; name: string }) => ({
        id: Number(r.id),
        uuid: r.uuid,
        kind,
        name: r.name,
      });
    return [
      ...(web.rows as Array<{ id: number | string; uuid: string; name: string }>).map(row('web')),
      ...(wa.rows as Array<{ id: number | string; uuid: string; name: string }>).map(
        row('whatsapp'),
      ),
    ];
  }

  // ----------------------------------------------------------------------------------------------------------------- people

  private cursorAfter(c: SummaryCursor | null, atExpr: string, keyExpr: string): SQL {
    if (!c) return sql`true`;
    return c.at === null
      ? sql`false`
      : sql`(${micros(atExpr)}, ${sql.raw(keyExpr)}) < (${c.at}::bigint, ${c.key})`;
  }

  /**
   * One page of the people behind a figure, newest first, keyset on (instant, person). `total` is the whole list. Names and numbers
   * are what the recipients tab already shows for the same permission.
   */
  async peoplePage(
    tx: Tx,
    s: SummaryScope,
    kind: 'came_back' | 'filled_form' | 'not_reached',
    cursor: SummaryCursor | null,
    limit: number,
  ): Promise<{ rows: PersonRow[]; total: number }> {
    // The list's size is counted on the first page and carried in the cursor, so paging through it does not count it again.
    const knownTotal = cursor?.total === undefined ? null : { n: cursor.total };
    if (kind === 'not_reached') {
      // Newest row first by id: stable while rows are retried and touched (a time column would move a person between pages).
      const after = cursor ? sql`r.id < ${cursor.key}::bigint` : sql`true`;
      const page = await tx.execute(sql`
        WITH rcp AS MATERIALIZED (${this.rcp(s.orgId, s.source, s.id)})
        SELECT r.id::text AS key, c.uuid AS contact_uuid, r.rname AS name, r.rphone AS phone, r.updated_at AS at,
               ${micros('r.updated_at')}::text AS at_micros
          FROM rcp r LEFT JOIN contacts c ON c.org_id = ${s.orgId} AND c.id = r.contact_id
         WHERE r.status = 'failed' AND ${after}
         ORDER BY r.id DESC LIMIT ${limit + 1}`);
      const total =
        knownTotal ??
        (
          await tx.execute(sql`
        WITH rcp AS MATERIALIZED (${this.rcp(s.orgId, s.source, s.id)})
        SELECT count(*)::int AS n FROM rcp WHERE status = 'failed'`)
        ).rows[0];
      return this.toPage(page.rows as Array<Record<string, unknown>>, total);
    }

    const cond = this.cursorAfter(cursor, 'x.at', 'x.pkey');
    const cte =
      kind === 'came_back'
        ? sql`WITH ${this.people(s)}, ${this.replies(s)},
              x AS MATERIALIZED (
                SELECT p.pkey, p.contact_id, p.rname, p.rphone, r.replied_at AS at, NULL::text AS form_name
                  FROM repl r JOIN persons p USING (pkey) WHERE NOT p.opted_out
              )`
        : sql`WITH ${this.people(s)}, ${this.forms(s)},
              x AS MATERIALIZED (
                SELECT DISTINCT ON (f.pkey) f.pkey, p.contact_id, p.rname, p.rphone, f.at, f.form_name
                  FROM fh f JOIN persons p USING (pkey) ORDER BY f.pkey, f.at
              )`;
    const page = await tx.execute(sql`
      ${cte}
      SELECT x.pkey AS key, c.uuid AS contact_uuid, coalesce(c.name, x.rname) AS name, coalesce(c.phone, x.rphone) AS phone,
             x.at, ${micros('x.at')}::text AS at_micros, x.form_name
        FROM x LEFT JOIN contacts c ON c.org_id = ${s.orgId} AND c.id = x.contact_id
       WHERE ${cond}
       ORDER BY ${micros('x.at')} DESC, x.pkey DESC LIMIT ${limit + 1}`);
    const total =
      knownTotal ?? (await tx.execute(sql`${cte} SELECT count(*)::int AS n FROM x`)).rows[0];
    return this.toPage(page.rows as Array<Record<string, unknown>>, total);
  }

  private toPage(
    rows: Array<Record<string, unknown>>,
    total: unknown,
  ): { rows: PersonRow[]; total: number } {
    return {
      rows: rows.map((r) => ({
        key: String(r.key),
        contactUuid: (r.contact_uuid as string | null) ?? null,
        name: (r.name as string | null) ?? null,
        phone: (r.phone as string | null) ?? null,
        at: date(r.at),
        atMicros: r.at_micros === null || r.at_micros === undefined ? null : String(r.at_micros),
        formName: (r.form_name as string | null) ?? null,
      })),
      total: Number((total as { n: number }).n),
    };
  }
}
