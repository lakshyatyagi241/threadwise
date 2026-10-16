import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  workspaceMinorAge,
  type ComplianceRegime,
  type PrivacyFlagKind,
  type PrivacyFlagSource,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { NO_FLAGS, type FlagsState } from './contact-privacy.rules';

type Raw = Record<string, unknown>;
const num = (v: unknown): number => Number(v);
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));

export interface PrivacyEventRow {
  id: number;
  uuid: string;
  contactId: number | null;
  contactUuid: string | null;
  kind: string;
  value: boolean;
  source: string;
  evidence: Record<string, unknown>;
  actorUuid: string | null;
  actorName: string | null;
  note: string | null;
  occurredAt: string;
  recordedAt: string;
}

/** What the Compliance center says that the privacy flags depend on (the table is read, never written, from here). */
export interface ComplianceFacts {
  childrenPolicy: 'unset' | 'no_minors' | 'may_include_minors';
  parentalConsentRequired: boolean;
  /** The `ccpa_us` profile is switched on. */
  ccpaUs: boolean;
  /** The age below which a person is a minor in this workspace (the highest of the profiles' ages, else 18). */
  minorAge: number;
}

/** The columns of a flags row, in the order `toState` reads them. */
const FLAG_COLUMNS = sql.raw(`is_minor, minor_since, minor_source, to_char(minor_until, 'YYYY-MM-DD') AS minor_until,
      to_char(dob_override_for, 'YYYY-MM-DD') AS dob_override_for, guardian_consent, guardian_since, do_not_sell_share, dns_since, dns_source`);

/** SQL of the contact privacy flags. Every statement is tenant scoped by `org_id` (and by forced RLS underneath). */
@Injectable()
export class ContactPrivacyRepository {
  /** The flags row, created empty when the contact has none, and locked: two changes of one contact must not race. */
  async lockFlags(tx: Tx, orgId: number, contactId: number): Promise<FlagsState> {
    await tx.execute(sql`
      INSERT INTO contact_privacy_flags (org_id, contact_id) VALUES (${orgId}, ${contactId})
      ON CONFLICT (org_id, contact_id) DO NOTHING`);
    const res = await tx.execute(sql`
      SELECT ${FLAG_COLUMNS}
      FROM contact_privacy_flags WHERE org_id = ${orgId} AND contact_id = ${contactId} FOR UPDATE`);
    return toState(res.rows[0] as Raw | undefined);
  }

  /** The flags without creating or locking anything (a read). All false when the contact has no row. */
  async flagsOf(tx: Tx, orgId: number, contactId: number): Promise<FlagsState> {
    const res = await tx.execute(sql`
      SELECT ${FLAG_COLUMNS}
      FROM contact_privacy_flags WHERE org_id = ${orgId} AND contact_id = ${contactId}`);
    return toState(res.rows[0] as Raw | undefined);
  }

  async saveFlags(tx: Tx, orgId: number, contactId: number, s: FlagsState): Promise<void> {
    await tx.execute(sql`
      UPDATE contact_privacy_flags
      SET is_minor = ${s.isMinor}, minor_since = ${s.minorSince}::timestamptz, minor_source = ${s.minorSource},
          minor_until = ${s.minorUntil}::date, dob_override_for = ${s.dobOverrideFor}::date,
          guardian_consent = ${s.guardianConsent}, guardian_since = ${s.guardianSince}::timestamptz,
          do_not_sell_share = ${s.doNotSellShare}, dns_since = ${s.doNotSellShareSince}::timestamptz,
          dns_source = ${s.doNotSellShareSource}, updated_at = now()
      WHERE org_id = ${orgId} AND contact_id = ${contactId}`);
  }

  /** Inserts the event; null when the idempotency key was already used (a redelivery). */
  async insertEvent(
    tx: Tx,
    orgId: number,
    v: {
      contactId: number;
      kind: PrivacyFlagKind;
      value: boolean;
      source: PrivacyFlagSource;
      evidence: Record<string, unknown>;
      actorUserId: number | null;
      note: string | null;
      occurredAt: Date;
      idempotencyKey: string;
    },
  ): Promise<{ id: number; uuid: string } | null> {
    const res = await tx.execute(sql`
      INSERT INTO contact_privacy_events
        (org_id, contact_id, kind, value, source, evidence, actor_user_id, note, occurred_at, idempotency_key)
      VALUES (${orgId}, ${v.contactId}, ${v.kind}, ${v.value}, ${v.source}, ${JSON.stringify(v.evidence)}::jsonb,
              ${v.actorUserId}, ${v.note}, ${v.occurredAt.toISOString()}::timestamptz, ${v.idempotencyKey})
      ON CONFLICT (org_id, idempotency_key) DO NOTHING
      RETURNING id, uuid`);
    const r = res.rows[0] as Raw | undefined;
    return r ? { id: num(r.id), uuid: r.uuid as string } : null;
  }

  async eventByKey(
    tx: Tx,
    orgId: number,
    key: string,
  ): Promise<{ contactId: number | null; kind: string; value: boolean } | null> {
    const res = await tx.execute(sql`
      SELECT contact_id, kind, value FROM contact_privacy_events WHERE org_id = ${orgId} AND idempotency_key = ${key}`);
    const r = res.rows[0] as Raw | undefined;
    return r
      ? {
          contactId: r.contact_id === null ? null : num(r.contact_id),
          kind: r.kind as string,
          value: r.value === true,
        }
      : null;
  }

  /** Newest recorded first. */
  async listEvents(
    tx: Tx,
    orgId: number,
    contactId: number,
    limit: number,
  ): Promise<PrivacyEventRow[]> {
    const res = await tx.execute(sql`
      SELECT e.id, e.uuid, e.contact_id, c.uuid AS contact_uuid, e.kind, e.value, e.source, e.evidence,
             u.uuid AS actor_uuid, u.full_name AS actor_name, e.note, e.occurred_at, e.recorded_at
      FROM contact_privacy_events e
      LEFT JOIN contacts c ON c.org_id = e.org_id AND c.id = e.contact_id
      LEFT JOIN users u ON u.org_id = e.org_id AND u.id = e.actor_user_id
      WHERE e.org_id = ${orgId} AND e.contact_id = ${contactId}
      ORDER BY e.id DESC
      LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => ({
      id: num(r.id),
      uuid: r.uuid as string,
      contactId: r.contact_id === null ? null : num(r.contact_id),
      contactUuid: (r.contact_uuid as string | null) ?? null,
      kind: r.kind as string,
      value: r.value === true,
      source: r.source as string,
      evidence: (r.evidence as Record<string, unknown>) ?? {},
      actorUuid: (r.actor_uuid as string | null) ?? null,
      actorName: (r.actor_name as string | null) ?? null,
      note: (r.note as string | null) ?? null,
      occurredAt: iso(r.occurred_at),
      recordedAt: iso(r.recorded_at),
    }));
  }

  /** The Compliance center settings the flags depend on. A workspace that never saved them has the defaults. */
  async complianceFacts(tx: Tx, orgId: number): Promise<ComplianceFacts> {
    const res = await tx.execute(sql`
      SELECT children_policy, parental_consent_required, 'ccpa_us' = ANY(regimes) AS ccpa_us, regimes
      FROM compliance_settings WHERE org_id = ${orgId}`);
    const r = res.rows[0] as Raw | undefined;
    if (!r) {
      return {
        childrenPolicy: 'unset',
        parentalConsentRequired: false,
        ccpaUs: false,
        minorAge: workspaceMinorAge([]),
      };
    }
    const policy = r.children_policy as string;
    return {
      childrenPolicy:
        policy === 'no_minors' || policy === 'may_include_minors' ? policy : 'unset',
      parentalConsentRequired: r.parental_consent_required === true,
      ccpaUs: r.ccpa_us === true,
      minorAge: workspaceMinorAge((r.regimes as ComplianceRegime[] | null) ?? []),
    };
  }

  /** The contact's date of birth as an ISO day, or null. */
  async dateOfBirth(tx: Tx, orgId: number, contactId: number): Promise<string | null> {
    const res = await tx.execute(sql`
      SELECT to_char(date_of_birth, 'YYYY-MM-DD') AS dob FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`);
    return ((res.rows[0] as Raw | undefined)?.dob as string | null | undefined) ?? null;
  }

  /**
   * The flags that lapse by themselves, across every workspace: minors flagged from a date of birth (or an age) whose day has come.
   * Run as a privileged session by the worker; the writes that follow are tenant scoped again. Oldest first.
   */
  async lapsedFlags(
    tx: Tx,
    today: string,
    limit: number,
  ): Promise<Array<{ orgId: number; contactId: number }>> {
    const res = await tx.execute(sql`
      SELECT org_id, contact_id FROM contact_privacy_flags
      WHERE is_minor AND minor_source = 'dob' AND minor_until IS NOT NULL AND minor_until <= ${today}::date
      ORDER BY minor_until, org_id, contact_id
      LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => ({ orgId: num(r.org_id), contactId: num(r.contact_id) }));
  }

  /** The workspaces that hold at least one contact born on or after `bornAfter` (the youngest threshold anyone could ask for). */
  async orgsWithYoungContacts(tx: Tx, bornAfter: string): Promise<number[]> {
    const res = await tx.execute(sql`
      SELECT DISTINCT org_id FROM contacts WHERE date_of_birth > ${bornAfter}::date ORDER BY org_id`);
    return (res.rows as Raw[]).map((r) => num(r.org_id));
  }

  /**
   * Contacts of one workspace whose date of birth says "younger than the threshold" and who are not flagged, and whom no person has
   * reviewed for that date. `bornAfter` is the birth day that has not yet reached the threshold.
   */
  async unflaggedYoung(
    tx: Tx,
    orgId: number,
    bornAfter: string,
    limit: number,
  ): Promise<number[]> {
    const res = await tx.execute(sql`
      SELECT c.id FROM contacts c
      LEFT JOIN contact_privacy_flags f ON f.org_id = c.org_id AND f.contact_id = c.id
      WHERE c.org_id = ${orgId} AND c.date_of_birth > ${bornAfter}::date
        AND NOT coalesce(f.is_minor, false)
        AND f.dob_override_for IS DISTINCT FROM c.date_of_birth
      ORDER BY c.id
      LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => num(r.id));
  }
}

function toState(r: Raw | undefined): FlagsState {
  if (!r) return NO_FLAGS;
  return {
    isMinor: r.is_minor === true,
    minorSince: isoOrNull(r.minor_since),
    minorSource: (r.minor_source as PrivacyFlagSource | null) ?? null,
    minorUntil: (r.minor_until as string | null) ?? null,
    dobOverrideFor: (r.dob_override_for as string | null) ?? null,
    guardianConsent: r.guardian_consent === true,
    guardianSince: isoOrNull(r.guardian_since),
    doNotSellShare: r.do_not_sell_share === true,
    doNotSellShareSince: isoOrNull(r.dns_since),
    doNotSellShareSource: (r.dns_source as PrivacyFlagSource | null) ?? null,
  };
}
