import {
  deviceConnectionStateSchema,
  deviceStateReasonSchema,
  type DeviceConnectionState,
  type DeviceStateReason,
  type PersonalDevice,
  type PersonalDeviceDetail,
} from '@crm/contracts';
import { senderDigits } from '../node-bridge-runtime';
import type { DeviceRow } from './devices.repository';
import { toE164 } from './device-rules';
import { toHistoryStatus } from './history-import.mapper';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** A state read from the database: the CHECK keeps it inside the set, this keeps the type honest. */
const stateOf = (v: string): DeviceConnectionState => deviceConnectionStateSchema.parse(v);
const reasonOf = (v: string | null): DeviceStateReason | null => {
  if (v === null) return null;
  const parsed = deviceStateReasonSchema.safeParse(v);
  return parsed.success ? parsed.data : null;
};

/** The only place a `devices` row becomes an API response: uuids out, internal ids never, no credentials. */
export function toDevice(r: DeviceRow): PersonalDevice {
  const digits = r.phone_digits ?? senderDigits(r.country_code, r.phone_number);
  return {
    id: r.uuid,
    name: r.device_name,
    phone: toE164(digits),
    countryCode: r.country_code,
    region: r.region,
    connectionState: stateOf(r.connection_state),
    stateReason: reasonOf(r.state_reason),
    stateChangedAt: iso(r.state_changed_at),
    status: r.status === 'connected' || r.status === 'needs_pair' ? r.status : 'disconnected',
    active: r.active,
    activateAfterPairing: r.activate_after_pairing,
    lastSeenAt: iso(r.last_seen_at),
    assignee: r.assignee_uuid ? { id: r.assignee_uuid, name: r.assignee_name ?? '' } : null,
    createdBy: r.creator_uuid ? { id: r.creator_uuid, name: r.creator_name ?? '' } : null,
    proxy: { enabled: r.proxy_enabled, status: r.proxy_status, egressIp: r.proxy_egress_ip },
    sent24h: r.sent_24h,
    failed24h: r.failed_24h,
    historyImport: toHistoryStatus(
      r.hi_state === null
        ? null
        : {
            state: r.hi_state,
            mode: r.hi_mode,
            chats_count: r.hi_chats,
            contacts_count: r.hi_contacts,
            messages_count: r.hi_messages,
            progress: r.hi_progress,
            window_days: r.hi_window_days,
            started_at: r.hi_started_at,
            finished_at: r.hi_finished_at,
            error_code: r.hi_error,
          },
    ),
    createdAt: r.created_at.toISOString(),
    rowVersion: r.row_version,
  };
}

export function toDeviceDetail(r: DeviceRow, hasSession: boolean): PersonalDeviceDetail {
  const base = toDevice(r);
  const failed = base.connectionState === 'error' || base.connectionState === 'logged_out';
  return {
    ...base,
    lastError:
      failed && base.stateReason
        ? { reason: base.stateReason, at: base.stateChangedAt ?? base.createdAt }
        : null,
    warmerConfigured: r.warmer_configured,
    hasSession,
  };
}
