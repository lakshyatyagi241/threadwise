import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;
const json = (v: unknown): Record<string, unknown> | null =>
  v === null || v === undefined
    ? null
    : typeof v === 'string'
      ? (JSON.parse(v) as Record<string, unknown>)
      : (v as Record<string, unknown>);

export interface PushMailbox {
  orgId: number;
  uuid: string;
  status: string;
  syncCursor: Record<string, unknown> | null;
  pushState: Record<string, unknown> | null;
}

const toPush = (r: Raw): PushMailbox => ({
  orgId: Number(r.org_id),
  uuid: r.uuid as string,
  status: r.status as string,
  syncCursor: json(r.sync_cursor),
  pushState: json(r.push_state),
});

/**
 * The cross-workspace reads Gmail push needs (TW-MAIL-033). All of them run PRIVILEGED (RLS lifted): a Pub/Sub request carries no
 * tenant, only a Gmail address, and the renewal sweep walks every workspace. Nothing here is reachable with a tenant's input except the
 * address, which is matched exactly and only ever leads to a sync job for a mailbox that is connected.
 */
@Injectable()
export class MailPushRepository {
  /** The connected Google mailboxes whose address is `address` (an address is unique per workspace, so several workspaces may hold it). */
  async connectedByAddress(tx: Tx, address: string): Promise<PushMailbox[]> {
    const res = await tx.execute(sql`
      SELECT org_id, uuid, status, sync_cursor, push_state FROM mail_mailboxes
       WHERE provider = 'google' AND status = 'connected' AND lower(address) = lower(${address})
       ORDER BY org_id, id`);
    return (res.rows as Raw[]).map(toPush);
  }

  /** Every mailbox of `provider` that has a push registration or could get one (connected), for the renewal sweep. */
  async pushCandidates(
    tx: Tx,
    provider: 'google' | 'microsoft' = 'google',
  ): Promise<PushMailbox[]> {
    const res = await tx.execute(sql`
      SELECT org_id, uuid, status, sync_cursor, push_state FROM mail_mailboxes
       WHERE provider = ${provider} AND (push_state IS NOT NULL OR status = 'connected')
       ORDER BY org_id, id`);
    return (res.rows as Raw[]).map(toPush);
  }

  /** One mailbox by the workspace and uuid a verified Graph notification names (its signed `clientState`), or undefined. */
  async microsoftByUuid(tx: Tx, orgId: number, uuid: string): Promise<PushMailbox | undefined> {
    const res = await tx.execute(sql`
      SELECT org_id, uuid, status, sync_cursor, push_state FROM mail_mailboxes
       WHERE provider = 'microsoft' AND org_id = ${orgId} AND uuid = ${uuid}::uuid`);
    const row = (res.rows as Raw[])[0];
    return row ? toPush(row) : undefined;
  }

  /** Mailboxes with a live push registration that were synced within `minutes`: the polling sweep leaves them alone until the window passes. */
  async freshlySyncedWithPush(tx: Tx, minutes: number): Promise<Set<string>> {
    const res = await tx.execute(sql`
      SELECT uuid FROM mail_mailboxes
       WHERE push_state IS NOT NULL AND status = 'connected'
         AND (push_state->>'expiresAt')::timestamptz > now()
         AND last_synced_at > now() - make_interval(mins => ${minutes})`);
    return new Set((res.rows as Raw[]).map((r) => r.uuid as string));
  }
}
