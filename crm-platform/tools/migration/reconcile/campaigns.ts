import type { BroadcastPlan } from '../broadcast/plan';
import type { BroadcastSettings } from '../broadcast/config';
import type { Source } from '../extract/source';
import { linkedCampaigns } from '../load/campaignlink';
import { sql, withTenant, type Database, type TenantTx } from '../load/db';
import { mask } from '../util';
import { hexKey, oracleDeleted, text } from './oracle';
import { oracleBroadcast, type BResult } from './oracle-campaigns';
import type { Report } from './index';

/**
 * The verifier of the broadcast step. What it believes about the source comes from reconcile/oracle-campaigns.ts (a second
 * implementation of spec A); what it believes about the target it reads here. For the organization it checks:
 *   - every campaign and every recipient: loaded / quarantined / excluded as the oracle says, every column compared with the oracle
 *     (not with the loader's transform), the columns the loader never writes still at their defaults,
 *   - SAFETY: every campaign in a terminal status with retry off, no recipient in a sendable state or with a retry state, a failed
 *     recipient without a timestamp that the tiles would count as sent, and enough send attempts for the sweeper to leave it alone,
 *   - the counters of every campaign equal the app's own roll-up over its recipient rows (the app recomputes them; they must agree),
 *   - nothing the live application would have written for these campaigns (retry attempts, test sends, link clicks, scheduled messages),
 *   - which Waboo fields have no column (NOT PRESENT), counted over the rows that did load.
 * Rows the source does not account for are caught by the generic extra-row check of reconcile/index.ts (the uuid sets) and by the
 * baseline digest (outbox, notifications, usage charges and wallet rows must stay empty).
 */
type Tx = TenantTx;

const ts = (iso: string | null): string | null => (iso === null ? null : `${iso.slice(0, -1)}000`);
const tsCol = (c: string, al: string): string =>
  `to_char(${al}${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS ${c}`;

/** Columns of wpcampaigns the loader never writes (written again here, not imported from the loader). */
const CAMPAIGN_DEFAULTS: Record<string, unknown> = {
  scheduled_message_id: null,
  device_id: null,
  ab_testing: false,
  ab_split: 50,
  custom_message: null,
  custom_message_b: null,
  custom_header: null,
  custom_footer: null,
  custom_buttons: null,
  custom_quick_replies: null,
  custom_variable_map: null,
  custom_image: null,
  custom_video: null,
  custom_document: null,
  template_id_a: null,
  template_id_b: null,
  template_overrides: null,
  template_overrides_b: null,
  flow_id: null,
  flow_id_b: null,
  use_attributes: false,
  tracking_enabled: true,
  repeat_interval: null,
  repeat_until: null,
  throttle_min_sec: null,
  throttle_max_sec: null,
  batch_size: null,
  batch_pause_min: null,
  daily_limit: null,
  window_start: null,
  window_end: null,
  node_schedule_id: null,
  clicked_count: 0,
  meta_clicked_count: 0,
  meta_analytics_synced_at: null,
  expires_at: null,
  wizard: null,
  series_id: null,
  occurrence_no: null,
  retry_until: null,
  row_version: 1,
};
const RECIPIENT_DEFAULTS: Record<string, unknown> = {
  variant: null,
  next_attempt_at: null,
  tracking_id: null,
  response: null,
  clicked: false,
  clicked_at: null,
  click_count: 0,
  unsubscribed: false,
  is_unsubscribed: false,
  unsubscribed_at: null,
  retry_state: null,
  retry_first_sent_at: null,
  retry_next_at: null,
  row_version: 1,
};
const TS_COLUMNS = new Set([
  'last_run_at',
  'run_at',
  'completed_at',
  'created_at',
  'updated_at',
  'sent_at',
  'delivered_at',
  'read_at',
  'responded_at',
  'meta_analytics_synced_at',
  'expires_at',
  'retry_until',
  'next_attempt_at',
  'clicked_at',
  'unsubscribed_at',
  'retry_first_sent_at',
  'retry_next_at',
]);
const colExpr = (c: string, al = ''): string =>
  TS_COLUMNS.has(c)
    ? tsCol(c, al)
    : c === 'send_date' || c === 'repeat_until'
      ? `to_char(${al}${c}, 'YYYY-MM-DD') AS ${c}`
      : c === 'send_time'
        ? `to_char(${al}send_time, 'HH24:MI:SS') AS send_time`
        : `${al}${c} AS ${c}`;
const same = (got: unknown, want: unknown, col: string): boolean => {
  if (TS_COLUMNS.has(col)) return (got ?? null) === ts((want as string | null) ?? null);
  if (typeof want === 'number') return got !== null && got !== undefined && Number(got) === want;
  return (got ?? null) === (want ?? null);
};

export interface CampaignVerifyArgs {
  db: Database;
  orgId: number;
  client: string;
  source: Source;
  settings: BroadcastSettings;
  plan: BroadcastPlan;
  defaultCc: string | null;
  referenceAt: string;
  allowExtraRows: boolean;
  alarm: (m: string) => void;
  warnings: string[];
  notPresent: Report['notPresent'];
}

const chunks = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

export async function verifyCampaigns(a: CampaignVerifyArgs): Promise<BResult> {
  const { db, orgId, client, alarm } = a;
  const tenant = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => withTenant(db, { orgId }, fn);
  const rowsOf = <T>(r: { rows: unknown[] }): T[] => r.rows as T[];
  const quote = (s: string): string => s.replace(/'/g, "''");
  const q1 = async (t: string): Promise<number> =>
    Number(rowsOf<{ n: number | string }>(await tenant((tx) => tx.execute(sql.raw(t))))[0]!.n);

  // ---- ids the oracle needs (migration.id_map) and the contacts deleted at the source -------------------------------------------------
  const idMapOf = async (collection: string, table: string): Promise<Map<string, number>> => {
    const r = await db.execute(sql`
      SELECT source_key, target_id FROM migration.id_map
      WHERE source_client = ${client} AND source_collection = ${collection} AND target_table = ${table}`);
    return new Map(
      rowsOf<{ source_key: string; target_id: number | string }>(r).map((x) => [
        x.source_key,
        Number(x.target_id),
      ]),
    );
  };
  const contactIds = await idMapOf('contact_list', 'contacts');
  const userIds = await idMapOf('user', 'users');
  // the migrated templates and the Waboo keys that point at them (the template link of a campaign)
  const templateKeys = new Map<number, string[]>();
  for (const [k, id] of await idMapOf('broadcast_templates', 'wa_templates'))
    templateKeys.set(id, [...(templateKeys.get(id) ?? []), k]);
  const templates = rowsOf<{
    id: number | string;
    template_name: string;
    language: string;
    meta_template_id: string | null;
  }>(
    await tenant((tx) =>
      tx.execute(
        sql`SELECT id, template_name, language, meta_template_id FROM wa_templates WHERE org_id = ${orgId}`,
      ),
    ),
  ).map((t) => ({
    id: Number(t.id),
    name: t.template_name,
    language: t.language,
    meta: t.meta_template_id,
    keys: templateKeys.get(Number(t.id)) ?? [],
  }));
  // campaign-link (load/campaignlink.ts) stamps updated_at / row_version through the touch trigger on exactly these campaigns
  const linked = await linkedCampaigns(db, client);
  // rows the `update` command changed carry row_version > 1: exactly the version it recorded is right (load/update.ts)
  const bumped = new Map<string, number>();
  try {
    const b = await db.execute(
      sql`SELECT target_uuid::text AS uuid, max(written_version) AS v FROM migration.id_map WHERE source_client = ${client} AND written_version IS NOT NULL AND target_uuid IS NOT NULL GROUP BY target_uuid`,
    );
    for (const x of b.rows as Array<{ uuid: string; v: number }>) bumped.set(x.uuid, Number(x.v));
  } catch {
    // an id_map from before update mode: nothing was ever updated
  }
  const has = (c: string): boolean => a.source.collections(client).includes(c);
  const deletedContacts = new Set<string>();
  if (has('contact_list'))
    for await (const d of a.source.read(client, 'contact_list'))
      if (oracleDeleted(d)) {
        if (hexKey(d._id) !== '') deletedContacts.add(hexKey(d._id));
        if (text(d.id) !== '') deletedContacts.add(text(d.id));
      }
  async function* none(): AsyncGenerator<Record<string, unknown>> {
    /* an absent collection */
  }
  const oracle = await oracleBroadcast(
    has('broadcasting') ? a.source.read(client, 'broadcasting') : none(),
    has('whatsapp_broadcasting_data')
      ? a.source.read(client, 'whatsapp_broadcasting_data')
      : none(),
    {
      client,
      keepTest: a.settings.keepTestBroadcasts,
      nonTerminal: a.settings.nonTerminalStatus,
      failedAttempts: a.settings.failedSendAttempts,
      defaultCc: a.defaultCc,
      fallbackAt: a.referenceAt,
      deletedContacts,
      contactId: (k) => contactIds.get(k),
      userId: (k) => userIds.get(k),
      hasUsers: has('user'),
      contactsByDigits: a.plan.contactsByDigits,
      templates,
    },
  );

  // ---- 1. the oracle against the loader's plan (pass 1) -------------------------------------------------------------------------------
  const norm = (k: string): string =>
    k.replace(/ quarantine (NUL_CHAR|LONE_SURROGATE)$/, ' engine');
  const planTally: Record<string, number> = {};
  for (const [k, n] of Object.entries(a.plan.tally))
    planTally[norm(k)] = (planTally[norm(k)] ?? 0) + n;
  const oracleTally = { ...oracle.tally };
  delete oracleTally['recipient engine']; // the plan never sees a document the engine already quarantined
  delete planTally['recipient engine'];
  for (const k of new Set([...Object.keys(planTally), ...Object.keys(oracleTally)]))
    if ((planTally[k] ?? 0) !== (oracleTally[k] ?? 0))
      alarm(
        `ORACLE_MISMATCH: ${k}: independent check ${oracleTally[k] ?? 0}, loader plan ${planTally[k] ?? 0} document(s)`,
      );
  for (const c of oracle.campaigns.values()) {
    if (c.verdict !== 'load') continue;
    const p = a.plan.agg.get(c.key) ?? {
      total: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      responded: 0,
      failed: 0,
    };
    if (
      p.total !== c.agg.rows ||
      p.sent !== c.agg.sent ||
      p.delivered !== c.agg.delivered ||
      p.read !== c.agg.read ||
      p.responded !== c.agg.responded ||
      p.failed !== c.agg.failed
    )
      alarm(
        `ORACLE_MISMATCH: campaign ${c.key}: the counters over its recipients differ (independent sent/delivered/read/responded/failed ${c.agg.sent}/${c.agg.delivered}/${c.agg.read}/${c.agg.responded}/${c.agg.failed} of ${c.agg.rows}, loader plan ${p.sent}/${p.delivered}/${p.read}/${p.responded}/${p.failed} of ${p.total})`,
      );
  }

  // ---- 2. quarantine codes: the hard ones, document by document ------------------------------------------------------------------------
  const qrows = rowsOf<{ collection: string; source_key: string; reason_code: string }>(
    await db.execute(sql`
      SELECT collection, source_key, reason_code FROM migration.quarantine
      WHERE source_client = ${client} AND collection IN ('broadcasting', 'whatsapp_broadcasting_data') AND position('#' in source_key) = 0`),
  );
  const hard = new Map(qrows.map((r) => [`${r.collection}\u0000${r.source_key}`, r.reason_code]));
  const wantHard = (
    collection: string,
    k: string,
    code: string | undefined,
    engine: boolean,
  ): void => {
    const got = hard.get(`${collection}\u0000${k}`);
    const ok = engine ? got === 'NUL_CHAR' || got === 'LONE_SURROGATE' : got === code;
    if (!ok)
      alarm(
        `ORACLE_MISMATCH: ${collection} ${k}: independent check says quarantine ${engine ? 'NUL_CHAR / LONE_SURROGATE' : code}, the target says ${got ?? 'nothing'}`,
      );
  };
  for (const c of oracle.campaigns.values())
    if (c.verdict === 'quarantine' || c.verdict === 'engine')
      wantHard('broadcasting', c.key, c.code, c.verdict === 'engine');
    else if (c.verdict === 'exclude' || c.verdict === 'load')
      if (hard.has(`broadcasting\u0000${c.key}`))
        alarm(
          `ORACLE_MISMATCH: broadcasting ${c.key}: quarantined, but the independent check says ${c.verdict}`,
        );
  for (const r of oracle.recipients.values())
    if (r.verdict === 'quarantine' || r.verdict === 'engine')
      wantHard('whatsapp_broadcasting_data', r.key, r.code, r.verdict === 'engine');
    else if (hard.has(`whatsapp_broadcasting_data\u0000${r.key}`))
      alarm(
        `ORACLE_MISMATCH: whatsapp_broadcasting_data ${r.key}: quarantined, but the independent check says it loads`,
      );

  const softRows = new Set(
    rowsOf<{ source_key: string }>(
      await db.execute(sql`
        SELECT source_key FROM migration.quarantine
        WHERE source_client = ${client} AND collection = 'broadcasting' AND position('#' in source_key) > 0`),
    ).map((r) => r.source_key),
  );

  // ---- 3. every campaign ----------------------------------------------------------------------------------------------------------------
  const wantCampaigns = [...oracle.campaigns.values()].filter((c) => c.verdict === 'load');
  const idOfCampaign = new Map<string, number>(); // oracle campaign key -> wpcampaigns.id
  const wantCols = (row: Record<string, unknown>): string[] => Object.keys(row);
  const campaignCols = wantCampaigns[0]?.row ? wantCols(wantCampaigns[0].row) : [];
  const defaults = Object.keys(CAMPAIGN_DEFAULTS);
  const relaxed = new Set([
    'status',
    'total_recipients',
    'sent_count',
    'failed_count',
    'delivered_count',
    'read_count',
    'responded_count',
    'updated_at',
    'retry_enabled',
    'completed_at',
    'last_run_at',
    'row_version',
  ]);
  let campaignsFound = 0;
  for (const part of chunks(wantCampaigns, 200)) {
    const res = await tenant((tx) =>
      tx.execute(
        sql.raw(`
        SELECT id, uuid::text AS uuid, ${[...new Set([...campaignCols, ...defaults])].map((c) => colExpr(c)).join(', ')}
        FROM wpcampaigns WHERE org_id = ${orgId}
          AND uuid = ANY (ARRAY(SELECT jsonb_array_elements_text('${quote(JSON.stringify(part.map((c) => c.uuid)))}'::jsonb)::uuid))`),
      ),
    );
    const byUuid = new Map(rowsOf<Record<string, unknown>>(res).map((r) => [String(r.uuid), r]));
    for (const c of part) {
      const t = byUuid.get(c.uuid);
      if (!t) {
        alarm(
          `TARGET_MISSING: wpcampaigns row for broadcasting ${c.key} (uuid ${c.uuid}) does not exist in the target`,
        );
        continue;
      }
      campaignsFound++;
      idOfCampaign.set(c.key, Number(t.id));
      const bad: string[] = [];
      const touchedByLink = linked.has(c.uuid);
      for (const [col, want] of Object.entries(c.row!))
        if (
          !(a.allowExtraRows && relaxed.has(col)) &&
          !(touchedByLink && col === 'updated_at') &&
          !same(t[col], want, col)
        )
          bad.push(
            `${col} expected=${String(want)} target=${String(t[col])}${col === 'template_id' && t[col] === null ? ' (run campaign-link)' : ''}`,
          );
      if (!a.allowExtraRows)
        for (const [col, want] of Object.entries(CAMPAIGN_DEFAULTS))
          if (
            !(touchedByLink && col === 'row_version' && !bumped.has(c.uuid)) &&
            !same(
              t[col],
              col === 'row_version' && bumped.has(c.uuid) ? bumped.get(c.uuid) : want,
              col,
            )
          )
            bad.push(`default ${col}`);
      if (bad.length > 0) alarm(`ORACLE_MISMATCH: wpcampaigns ${c.key}: ${bad.join('; ')}`);
      // the soft issues the transform owes this campaign are in the quarantine log
      for (const code of c.softs)
        if (!softRows.has(`${c.key}#${code}`))
          alarm(
            `ORACLE_MISMATCH: broadcasting ${c.key}: the quarantine log has no ${code} row for it`,
          );
    }
  }

  // ---- 4. every recipient ---------------------------------------------------------------------------------------------------------------
  const wantRecipients = [...oracle.recipients.values()].filter((r) => r.verdict === 'load');
  const recipientCols = wantRecipients[0]?.row ? wantCols(wantRecipients[0].row) : [];
  const campaignIdOf = new Map<string, string>(); // oracle campaign key -> its uuid
  for (const c of oracle.campaigns.values()) campaignIdOf.set(c.key, c.uuid);
  let recipientsFound = 0;
  for (const part of chunks(wantRecipients, 1000)) {
    const res = await tenant((tx) =>
      tx.execute(
        sql.raw(`
        SELECT r.uuid::text AS uuid, r.campaign_id, c.uuid::text AS campaign_uuid,
               ${[...new Set([...recipientCols, ...Object.keys(RECIPIENT_DEFAULTS)])]
                 .filter((x) => x !== 'campaign_id')
                 .map((x) => colExpr(x, 'r.'))
                 .join(', ')}
        FROM wp_campaign_contacts r LEFT JOIN wpcampaigns c ON c.org_id = r.org_id AND c.id = r.campaign_id
        WHERE r.org_id = ${orgId}
          AND r.uuid = ANY (ARRAY(SELECT jsonb_array_elements_text('${quote(JSON.stringify(part.map((r) => r.uuid)))}'::jsonb)::uuid))`),
      ),
    );
    const byUuid = new Map(rowsOf<Record<string, unknown>>(res).map((r) => [String(r.uuid), r]));
    for (const r of part) {
      const t = byUuid.get(r.uuid);
      if (!t) {
        alarm(
          `TARGET_MISSING: wp_campaign_contacts row for whatsapp_broadcasting_data ${r.key} (uuid ${r.uuid}) does not exist in the target`,
        );
        continue;
      }
      recipientsFound++;
      const bad: string[] = [];
      for (const [col, want] of Object.entries(r.row!)) {
        const live =
          a.allowExtraRows &&
          [
            'status',
            'delivered_at',
            'read_at',
            'responded_at',
            'error_message',
            'error_code',
            'updated_at',
            'retry_count',
            'send_attempts',
          ].includes(col);
        if (!live && !same(t[col], want, col))
          bad.push(
            `${col} expected=${col === 'phone_number' || col === 'recipient_name' ? mask(want) : String(want)} target=${col === 'phone_number' || col === 'recipient_name' ? mask(t[col]) : String(t[col])}`,
          );
      }
      if (t.campaign_uuid !== campaignIdOf.get(r.campaign!)) bad.push('campaign');
      if (!a.allowExtraRows)
        for (const [col, want] of Object.entries(RECIPIENT_DEFAULTS))
          if (
            !same(
              t[col],
              col === 'row_version' && bumped.has(r.uuid) ? bumped.get(r.uuid) : want,
              col,
            )
          )
            bad.push(`default ${col}`);
      if (bad.length > 0)
        alarm(`ORACLE_MISMATCH: wp_campaign_contacts ${r.key}: ${bad.join('; ')}`);
    }
  }

  // ---- 5. rows the source does not account for (the same set arithmetic as the generic check, with the oracle's own uuids) ---------------
  if (!a.allowExtraRows) {
    const wantC = new Set(wantCampaigns.map((c) => c.uuid));
    const haveC = rowsOf<{ uuid: string }>(
      await tenant((tx) =>
        tx.execute(sql`SELECT uuid::text AS uuid FROM wpcampaigns WHERE org_id = ${orgId}`),
      ),
    );
    const extraC = haveC.filter((r) => !wantC.has(r.uuid)).length;
    if (extraC > 0)
      alarm(
        `EXTRA_ROWS: ${extraC} wpcampaigns row(s) are not accounted for by any broadcasting document`,
      );
    const wantR = new Set(wantRecipients.map((r) => r.uuid));
    const haveR = rowsOf<{ uuid: string }>(
      await tenant((tx) =>
        tx.execute(
          sql`SELECT uuid::text AS uuid FROM wp_campaign_contacts WHERE org_id = ${orgId}`,
        ),
      ),
    );
    const extraR = haveR.filter((r) => !wantR.has(r.uuid)).length;
    if (extraR > 0)
      alarm(
        `EXTRA_ROWS: ${extraR} wp_campaign_contacts row(s) are not accounted for by any whatsapp_broadcasting_data document`,
      );
  }

  // ---- 6. SAFETY and counters, straight from the target (SQL) -----------------------------------------------------------------------------
  const mine = (alias: string, collection: string, table: string): string =>
    `EXISTS (SELECT 1 FROM migration.id_map i WHERE i.source_client = '${quote(client)}' AND i.source_collection = '${collection}' AND i.target_table = '${table}' AND i.target_id = ${alias}.id AND i.target_uuid = ${alias}.uuid)`;
  const sendable = await q1(
    `SELECT count(*) AS n FROM wpcampaigns c WHERE c.org_id = ${orgId} AND ${mine('c', 'broadcasting', 'wpcampaigns')} AND c.status NOT IN ('completed', 'failed', 'cancelled')`,
  );
  if (sendable > 0 && !a.allowExtraRows)
    alarm(
      `SENDABLE_CAMPAIGN: ${sendable} migrated campaign(s) are in a status a scheduler, sweeper or resume could act on (only completed / failed / cancelled are safe)`,
    );
  const retryOn = await q1(
    `SELECT count(*) AS n FROM wpcampaigns c WHERE c.org_id = ${orgId} AND ${mine('c', 'broadcasting', 'wpcampaigns')} AND (c.retry_enabled OR c.wizard IS NOT NULL OR c.series_id IS NOT NULL)`,
  );
  if (retryOn > 0 && !a.allowExtraRows)
    alarm(
      `SENDABLE_CAMPAIGN: ${retryOn} migrated campaign(s) have retry on (or a wizard / series), which the retry job acts on`,
    );
  const live = await q1(
    `SELECT count(*) AS n FROM wp_campaign_contacts r WHERE r.org_id = ${orgId} AND ${mine('r', 'whatsapp_broadcasting_data', 'wp_campaign_contacts')}
       AND (r.status NOT IN ('sent', 'delivered', 'read', 'responded', 'failed') OR r.retry_state IS NOT NULL OR r.next_attempt_at IS NOT NULL OR r.retry_next_at IS NOT NULL)`,
  );
  if (live > 0 && !a.allowExtraRows)
    alarm(
      `SENDABLE_RECIPIENT: ${live} migrated recipient(s) are queued / pending / skipped, or have a retry state or a next attempt: a sender would pick them up`,
    );
  const failedStamped = await q1(
    `SELECT count(*) AS n FROM wp_campaign_contacts r WHERE r.org_id = ${orgId} AND ${mine('r', 'whatsapp_broadcasting_data', 'wp_campaign_contacts')}
       AND r.status = 'failed' AND (r.sent_at IS NOT NULL OR r.delivered_at IS NOT NULL OR r.read_at IS NOT NULL OR r.responded_at IS NOT NULL)`,
  );
  if (failedStamped > 0)
    alarm(
      `FAILED_WITH_TIMESTAMP: ${failedStamped} failed recipient(s) carry sent_at / delivered_at / read_at / responded_at: the campaign tiles would count them as sent AND failed`,
    );
  const repliedOdd = await q1(
    `SELECT count(*) AS n FROM wp_campaign_contacts r WHERE r.org_id = ${orgId} AND ${mine('r', 'whatsapp_broadcasting_data', 'wp_campaign_contacts')}
       AND ((r.responded_at IS NOT NULL) <> (r.status = 'responded') OR (r.read_at IS NOT NULL AND r.status NOT IN ('read', 'responded')))`,
  );
  if (repliedOdd > 0 && !a.allowExtraRows)
    alarm(
      `STATUS_INCONSISTENT: ${repliedOdd} recipient(s) have a status that disagrees with their responded_at / read_at`,
    );
  const lowAttempts = await q1(
    `SELECT count(*) AS n FROM wp_campaign_contacts r WHERE r.org_id = ${orgId} AND ${mine('r', 'whatsapp_broadcasting_data', 'wp_campaign_contacts')}
       AND r.status = 'failed' AND r.send_attempts < 3`,
  );
  if (lowAttempts > 0)
    alarm(
      `SENDABLE_RECIPIENT: ${lowAttempts} failed recipient(s) have send_attempts below 3: the Meta-throttle sweeper would schedule their campaign again`,
    );
  // counters = the app's own roll-up over the rows (campaigns.repository.ts AGG), for every migrated campaign
  const agg = rowsOf<{
    id: number | string;
    total_recipients: number;
    sent_count: number;
    delivered_count: number;
    read_count: number;
    responded_count: number;
    failed_count: number;
    n: number;
    a_sent: number;
    a_delivered: number;
    a_read: number;
    a_responded: number;
    a_failed: number;
  }>(
    await tenant((tx) =>
      tx.execute(
        sql.raw(`
        SELECT c.id, c.total_recipients, c.sent_count, c.delivered_count, c.read_count, c.responded_count, c.failed_count,
               count(r.id)::int AS n,
               count(*) FILTER (WHERE r.status IN ('sent','delivered','read','responded') OR r.sent_at IS NOT NULL OR r.delivered_at IS NOT NULL OR r.read_at IS NOT NULL OR r.responded_at IS NOT NULL)::int AS a_sent,
               count(*) FILTER (WHERE r.status IN ('delivered','read','responded') OR r.delivered_at IS NOT NULL OR r.read_at IS NOT NULL OR r.responded_at IS NOT NULL)::int AS a_delivered,
               count(*) FILTER (WHERE r.status IN ('read','responded') OR r.read_at IS NOT NULL)::int AS a_read,
               count(*) FILTER (WHERE r.status = 'responded' OR r.responded_at IS NOT NULL)::int AS a_responded,
               count(*) FILTER (WHERE r.status = 'failed')::int AS a_failed
        FROM wpcampaigns c LEFT JOIN wp_campaign_contacts r ON r.org_id = c.org_id AND r.campaign_id = c.id
        WHERE c.org_id = ${orgId} AND ${mine('c', 'broadcasting', 'wpcampaigns')}
        GROUP BY c.org_id, c.id`),
      ),
    ),
  );
  for (const g of agg) {
    if (a.allowExtraRows) break; // after cutover the app recounts and sends: the counters are the app's
    const bad: string[] = [];
    if (Number(g.sent_count) !== g.a_sent) bad.push(`sent_count ${g.sent_count} vs ${g.a_sent}`);
    if (Number(g.delivered_count) !== g.a_delivered)
      bad.push(`delivered_count ${g.delivered_count} vs ${g.a_delivered}`);
    if (Number(g.read_count) !== g.a_read) bad.push(`read_count ${g.read_count} vs ${g.a_read}`);
    if (Number(g.responded_count) !== g.a_responded)
      bad.push(`responded_count ${g.responded_count} vs ${g.a_responded}`);
    if (Number(g.failed_count) !== g.a_failed)
      bad.push(`failed_count ${g.failed_count} vs ${g.a_failed}`);
    if (Number(g.total_recipients) < g.n)
      bad.push(`total_recipients ${g.total_recipients} below ${g.n} rows`);
    if (bad.length > 0)
      alarm(
        `COUNTER_MISMATCH: wpcampaigns ${g.id}: stored counters differ from the roll-up of its recipient rows (${bad.join('; ')})`,
      );
  }
  const orphans = await q1(
    `SELECT count(*) AS n FROM wp_campaign_contacts r WHERE r.org_id = ${orgId} AND NOT EXISTS (SELECT 1 FROM wpcampaigns c WHERE c.org_id = r.org_id AND c.id = r.campaign_id)`,
  );
  if (orphans > 0)
    alarm(
      `ORPHANS: ${orphans} wp_campaign_contacts row(s) point at a campaign that does not exist`,
    );

  // ---- 7. nothing the live application would have written for these campaigns -----------------------------------------------------------
  if (!a.allowExtraRows)
    for (const [t, col] of [
      ['camp_retry_attempts', 'campaign_id'],
      ['camp_follow_up_attempts', 'campaign_id'],
      ['camp_test_sends', 'campaign_id'],
      ['wa_link_clicks', 'campaign_id'],
      ['scheduled_messages', 'campaign_id'],
    ] as const) {
      const n = await q1(
        `SELECT count(*) AS n FROM ${t} x WHERE x.org_id = ${orgId} AND x.${col} IN (SELECT id FROM wpcampaigns WHERE org_id = ${orgId} AND ${mine('wpcampaigns', 'broadcasting', 'wpcampaigns')})`,
      );
      if (n > 0)
        alarm(
          `EXTRA_ROWS: ${n} row(s) in ${t} belong to migrated campaigns (history is imported quietly)`,
        );
    }

  // ---- 8. the report ----------------------------------------------------------------------------------------------------------------------
  void campaignsFound;
  void recipientsFound;
  for (const n of oracle.noHome)
    a.notPresent.droppedFields.push(
      `NOT PRESENT (broadcasts): ${n.what}: ${n.n} of ${n.of} ${n.what.startsWith('wpcampaigns') ? 'loaded campaigns' : 'loaded recipient rows'}`,
    );
  return oracle;
}
