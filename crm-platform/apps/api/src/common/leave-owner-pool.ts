import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { pickDelegate } from './leave-delegate';
import { loadWorkspaceCalendar, onLeaveMap } from './workspace-calendar';

interface Person {
  id: number;
  uuid: string;
}

/**
 * The people an owner rule (a form's, a lead source's) may hand a new contact to, once those on leave today are taken out (BL-112).
 * A `fixed` rule's person who is away is replaced by their delegate (active and present); in a rotation the absent are simply
 * skipped (their share goes to the others, the delegate is not added a second share). Nobody left means "unassigned", as the rule
 * already means when nobody is active. People not on leave are returned untouched, in the same order.
 */
export async function ownersAvailable<T extends Person>(
  tx: Tx,
  orgId: number,
  users: readonly T[],
  mode: 'fixed' | 'round_robin' | 'unassigned',
  now: Date = new Date(),
): Promise<Array<T | Person>> {
  if (users.length === 0 || mode === 'unassigned') return [...users];
  const { today } = await loadWorkspaceCalendar(tx, orgId, now);
  const away = await onLeaveMap(
    tx,
    orgId,
    users.map((u) => u.id),
    today,
  );
  if (away.size === 0) return [...users];
  const present = users.filter((u) => !away.has(u.id));
  if (mode !== 'fixed') return present;

  const res = await tx.execute(sql`
    SELECT d.user_id, du.id AS delegate_id, du.uuid FROM member_delegates d
    JOIN users du ON du.org_id = d.org_id AND du.id = d.delegate_user_id AND du.status = 'active'
    WHERE d.org_id = ${orgId} AND d.user_id IN (${sql.join(
      [...away.keys()].map((i) => sql`${i}`),
      sql`, `,
    )})`);
  const rows = res.rows as Array<{ user_id: unknown; delegate_id: unknown; uuid: string }>;
  const delegateOf = new Map(rows.map((r) => [Number(r.user_id), Number(r.delegate_id)]));
  const delegateAway = await onLeaveMap(tx, orgId, [...delegateOf.values()], today);
  const out: Array<T | Person> = [...present];
  for (const u of users) {
    if (!away.has(u.id)) continue;
    const d = pickDelegate(
      delegateOf,
      u.id,
      (x) => delegateAway.has(x),
      () => true,
    );
    const row = rows.find((r) => Number(r.delegate_id) === d);
    if (d !== null && row && !out.some((o) => o.id === d)) out.push({ id: d, uuid: row.uuid });
  }
  return out;
}
