import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  ComplianceRegime,
  ComplianceSettingsValues,
  Subprocessor,
  SubprocessorInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;

export interface SettingsRow {
  values: ComplianceSettingsValues;
  regimesConfirmedAt: string | null;
  rowVersion: number;
  updatedAt: string;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const day = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
};
const pgArray = (items: ReadonlyArray<string | number>): string => `{${items.join(',')}}`;

function toSettings(r: Raw): SettingsRow {
  return {
    values: {
      regimes: (Array.isArray(r.regimes) ? r.regimes : []) as ComplianceRegime[],
      privacyUrl: strOrNull(r.privacy_url),
      termsUrl: strOrNull(r.terms_url),
      dpo: {
        name: str(r.dpo_name),
        email: str(r.dpo_email),
        phone: str(r.dpo_phone),
        address: str(r.dpo_address),
      },
      grievanceOfficer: {
        name: str(r.grievance_name),
        email: str(r.grievance_email),
        phone: str(r.grievance_phone),
        address: str(r.grievance_address),
      },
      childrenPolicy: r.children_policy as ComplianceSettingsValues['childrenPolicy'],
      parentalConsentRequired: r.parental_consent_required === true,
      offerSaleShareOptOut: r.offer_sale_share_opt_out === true,
      optOutNoticeUrl: strOrNull(r.opt_out_notice_url),
      consentManager: { name: str(r.consent_manager_name), url: strOrNull(r.consent_manager_url) },
      quietHours: {
        enabled: r.quiet_hours_enabled === true,
        start: str(r.quiet_start),
        end: str(r.quiet_end),
      },
      callingWindow: {
        enabled: r.calling_window_enabled === true,
        start: str(r.calling_start),
        end: str(r.calling_end),
        days: (Array.isArray(r.calling_days) ? r.calling_days : []).map(Number),
      },
      windowTimezone: strOrNull(r.window_timezone),
      dndRegistry: r.dnd_registry as ComplianceSettingsValues['dndRegistry'],
      secondaryNoticeLocale: strOrNull(r.secondary_notice_locale),
      subprocessorsPublic: r.subprocessors_public === true,
    },
    regimesConfirmedAt: isoOrNull(r.regimes_confirmed_at),
    rowVersion: Number(r.row_version),
    updatedAt: iso(r.updated_at),
  };
}

/** The window columns of the settings row, with the workspace time zone (see `windowFacts`). */
export interface WindowFacts {
  quietHours: ComplianceSettingsValues['quietHours'];
  callingWindow: ComplianceSettingsValues['callingWindow'];
  windowTimezone: string | null;
  workspaceTimezone: string | null;
}

interface SubRow extends Subprocessor {
  internalId: number;
}

const toSub = (r: Raw): SubRow => ({
  internalId: Number(r.id),
  id: String(r.uuid),
  name: str(r.name),
  purpose: str(r.purpose),
  dataCategories: str(r.data_categories),
  location: str(r.location),
  websiteUrl: strOrNull(r.website_url),
  dpaUrl: strOrNull(r.dpa_url),
  status: r.status as Subprocessor['status'],
  addedOn: day(r.added_on),
  noticeSentOn: day(r.notice_sent_on),
  rowVersion: Number(r.row_version),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const SUB_COLUMNS = sql`id, uuid, name, purpose, data_categories, location, website_url, dpa_url, status, added_on, notice_sent_on, row_version, created_at, updated_at`;

/** SQL of the Compliance center. Every statement is tenant scoped by `org_id` (and by forced RLS underneath). */
@Injectable()
export class ComplianceRepository {
  async getSettings(tx: Tx, orgId: number): Promise<SettingsRow | null> {
    const res = await tx.execute(sql`SELECT * FROM compliance_settings WHERE org_id = ${orgId}`);
    const r = res.rows[0] as Raw | undefined;
    return r ? toSettings(r) : null;
  }

  /** What the send-window decision needs, in one cheap statement: the window columns and the workspace time zone. */
  async windowFacts(tx: Tx, orgId: number): Promise<WindowFacts> {
    const res = await tx.execute(sql`
      SELECT s.quiet_hours_enabled, s.quiet_start, s.quiet_end, s.calling_window_enabled, s.calling_start, s.calling_end,
             s.calling_days, s.window_timezone, o.settings->>'timezone' AS workspace_timezone
      FROM organizations o LEFT JOIN compliance_settings s ON s.org_id = o.id
      WHERE o.id = ${orgId}`);
    const r = (res.rows[0] ?? {}) as Raw;
    return {
      quietHours: {
        enabled: r.quiet_hours_enabled === true,
        start: str(r.quiet_start) || '21:00',
        end: str(r.quiet_end) || '08:00',
      },
      callingWindow: {
        enabled: r.calling_window_enabled === true,
        start: str(r.calling_start) || '08:00',
        end: str(r.calling_end) || '21:00',
        days: (Array.isArray(r.calling_days) ? r.calling_days : []).map(Number),
      },
      windowTimezone: strOrNull(r.window_timezone),
      workspaceTimezone: strOrNull(r.workspace_timezone),
    };
  }

  /**
   * First save inserts (no version); later saves need the version they read. False on a conflict. `confirmed` says whether the
   * profile choice is confirmed by this save (any non-empty list); an empty list resets it.
   */
  async saveSettings(
    tx: Tx,
    orgId: number,
    v: ComplianceSettingsValues,
    rowVersion: number | undefined,
  ): Promise<boolean> {
    const confirmed = v.regimes.length > 0;
    const cols = sql`
      regimes = ${pgArray(v.regimes)}::text[],
      regimes_confirmed_at = CASE WHEN ${confirmed} THEN COALESCE(compliance_settings.regimes_confirmed_at, now()) ELSE NULL END,
      privacy_url = ${v.privacyUrl}, terms_url = ${v.termsUrl},
      dpo_name = ${v.dpo.name}, dpo_email = ${v.dpo.email}, dpo_phone = ${v.dpo.phone}, dpo_address = ${v.dpo.address},
      grievance_name = ${v.grievanceOfficer.name}, grievance_email = ${v.grievanceOfficer.email},
      grievance_phone = ${v.grievanceOfficer.phone}, grievance_address = ${v.grievanceOfficer.address},
      children_policy = ${v.childrenPolicy}, parental_consent_required = ${v.parentalConsentRequired},
      offer_sale_share_opt_out = ${v.offerSaleShareOptOut}, opt_out_notice_url = ${v.optOutNoticeUrl},
      consent_manager_name = ${v.consentManager.name}, consent_manager_url = ${v.consentManager.url},
      quiet_hours_enabled = ${v.quietHours.enabled}, quiet_start = ${v.quietHours.start}, quiet_end = ${v.quietHours.end},
      calling_window_enabled = ${v.callingWindow.enabled}, calling_start = ${v.callingWindow.start}, calling_end = ${v.callingWindow.end},
      calling_days = ${pgArray(v.callingWindow.days)}::smallint[],
      window_timezone = ${v.windowTimezone}, dnd_registry = ${v.dndRegistry},
      secondary_notice_locale = ${v.secondaryNoticeLocale}, subprocessors_public = ${v.subprocessorsPublic}`;
    if (rowVersion === undefined) {
      // A first save is an insert that falls into the update branch only to share the column list; the conflict clause refuses it.
      const res = await tx.execute(sql`
        INSERT INTO compliance_settings (org_id, regimes, regimes_confirmed_at, privacy_url, terms_url,
          dpo_name, dpo_email, dpo_phone, dpo_address, grievance_name, grievance_email, grievance_phone, grievance_address,
          children_policy, parental_consent_required, offer_sale_share_opt_out, opt_out_notice_url, consent_manager_name, consent_manager_url,
          quiet_hours_enabled, quiet_start, quiet_end, calling_window_enabled, calling_start, calling_end, calling_days,
          window_timezone, dnd_registry, secondary_notice_locale, subprocessors_public)
        VALUES (${orgId}, ${pgArray(v.regimes)}::text[], ${confirmed ? sql`now()` : sql`NULL`}, ${v.privacyUrl}, ${v.termsUrl},
          ${v.dpo.name}, ${v.dpo.email}, ${v.dpo.phone}, ${v.dpo.address},
          ${v.grievanceOfficer.name}, ${v.grievanceOfficer.email}, ${v.grievanceOfficer.phone}, ${v.grievanceOfficer.address},
          ${v.childrenPolicy}, ${v.parentalConsentRequired}, ${v.offerSaleShareOptOut}, ${v.optOutNoticeUrl},
          ${v.consentManager.name}, ${v.consentManager.url},
          ${v.quietHours.enabled}, ${v.quietHours.start}, ${v.quietHours.end},
          ${v.callingWindow.enabled}, ${v.callingWindow.start}, ${v.callingWindow.end}, ${pgArray(v.callingWindow.days)}::smallint[],
          ${v.windowTimezone}, ${v.dndRegistry}, ${v.secondaryNoticeLocale}, ${v.subprocessorsPublic})
        ON CONFLICT (org_id) DO NOTHING RETURNING org_id`);
      return res.rows.length > 0;
    }
    const res = await tx.execute(sql`
      UPDATE compliance_settings SET ${cols}
      WHERE org_id = ${orgId} AND row_version = ${rowVersion} RETURNING org_id`);
    return res.rows.length > 0;
  }

  // ---- sub-processors ---------------------------------------------------------------------------------------------------------

  async listSubprocessors(tx: Tx, orgId: number): Promise<SubRow[]> {
    const res = await tx.execute(sql`
      SELECT ${SUB_COLUMNS} FROM compliance_subprocessors WHERE org_id = ${orgId}
      ORDER BY (status = 'removed'), lower(name), id`);
    return (res.rows as Raw[]).map(toSub);
  }

  async findSubprocessor(tx: Tx, orgId: number, uuid: string): Promise<SubRow | null> {
    const res = await tx.execute(sql`
      SELECT ${SUB_COLUMNS} FROM compliance_subprocessors WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`);
    const r = res.rows[0] as Raw | undefined;
    return r ? toSub(r) : null;
  }

  async insertSubprocessor(tx: Tx, orgId: number, v: SubprocessorInput): Promise<SubRow> {
    const res = await tx.execute(sql`
      INSERT INTO compliance_subprocessors (org_id, name, purpose, data_categories, location, website_url, dpa_url, status, added_on, notice_sent_on)
      VALUES (${orgId}, ${v.name}, ${v.purpose}, ${v.dataCategories}, ${v.location}, ${v.websiteUrl}, ${v.dpaUrl}, ${v.status},
        ${v.addedOn}::date, ${v.noticeSentOn}::date)
      RETURNING ${SUB_COLUMNS}`);
    return toSub(res.rows[0] as Raw);
  }

  /** Null when the row is gone or the version is stale. */
  async updateSubprocessor(
    tx: Tx,
    orgId: number,
    uuid: string,
    v: SubprocessorInput,
    rowVersion: number,
  ): Promise<SubRow | null> {
    const res = await tx.execute(sql`
      UPDATE compliance_subprocessors
      SET name = ${v.name}, purpose = ${v.purpose}, data_categories = ${v.dataCategories}, location = ${v.location},
          website_url = ${v.websiteUrl}, dpa_url = ${v.dpaUrl}, status = ${v.status},
          added_on = ${v.addedOn}::date, notice_sent_on = ${v.noticeSentOn}::date
      WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid AND row_version = ${rowVersion}
      RETURNING ${SUB_COLUMNS}`);
    const r = res.rows[0] as Raw | undefined;
    return r ? toSub(r) : null;
  }

  async deleteSubprocessor(tx: Tx, orgId: number, uuid: string): Promise<boolean> {
    const res = await tx.execute(sql`
      DELETE FROM compliance_subprocessors WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid RETURNING id`);
    return res.rows.length > 0;
  }

  // ---- facts the checklist and the suggestion read from the workspace's own data ----------------------------------------------

  /** Name, onboarding country and time zone, and the billing country of the latest paid order. */
  async orgFacts(
    tx: Tx,
    orgId: number,
  ): Promise<{
    name: string;
    slug: string;
    country: string | null;
    timezone: string | null;
    billingCountry: string | null;
  }> {
    const res = await tx.execute(sql`
      SELECT o.name, o.slug, o.settings->>'country' AS country, o.settings->>'timezone' AS timezone,
        (SELECT upper(btrim(x.billing_country)) FROM orders x
          WHERE x.org_id = o.id AND x.status = 'paid' AND btrim(coalesce(x.billing_country, '')) <> ''
          ORDER BY x.paid_at DESC NULLS LAST, x.id DESC LIMIT 1) AS billing_country
      FROM organizations o WHERE o.id = ${orgId}`);
    const r = (res.rows[0] ?? {}) as Raw;
    return {
      name: str(r.name),
      slug: str(r.slug),
      country: strOrNull(r.country),
      timezone: strOrNull(r.timezone),
      billingCountry: strOrNull(r.billing_country),
    };
  }

  /** How many intake points have an enabled current notice, and in which languages the workspace default is enabled. */
  async noticeFacts(
    tx: Tx,
    orgId: number,
  ): Promise<{ enabledCount: number; workspaceLocales: string[] }> {
    const res = await tx.execute(sql`
      SELECT scope, scope_ref FROM (
        SELECT DISTINCT ON (scope, scope_ref) scope, scope_ref, enabled FROM consent_notices
        WHERE org_id = ${orgId} ORDER BY scope, scope_ref, version DESC
      ) latest WHERE enabled`);
    const rows = res.rows as Array<{ scope: string; scope_ref: string }>;
    return {
      enabledCount: rows.length,
      workspaceLocales: rows.filter((r) => r.scope === 'workspace').map((r) => r.scope_ref),
    };
  }

  async requestFacts(
    tx: Tx,
    orgId: number,
  ): Promise<{ slaDays: number; open: number; overdue: number }> {
    const res = await tx.execute(sql`
      SELECT
        coalesce((SELECT sla_days FROM privacy_settings WHERE org_id = ${orgId}), 30) AS sla_days,
        count(*) FILTER (WHERE status IN ('received', 'verifying', 'in_progress'))::int AS open,
        count(*) FILTER (WHERE status IN ('received', 'verifying', 'in_progress') AND due_at < now())::int AS overdue
      FROM privacy_requests WHERE org_id = ${orgId}`);
    const r = (res.rows[0] ?? {}) as Raw;
    return {
      slaDays: Number(r.sla_days ?? 30),
      open: Number(r.open ?? 0),
      overdue: Number(r.overdue ?? 0),
    };
  }

  async recordingFacts(
    tx: Tx,
    orgId: number,
  ): Promise<{ enabled: boolean; retentionDays: number }> {
    const res = await tx.execute(
      sql`SELECT enabled, retention_days FROM call_recording_settings WHERE org_id = ${orgId}`,
    );
    const r = res.rows[0] as Raw | undefined;
    return { enabled: r?.enabled === true, retentionDays: Number(r?.retention_days ?? 90) };
  }

  /** The current English default notice, when it is switched on. */
  async defaultNoticeText(tx: Tx, orgId: number): Promise<string | null> {
    const res = await tx.execute(sql`
      SELECT enabled, text FROM consent_notices
      WHERE org_id = ${orgId} AND scope = 'workspace' AND scope_ref = 'en' ORDER BY version DESC LIMIT 1`);
    const r = res.rows[0] as Raw | undefined;
    return r && r.enabled === true && str(r.text) !== '' ? str(r.text) : null;
  }
}

export type { SubRow };
