import type { WabaConnection as WabaConnectionDto, WabaProvider, WabaStatus } from '@crm/contracts';
import { isCoexistence } from './waba-rules';
import type { WabaRow } from './waba-connections.repository';

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const iso = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** The row as the API returns it. Reads only meta_json and plain columns: the credentials are never decrypted here. */
export function toDto(row: WabaRow): WabaConnectionDto {
  const m = row.meta_json ?? {};
  const platformType = str(m.platform_type);
  return {
    id: row.uuid,
    provider: (m.provider === 'interakt' ? 'interakt' : 'meta') as WabaProvider,
    status: (['pending', 'connected', 'failed', 'disconnected'].includes(row.status)
      ? row.status
      : 'failed') as WabaStatus,
    isPrimary: row.is_primary,
    displayLabel: row.display_label,
    phoneNumber: row.phone_number,
    verifiedName: str(m.verified_name),
    wabaId: str(m.waba_id),
    phoneNumberId: str(m.phone_number_id),
    businessId: str(m.business_id),
    qualityRating: str(m.quality_rating),
    messagingLimitTier: str(m.messaging_limit_tier),
    platformType,
    nameStatus: str(m.name_status),
    codeVerificationStatus: str(m.code_verification_status),
    coexistence: m.coexistence === true || isCoexistence(platformType),
    inboundWired: typeof m.inbound_wired === 'boolean' ? m.inbound_wired : null,
    inboundCheckedAt: iso(m.inbound_checked_at),
    connectedVia:
      m.connected_via === 'embedded' || m.connected_via === 'manual' ? m.connected_via : null,
    hasToken: row.credentials_json !== null && row.credentials_json !== '',
    tokenExpiresAt: iso(m.token_expires_at),
    lastError: str(m.last_error),
    connectedAt: row.connected_at ? row.connected_at.toISOString() : null,
    lastHealthAt: row.last_health_at ? row.last_health_at.toISOString() : null,
    rowVersion: row.row_version,
  };
}
