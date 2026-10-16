import { Injectable, Logger } from '@nestjs/common';
import type {
  LeadPullCapabilities,
  LeadPullProvider,
  LeadPullRegistryPort,
  LeadPullSource,
} from './lead-pull.port';

/**
 * The providers that can pull a lead source. One instance per process (`LeadPullModule`), bound to `LEAD_PULL_REGISTRY`. A provider
 * registers when its own module starts; the first one that recognises a source owns it. With no provider no source can be pulled and
 * the inbox shows no sync controls: a webhook sends its own leads.
 */
@Injectable()
export class LeadPullRegistry implements LeadPullRegistryPort {
  private readonly logger = new Logger(LeadPullRegistry.name);
  private readonly providers: LeadPullProvider[] = [];

  register(provider: LeadPullProvider): void {
    if (this.providers.some((p) => p.name === provider.name)) return;
    this.providers.push(provider);
    this.logger.log({ provider: provider.name }, 'lead pull provider registered');
  }

  /** The provider that owns the source and what it can do; undefined when none does. */
  async resolve(
    orgId: number,
    source: LeadPullSource,
  ): Promise<{ provider: LeadPullProvider; capabilities: LeadPullCapabilities } | undefined> {
    for (const provider of this.providers) {
      try {
        const capabilities = await provider.capabilities(orgId, source);
        if (capabilities && (capabilities.sync || capabilities.backfill)) {
          return { provider, capabilities };
        }
      } catch (err) {
        // One provider failing must not hide the sources of the others, nor fail the inbox.
        this.logger.warn({ err, provider: provider.name }, 'lead pull provider could not answer');
      }
    }
    return undefined;
  }
}
