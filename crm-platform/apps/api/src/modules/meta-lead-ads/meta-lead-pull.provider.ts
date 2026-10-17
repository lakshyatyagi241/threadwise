import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { META_LEAD_SOURCE_REF_PREFIX } from '@crm/contracts';
// Only the leaf port of the lead pipeline's pulls: it imports nothing, so this module never imports the leads module (that module
// already reaches this one's sources through ports, and the two would close a cycle).
import {
  LEAD_PULL_REGISTRY,
  type LeadPullCapabilities,
  type LeadPullProvider,
  type LeadPullRegistryPort,
  type LeadPullRequest,
  type LeadPullResult,
  type LeadPullSource,
} from '../leads/lead-pull.port';
import { PULL_MIN_INTERVAL_SECONDS, PULL_REACH_MS } from './meta-lead-pull.rules';
import { MetaLeadPullService } from './meta-lead-pull.service';

const NONE = { fetched: 0, accepted: 0, duplicates: 0, failed: 0, windowsDone: 0, windowsTotal: 0 };

/**
 * The Meta lead forms as pullable lead sources (BL-204, BL-210, spec L-18). A picked form's lead source is `kind: meta_lead_ads`, with the
 * form's stable reference as `externalRef`. "Sync now" and a backfill of a date range work for every picked form; the pull itself, with
 * Meta's limits kept, is `MetaLeadPullService`.
 */
@Injectable()
export class MetaLeadPullProvider implements LeadPullProvider {
  readonly name = 'meta_lead_ads';

  constructor(private readonly service: MetaLeadPullService) {}

  async capabilities(orgId: number, source: LeadPullSource): Promise<LeadPullCapabilities | null> {
    if (source.kind !== 'meta_lead_ads') return null;
    if (!source.externalRef?.startsWith(META_LEAD_SOURCE_REF_PREFIX)) return null;
    if (!(await this.service.hasForm(orgId, source.uuid))) return null;
    return {
      sync: true,
      backfill: true,
      minIntervalSeconds: PULL_MIN_INTERVAL_SECONDS,
      maxBackfillSeconds: Math.floor(PULL_REACH_MS / 1000),
    };
  }

  async pull(req: LeadPullRequest): Promise<LeadPullResult> {
    if (req.source.kind !== 'meta_lead_ads') {
      return { status: 'failed', error: 'not_supported', progress: NONE };
    }
    return this.service.run(req);
  }
}

/**
 * Puts the provider in the lead pipeline's registry once the application is up, found by its token in the whole application (like the
 * marketplace does), so neither module imports the other. Without a registry in this build the Meta door works as before.
 */
@Injectable()
export class MetaLeadPullBinding implements OnApplicationBootstrap {
  private readonly logger = new Logger(MetaLeadPullBinding.name);

  constructor(
    private readonly modules: ModuleRef,
    private readonly provider: MetaLeadPullProvider,
  ) {}

  onApplicationBootstrap(): void {
    try {
      this.modules
        .get<LeadPullRegistryPort>(LEAD_PULL_REGISTRY, { strict: false })
        .register(this.provider);
    } catch {
      this.logger.debug(
        'no lead pull registry in this build; Meta lead forms cannot be pulled from the inbox',
      );
    }
  }
}
