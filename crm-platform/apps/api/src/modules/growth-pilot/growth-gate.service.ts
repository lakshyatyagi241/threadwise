import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type GrowthConfig,
  type GrowthFeature,
  type GrowthFeatures,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { CHAT_DIGEST_PILOT_SLUGS, isChatDigestPilot } from '../lead-scoring';
import { GrowthRepository } from './growth.repository';
import { mergeConfig, mergeFeatures, noFeatures } from './growth.rules';

export interface GrowthContext {
  orgId: number;
  /** In the pilot list AND has a settings row: the only workspaces any part of the growth pilot touches. */
  available: boolean;
  features: GrowthFeatures;
  config: GrowthConfig;
  rowVersion: number | null;
  /** The overrides as stored (what a settings update patches). */
  storedConfig: Partial<GrowthConfig>;
}

/**
 * The one door of the growth pilot. A workspace outside the pilot list, or without a settings row, is "not available": every route
 * refuses it, every sweeper skips it, every listener ignores it. Nothing in the pilot reads or writes a workspace that did not pass
 * through here.
 */
@Injectable()
export class GrowthGateService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: GrowthRepository,
  ) {}

  async load(orgId: number): Promise<GrowthContext> {
    const { slug, stored } = await this.db.txAs({ orgId, userId: null }, async (tx) => ({
      slug: await this.repo.orgSlug(tx, orgId),
      stored: await this.repo.getSettings(tx, orgId),
    }));
    const inPilot = isChatDigestPilot(slug);
    const available = inPilot && stored !== null;
    return {
      orgId,
      available,
      features: available ? mergeFeatures(stored.features) : noFeatures(),
      config: available ? mergeConfig(stored.config) : mergeConfig({}),
      rowVersion: available ? stored.rowVersion : null,
      storedConfig:
        available && stored.config && typeof stored.config === 'object'
          ? (stored.config as Partial<GrowthConfig>)
          : {},
    };
  }

  /** Loads and refuses: 403 outside the pilot, 422 when the named part is switched off. */
  async require(orgId: number, feature?: GrowthFeature): Promise<GrowthContext> {
    const ctx = await this.load(orgId);
    if (!ctx.available) {
      throw new AppError(
        ERROR_CODES.GRW_NOT_AVAILABLE,
        'The growth pilot is not available to this workspace.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (feature && !ctx.features[feature]) {
      throw new AppError(
        ERROR_CODES.GRW_FEATURE_OFF,
        'This part of the growth pilot is switched off for the workspace.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return ctx;
  }

  /** For a listener: the context if the part is on, else null (never throws, never touches another workspace). */
  async ifOn(orgId: number, feature: GrowthFeature): Promise<GrowthContext | null> {
    const ctx = await this.load(orgId);
    return ctx.available && ctx.features[feature] ? ctx : null;
  }

  /** The workspaces a sweeper loops over: in the pilot list, with this part on. */
  pilotOrgs(feature: GrowthFeature): Promise<number[]> {
    return this.db.privileged((tx) => this.repo.pilotOrgs(tx, CHAT_DIGEST_PILOT_SLUGS, feature));
  }
}
