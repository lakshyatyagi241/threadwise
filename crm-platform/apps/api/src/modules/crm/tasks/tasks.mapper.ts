import type { TaskResponse } from '@crm/contracts';
import type { TaskRow } from './tasks.repository';

/** The mapper is the only place an internal id becomes a uuid. `notes` arrives decrypted (the service owns the key). */
export function toTaskResponse(row: TaskRow, notes: string | null): TaskResponse {
  return {
    id: row.uuid,
    title: row.title,
    notes,
    priority: row.priority,
    status: row.status,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    doneAt: row.doneAt ? row.doneAt.toISOString() : null,
    remindedAt: row.remindedAt ? row.remindedAt.toISOString() : null,
    bucket: row.bucket,
    overdue: row.bucket === 'overdue',
    assignee: row.assigneeUuid ? { id: row.assigneeUuid, name: row.assigneeName ?? '' } : null,
    createdBy: row.createdByUuid ? { id: row.createdByUuid, name: row.createdByName ?? '' } : null,
    contact: row.contactUuid ? { id: row.contactUuid, name: row.contactName } : null,
    deal: row.dealUuid ? { id: row.dealUuid, title: row.dealTitle ?? '' } : null,
    company: row.companyUuid ? { id: row.companyUuid, name: row.companyName ?? '' } : null,
    source: row.source,
    kind: row.kind,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The few fields an outbox event carries: identifiers and what a consumer decides on, not the whole row (and never the notes). */
export function taskEventPayload(row: TaskRow): Record<string, unknown> {
  return {
    uuid: row.uuid,
    title: row.title,
    priority: row.priority,
    status: row.status,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    assigneeId: row.assigneeUuid,
    createdById: row.createdByUuid,
    contactId: row.contactUuid,
    dealId: row.dealUuid,
    companyId: row.companyUuid,
    source: row.source,
    kind: row.kind,
  };
}
