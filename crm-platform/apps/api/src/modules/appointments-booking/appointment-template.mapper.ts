import type { AppointmentTemplate } from '@crm/contracts';
import type { LibraryRow } from './appointment-channels.repository';
import { libraryStatusOfWa } from './appointment-template.rules';

/** One library row as the API shows it. Pure: the status of a WhatsApp message is read from the template it is linked to. */
export function toApiTemplate(row: LibraryRow, now: Date = new Date()): AppointmentTemplate {
  const wa =
    row.channel === 'whatsapp'
      ? libraryStatusOfWa(
          row.waTemplateId === null
            ? null
            : {
                status: row.waStatus ?? 'draft',
                metaStatus: row.waMetaStatus,
                pausedUntil: row.waPausedUntil,
                rejectionReason: row.waRejectionReason,
              },
          now,
        )
      : { status: 'approved' as const, reason: null };
  return {
    id: row.uuid,
    kind: row.kind,
    channel: row.channel,
    language: row.language,
    name: row.name,
    subject: row.subject,
    body: row.body,
    variables: row.variables,
    status: wa.status,
    rejectionReason: wa.reason,
    waTemplateId: row.waUuid,
    connectionId: row.connectionUuid,
    predefinedKey: row.predefinedKey,
    isActive: row.isActive,
    usable: row.isActive && wa.status === 'approved',
    usedByTypes: row.usedByTypes,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
