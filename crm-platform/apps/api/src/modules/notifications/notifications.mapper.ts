import type { NotificationResponse } from '@crm/contracts';
import type { NotificationRow } from './notifications.repository';

export function toNotificationResponse(row: NotificationRow): NotificationResponse {
  return {
    id: row.uuid,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    data: row.data,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    // Only a collapsing row stands for several events; every other row keeps the shape it always had.
    ...(row.collapseKey ? { count: row.eventCount } : {}),
    ...(row.subjectKind && row.subjectUuid
      ? { subject: { kind: row.subjectKind, id: row.subjectUuid } }
      : {}),
  };
}
