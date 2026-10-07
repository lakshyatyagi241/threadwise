import type { ScheduleDetail, ScheduleSummary, V1Scheduled } from '@crm/contracts';
import type { ScheduledExtras } from './scheduled-extras.repository';

/** The public scheduled message. Phone numbers are never part of it, only how many there are (TW-API-093 rule 3). */
export function toV1Scheduled(
  s: ScheduleSummary | ScheduleDetail,
  extras: ScheduledExtras | undefined,
): V1Scheduled {
  return {
    id: s.id,
    name: s.name,
    // A template schedule is stored as a text send of the template's body; the API calls it what it was asked to be (Reference: `template`).
    type: extras?.templateId ? 'template' : s.messageType,
    status: s.status,
    message: 'message' in s ? s.message : null,
    template_id: extras?.templateId ?? null,
    device_id: extras?.senderKey ?? null,
    recipient_count: s.totalRecipients,
    run_at: s.scheduledAt,
    next_run_at: s.nextRunAt,
    timezone: s.timezone,
    total_sent: s.totalSent,
    total_delivered: s.totalDelivered,
    total_failed: s.totalFailed,
    created_at: (extras?.createdAt ?? new Date(s.scheduledAt)).toISOString(),
  };
}

/** Offset paging under an opaque cursor: the staff list pages by offset, the public one never shows it. */
export function encodeOffset(offset: number): string {
  return Buffer.from(`o:${offset}`, 'utf8').toString('base64url');
}

export function decodeOffset(cursor: string | undefined): number | null {
  if (!cursor) return 0;
  const m = /^o:(\d{1,9})$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  return m ? Number(m[1]) : null;
}
