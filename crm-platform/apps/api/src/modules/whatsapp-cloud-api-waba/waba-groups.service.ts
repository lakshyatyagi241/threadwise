import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';
import { emitDeliveryReported } from '../../kernel/outbox/delivery-report';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { emitGroupEvents, groupEventsFor } from './waba-group-events';
import {
  GROUP_FIELDS,
  applyGroupDelivery,
  applyGroupEntry,
  type GroupDelivery,
  type GroupFacts,
  type GroupField,
} from './waba-group-rules';

interface GroupRow {
  id: number | string;
  uuid: string;
  group_id?: string;
  subject: string | null;
  description: string | null;
  invite_link: string | null;
  join_approval_mode: string | null;
  participant_count: number;
  suspended: boolean;
  creation_timestamp: Date | string | null;
  meta_json: Record<string, unknown> | null;
}

export function isGroupField(field: string): field is GroupField {
  return (GROUP_FIELDS as readonly string[]).includes(field);
}

/**
 * Keeps `waba_groups` in step with Meta's four Groups webhooks (TW-WABA-040), so a screen never calls Graph just to list groups.
 * Scoped to the receiving number's `provider_config_id`: a spoofed group id cannot touch another workspace's row.
 */
@Injectable()
export class WabaGroupsService {
  private readonly logger = new Logger(WabaGroupsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * A delivery status of a message sent to a group (`recipient_type=group`) folded into the bubble's `meta.group_delivery`
   * (TW-WABA-039). A status for a message the inbox never stored changes nothing. Errors are logged and swallowed so a batch is
   * never retried over one bad row.
   */
  async recordDelivery(orgId: number, st: Record<string, unknown>): Promise<boolean> {
    const wamid = String(st.id ?? '');
    if (!wamid) return false;
    try {
      return await this.db.txAs({ orgId }, async (tx) => {
        const found = await tx.execute(
          sql`SELECT m.id, m.created_at::text AS created_at, m.status, m.meta
                FROM message_ledger l
                JOIN messages m ON m.org_id = l.org_id AND m.id = l.message_id AND m.created_at = l.message_created_at
               WHERE l.org_id = ${orgId} AND l.kind = 'provider_id' AND l.key = ${wamid} LIMIT 1`,
        );
        const row = found.rows[0] as unknown as
          | {
              id: number | string;
              created_at: string;
              status: string;
              meta: Record<string, unknown> | null;
            }
          | undefined;
        if (!row) return false;
        const meta = row.meta ?? {};
        const { delivery, status } = applyGroupDelivery(
          meta.group_delivery as Partial<GroupDelivery> | undefined,
          row.status,
          st,
        );
        const next = { ...meta, group_delivery: delivery };
        await tx.execute(
          sql`UPDATE messages SET meta = ${JSON.stringify(next)}::jsonb, status = ${status}
               WHERE org_id = ${orgId} AND id = ${Number(row.id)} AND created_at = ${row.created_at}::timestamptz`,
        );
        await this.reportMemberDelivery(tx, orgId, Number(row.id), wamid, st, delivery);
        return true;
      });
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'group delivery status could not be recorded');
      return false;
    }
  }

  /**
   * A group message is billed once per member who receives it: each billable member that reaches delivered or read is reported to the
   * workspace's wallet as its own message (`<wamid>:<member id>`), so a repeated status row, or Meta retrying a webhook, charges once.
   * A member Meta marks free (the group's customer-service window) is never reported.
   */
  private async reportMemberDelivery(
    tx: Tx,
    orgId: number,
    messageId: number,
    wamid: string,
    st: Record<string, unknown>,
    delivery: GroupDelivery,
  ): Promise<void> {
    const status = String(st.status ?? '');
    const member = String(st.recipient_participant_id ?? '');
    if (!member || (status !== 'delivered' && status !== 'read')) return;
    if (delivery.participants[member]?.billable !== true) return;
    await emitDeliveryReported(this.outbox, tx, {
      orgId,
      aggregateModule: 'chat-conversations',
      aggregateId: messageId,
      report: {
        provider: 'waba',
        providerMessageId: `${wamid}:${member}`.slice(0, 191),
        status,
        recipient: /^\+?\d{6,20}$/.test(member) ? member : null,
        category: delivery.category,
        source: 'inbox',
      },
    });
  }

  /** The group's subject, for the thread title; null until a lifecycle event has told us. */
  async subjectOf(orgId: number, configId: number, groupId: string): Promise<string | null> {
    return this.db.txAs({ orgId }, async (tx) => {
      const res = await tx.execute(
        sql`SELECT subject FROM waba_groups
             WHERE org_id = ${orgId} AND provider_config_id = ${configId} AND group_id = ${groupId}`,
      );
      return ((res.rows[0] as { subject?: string | null } | undefined)?.subject ?? null) || null;
    });
  }

  /** How many entries changed a row (a delete counts). */
  async apply(
    tx: Tx,
    orgId: number,
    configId: number,
    field: GroupField,
    value: Record<string, unknown>,
    now: Date,
  ): Promise<number> {
    const entries = Array.isArray(value.groups)
      ? (value.groups as Array<Record<string, unknown>>)
      : [];
    let changed = 0;
    // The number's uuid names it in the events (consumers in other domains never see internal ids).
    const cfg = entries.length
      ? await tx.execute(
          sql`SELECT uuid FROM wa_provider_configs WHERE org_id = ${orgId} AND id = ${configId}`,
        )
      : null;
    const connectionUuid = String((cfg?.rows[0] as { uuid?: string } | undefined)?.uuid ?? '');
    for (const entry of entries) {
      const groupId = String(entry.group_id ?? '');
      if (!groupId) continue;
      const found = await tx.execute(
        sql`SELECT id, uuid, subject, description, invite_link, join_approval_mode, participant_count, suspended,
                   creation_timestamp, meta_json
              FROM waba_groups
             WHERE org_id = ${orgId} AND provider_config_id = ${configId} AND group_id = ${groupId}`,
      );
      const row = found.rows[0] as unknown as GroupRow | undefined;
      const result = applyGroupEntry(field, entry, row ? toFacts(row) : null, now);
      if ('delete' in result) {
        await tx.execute(
          sql`DELETE FROM waba_groups
               WHERE org_id = ${orgId} AND provider_config_id = ${configId} AND group_id = ${groupId}`,
        );
        if (row) {
          await emitGroupEvents(
            this.outbox,
            tx,
            orgId,
            { id: Number(row.id), uuid: row.uuid, group_id: groupId, subject: row.subject },
            connectionUuid,
            groupEventsFor(field, toFacts(row), null),
          );
        }
        changed++;
        continue;
      }
      const n = result.next;
      const written = await tx.execute(
        sql`INSERT INTO waba_groups (org_id, provider_config_id, group_id, subject, description, invite_link,
                                     join_approval_mode, participant_count, suspended, creation_timestamp,
                                     synced_at, meta_json)
            VALUES (${orgId}, ${configId}, ${groupId}, ${n.subject}, ${n.description}, ${n.inviteLink},
                    ${n.joinApprovalMode}, ${n.participantCount}, ${n.suspended}, ${n.creationTimestamp},
                    ${now}, ${JSON.stringify(n.meta)}::jsonb)
            ON CONFLICT (org_id, provider_config_id, group_id) DO UPDATE SET
              subject = EXCLUDED.subject, description = EXCLUDED.description, invite_link = EXCLUDED.invite_link,
              join_approval_mode = EXCLUDED.join_approval_mode, participant_count = EXCLUDED.participant_count,
              suspended = EXCLUDED.suspended, creation_timestamp = EXCLUDED.creation_timestamp,
              synced_at = EXCLUDED.synced_at, meta_json = EXCLUDED.meta_json
            RETURNING id, uuid`,
      );
      const saved = written.rows[0] as unknown as { id: number | string; uuid: string };
      await emitGroupEvents(
        this.outbox,
        tx,
        orgId,
        { id: Number(saved.id), uuid: saved.uuid, group_id: groupId, subject: n.subject },
        connectionUuid,
        groupEventsFor(field, row ? toFacts(row) : null, n),
      );
      changed++;
    }
    if (changed === 0)
      this.logger.debug({ orgId, configId, field }, 'group event with no usable entry');
    return changed;
  }
}

function toFacts(r: GroupRow): GroupFacts {
  return {
    subject: r.subject,
    description: r.description,
    inviteLink: r.invite_link,
    joinApprovalMode: r.join_approval_mode,
    participantCount: Number(r.participant_count),
    suspended: r.suspended,
    creationTimestamp: r.creation_timestamp ? new Date(r.creation_timestamp) : null,
    meta: r.meta_json ?? {},
  };
}
