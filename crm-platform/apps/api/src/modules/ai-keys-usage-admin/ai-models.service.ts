import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  findAiProvider,
  type AiModelOption,
  type AiModelsResponse,
  type AiProviderSlug,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { PlatformStore } from '../auth';
import { AiKeyResolver } from './ai-key-resolver.service';
import { parseExtras } from './ai-rules';
import { KeyVault } from './key-vault';

/** How many of a vendor's catalogue models a workspace's own key offers (the newest ones). */
const OWN_KEY_MODELS = 2;

/**
 * The model picker the AI editors read (WD-AIADM-015): the text models behind the platform's active, readable keys
 * (the default model first, then any extra ids the admin listed) and, where the workspace's own key will actually be
 * used, that vendor's models in their place so only the workspace's key shows. Voice vendors are not text models and
 * are left out (WaDesk dropped only ElevenLabs, so Deepgram's speech model showed up as a text option).
 *
 * WaDesk also listed a workspace's own keys on plans where the resolver would then ignore them, so a person could pick
 * a model the call would not honour; here the overlay follows the same plan rule as the resolver.
 */
@Injectable()
export class AiModelsService {
  constructor(
    private readonly platform: PlatformStore,
    private readonly resolver: AiKeyResolver,
    private readonly vault: KeyVault,
  ) {}

  async list(): Promise<AiModelsResponse> {
    const ctx = RequestContextStore.require();
    const rows = await this.platform.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT provider, api_key, default_model, extra_config FROM admin_ai_keys
        WHERE is_active ORDER BY sort_order, provider
      `);
      return res.rows as unknown as Array<{
        provider: string;
        api_key: string | null;
        default_model: string | null;
        extra_config: string | null;
      }>;
    });
    const { byokAllowed, workspaceProviders } = await this.resolver.sourcesFor(ctx.orgId);
    const ownKeyProviders = byokAllowed ? workspaceProviders : new Set<string>();

    const data: AiModelOption[] = [];
    for (const r of rows) {
      const def = findAiProvider(r.provider);
      if (!def || def.group === 'voice') continue;
      if (ownKeyProviders.has(r.provider)) continue;
      if (!r.default_model || this.vault.read(r.api_key, r.provider).state !== 'readable') continue;
      const ids = [...new Set([r.default_model, ...parseExtras(r.extra_config).models])];
      for (const value of ids) {
        data.push({
          value,
          provider: r.provider as AiProviderSlug,
          providerName: def.name,
          source: 'platform',
        });
      }
    }
    for (const provider of ownKeyProviders) {
      const def = findAiProvider(provider);
      if (!def || def.group === 'voice') continue;
      for (const value of def.models.slice(0, OWN_KEY_MODELS)) {
        data.push({
          value,
          provider: provider as AiProviderSlug,
          providerName: def.name,
          source: 'workspace',
        });
      }
    }
    return { data };
  }
}
