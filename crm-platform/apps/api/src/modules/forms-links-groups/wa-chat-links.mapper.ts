import type { WaChatLink, WaChatLinkStatus } from '@crm/contracts';
import type { WaChatLinkRow } from './wa-chat-links.repository';

/** `wa.me` URL: digits-only phone, country code re-prefixed with `+`. UTM fields are never appended (Reference parity). */
export function buildWaUrl(
  countryCode: string,
  phoneNumber: string,
  welcomeMessage: string | null,
): string {
  const digits = `${countryCode}${phoneNumber}`.replace(/\D/g, '');
  const text = welcomeMessage ? `?text=${encodeURIComponent(welcomeMessage)}` : '';
  return `https://wa.me/${digits}${text}`;
}

export function isLinkLive(status: string, expiresAt: Date | null): boolean {
  return status === 'active' && (!expiresAt || expiresAt.getTime() > Date.now());
}

export function toWaChatLinkResponse(row: WaChatLinkRow): WaChatLink {
  return {
    id: row.uuid,
    name: row.name,
    slug: row.slug,
    countryCode: row.country_code,
    phoneNumber: row.phone_number,
    welcomeMessage: row.welcome_message,
    utmSource: row.utm_source,
    utmMedium: row.utm_medium,
    utmCampaign: row.utm_campaign,
    clickCount: row.click_count,
    lastClickedAt: row.last_clicked_at?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null,
    status: row.status as WaChatLinkStatus,
    isLive: isLinkLive(row.status, row.expires_at),
    waUrl: buildWaUrl(row.country_code, row.phone_number, row.welcome_message),
    shortPath: `/l/${row.slug}`,
    createdAt: row.created_at_iso,
    rowVersion: row.row_version,
  };
}
