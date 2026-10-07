import type { V1Campaign, V1CampaignStatistics } from '@crm/contracts';
import { wallTimeToUtc } from '../../../broadcasts';
import type { CampaignRow } from '../../../campaigns';
import { rate } from './bulk-input';

/** What the public shape needs of a campaign, whichever read it came from. */
export interface CampaignFacts {
  row: CampaignRow;
  /** `<engine>:<uuid>` of the sender, or null when it has none. */
  senderKey: string | null;
}

export interface CampaignCounts {
  total_recipients: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  clicked: number;
  responded: number;
}

/** Our `cancelled` is WaDesk's `stopped`; the other words are the same. */
export function wireStatus(status: string): string {
  return status === 'cancelled' ? 'stopped' : status;
}

/** The status a client filtered by, as we store it. */
export function storedStatus(status: string): string {
  return status === 'stopped' ? 'cancelled' : status;
}

/** Counts from the recipient rows; the click count is the greater of ours and Meta's, as the dashboard shows it. */
export function countsOf(row: CampaignRow): CampaignCounts {
  const c = row.counts;
  return {
    total_recipients: row.totalRecipients || c.total,
    sent: c.sent,
    delivered: c.delivered,
    read: c.read,
    failed: c.failed,
    clicked: Math.max(c.clicked, row.metaClickedCount),
    responded: c.responded,
  };
}

export function metricsOf(c: CampaignCounts) {
  return {
    delivery_rate: rate(c.delivered, c.sent),
    read_rate: rate(c.read, c.delivered),
    click_rate: rate(c.clicked, c.sent),
    response_rate: rate(c.responded, c.sent),
  };
}

/** The send date and time, stored apart, as the instant they mean in the campaign's zone. */
function scheduledFor(row: CampaignRow): string | null {
  if (!row.sendDate || !row.sendTime) return null;
  try {
    return wallTimeToUtc(
      row.sendDate,
      row.sendTime.slice(0, 5),
      row.timezone ?? 'UTC',
    ).toISOString();
  } catch {
    return null;
  }
}

const ZERO: CampaignCounts = {
  total_recipients: 0,
  sent: 0,
  delivered: 0,
  read: 0,
  failed: 0,
  clicked: 0,
  responded: 0,
};

/**
 * WaDesk's campaign object. `asStored` is the create answer, which WaDesk built from the row it had just inserted: counts and rates all 0
 * (even the audience) and no `scheduled_for`; a read right after has the real numbers (WD-API-087 rule 7, kept on purpose).
 */
export function toV1Campaign(
  { row, senderKey }: CampaignFacts,
  opts: { asStored?: boolean } = {},
): V1Campaign {
  const counts = opts.asStored ? ZERO : countsOf(row);
  return {
    id: row.uuid,
    name: row.name,
    type: row.type,
    status: wireStatus(row.status),
    device_id: senderKey,
    template_id: row.templateUuid,
    flow_id: row.flowUuid,
    ab_testing: row.abTesting,
    ab_split: row.abSplit,
    counts,
    metrics: metricsOf(counts),
    schedule_type: row.scheduleType,
    scheduled_for: opts.asStored ? null : scheduledFor(row),
    timezone: row.timezone,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    completed_at: row.completedAt?.toISOString() ?? null,
  };
}

/** The workspace rollup (WD-API-085). `active` is a campaign that is running; WaDesk counted only `processing`, which a new campaign never was. */
export function statisticsOf(rows: readonly CampaignRow[]): V1CampaignStatistics {
  const sum: CampaignCounts = { ...ZERO };
  const by = { active: 0, completed: 0, scheduled: 0, failed: 0 };
  for (const row of rows) {
    const c = countsOf(row);
    for (const k of Object.keys(sum) as Array<keyof CampaignCounts>) sum[k] += c[k];
    if (row.status === 'running') by.active++;
    else if (row.status === 'completed') by.completed++;
    else if (row.status === 'scheduled') by.scheduled++;
    else if (row.status === 'failed') by.failed++;
  }
  const m = metricsOf(sum);
  return { campaigns: { total: rows.length, ...by }, messages: sum, rates: m };
}
