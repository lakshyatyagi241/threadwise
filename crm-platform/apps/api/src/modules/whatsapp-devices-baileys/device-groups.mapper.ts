import {
  WA_DEVICE_GROUP_PREVIEW_MAX,
  type WaDeviceGroup,
  type WaDeviceGroupJoinRequest as JoinRequestDto,
  type WaDeviceGroupMember,
} from '@crm/contracts';
import { jidUser } from '../node-bridge-runtime';
import type { DeviceGroupRow, WaDeviceGroupJoinRequest } from './device-groups.repository';
import { digitsOf, e164Of, previewOf } from './device-groups-rules';

/**
 * The wire shape of a group. The only place an internal id becomes a uuid. Never the invite code, never a member's number: a list row
 * carries names and roles of at most five members and a count of the people waiting.
 */
export function toDeviceGroupDto(row: DeviceGroupRow): WaDeviceGroup {
  return {
    id: row.uuid,
    deviceId: row.device_uuid,
    groupId: row.group_jid,
    subject: row.subject,
    description: row.description,
    size: row.size,
    isAdmin: row.is_admin && row.left_at === null,
    announce: row.announce,
    restrict: row.restrict_info,
    joinApproval: row.join_approval,
    memberAddMode: row.member_add_mode === 'admin_add' ? 'admin_add' : 'all_member_add',
    hasInviteLink: row.has_invite && row.left_at === null,
    pictureUrl: row.picture_url,
    participantsPreview: previewOf(row.participants).slice(0, WA_DEVICE_GROUP_PREVIEW_MAX),
    participantsCount: row.size,
    pendingRequestCount: row.join_requests.length,
    conversationId: row.conversation_uuid,
    groupCreatedAt: row.creation_at ? row.creation_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    syncedAt: row.synced_at ? row.synced_at.toISOString() : null,
    left: row.left_at !== null,
    leftAt: row.left_at ? row.left_at.toISOString() : null,
    rowVersion: row.row_version,
  };
}

/** Is this roster entry the connected number? (A member may be known by the phone id or the anonymous one.) */
const isSelf = (p: { jid: string; phone: string | null }, selfDigits: string | null): boolean =>
  selfDigits !== null && (p.phone === selfDigits || jidUser(p.jid) === selfDigits);

/** A member as the manage view shows it. Numbers are personal data: only `wa.groups.manage` reaches this. */
export function toMemberDto(
  p: DeviceGroupRow['participants'][number],
  selfDigits: string | null,
): WaDeviceGroupMember {
  return {
    jid: p.jid,
    phone: e164Of(p.phone),
    name: p.name,
    admin: p.admin,
    self: isSelf(p, selfDigits),
  };
}

export function toJoinRequestDto(r: WaDeviceGroupJoinRequest): JoinRequestDto {
  return { jid: r.jid, phone: e164Of(r.phone), name: r.name, requestedAt: r.requestedAt };
}

/** `q` matches a member's name or number (digits typed with or without the `+`). */
export function matchesMember(
  p: DeviceGroupRow['participants'][number],
  q: string | undefined,
): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if ((p.name ?? '').toLowerCase().includes(needle)) return true;
  const digits = digitsOf(q);
  return digits.length >= 3 && (p.phone ?? '').includes(digits);
}
