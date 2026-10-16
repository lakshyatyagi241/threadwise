import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { assemblePhone, previousSendContactsSql } from '../../broadcasts';
import { ConsentGate } from '../../contact-consent';

export interface AudienceInput {
  recipientType: 'group' | 'tag' | 'queue' | 'number';
  groupIds?: readonly string[];
  tagIds?: readonly string[];
  queueIds?: readonly string[];
  numbers?: readonly string[];
}

export interface Recipient {
  /** Digits, country code included: the form the engines send to. */
  phone: string;
  contactId: number | null;
}

export interface ResolvedAudience {
  recipients: Recipient[];
  /** People the audience named who are not messaged: opted out, archived, or without a usable number. */
  optedOut: number;
}

const chunk = <T>(xs: readonly T[], n = 500): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};
const uuids = (xs: readonly string[]): SQL =>
  sql.join(
    xs.map((x) => sql`${x}::uuid`),
    sql`, `,
  );
const ids = (xs: readonly number[]): SQL =>
  sql.join(
    xs.map((x) => sql`${x}::bigint`),
    sql`, `,
  );

/** A typed number: digits and a leading `+` only, 8 to 15 digits (TW-SCHED-004 rule 4). */
export function cleanNumber(raw: string): string | null {
  const v = raw.replace(/[\s().-]+/g, '');
  const m = /^\+?([0-9]{8,15})$/.exec(v);
  return m ? m[1]! : null;
}

/**
 * Who a schedule reaches (TW-SCHED-004): a group, a tag, the recipients of earlier broadcasts, or typed numbers. Resolved once
 * when the schedule is saved and kept as that schedule's recipient rows.
 *
 * Deliberately not Reference's behavior: a contact who opted out (replied STOP) or was archived is never messaged, whichever audience
 * type named them (Reference filtered them only on the multi-sender path), and a contact is counted once however many of the chosen
 * groups, tags or broadcasts contain them. "Opted out" is the ConsentGate's answer for marketing (BL-141), so the workspace switch
 * "require recorded consent" is honoured here too; the run asks the gate again at send time.
 */
@Injectable()
export class ScheduleAudienceService {
  constructor(private readonly consentGate: ConsentGate) {}

  async resolve(tx: Tx, orgId: number, input: AudienceInput): Promise<ResolvedAudience> {
    if (input.recipientType === 'number') return this.numbers(tx, orgId, input.numbers ?? []);
    const contactIds = await this.contactIds(tx, orgId, input);
    return this.contacts(tx, orgId, contactIds);
  }

  private async contactIds(tx: Tx, orgId: number, input: AudienceInput): Promise<number[]> {
    if (input.recipientType === 'group' && input.groupIds?.length) {
      const res = await tx.execute(sql`
        SELECT DISTINCT m.contact_id AS id
          FROM contact_group_members m JOIN contact_groups g ON g.org_id = m.org_id AND g.id = m.group_id
         WHERE m.org_id = ${orgId} AND g.uuid IN (${uuids(input.groupIds)}) ORDER BY m.contact_id`);
      return (res.rows as Array<{ id: number | string }>).map((r) => Number(r.id));
    }
    if (input.recipientType === 'tag' && input.tagIds?.length) {
      const res = await tx.execute(sql`
        SELECT DISTINCT ct.contact_id AS id
          FROM contact_tags ct JOIN tags t ON t.org_id = ct.org_id AND t.id = ct.tag_id
         WHERE ct.org_id = ${orgId} AND t.uuid IN (${uuids(input.tagIds)}) ORDER BY ct.contact_id`);
      return (res.rows as Array<{ id: number | string }>).map((r) => Number(r.id));
    }
    if (input.recipientType === 'queue' && input.queueIds?.length) {
      // An earlier send: a broadcast or a campaign (a uuid is one or the other; the other kind simply matches nobody).
      const q = previousSendContactsSql(orgId, {
        sends: [
          ...input.queueIds.map((id) => ({ kind: 'broadcast' as const, id })),
          ...input.queueIds.map((id) => ({ kind: 'campaign' as const, id })),
        ],
        outcome: 'all',
      });
      if (!q) return [];
      const res = await tx.execute(
        sql`SELECT DISTINCT contact_id AS id FROM (${q}) p ORDER BY contact_id`,
      );
      return (res.rows as Array<{ id: number | string }>).map((r) => Number(r.id));
    }
    return [];
  }

  private async contacts(
    tx: Tx,
    orgId: number,
    contactIds: readonly number[],
  ): Promise<ResolvedAudience> {
    const recipients: Recipient[] = [];
    const seen = new Set<string>();
    let skipped = 0;
    for (const part of chunk(contactIds)) {
      const res = await tx.execute(sql`
        SELECT id, phone, country_code, is_unsubscribed, is_archived FROM contacts
         WHERE org_id = ${orgId} AND id IN (${ids(part)}) ORDER BY id`);
      const rows = res.rows as Array<{
        id: number | string;
        phone: string | null;
        country_code: string | null;
        is_unsubscribed: boolean;
        is_archived: boolean;
      }>;
      const verdict = await this.consentGate.checkMany(
        orgId,
        rows.map((r) => Number(r.id)),
        'whatsapp',
        'marketing_messaging',
        undefined,
        { tx },
      );
      for (const r of rows) {
        const phone = assemblePhone(r.phone, r.country_code);
        if (!phone || !verdict.allowed.has(Number(r.id)) || r.is_archived) {
          skipped++;
          continue;
        }
        if (seen.has(phone)) continue;
        seen.add(phone);
        recipients.push({ phone, contactId: Number(r.id) });
      }
    }
    return { recipients, optedOut: skipped };
  }

  private async numbers(
    tx: Tx,
    orgId: number,
    typed: readonly string[],
  ): Promise<ResolvedAudience> {
    const clean = [...new Set(typed.map(cleanNumber).filter((n): n is string => n !== null))];
    const known = new Map<string, { id: number; out: boolean }>();
    for (const part of chunk(clean)) {
      const res = await tx.execute(sql`
        SELECT id, is_unsubscribed, is_archived,
               regexp_replace(coalesce(country_code, '') || coalesce(phone, ''), '[^0-9]', '', 'g') AS whole,
               regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') AS local
          FROM contacts
         WHERE org_id = ${orgId}
           AND (regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') IN (${sql.join(
             part.map((p) => sql`${p}`),
             sql`, `,
           )})
             OR regexp_replace(coalesce(country_code, '') || coalesce(phone, ''), '[^0-9]', '', 'g') IN (${sql.join(
               part.map((p) => sql`${p}`),
               sql`, `,
             )}))`);
      for (const r of res.rows as Array<{
        id: number | string;
        is_unsubscribed: boolean;
        is_archived: boolean;
        whole: string;
        local: string;
      }>) {
        const entry = { id: Number(r.id), out: r.is_archived };
        known.set(r.local, entry);
        known.set(r.whole, entry);
      }
    }
    const verdict = await this.consentGate.checkMany(
      orgId,
      [...new Set([...known.values()].map((k) => k.id))],
      'whatsapp',
      'marketing_messaging',
      undefined,
      { tx },
    );
    for (const k of known.values()) if (!verdict.allowed.has(k.id)) k.out = true;
    const recipients: Recipient[] = [];
    let skipped = 0;
    for (const phone of clean) {
      const c = known.get(phone);
      // A typed number that belongs to a contact who opted out is honoured, as for any other audience.
      if (c?.out) {
        skipped++;
        continue;
      }
      recipients.push({ phone, contactId: c?.id ?? null });
    }
    return { recipients, optedOut: skipped };
  }
}
