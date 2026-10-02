import type { BroadcastResponse } from '@crm/contracts';
import type { BroadcastRow } from './broadcasts.repository';

export const toBroadcastResponse = (
  row: BroadcastRow,
  senderKey: string | null,
): BroadcastResponse => ({
  id: row.uuid,
  name: row.name,
  status: row.status,
  provider: row.provider,
  senderKey,
  templateId: row.templateUuid,
  timezone: row.timezone,
  scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : null,
  completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  totalRecipients: row.totalRecipients,
  successCount: row.successCount,
  deliveredCount: row.deliveredCount,
  readCount: row.readCount,
  clickedCount: row.clickedCount,
  failCount: row.failCount,
  rowVersion: row.rowVersion,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
