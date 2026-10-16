import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { RbacService } from '../../kernel/rbac/rbac.service';
import {
  hasPreviousSends,
  type PreviousSendOption,
  type PreviousSendOutcome,
  type PreviousSendsAudience,
} from '@crm/contracts';

/** `a, b, c` of uuid parameters, for an IN list. */
const uuidList = (ids: readonly string[]): SQL =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

/**
 * What each outcome means on a broadcast's recipient row (`bc`). A broadcast records delivery and reading only, so an outcome it does
 * not record matches nobody (the contract refuses the combination before it gets here).
 */
const BROADCAST_OUTCOME: Record<PreviousSendOutcome, SQL> = {
  all: sql`true`,
  delivered: sql`(bc.status IN ('delivered', 'read') OR bc.delivered_at IS NOT NULL OR bc.read_at IS NOT NULL)`,
  read: sql`(bc.status = 'read' OR bc.read_at IS NOT NULL)`,
  not_read: sql`(bc.status IN ('sent', 'delivered') AND bc.read_at IS NULL)`,
  replied: sql`false`,
  not_replied: sql`false`,
  clicked: sql`false`,
  failed: sql`bc.status = 'failed'`,
};

/** The same on a campaign's recipient row (`r`). A recipient who was skipped or opted out was never a recipient of the message. */
const CAMPAIGN_OUTCOME: Record<PreviousSendOutcome, SQL> = {
  all: sql`r.status NOT IN ('skipped', 'unsubscribed')`,
  delivered: sql`(r.status IN ('delivered', 'read', 'responded') OR r.delivered_at IS NOT NULL OR r.read_at IS NOT NULL)`,
  // A reply means they saw it, so a replier counts as having read it (and is not among those who did not).
  read: sql`(r.status IN ('read', 'responded') OR r.read_at IS NOT NULL OR r.responded_at IS NOT NULL)`,
  not_read: sql`(r.status IN ('sent', 'delivered') AND r.read_at IS NULL AND r.responded_at IS NULL)`,
  replied: sql`(r.status = 'responded' OR r.responded_at IS NOT NULL)`,
  not_replied: sql`(r.status IN ('sent', 'delivered', 'read') AND r.responded_at IS NULL)`,
  clicked: sql`r.clicked`,
  failed: sql`r.status = 'failed'`,
};

/**
 * `SELECT contact_id ...` of the contacts the named earlier sends went to (narrowed by the outcome), or null when the source names no
 * send. Scoped to the organization through the sends' own `org_id`, so an id of another workspace matches nobody. Meant for
 * `contacts.id IN (...)` or to be run as is.
 */
export function previousSendContactsSql(
  orgId: number,
  previous: PreviousSendsAudience | null | undefined,
): SQL | null {
  if (!previous || !hasPreviousSends(previous)) return null;
  const broadcasts = previous.sends.filter((s) => s.kind === 'broadcast').map((s) => s.id);
  const campaigns = previous.sends.filter((s) => s.kind === 'campaign').map((s) => s.id);
  const parts: SQL[] = [];
  if (broadcasts.length > 0) {
    parts.push(sql`
      SELECT bc.contact_id FROM broadcast_contacts bc
      JOIN broadcasts b ON b.org_id = bc.org_id AND b.id = bc.broadcast_id
      WHERE bc.org_id = ${orgId} AND b.uuid IN (${uuidList(broadcasts)}) AND bc.contact_id IS NOT NULL
        AND ${BROADCAST_OUTCOME[previous.outcome]}`);
  }
  if (campaigns.length > 0) {
    parts.push(sql`
      SELECT r.contact_id FROM wp_campaign_contacts r
      JOIN wpcampaigns c ON c.org_id = r.org_id AND c.id = r.campaign_id
      WHERE r.org_id = ${orgId} AND c.uuid IN (${uuidList(campaigns)}) AND r.contact_id IS NOT NULL
        AND ${CAMPAIGN_OUTCOME[previous.outcome]}`);
  }
  return sql.join(parts, sql` UNION `);
}

/** How many sends the picker offers. */
const OPTIONS_LIMIT = 100;

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const num = (v: unknown): number => Number(v ?? 0);

/** The earlier sends a person can target: finished broadcasts and campaigns (each run of a recurring broadcast is one), newest first. */
@Injectable()
export class PreviousSendsService {
  constructor(private readonly rbac: RbacService) {}

  async options(tx: Tx, orgId: number): Promise<PreviousSendOption[]> {
    // Broadcasts are listed to people who may read broadcasts (their names and numbers are that screen's); campaigns to everyone here.
    const ctx = RequestContextStore.require();
    const mayBroadcasts = Boolean(
      ctx.grants && this.rbac.can(ctx.grants, 'bcast.broadcasts.read').allowed,
    );
    const b = BROADCAST_OUTCOME;
    const broadcasts = !mayBroadcasts
      ? { rows: [] }
      : await tx.execute(sql`
      SELECT b.uuid, b.name, coalesce(b.updated_at, b.created_at) AS at,
             count(bc.id)::int AS recipients,
             count(bc.id) FILTER (WHERE ${b.delivered})::int AS delivered,
             count(bc.id) FILTER (WHERE ${b.read})::int AS read,
             count(bc.id) FILTER (WHERE ${b.failed})::int AS failed
      FROM broadcasts b LEFT JOIN broadcast_contacts bc ON bc.org_id = b.org_id AND bc.broadcast_id = b.id
      WHERE b.org_id = ${orgId} AND b.status IN ('completed', 'completed_with_errors')
      GROUP BY b.id, b.uuid, b.name, b.updated_at, b.created_at ORDER BY b.id DESC LIMIT ${OPTIONS_LIMIT}`);
    const c = CAMPAIGN_OUTCOME;
    const campaigns = await tx.execute(sql`
      SELECT c.uuid, c.campaign_name AS name, coalesce(c.last_run_at, c.created_at) AS at,
             count(r.id) FILTER (WHERE ${c.all})::int AS recipients,
             count(r.id) FILTER (WHERE ${c.delivered})::int AS delivered,
             count(r.id) FILTER (WHERE ${c.read})::int AS read,
             count(r.id) FILTER (WHERE ${c.replied})::int AS replied,
             count(r.id) FILTER (WHERE ${c.clicked})::int AS clicked,
             count(r.id) FILTER (WHERE ${c.failed})::int AS failed
      FROM wpcampaigns c LEFT JOIN wp_campaign_contacts r ON r.org_id = c.org_id AND r.campaign_id = c.id
      WHERE c.org_id = ${orgId} AND c.status NOT IN ('draft', 'scheduled') AND c.total_recipients > 0
      GROUP BY c.id, c.uuid, c.campaign_name, c.last_run_at, c.created_at ORDER BY c.id DESC LIMIT ${OPTIONS_LIMIT}`);

    const rows: PreviousSendOption[] = [
      ...(broadcasts.rows as Array<Record<string, unknown>>).map((r) => ({
        kind: 'broadcast' as const,
        id: String(r.uuid),
        name: String(r.name ?? ''),
        at: iso(r.at),
        recipients: num(r.recipients),
        delivered: num(r.delivered),
        read: num(r.read),
        replied: null,
        clicked: null,
        failed: num(r.failed),
      })),
      ...(campaigns.rows as Array<Record<string, unknown>>).map((r) => ({
        kind: 'campaign' as const,
        id: String(r.uuid),
        name: String(r.name ?? ''),
        at: iso(r.at),
        recipients: num(r.recipients),
        delivered: num(r.delivered),
        read: num(r.read),
        replied: num(r.replied),
        clicked: num(r.clicked),
        failed: num(r.failed),
      })),
    ].filter((r) => r.recipients > 0);
    // Newest first across both kinds.
    rows.sort((x, y) => (y.at ?? '').localeCompare(x.at ?? ''));
    return rows.slice(0, OPTIONS_LIMIT);
  }
}
