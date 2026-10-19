import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;

export interface SmsSenderFacts {
  id: number;
  uuid: string;
  label: string;
  /** The sender's From value as digits; empty = unusable (an alphanumeric id stays as typed in the label). */
  phoneDigits: string;
}

export interface MailboxFacts {
  id: number;
  uuid: string;
  label: string;
  address: string;
}

/**
 * The few facts the first message needs from tables that belong to other domains: the channel of a template, the connected SMS numbers,
 * the shared mailboxes, the workspace's business hours. The broadcast and storefront domains read the same tables the same way
 * (`SqlSenderDirectory`) until the SMS, email and settings domains export their own lookups. Every query is scoped by `org_id` and runs in
 * the caller's tenant transaction, so row-level security applies on top.
 */
@Injectable()
export class LeadFirstMessageLookups {
  /** The channel an approved template belongs to (`whatsapp` or `sms`), or undefined when the workspace has no such template. */
  async templateChannel(tx: Tx, orgId: number, uuid: string): Promise<string | undefined> {
    const res = await tx.execute(
      sql`SELECT channel FROM wa_templates WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    return (res.rows[0] as Raw | undefined)?.channel as string | undefined;
  }

  /**
   * The SMS number to send from: the one the source names if it is still connected, else the workspace's primary connected one, else
   * the oldest. The named one is never swapped for another when it is gone: that would send from a number nobody chose.
   */
  async smsSender(tx: Tx, orgId: number, uuid: string | null): Promise<SmsSenderFacts | undefined> {
    const res = await tx.execute(sql`
      SELECT id, uuid, phone_number, coalesce(nullif(display_label, ''), phone_number) AS label
      FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider = 'sms' AND status = 'connected'
        ${uuid ? sql`AND uuid = ${uuid}::uuid` : sql``}
      ORDER BY is_primary DESC, id
      LIMIT 1`);
    const r = res.rows[0] as Raw | undefined;
    if (!r) return undefined;
    return {
      id: Number(r.id),
      uuid: r.uuid as string,
      label: (r.label as string | null) ?? '',
      phoneDigits: String(r.phone_number ?? '').replace(/\D/g, ''),
    };
  }

  /**
   * The mailbox to send from, shared ones only: a personal mailbox is one person's address and a system send must never go out from it.
   * Named by the source, else the workspace's oldest connected shared mailbox.
   */
  async mailbox(tx: Tx, orgId: number, uuid: string | null): Promise<MailboxFacts | undefined> {
    const res = await tx.execute(sql`
      SELECT id, uuid, address::text AS address, coalesce(nullif(display_name, ''), address::text) AS label
      FROM mail_mailboxes
      WHERE org_id = ${orgId} AND status = 'connected' AND scope = 'shared'
        ${uuid ? sql`AND uuid = ${uuid}::uuid` : sql``}
      ORDER BY created_at, id
      LIMIT 1`);
    const r = res.rows[0] as Raw | undefined;
    return r
      ? {
          id: Number(r.id),
          uuid: r.uuid as string,
          label: r.label as string,
          address: r.address as string,
        }
      : undefined;
  }

  /** Uuids of the approved templates of a channel (`whatsapp` or `sms`), newest first, at most `limit`. */
  async approvedTemplateUuids(
    tx: Tx,
    orgId: number,
    channel: 'whatsapp' | 'sms',
    limit: number,
  ): Promise<string[]> {
    const res = await tx.execute(sql`
      SELECT uuid FROM wa_templates
      WHERE org_id = ${orgId} AND channel = ${channel} AND status IN ('approved', 'public')
      ORDER BY id DESC LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => r.uuid as string);
  }

  /** The shared (workspace-owned, not personal) email templates that are not archived, by name. */
  async sharedEmailTemplates(
    tx: Tx,
    orgId: number,
    limit: number,
  ): Promise<Array<{ uuid: string; name: string; subject: string }>> {
    const res = await tx.execute(sql`
      SELECT uuid, name, subject FROM email_templates
      WHERE org_id = ${orgId} AND user_id IS NULL AND status <> 'archived'
      ORDER BY lower(name) LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => ({
      uuid: r.uuid as string,
      name: r.name as string,
      subject: (r.subject as string | null) ?? '',
    }));
  }

  /** Every connected SMS number, primary first. */
  async smsSenders(tx: Tx, orgId: number): Promise<SmsSenderFacts[]> {
    const res = await tx.execute(sql`
      SELECT id, uuid, phone_number, coalesce(nullif(display_label, ''), phone_number) AS label
      FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider = 'sms' AND status = 'connected'
      ORDER BY is_primary DESC, id`);
    return (res.rows as Raw[]).map((r) => ({
      id: Number(r.id),
      uuid: r.uuid as string,
      label: (r.label as string | null) ?? '',
      phoneDigits: String(r.phone_number ?? '').replace(/\D/g, ''),
    }));
  }

  /** Every connected shared mailbox, oldest first. */
  async sharedMailboxes(tx: Tx, orgId: number): Promise<MailboxFacts[]> {
    const res = await tx.execute(sql`
      SELECT id, uuid, address::text AS address, coalesce(nullif(display_name, ''), address::text) AS label
      FROM mail_mailboxes
      WHERE org_id = ${orgId} AND status = 'connected' AND scope = 'shared'
      ORDER BY created_at, id`);
    return (res.rows as Raw[]).map((r) => ({
      id: Number(r.id),
      uuid: r.uuid as string,
      label: r.label as string,
      address: r.address as string,
    }));
  }

  /** The workspace's business hours as saved and its time zone (`UTC` when none). */
  async businessHours(tx: Tx, orgId: number): Promise<{ hours: unknown; timezone: string }> {
    const res = await tx.execute(
      sql`SELECT ws.business_hours, COALESCE(o.settings ->> 'timezone', 'UTC') AS timezone
            FROM organizations o LEFT JOIN workspace_settings ws ON ws.org_id = o.id
           WHERE o.id = ${orgId}`,
    );
    const r = res.rows[0] as Raw | undefined;
    return { hours: r?.business_hours ?? null, timezone: (r?.timezone as string | null) ?? 'UTC' };
  }
}
