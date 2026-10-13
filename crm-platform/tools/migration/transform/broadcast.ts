import { CAMPAIGN_ALIASES, zeroAgg } from '../broadcast/plan';
import { linkTemplate } from '../broadcast/template-link';
import {
  campaignSchedule,
  campaignStatus,
  campaignVerdict,
  classifyRecipient,
  errorParts,
  intOf,
  moneyString,
  nameOf,
  utcDate,
} from '../broadcast/rules';
import { iso, primaryKey, str, type Doc } from '../util';
import { c, times } from './common';
import { phoneOf } from './contacts';
import type { Ctx, FieldMap, HandlerSpec, Outcome, Row, Soft } from './types';

/**
 * broadcasting -> wpcampaigns and whatsapp_broadcasting_data -> wp_campaign_contacts (spec A section 3 and 4).
 *
 * SAFETY (an imported campaign must never send): the status is always terminal (completed / failed / cancelled), `retry_enabled` is
 * false and no recipient has a retry state, so neither the scheduler (`status = 'scheduled'`), the stalled-run resume (`running`), the
 * wizard retry job (`retry_enabled` + `retry_state`) nor the Meta-throttle sweeper (`failed AND send_attempts < 3`) can pick anything
 * up; a FAILED recipient has no sent_at / delivered_at / read_at / responded_at (the tiles count any of them as sent as well as
 * failed). The counters are computed in pass 1 (broadcast/plan.ts) and written with the campaign row: nothing is UPDATEd afterwards
 * (touch_row would overwrite updated_at). No event_outbox, notification, usage charge or wallet row is written; no INSERT trigger
 * exists on either table (test/bcast.spec.ts pins it).
 */
const NOT_PRESENT = 'NOT PRESENT: no column in wpcampaigns / wp_campaign_contacts';

export const CAMPAIGN_FIELDS: FieldMap = {
  _id: 'id (wpcampaigns.uuid is derived from it; registered in migration.id_map)',
  id: 'id (registered in migration.id_map: the recipient rows reference the campaign by it)',
  broadcast_id:
    'id (registered in migration.id_map: the recipient rows reference the campaign by it)',
  broadcast_name: 'col:campaign_name',
  type: 'col:campaign_type (whatsapp -> template) and provider waba',
  status:
    'col:status (completed / failed / cancelled as they are; anything else is imported as a TERMINAL status, soft NONTERMINAL_AT_MIGRATION)',
  created_time: 'col:created_at',
  modified_time: 'col:updated_at',
  deleted_time: 'drop:soft-delete timestamp; a campaign with it set is excluded and counted',
  test: 'drop:test=true campaigns are excluded TEST_BROADCAST (--keep-test-broadcasts loads them)',
  scheduled_now: 'col:schedule_type',
  scheduled_date: 'col:send_date, send_time, timezone (UTC) when scheduled_now is false',
  scheduled_date_dt: 'col:send_date, send_time, timezone (UTC); preferred over scheduled_date',
  sent_on: 'col:last_run_at, run_at, completed_at',
  recipients: 'col:total_recipients (never below the number of loaded recipient rows)',
  sent: 'col:sent_count (recomputed from the loaded recipient rows; a different Waboo value is kept in quarantine COUNTER_MISMATCH)',
  delivered: 'col:delivered_count (recomputed from the recipient rows, see sent)',
  seen: 'col:read_count (recomputed from the recipient rows, see sent)',
  replied: 'col:responded_count (recomputed from the recipient rows, see sent)',
  failed: 'col:failed_count (recomputed from the recipient rows, see sent)',
  processing:
    'drop:transient counter of a running send (a non-zero value is quarantined PENDING_AT_MIGRATION)',
  queued:
    'drop:transient counter of a running send (a non-zero value is quarantined PENDING_AT_MIGRATION)',
  created_by: 'col:created_by (the migrated Waboo user; soft UNRESOLVED_USER when there is none)',
  updated_by: 'drop:last editor; wpcampaigns has no updated_by column',
  retry_enabled: `drop:${NOT_PRESENT}; wpcampaigns.retry_enabled is written FALSE on purpose (a true value would arm the wizard retry job and RESEND failed recipients)`,
  retry_count: `drop:${NOT_PRESENT}; the retry job counts per recipient`,
  max_retries: `drop:${NOT_PRESENT}; the retry job counts per recipient`,
  last_retry: `drop:${NOT_PRESENT}; retry bookkeeping`,
  broadcast_template_id:
    'col:template_id (the Waboo template id, matched to the migrated wa_templates row through migration.id_map; see broadcast/template-link.ts)',
  broadcast_template_name:
    `drop:${NOT_PRESENT}; the name must equal the linked template's name (else CONFLICT, template_id NULL); kept in quarantine TEMPLATE_UNLINKED when unlinked`,
  broadcast_template_type: `drop:${NOT_PRESENT}; kept in quarantine TEMPLATE_UNLINKED when unlinked (proposal P1)`,
  broadcast_template_category: `drop:${NOT_PRESENT}; kept in quarantine TEMPLATE_UNLINKED when unlinked (proposal P1)`,
  sender_number: `drop:${NOT_PRESENT} (device_id points into wa_provider_configs); kept in quarantine SENDER_NUMBER (proposal P1)`,
  billable_amount: `drop:${NOT_PRESENT}; money belongs to the credits step; kept as a string in quarantine COST_FIELDS`,
  refunded_amount: `drop:${NOT_PRESENT}; money belongs to the credits step; kept as a string in quarantine COST_FIELDS`,
  reseller_amount: `drop:${NOT_PRESENT}; money belongs to the credits step; kept as a string in quarantine COST_FIELDS`,
  filter_query: `drop:${NOT_PRESENT}; Waboo filter DSL (wpcampaigns.wizard is the wizard's own contract and must not hold it; proposal P1)`,
  mongodb_query: `drop:${NOT_PRESENT}; raw Mongo query (proposal P1)`,
  search: `drop:${NOT_PRESENT}; audience search text (proposal P1)`,
  marketing_list_id: `drop:${NOT_PRESENT}; the audience list (proposal P1)`,
  components: `drop:${NOT_PRESENT}; send-time template components (template_overrides is replayed by a resend, so it must not hold them)`,
  materialize_time_seconds: 'drop:telemetry of the Waboo sender',
  template_resolution_time_seconds: 'drop:telemetry of the Waboo sender',
};

export const RECIPIENT_FIELDS: FieldMap = {
  _id: 'id (wp_campaign_contacts.uuid is derived from it; registered in migration.id_map)',
  id: 'id (registered in migration.id_map)',
  message_id: 'col:whatsapp_message_id',
  phone_no:
    'col:phone_number (E.164; the raw digits with a soft INVALID_PHONE when it cannot be read)',
  mobile: 'col:phone_number (fallback when phone_no is empty)',
  mobile_phone_number: 'col:phone_number (fallback)',
  contact_id: 'col:contact_id (id_map; else the single contact with that phone; else NULL)',
  first_name: 'col:recipient_name',
  last_name: 'col:recipient_name',
  primary_email: 'drop:the contact carries the email (no email column on a recipient)',
  status:
    'col:status, sent_at, delivered_at, read_at, responded_at, updated_at (forward-only; failed rows keep no timestamp)',
  'status.sent': 'col:sent_at (the iskm quirk: a literal top-level key "status.sent")',
  error: 'col:error_message, error_code (leading 3 to 6 digits)',
  source:
    'col:(row kept only when source = broadcast with a broadcast_id; others are excluded NON_BROADCAST_SOURCE)',
  broadcast_id: 'col:campaign_id (id_map of the campaign)',
  created_time: 'col:created_at',
  retry_count: 'col:retry_count (retry_state stays NULL: nothing is retried)',
  retry_enabled: `drop:${NOT_PRESENT}; recipients have no retry switch (the campaign's is written false)`,
  max_retries: `drop:${NOT_PRESENT}; campaign-level setting`,
  amount: `drop:${NOT_PRESENT}; money belongs to the credits step (join key: message_id = usage_charges.wamid)`,
  reseller_amount: `drop:${NOT_PRESENT}; money belongs to the credits step`,
  reseller_margin: `drop:${NOT_PRESENT}; money belongs to the credits step`,
  cost: `drop:${NOT_PRESENT}; money belongs to the credits step`,
  cost_description: `drop:${NOT_PRESENT}; billing note, credits step`,
  revert: `drop:${NOT_PRESENT}; refund flag, credits step`,
  reverted_at: `drop:${NOT_PRESENT}; refund time, credits step`,
  refund_run_id: `drop:${NOT_PRESENT}; refund run, credits step`,
  interakt_reponse_time: 'drop:telemetry of the Waboo sender',
  template_id: `drop:${NOT_PRESENT}; wp_campaign_contacts has no template column: the recipient points at its campaign, which carries the template (the value equals the campaign's on every campaign checked)`,
  meta_template_id: `drop:${NOT_PRESENT}; read (not stored) to confirm / find the campaign's template (broadcast/template-link.ts)`,
  template_category: `drop:${NOT_PRESENT}; Meta category of the send (proposal P1)`,
  origin: 'drop:automation / flow bookkeeping of a non-broadcast send',
  run_id: 'drop:automation / flow bookkeeping of a non-broadcast send',
  automation_id: 'drop:automation / flow bookkeeping of a non-broadcast send',
  node_id: 'drop:automation / flow bookkeeping of a non-broadcast send',
  events: 'drop:automation / flow bookkeeping of a non-broadcast send',
  context: 'drop:automation / flow bookkeeping of a non-broadcast send',
  list_id: 'drop:list the recipient was picked from (always null in the pilot data)',
  isSelected: 'drop:UI selection flag of the Waboo audience picker',
  conversation_id: 'drop:inbox thread of a non-broadcast send (no broadcast mirror is created)',
  expiry_reason: 'drop:automation expiry bookkeeping',
  expiry_run_id: 'drop:automation expiry bookkeeping',
};

const asObj = (v: unknown): Doc | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Doc) : null;

/** Columns of wpcampaigns the loader never writes: they must still hold their default (the verifier checks). */
export const CAMPAIGN_CONSTANTS: Record<string, unknown> = {
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

export const RECIPIENT_CONSTANTS: Record<string, unknown> = {
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

const WABOO_COUNTERS: Array<[string, 'sent' | 'delivered' | 'read' | 'responded' | 'failed']> = [
  ['sent', 'sent'],
  ['delivered', 'delivered'],
  ['seen', 'read'],
  ['replied', 'responded'],
  ['failed', 'failed'],
];

export const campaigns: HandlerSpec = {
  handler: 'campaigns',
  collection: 'broadcasting',
  mapCollection: 'broadcasting',
  aliasKeys: CAMPAIGN_ALIASES,
  fields: CAMPAIGN_FIELDS,
  // `update` mode: delivery counters and statuses keep moving in Waboo after the first load. retry_enabled is a sender switch: never written;
  // the status can only ever be a terminal one (no scheduler or sender picks the campaign up)
  update: { ignore: ['retry_enabled'], allow: { status: ['completed', 'failed', 'cancelled'] } },
  tables: {
    wpcampaigns: {
      columns: [
        c('campaign_name', 'text'),
        c('campaign_type', 'text'),
        c('status', 'text'),
        c('provider', 'text'),
        c('template_id', 'bigint'),
        c('created_by', 'bigint'),
        c('schedule_type', 'text'),
        c('send_date', 'date'),
        c('send_time', 'time'),
        c('timezone', 'text'),
        c('last_run_at', 'timestamptz'),
        c('run_at', 'timestamptz'),
        c('completed_at', 'timestamptz'),
        c('total_recipients', 'integer'),
        c('sent_count', 'integer'),
        c('failed_count', 'integer'),
        c('delivered_count', 'integer'),
        c('read_count', 'integer'),
        c('responded_count', 'integer'),
        c('retry_enabled', 'boolean'),
        c('created_at', 'timestamptz'),
        c('updated_at', 'timestamptz'),
      ],
      constants: CAMPAIGN_CONSTANTS,
      // what the live application changes once it takes writes (a send, a recount, the click sync): not compared under --allow-extra-rows
      liveColumns: [
        'status',
        'total_recipients',
        'sent_count',
        'failed_count',
        'delivered_count',
        'read_count',
        'responded_count',
        'clicked_count',
        'meta_clicked_count',
        'meta_analytics_synced_at',
        'updated_at',
        'retry_enabled',
        'retry_until',
        'completed_at',
        'last_run_at',
        'row_version',
      ],
    },
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    const plan = ctx.bcast;
    if (!plan)
      return {
        kind: 'quarantine',
        code: 'NOT_PLANNED',
        reason: 'the broadcast plan has no verdict for this document',
      };
    const s = plan.settings;
    const v = campaignVerdict(doc, s);
    if (v.verdict === 'exclude') return { kind: 'exclude', code: v.code!, reason: v.reason! };
    if (v.verdict === 'quarantine') return { kind: 'quarantine', code: v.code!, reason: v.reason! };

    const base = primaryKey(doc);
    const t = times(doc, ctx.fallbackAt);
    const soft: Soft[] = [...t.soft];
    const st = campaignStatus(doc.status, s);
    if (st.soft) soft.push(st.soft);
    const sch = campaignSchedule(doc);
    soft.push(...sch.soft);
    const sentOn = utcDate(doc.sent_on);
    const agg = plan.agg.get(base) ?? zeroAgg();
    const waboo = Math.max(0, intOf(doc.recipients) ?? 0);
    const total = Math.max(waboo, agg.total);
    if (waboo !== agg.total)
      soft.push({
        code: 'RECIPIENT_COUNT_MISMATCH',
        reason:
          'Waboo recipients (the audience) differs from the number of recipient rows in the log; total_recipients is the larger of the two',
        detail: { waboo, rows: agg.total },
      });
    const differs = WABOO_COUNTERS.filter(([k, mine]) => {
      const w = intOf(doc[k]);
      return w !== null && w !== agg[mine];
    });
    if (differs.length > 0)
      soft.push({
        code: 'COUNTER_MISMATCH',
        reason:
          'the app shows counters computed from the recipient rows, which differ from the counters Waboo stored',
        detail: {
          waboo: Object.fromEntries(WABOO_COUNTERS.map(([k]) => [k, intOf(doc[k])])),
          migrated: {
            sent: agg.sent,
            delivered: agg.delivered,
            seen: agg.read,
            replied: agg.responded,
            failed: agg.failed,
          },
        },
      });
    if ((intOf(doc.processing) ?? 0) > 0 || (intOf(doc.queued) ?? 0) > 0)
      soft.push({
        code: 'PENDING_AT_MIGRATION',
        reason: 'Waboo still showed processing / queued recipients; they are not sent',
        detail: { processing: intOf(doc.processing), queued: intOf(doc.queued) },
      });

    let createdBy: number | null = null;
    const cb = asObj(doc.created_by);
    const cbId = str(cb ? cb.id : doc.created_by);
    if (ctx.idx.hasUsers && cbId) {
      const ref = ctx.ref('user', cbId);
      if (ref && ref.table === 'users') createdBy = ref.id;
      else
        soft.push({
          code: 'UNRESOLVED_USER',
          reason: 'created_by matches no migrated user; created_by is left empty',
        });
    }
    // the fields with no column are kept as TEXT in quarantine rows (the raw dump is the archive), money as exact decimal strings
    const link = linkTemplate(doc, plan.templates, plan.metaIds.get(base));
    if (link.id === null)
      soft.push({
        code: 'TEMPLATE_UNLINKED',
        reason: `no migrated template matches this campaign exactly (${link.why}): template_id is NULL; the Waboo template is listed here`,
        detail: {
          why: link.why,
          id: str(doc.broadcast_template_id),
          name: str(doc.broadcast_template_name),
          type: str(doc.broadcast_template_type),
          category: str(doc.broadcast_template_category),
        },
      });
    else if (link.how !== 'reference')
      soft.push({
        code: 'TEMPLATE_LINKED_VIA',
        reason: `the template id did not resolve; the template was found by its ${link.how === 'meta' ? 'Meta id' : 'name'} (exact, unique)`,
        detail: { how: link.how },
      });
    if (str(doc.sender_number))
      soft.push({
        code: 'SENDER_NUMBER',
        reason: 'the sending number has no column (device_id is NULL)',
        detail: str(doc.sender_number),
      });
    const money = {
      billable_amount: moneyString(doc.billable_amount),
      refunded_amount: moneyString(doc.refunded_amount),
      reseller_amount: moneyString(doc.reseller_amount),
    };
    if (Object.values(money).some((x) => x !== null))
      soft.push({
        code: 'COST_FIELDS',
        reason: 'campaign cost fields have no column here; the credits step owns money',
        detail: money,
      });

    const completed = st.status === 'completed';
    const row: Row = {
      campaign_name: str(doc.broadcast_name),
      campaign_type: 'template',
      status: st.status,
      provider: 'waba',
      template_id: link.id,
      created_by: createdBy,
      schedule_type: sch.type,
      send_date: sch.date,
      send_time: sch.time,
      timezone: sch.timezone,
      last_run_at: iso(sentOn),
      run_at: iso(sentOn ?? sch.instant),
      completed_at: st.soft ? null : completed ? (iso(sentOn) ?? t.updated) : t.updated,
      total_recipients: total,
      sent_count: agg.sent,
      failed_count: agg.failed,
      delivered_count: agg.delivered,
      read_count: agg.read,
      responded_count: agg.responded,
      retry_enabled: false,
      created_at: t.created,
      updated_at: t.updated,
    };
    return { kind: 'rows', rows: [{ table: 'wpcampaigns', sub: '', row }], soft };
  },
};

/** The single contact with that number, when the document's own contact id does not resolve. */
function contactOf(doc: Doc, ctx: Ctx, digits: string, soft: Soft[]): number | null {
  const cid = str(doc.contact_id);
  if (cid) {
    const ref = ctx.ref('contact_list', cid);
    if (ref && ref.table === 'contacts') return ref.id;
    if (ctx.idx.contactDeleted.has(cid)) {
      soft.push({
        code: 'CONTACT_DELETED_AT_SOURCE',
        reason: 'the contact was deleted at the source: no contact is linked (the phone is kept)',
      });
      return null;
    }
  }
  const hit = digits ? ctx.bcast!.contactsByDigits.get(digits) : undefined;
  if (hit && hit.n === 1) {
    soft.push({
      code: 'CONTACT_BY_PHONE',
      reason: 'the contact id did not resolve; linked to the single contact with this number',
    });
    return hit.id;
  }
  soft.push({
    code: hit ? 'CONTACT_AMBIGUOUS' : 'CONTACT_UNRESOLVED',
    reason: hit
      ? 'the contact id did not resolve and several contacts hold this number: no contact is linked (never guessed)'
      : 'no contact is linked: the phone and name are kept on the recipient',
  });
  return null;
}

export const recipients: HandlerSpec = {
  handler: 'recipients',
  collection: 'whatsapp_broadcasting_data',
  mapCollection: 'whatsapp_broadcasting_data',
  fields: RECIPIENT_FIELDS,
  // `update` mode: a recipient's delivery status moves on (sent -> delivered -> read) after the first load. retry_count is never written (nor
  // are next_attempt_at / retry_*: they are not columns of this step); a failed row keeps send_attempts >= 3 so the sweeper skips it
  update: { ignore: ['retry_count'], allow: { status: ['sent', 'delivered', 'read', 'responded', 'failed'] } },
  tables: {
    wp_campaign_contacts: {
      columns: [
        c('campaign_id', 'bigint'),
        c('contact_id', 'bigint'),
        c('status', 'text'),
        c('send_attempts', 'smallint'),
        c('phone_number', 'text'),
        c('recipient_name', 'text'),
        c('whatsapp_message_id', 'text'),
        c('sent_at', 'timestamptz'),
        c('delivered_at', 'timestamptz'),
        c('read_at', 'timestamptz'),
        c('responded_at', 'timestamptz'),
        c('error_message', 'text'),
        c('error_code', 'text'),
        c('retry_count', 'smallint'),
        c('created_at', 'timestamptz'),
        c('updated_at', 'timestamptz'),
      ],
      constants: RECIPIENT_CONSTANTS,
      // receipts, replies, clicks, opt-outs and retries of the live application
      liveColumns: [
        'status',
        'send_attempts',
        'sent_at',
        'delivered_at',
        'read_at',
        'responded_at',
        'error_message',
        'error_code',
        'retry_count',
        'updated_at',
        'row_version',
        'next_attempt_at',
        'tracking_id',
        'response',
        'clicked',
        'clicked_at',
        'click_count',
        'unsubscribed',
        'is_unsubscribed',
        'unsubscribed_at',
        'retry_state',
        'retry_first_sent_at',
        'retry_next_at',
      ],
    },
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    const plan = ctx.bcast;
    if (!plan)
      return {
        kind: 'quarantine',
        code: 'NOT_PLANNED',
        reason: 'the broadcast plan has no verdict for this document',
      };
    const v = classifyRecipient(doc, plan.campaigns);
    if (v.kind !== 'load') return { kind: v.kind, code: v.code, reason: v.reason };
    const camp = ctx.ref('broadcasting', v.campaign.primary);
    if (!camp || camp.table !== 'wpcampaigns')
      return {
        kind: 'quarantine',
        code: 'CAMPAIGN_MISSING',
        reason: 'its campaign was not loaded into wpcampaigns',
      };
    const t = times(doc, ctx.fallbackAt, ['created_time', 'created_at'], []);
    const soft: Soft[] = [...t.soft, ...v.st.soft];
    const e164 = phoneOf(v.rawPhone, null, ctx.defaultCountryCode);
    const rawDigits = v.rawPhone.replace(/\D/g, '');
    let phone = e164;
    if (!phone) {
      phone =
        rawDigits === '' ? null : `${v.rawPhone.trim().startsWith('+') ? '+' : ''}${rawDigits}`;
      soft.push({
        code: 'INVALID_PHONE',
        reason:
          'cannot be read as an E.164 number: the raw digits are kept as the snapshot (the recipient is never sent to)',
        detail: v.rawPhone,
      });
    }
    const contactId = contactOf(doc, ctx, (e164 ?? rawDigits).replace(/\D/g, ''), soft);
    const failed = v.st.status === 'failed';
    const err = failed ? errorParts(doc.error) : { message: null, code: null };
    if (!failed && v.st.conflict && str(doc.error))
      soft.push({
        code: 'ERROR_DROPPED',
        reason:
          'the recipient has a later delivery step, so it is not failed and carries no error text',
        detail: str(doc.error),
      });
    const retry = intOf(doc.retry_count);
    const row: Row = {
      campaign_id: camp.id,
      contact_id: contactId,
      status: v.st.status,
      send_attempts: failed ? plan.settings.failedSendAttempts : 1,
      phone_number: phone,
      recipient_name: nameOf(doc),
      whatsapp_message_id: str(doc.message_id),
      sent_at: v.st.sentAt,
      delivered_at: v.st.deliveredAt,
      read_at: v.st.readAt,
      responded_at: v.st.respondedAt,
      error_message: err.message,
      error_code: err.code,
      retry_count: retry === null ? 0 : Math.min(32767, Math.max(0, retry)),
      created_at: t.created,
      updated_at: v.st.latest > t.created ? v.st.latest : t.created,
    };
    return { kind: 'rows', rows: [{ table: 'wp_campaign_contacts', sub: '', row }], soft };
  },
};
