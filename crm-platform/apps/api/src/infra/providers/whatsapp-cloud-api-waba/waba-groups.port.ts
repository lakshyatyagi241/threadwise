import type { WabaConnection } from './waba-admin.port';

/**
 * Meta's WhatsApp Groups API for one connected number (docs/specs/waba-groups-management.md 10). One method per endpoint Reference's
 * `GroupClient` calls; there is deliberately no "add participant" (Meta has none: groups are invite-only) and no join-request listing or
 * list-all (Reference calls neither: decision D4, phase 4).
 *
 * Every method throws `WabaApiError` on a Meta or network failure; `describeGroupFailure` (waba-group-errors.ts) turns that into the
 * operator sentence and the kind the API answers with.
 */

export interface GroupInfo {
  subject: string | null;
  description: string | null;
  joinApprovalMode: string | null;
  suspended: boolean | null;
  /** Meta's `total_participant_count`: it leaves the business itself out. */
  totalParticipantCount: number | null;
  creationTimestamp: number | null;
  /** The members' WhatsApp ids, when `participants` was asked for. */
  participants: string[];
}

export type GroupInfoField =
  | 'subject'
  | 'description'
  | 'participants'
  | 'join_approval_mode'
  | 'suspended'
  | 'creation_timestamp'
  | 'total_participant_count';

export interface WabaGroupsPort {
  /** `POST /{phone}/groups`. The id comes back at once; the invite link arrives later on the lifecycle webhook. NOT idempotent: never retried. */
  create(
    conn: WabaConnection,
    input: { subject: string; description?: string; joinApprovalMode?: string },
  ): Promise<{ groupId: string }>;
  /** Can this number use Groups: `GET /{phone}/groups?limit=1`. Only error 131215 is a definite `not_eligible`; any other failure is `unknown`. */
  probe(conn: WabaConnection): Promise<'eligible' | 'not_eligible' | 'unknown'>;
  /** `GET /{group}?fields=...` (every documented field unless narrowed). */
  info(conn: WabaConnection, groupId: string, fields?: GroupInfoField[]): Promise<GroupInfo>;
  /** `GET /{group}/invite_link`; null when Meta has not issued one yet. */
  inviteLink(conn: WabaConnection, groupId: string): Promise<string | null>;
  /** `POST /{group}/invite_link`: every earlier link stops working. */
  resetInviteLink(conn: WabaConnection, groupId: string): Promise<string | null>;
  /** `POST /{group}` with the given fields only. Meta confirms each field on `group_settings_update`. */
  update(
    conn: WabaConnection,
    groupId: string,
    fields: { subject?: string; description?: string },
  ): Promise<void>;
  /** `DELETE /{group}`: removes every participant, the business included. */
  delete(conn: WabaConnection, groupId: string): Promise<void>;
  /** `POST /{group}/join_requests` */
  approveJoinRequests(conn: WabaConnection, groupId: string, ids: string[]): Promise<void>;
  /** `DELETE /{group}/join_requests` (the ids go in the body) */
  rejectJoinRequests(conn: WabaConnection, groupId: string, ids: string[]): Promise<void>;
  /** `DELETE /{group}/participants` (the ids go in the body); at most 8. */
  removeParticipants(conn: WabaConnection, groupId: string, waIds: string[]): Promise<void>;
}

export const WABA_GROUPS = Symbol('WABA_GROUPS');
