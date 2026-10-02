import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AiKeySource } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { PlatformStore } from '../auth';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { byokAllowed, capRequestedTokens, parseExtras, pickSource } from './ai-rules';
import { KeyVault } from './key-vault';

export interface ResolvedKey {
  key: string | null;
  source: AiKeySource;
  /** The platform row's default model; null for a workspace key (the caller brings its own model). */
  model: string | null;
}

interface PlatformKeyRead {
  provider: string;
  api_key: string | null;
  default_model: string | null;
}
interface WorkspaceKeyRead {
  provider: string;
  api_key: string;
}

/**
 * Picks the key for an AI call (WD-AIADM-010): the workspace's own active key when its plan (or ownership) allows
 * it, else the platform's active key for the vendor, else none. Every other AI domain calls this and passes the
 * `source` to AiTokenMeter so the tokens are billed to the right side.
 *
 * There is no cache: each call reads the tables, so switching a provider off takes effect on the next call. There is
 * no fallback to an environment variable. A key that cannot be decrypted counts as absent.
 *
 * `orgId` null is a system-level call: only the platform key is considered.
 */
@Injectable()
export class AiKeyResolver {
  constructor(
    private readonly db: DatabaseService,
    private readonly platform: PlatformStore,
    private readonly entitlements: PlanEntitlementService,
    private readonly vault: KeyVault,
  ) {}

  async resolve(orgId: number | null, provider: string): Promise<ResolvedKey> {
    const slug = provider.trim().toLowerCase();

    const allow = orgId !== null && (await this.allowsByok(orgId));
    const own = allow ? await this.workspaceKey(orgId, slug) : null;
    if (own !== null) return { key: own, source: 'workspace', model: null };

    const admin = await this.platformKey(slug);
    if (admin) return { key: admin.key, source: 'admin', model: admin.model };
    return { key: null, source: 'none', model: null };
  }

  /** Just the key string, or null when nothing resolves. */
  async keyFor(orgId: number | null, provider: string): Promise<string | null> {
    return (await this.resolve(orgId, provider)).key;
  }

  /**
   * Which key every vendor would use right now for a workspace, in one pass (the keys screen and the model
   * pickers). Vendors that resolve to nothing are left out.
   */
  async sourcesFor(orgId: number): Promise<{
    byokAllowed: boolean;
    sources: Map<string, 'workspace' | 'admin'>;
    workspaceProviders: Set<string>;
  }> {
    const allow = await this.allowsByok(orgId);
    const own = await this.workspaceKeys(orgId);
    const platform = await this.platformKeys();
    const sources = new Map<string, 'workspace' | 'admin'>();
    for (const provider of new Set([...own.keys(), ...platform.keys()])) {
      const s = pickSource(allow, own.has(provider), platform.has(provider));
      if (s !== 'none') sources.set(provider, s);
    }
    return { byokAllowed: allow, sources, workspaceProviders: new Set(own.keys()) };
  }

  /**
   * The platform's output-token ceiling for a vendor, or null (WD-AIADM-009). Read from the vendor's row whether or not
   * it is active, so a workspace on its own key is capped too, as in WaDesk. A failed lookup never blocks a call.
   */
  async maxTokensCeiling(provider: string): Promise<number | null> {
    try {
      const rows = await this.platform.tx(async (tx) => {
        const res = await tx.execute(
          sql`SELECT extra_config FROM admin_ai_keys WHERE provider = ${provider.trim().toLowerCase()}`,
        );
        return res.rows as unknown as Array<{ extra_config: string | null }>;
      });
      return rows[0] ? parseExtras(rows[0].extra_config).maxTokens : null;
    } catch {
      return null;
    }
  }

  /** The number of output tokens to ask the vendor for: the requested count, lowered to the platform ceiling. */
  async capMaxTokens(provider: string, requested: number): Promise<number> {
    return capRequestedTokens(requested, await this.maxTokensCeiling(provider));
  }

  // --- internals -----------------------------------------------------------------------------------------------------

  private async allowsByok(orgId: number): Promise<boolean> {
    const e = await this.entitlements.forOrg(orgId);
    return e !== null && byokAllowed(e);
  }

  private async workspaceKey(orgId: number, provider: string): Promise<string | null> {
    return (await this.workspaceKeys(orgId, provider)).get(provider) ?? null;
  }

  /** The workspace's active keys that can be read, by vendor. */
  private async workspaceKeys(orgId: number, provider?: string): Promise<Map<string, string>> {
    const rows = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const res = await tx.execute(
        provider === undefined
          ? sql`SELECT provider, api_key FROM ai_provider_keys WHERE org_id = ${orgId} AND is_active`
          : sql`SELECT provider, api_key FROM ai_provider_keys
                WHERE org_id = ${orgId} AND is_active AND provider = ${provider}`,
      );
      return res.rows as unknown as WorkspaceKeyRead[];
    });
    const out = new Map<string, string>();
    for (const r of rows) {
      const read = this.vault.read(r.api_key, `${orgId}:${r.provider}`);
      if (read.state === 'readable') out.set(r.provider, read.key);
    }
    return out;
  }

  private async platformKey(
    provider: string,
  ): Promise<{ key: string; model: string | null } | null> {
    const found = (await this.platformKeys(provider)).get(provider);
    return found ?? null;
  }

  /** The platform's active keys that can be read, by vendor. */
  private async platformKeys(
    provider?: string,
  ): Promise<Map<string, { key: string; model: string | null }>> {
    const rows = await this.platform.tx(async (tx) => {
      const res = await tx.execute(
        provider === undefined
          ? sql`SELECT provider, api_key, default_model FROM admin_ai_keys WHERE is_active`
          : sql`SELECT provider, api_key, default_model FROM admin_ai_keys
                WHERE is_active AND provider = ${provider}`,
      );
      return res.rows as unknown as PlatformKeyRead[];
    });
    const out = new Map<string, { key: string; model: string | null }>();
    for (const r of rows) {
      const read = this.vault.read(r.api_key, r.provider);
      if (read.state === 'readable') out.set(r.provider, { key: read.key, model: r.default_model });
    }
    return out;
  }
}
