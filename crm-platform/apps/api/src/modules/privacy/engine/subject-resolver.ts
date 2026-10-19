import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { bigintArray } from '../registry/sql';
import type { ResolvedSubject } from '../registry/types';

/** A number shorter than this is not matched by digits: it would hit unrelated rows. */
const MIN_PHONE_DIGITS = 7;

export type StoredSubject =
  | { kind: 'contact'; contactId: number }
  | { kind: 'lead'; leadId: number }
  | { kind: 'identifier'; identifierKind: 'phone' | 'email'; value: string };

const digitsOf = (v: string | null | undefined): string => (v ?? '').replace(/\D/g, '');

/**
 * Turns "this person" into everything that identifies them in one workspace: the contact rows (a person may be in the contacts twice),
 * their leads, every phone number and email address they have, and their conversations (through the contact link or the peer key).
 *
 * Read in the tenant transaction of the request, before anything is changed: an erasure unlinks the contact from its conversations, so
 * the ids must be in hand first. A free identifier (a phone or an email of someone who may not be a contact at all) is resolved the
 * same way and still matches the tables that store the number or address as plain text.
 */
@Injectable()
export class SubjectResolver {
  /** The CRM deleted contacts: resolve by contact ids. */
  fromContacts(tx: Tx, orgId: number, contactIds: readonly number[]): Promise<ResolvedSubject> {
    return this.expand(
      tx,
      orgId,
      { contactIds: new Set(contactIds), leadIds: new Set(), phones: new Set(), emails: new Set() },
      // Deleting a contact must not wipe the thread of a DIFFERENT contact that has the same number (a duplicate): such numbers are
      // left out of the matching and the conversations are found through the contact link only.
      { guardSharedNumbers: true },
    );
  }

  /**
   * Staff members of the workspace (`users.id`), for the derived copies they leave behind (revenue export files, AI briefs). Only ids
   * that are users of this workspace reach a predicate; the address is the one the export mail went to.
   */
  async fromUsers(tx: Tx, orgId: number, userIds: readonly number[]): Promise<ResolvedSubject> {
    const found = userIds.length
      ? await tx.execute(sql`
          SELECT id, lower(email::text) AS email FROM users WHERE org_id = ${orgId} AND id = ANY(${bigintArray(userIds)})`)
      : { rows: [] };
    const rows = found.rows as Array<{ id: number | string; email: string | null }>;
    return {
      orgId,
      contactIds: [],
      contactUuids: [],
      userIds: rows.map((r) => Number(r.id)),
      userEmails: [...new Set(rows.map((r) => r.email).filter((e): e is string => !!e))],
      leadIds: [],
      conversationIds: [],
      conversationUuids: [],
      phoneDigits: [],
      emails: [],
      peerKeys: [],
    };
  }

  async resolve(tx: Tx, orgId: number, subject: StoredSubject): Promise<ResolvedSubject> {
    const seed = {
      contactIds: new Set<number>(),
      leadIds: new Set<number>(),
      phones: new Set<string>(),
      emails: new Set<string>(),
    };
    if (subject.kind === 'contact') seed.contactIds.add(subject.contactId);
    if (subject.kind === 'lead') seed.leadIds.add(subject.leadId);
    if (subject.kind === 'identifier') {
      if (subject.identifierKind === 'phone') {
        const d = digitsOf(subject.value);
        if (d.length >= MIN_PHONE_DIGITS) {
          seed.phones.add(d);
          const found = await tx.execute(sql`
            SELECT c.id FROM contacts c WHERE c.org_id = ${orgId}
               AND regexp_replace(coalesce(c.normalized_phone, c.phone, ''), '\\D', '', 'g') = ${d}
            UNION
            SELECT i.contact_id FROM contact_identities i WHERE i.org_id = ${orgId} AND i.kind IN ('phone', 'whatsapp')
               AND regexp_replace(i.value, '\\D', '', 'g') = ${d}`);
          for (const r of found.rows as Array<{ id: number | string }>)
            seed.contactIds.add(Number(r.id));
          const leads = await tx.execute(sql`
            SELECT id FROM leads WHERE org_id = ${orgId}
               AND (regexp_replace(coalesce(phone_e164, ''), '\\D', '', 'g') = ${d} OR regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = ${d})`);
          for (const r of leads.rows as Array<{ id: number | string }>)
            seed.leadIds.add(Number(r.id));
        }
      } else {
        const e = subject.value.trim().toLowerCase();
        seed.emails.add(e);
        const found = await tx.execute(sql`
          SELECT c.id FROM contacts c WHERE c.org_id = ${orgId} AND lower(coalesce(c.normalized_email, c.email::text, '')) = ${e}
          UNION
          SELECT i.contact_id FROM contact_identities i WHERE i.org_id = ${orgId} AND i.kind = 'email' AND lower(i.value) = ${e}`);
        for (const r of found.rows as Array<{ id: number | string }>)
          seed.contactIds.add(Number(r.id));
        const leads = await tx.execute(
          sql`SELECT id FROM leads WHERE org_id = ${orgId} AND lower(coalesce(email, '')) = ${e}`,
        );
        for (const r of leads.rows as Array<{ id: number | string }>)
          seed.leadIds.add(Number(r.id));
      }
    }
    return this.expand(tx, orgId, seed);
  }

  private async expand(
    tx: Tx,
    orgId: number,
    seed: {
      contactIds: Set<number>;
      leadIds: Set<number>;
      phones: Set<string>;
      emails: Set<string>;
    },
    opts: { guardSharedNumbers?: boolean } = {},
  ): Promise<ResolvedSubject> {
    const contactIds = new Set(seed.contactIds);
    const leadIds = new Set(seed.leadIds);
    const phones = new Set(seed.phones);
    const emails = new Set(seed.emails);
    const addPhone = (v: string | null | undefined) => {
      const d = digitsOf(v);
      if (d.length >= MIN_PHONE_DIGITS) phones.add(d);
    };
    const addEmail = (v: string | null | undefined) => {
      const e = (v ?? '').trim().toLowerCase();
      if (e.includes('@')) emails.add(e);
    };

    // Leads: the ones asked for, and the ones of the contacts; a lead tied to a contact brings that contact in (one person).
    if (leadIds.size || contactIds.size) {
      const leads = await tx.execute(sql`
        SELECT id, contact_id, phone, phone_e164, email FROM leads
         WHERE org_id = ${orgId} AND (id = ANY(${bigintArray([...leadIds])}) OR contact_id = ANY(${bigintArray([...contactIds])}))`);
      for (const l of leads.rows as Array<{
        id: number | string;
        contact_id: number | string | null;
        phone: string | null;
        phone_e164: string | null;
        email: string | null;
      }>) {
        leadIds.add(Number(l.id));
        if (l.contact_id !== null) contactIds.add(Number(l.contact_id));
        addPhone(l.phone);
        addPhone(l.phone_e164);
        addEmail(l.email);
      }
    }

    const contactUuids: string[] = [];
    if (contactIds.size) {
      const ids = bigintArray([...contactIds]);
      const rows = await tx.execute(sql`
        SELECT id, uuid, phone, normalized_phone, email, normalized_email FROM contacts
         WHERE org_id = ${orgId} AND id = ANY(${ids})`);
      const found = new Set<number>();
      for (const c of rows.rows as Array<{
        id: number | string;
        uuid: string;
        phone: string | null;
        normalized_phone: string | null;
        email: string | null;
        normalized_email: string | null;
      }>) {
        found.add(Number(c.id));
        contactUuids.push(c.uuid);
        addPhone(c.phone);
        addPhone(c.normalized_phone);
        addEmail(c.email);
        addEmail(c.normalized_email);
      }
      // Ids that are not (or no longer) contacts of this workspace never reach a predicate.
      for (const id of [...contactIds]) if (!found.has(id)) contactIds.delete(id);
      const idents = await tx.execute(sql`
        SELECT kind, value FROM contact_identities WHERE org_id = ${orgId} AND contact_id = ANY(${bigintArray([...contactIds])})`);
      for (const i of idents.rows as Array<{ kind: string; value: string }>) {
        if (i.kind === 'email') addEmail(i.value);
        else addPhone(i.value);
      }
    }

    if (opts.guardSharedNumbers && phones.size) {
      const shared = await tx.execute(sql`
        SELECT DISTINCT regexp_replace(coalesce(normalized_phone, phone, ''), '\\D', '', 'g') AS d FROM contacts
         WHERE org_id = ${orgId} AND NOT (id = ANY(${bigintArray([...contactIds])}))
           AND regexp_replace(coalesce(normalized_phone, phone, ''), '\\D', '', 'g')
               = ANY(ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify([...phones])}::jsonb)))`);
      for (const r of shared.rows as Array<{ d: string }>) phones.delete(r.d);
    }

    const peerKeys = [...phones, ...emails];
    const conversationIds: number[] = [];
    const conversationUuids: string[] = [];
    if (contactIds.size || peerKeys.length) {
      const convs = await tx.execute(sql`
        SELECT id, uuid FROM conversations
         WHERE org_id = ${orgId}
           AND (contact_id = ANY(${bigintArray([...contactIds])})
                OR peer_key = ANY(ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(peerKeys)}::jsonb))))`);
      for (const c of convs.rows as Array<{ id: number | string; uuid: string }>) {
        conversationIds.push(Number(c.id));
        conversationUuids.push(c.uuid);
      }
    }

    return {
      orgId,
      contactIds: [...contactIds],
      contactUuids,
      userIds: [],
      userEmails: [],
      leadIds: [...leadIds],
      conversationIds,
      conversationUuids,
      phoneDigits: [...phones],
      emails: [...emails],
      peerKeys,
    };
  }
}
