import { Injectable } from '@nestjs/common';
import type { ChannelCapabilities, ChannelSettings, ChannelStatus } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { effectiveCapabilitiesOf } from './channel-capabilities';
import { normalizeSettings } from './channel-settings';
import { ChannelsRepository, type ChannelRow } from './channels.repository';

/** A channel as other domains may see it: no credentials, no token, nothing a send would need. */
export interface ChannelSummary {
  /** Internal id, for foreign keys inside the caller's own transaction. Never put it on the wire. */
  id: number;
  uuid: string;
  kind: string;
  name: string;
  status: ChannelStatus;
  displayAddress: string | null;
  capabilities: ChannelCapabilities;
  settings: ChannelSettings;
}

/**
 * The door other domains use to ask about channels (the inbox filter rail, a broadcast picking its sender, a dashboard counting
 * connected channels). Read-only and secret-free by construction: it never returns credentials, and nothing here sends.
 * Methods take the caller's transaction, so they run under the caller's tenant and see exactly what its RLS allows.
 */
@Injectable()
export class ChannelsFacade {
  constructor(
    private readonly repo: ChannelsRepository,
    private readonly adapters: ChannelAdapterRegistry,
  ) {}

  async list(tx: Tx, orgId: number): Promise<ChannelSummary[]> {
    const rows = await this.repo.list(tx, orgId);
    return rows.flatMap((r) => this.summary(r) ?? []);
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<ChannelSummary | null> {
    const row = await this.repo.byUuid(tx, orgId, uuid);
    return row ? this.summary(row) : null;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<ChannelSummary | null> {
    const row = await this.repo.byId(tx, orgId, id);
    return row ? this.summary(row) : null;
  }

  /** Null for a channel whose kind has no adapter in this deployment: it cannot be used, so it is not offered. */
  private summary(row: ChannelRow): ChannelSummary | null {
    const adapter = this.adapters.find(row.kind);
    if (!adapter) return null;
    const settings = normalizeSettings(row.kind, row.settings);
    return {
      id: row.id,
      uuid: row.uuid,
      kind: row.kind,
      name: row.name,
      status: row.status,
      displayAddress: row.displayAddress,
      settings,
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
    };
  }
}
