import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PrivacyFlagKind, PrivacyFlagSource } from '@crm/contracts';
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
}

/** SQL of the contact privacy flags. Every statement is tenant scoped by `org_id` (and by forced RLS underneath). */
@Injectable()
export class ContactPrivacyRepository {
  /** The flags row, created empty when the contact has none, and locked: two changes of one contact must not race. */
  async lockFlags(tx: Tx, orgId: number, contactId: number): Promise<FlagsState> {
    await tx.execute(sql`
      INSERT INTO contact_privacy_flags (org_id, contact_id) VALUES (${orgId}, ${contactId})
      ON CONFLICT (org_id, contact_id) DO NOTHING`);
    const res = await tx.execute(sql`
      SELECT is_minor, minor_since, minor_source, guardian_consent, guardian_since, do_not_sell_share, dns_since, dns_source
      FROM contact_privacy_flags WHERE org_id = ${orgId} AND contact_id = ${contactId} FOR UPDATE`);
    return toState(res.rows[0] as Raw | undefined);
  }

  /** The flags without creating or locking anything (a read). All false when the contact has no row. */
  async flagsOf(tx: Tx, orgId: number, contactId: number): Promise<FlagsState> {
    const res = await tx.execute(sql`
      SELECT is_minor, minor_since, minor_source, guardian_consent, guardian_since, do_not_sell_share, dns_since, dns_source
      FROM contact_privacy_flags WHERE org_id = ${orgId} AND contact_id = ${contactId}`);
    return toState(res.rows[0] as Raw | undefined);
  }

  async saveFlags(tx: Tx, orgId: number, contactId: number, s: FlagsState): Promise<void> {
    await tx.execute(sql`
      UPDATE contact_privacy_flags
      SET is_minor = ${s.isMinor}, minor_since = ${s.minorSince}::timestamptz, minor_source = ${s.minorSource},
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
      SELECT children_policy, parental_consent_required, 'ccpa_us' = ANY(regimes) AS ccpa_us
      FROM compliance_settings WHERE org_id = ${orgId}`);
    const r = res.rows[0] as Raw | undefined;
    if (!r) return { childrenPolicy: 'unset', parentalConsentRequired: false, ccpaUs: false };
    const policy = r.children_policy as string;
    return {
      childrenPolicy:
        policy === 'no_minors' || policy === 'may_include_minors' ? policy : 'unset',
      parentalConsentRequired: r.parental_consent_required === true,
      ccpaUs: r.ccpa_us === true,
    };
  }
}

function toState(r: Raw | undefined): FlagsState {
  if (!r) return NO_FLAGS;
  return {
    isMinor: r.is_minor === true,
    minorSince: isoOrNull(r.minor_since),
    minorSource: (r.minor_source as PrivacyFlagSource | null) ?? null,
    guardianConsent: r.guardian_consent === true,
    guardianSince: isoOrNull(r.guardian_since),
    doNotSellShare: r.do_not_sell_share === true,
    doNotSellShareSince: isoOrNull(r.dns_since),
    doNotSellShareSource: (r.dns_source as PrivacyFlagSource | null) ?? null,
  };
}
