import type { ChannelKind, ChannelResponse } from '@crm/contracts';
import type { ChannelAdapter } from '../../infra/providers/chat-conversations';
import { effectiveCapabilitiesOf } from './channel-capabilities';
import { normalizeSettings } from './channel-settings';
import type { ChannelRow } from './channels.repository';

/** The path a provider posts to (see ChannelWebhooksController). A kind with no provider webhook (the simulator, the web chat widget) has none. */
export const webhookPath = (uuid: string): string => `/v2/webhooks/channels/${uuid}`;

/**
 * The only place a channel row becomes an API response: ids are uuids, secrets are never in a row to begin with, and the
 * capabilities are the adapter's own merged with this channel's overrides.
 */
export function toChannelResponse(
  row: ChannelRow,
  adapter: ChannelAdapter,
  publicBaseUrl: string,
): ChannelResponse {
  const settings = normalizeSettings(row.kind, row.settings);
  return {
    id: row.uuid,
    kind: row.kind as ChannelKind,
    name: row.name,
    status: row.status,
    externalId: row.externalId,
    displayAddress: row.displayAddress,
    capabilities: effectiveCapabilitiesOf(adapter, {
      orgId: 0,
      uuid: row.uuid,
      kind: row.kind,
      status: row.status,
      externalId: row.externalId,
      displayAddress: row.displayAddress,
      settings,
      capabilityOverrides: row.capabilities,
      credentials: {},
    }),
    settings,
    hasCredentials: row.hasCredentials,
    credentialHints: row.credentialHints,
    webhookUrl: adapter.publicWebhook ? `${publicBaseUrl}${webhookPath(row.uuid)}` : null,
    lastEventAt: row.lastEventAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    rowVersion: row.rowVersion,
  };
}
