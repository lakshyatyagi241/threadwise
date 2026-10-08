import type { WabaGroup, WabaGroupJoinMode, WabaGroupJoinRequest } from '@crm/contracts';
import type { WabaGroupRow } from './waba-groups.repository';

const MODES: readonly string[] = ['auto_approve', 'approval_required'];

/** `meta_json.join_requests` is `{ [requestId]: { wa_id, created_at } }` (the webhook rules write it); anything else is an empty queue. */
export function pendingOf(meta: Record<string, unknown> | null): WabaGroupJoinRequest[] {
  const raw = meta?.join_requests;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>).map(([id, v]) => {
    const r = (v && typeof v === 'object' ? v : {}) as { wa_id?: unknown; created_at?: unknown };
    const at = r.created_at;
    return {
      id,
      waId: String(r.wa_id ?? id),
      createdAt: at === undefined || at === null || at === '' ? null : String(at),
    };
  });
}

function lastErrorOf(meta: Record<string, unknown> | null): WabaGroup['lastError'] {
  const e = meta?.last_error;
  if (!e || typeof e !== 'object') return null;
  const r = e as { code?: unknown; message?: unknown; title?: unknown; details?: unknown };
  const text = r.message ?? r.title ?? r.details;
  return {
    code: typeof r.code === 'number' ? r.code : null,
    message: typeof text === 'string' ? text : null,
  };
}

/**
 * The wire shape of a group. The only place an internal id becomes a uuid. The numbers of people waiting to join are personal data:
 * `withRequests` is true only for a holder of `waba.groups.manage`; everyone else still gets the count.
 */
export function toGroupDto(row: WabaGroupRow, withRequests: boolean): WabaGroup {
  const pending = pendingOf(row.meta_json);
  return {
    id: row.uuid,
    groupId: row.group_id,
    subject: row.subject,
    description: row.description,
    inviteLink: row.invite_link,
    awaitingInviteLink: !row.invite_link,
    joinApprovalMode: MODES.includes(row.join_approval_mode ?? '')
      ? (row.join_approval_mode as WabaGroupJoinMode)
      : null,
    participantCount: row.participant_count,
    suspended: row.suspended,
    pendingJoinRequestCount: pending.length,
    pendingJoinRequests: withRequests ? pending : [],
    lastError: lastErrorOf(row.meta_json),
    syncedAt: row.synced_at ? row.synced_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    rowVersion: row.row_version,
  };
}
