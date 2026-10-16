import { sql } from 'drizzle-orm';
import { ALLOW, type SendWindowDecision } from '@crm/contracts';
import type { Tx } from '@crm/db';
import type { SendWindowService } from './send-window.service';

/**
 * What the broadcast senders of the social channels share to keep a marketing message back for the quiet hours (BL-191). The rule is the
 * same as everywhere else (BL-177): a recipient inside the hours is HELD, not denied. It goes back to `pending` carrying the instant it may
 * be messaged (`held_until`) and why (`held_reason`); the claim leaves it alone until then; when only held recipients are left the run
 * ends and a delayed job wakes it at the first opening.
 */

export type Hold = Extract<SendWindowDecision, { decision: 'hold' }>;

/** A recipient table of a channel broadcast and the column that points to its broadcast. Constants, never user input. */
export interface HeldTable {
  table: string;
  broadcastFk: string;
}

export const HELD_TABLES = {
  line: { table: 'line_broadcast_recipients', broadcastFk: 'line_broadcast_id' },
  facebook: { table: 'facebook_broadcast_recipients', broadcastFk: 'facebook_broadcast_id' },
  telegram: { table: 'telegram_broadcast_recipients', broadcastFk: 'telegram_broadcast_id' },
  viber: { table: 'viber_broadcast_recipients', broadcastFk: 'viber_broadcast_id' },
} as const satisfies Record<string, HeldTable>;

export interface HeldSplit<T> {
  /** The recipients that may go now. */
  go: T[];
  /** The recipients that wait, with the hold that says until when. */
  held: Array<{ row: T; hold: Hold }>;
}

/**
 * Splits a claimed slice into who may go now and who waits for the quiet hours. A recipient with a contact is read on that contact's clock
 * (one statement for the whole slice); one without (a group, a person who never became a contact) is read on the workspace's fallback
 * zone. A broadcast of a social channel is always marketing, so there is no purpose to ask about.
 */
export async function splitByQuietHours<T extends { contactId: number | null }>(
  sendWindow: SendWindowService,
  orgId: number,
  batch: readonly T[],
): Promise<HeldSplit<T>> {
  const ids = batch.flatMap((r) => (r.contactId === null ? [] : [r.contactId]));
  const many = ids.length > 0 ? await sendWindow.checkMany(orgId, 'message', ids) : null;
  const anonymous = batch.some((r) => r.contactId === null)
    ? await sendWindow.check(orgId, 'message', {})
    : ALLOW;
  const out: HeldSplit<T> = { go: [], held: [] };
  for (const row of batch) {
    const d = row.contactId === null ? anonymous : (many?.decisions.get(row.contactId) ?? ALLOW);
    if (d.decision === 'hold') out.held.push({ row, hold: d });
    else out.go.push(row);
  }
  return out;
}

/** A claimed recipient the quiet hours stop for now: back to `pending` with the instant it may go. Not a failure and not a skip. */
export async function holdRecipient(
  tx: Tx,
  orgId: number,
  t: HeldTable,
  id: number,
  hold: Pick<Hold, 'until' | 'reason'>,
): Promise<void> {
  await tx.execute(sql`
    UPDATE ${sql.raw(t.table)} SET status = 'pending', held_until = ${hold.until}::timestamptz, held_reason = ${hold.reason}
    WHERE org_id = ${orgId} AND id = ${id} AND status IN ('processing', 'pending')`);
}

export interface HeldSummary {
  /** Recipients waiting for the end of the quiet hours. */
  count: number;
  /** The earliest instant one of them may go. */
  next: Date | null;
}

const NONE: HeldSummary = { count: 0, next: null };

/** The held recipients of several broadcasts at once (one statement), keyed by the broadcast's row id. */
export async function heldSummaries(
  tx: Tx,
  orgId: number,
  t: HeldTable,
  broadcastIds: readonly number[],
): Promise<Map<number, HeldSummary>> {
  const out = new Map<number, HeldSummary>();
  if (broadcastIds.length === 0) return out;
  const res = await tx.execute(sql`
    SELECT ${sql.raw(t.broadcastFk)} AS broadcast_id, count(*)::int AS n, min(held_until) AS next
    FROM ${sql.raw(t.table)}
    WHERE org_id = ${orgId} AND status = 'pending' AND held_until IS NOT NULL
      AND ${sql.raw(t.broadcastFk)} IN (${sql.join(
        broadcastIds.map((id) => sql`${id}::bigint`),
        sql`, `,
      )})
    GROUP BY ${sql.raw(t.broadcastFk)}`);
  for (const r of res.rows as Array<{
    broadcast_id: number | string;
    n: number;
    next: Date | string | null;
  }>) {
    out.set(Number(r.broadcast_id), {
      count: Number(r.n),
      next: r.next === null ? null : new Date(r.next),
    });
  }
  return out;
}

export const heldOf = (m: Map<number, HeldSummary>, id: number): HeldSummary => m.get(id) ?? NONE;

/** Wake-up margin: the job fires a second after the hours open, so the decision it takes is never made a moment too early. */
export const WAKE_MARGIN_MS = 1_000;

/** How long to wait from `now` for a wake-up at `at`. */
export const wakeDelayMs = (at: Date, now: Date = new Date()): number =>
  Math.max(WAKE_MARGIN_MS, at.getTime() - now.getTime() + WAKE_MARGIN_MS);

/** The id of a wake-up job: one per broadcast per opening, so asking twice for the same opening queues it once. */
export const wakeJobId = (broadcastUuid: string, at: Date): string =>
  `${broadcastUuid}-held-${Math.floor(at.getTime() / 1000)}`;

/** The part of a BullMQ queue the wake-up needs. */
export interface WakeQueue<D> {
  add(
    name: string,
    data: D,
    opts: { jobId: string; delay: number; removeOnComplete: number; removeOnFail: number },
  ): Promise<unknown>;
}

/**
 * Queues the run that takes up a broadcast's held recipients at the first opening. A queue that is down is logged, not thrown: the
 * recipients stay `pending` with their `held_until`, and a person pressing Start (or the next run) takes them up the same way.
 */
export async function scheduleWake<D>(
  queue: WakeQueue<D>,
  name: string,
  data: D,
  broadcastUuid: string,
  at: Date,
  onError: (err: unknown) => void,
  /** The clock the hold was decided on (`SendWindowService.now()`): the delay is measured from it. */
  now: Date = new Date(),
): Promise<void> {
  try {
    await queue.add(name, data, {
      jobId: wakeJobId(broadcastUuid, at),
      delay: wakeDelayMs(at, now),
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  } catch (err) {
    onError(err);
  }
}
