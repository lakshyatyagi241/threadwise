import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  PLAN_UPGRADE_PATH,
  TEAM_LANGUAGE_CODES,
  type TranslationSettings,
  type UpdateTranslationSettingsRequest,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { PlanEntitlementService, type Entitlements } from '../plans-subscriptions-trials';
import { ProviderRouterService } from './provider-router.service';
import { TranslationUsageService } from './translation-usage.service';

/** The plan feature that unlocks translation. WaDesk: `packages.access_translation` (Pro and Enterprise). */
export const TRANSLATION_FEATURE = 'translation';

interface SettingsRow {
  id: number | string;
  default_language: string | null;
  inbox_translate: boolean;
  data_residency: string;
  row_version: number;
}

/**
 * Shim for the plan gate. The PLAN domain's feature registry has no `translation` key yet, so
 * `PlanEntitlementService.featureEnabled` cannot be asked. This applies the same resolution order to the same stored
 * data (platform-owned, then the organization's override, then the plan's flag, an unknown plan locks nothing) and
 * reads the flag as `features.translation`. When PLAN registers the key, replace this with
 * `entitlements.featureEnabled(orgId, 'translation')` and delete the function.
 */
export function translationAllowed(e: Entitlements | null): boolean {
  if (!e) return false;
  if (e.platformOwned) return true;
  const override = e.overrides.features?.[TRANSLATION_FEATURE];
  if (typeof override === 'boolean') return override;
  if (!e.planKnown) return true;
  return e.planFeatures[TRANSLATION_FEATURE] === true;
}

/**
 * Account > Translation (WD-I18N-035): the team language, the auto-translate switch, the engine in use and this
 * month's volume. The two settings live in the workspace's settings row, which the WSP domain owns; this service
 * reads and writes only those columns.
 */
@Injectable()
export class TranslationSettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly plans: PlanEntitlementService,
    private readonly usage: TranslationUsageService,
    private readonly router: ProviderRouterService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Whether the workspace's plan includes translation. */
  async planAllows(orgId: number): Promise<boolean> {
    return translationAllowed(await this.plans.forOrg(orgId));
  }

  private async assertPlan(orgId: number): Promise<void> {
    if (await this.planAllows(orgId)) return;
    throw new AppError(
      ERROR_CODES.PLAN_FEATURE_LOCKED,
      "Real-time translation isn't available on your current plan. Upgrade to unlock it.",
      HttpStatus.UNPROCESSABLE_ENTITY,
      [
        { path: 'feature', message: TRANSLATION_FEATURE },
        { path: 'reason', message: 'feature_disabled' },
        { path: 'upgradeUrl', message: PLAN_UPGRADE_PATH },
      ],
    );
  }

  private async readRow(orgId: number): Promise<SettingsRow | undefined> {
    const res = await this.db.tx((tx) =>
      tx.execute(sql`
        SELECT id, default_language, inbox_translate, data_residency, row_version
        FROM workspace_settings WHERE org_id = ${orgId}
      `),
    );
    return res.rows[0] as unknown as SettingsRow | undefined;
  }

  async get(): Promise<TranslationSettings> {
    const { orgId } = RequestContextStore.require();
    const [planAllows, row, usage] = await Promise.all([
      this.planAllows(orgId),
      this.readRow(orgId),
      this.usage.monthToDate(orgId),
    ]);
    const residency =
      row?.data_residency === 'eu_only' || row?.data_residency === 'local'
        ? row.data_residency
        : 'any';
    const engineName = planAllows
      ? await this.router.engineName(await this.router.policy({ orgId }))
      : null;
    return {
      planAllows,
      enabled: row?.inbox_translate ?? true,
      teamLanguage: row?.default_language ?? 'en',
      teamLanguageOptions: [...TEAM_LANGUAGE_CODES],
      engineName,
      residency,
      usageThisMonth: usage,
      rowVersion: row?.row_version ?? 0,
    };
  }

  async update(body: UpdateTranslationSettingsRequest): Promise<TranslationSettings> {
    const { orgId } = RequestContextStore.require();
    await this.assertPlan(orgId);

    await this.db.tx(async (tx) => {
      const current = (
        await tx.execute(sql`
          SELECT id, default_language, inbox_translate, row_version
          FROM workspace_settings WHERE org_id = ${orgId} FOR UPDATE
        `)
      ).rows[0] as unknown as SettingsRow | undefined;

      if ((current?.row_version ?? 0) !== body.rowVersion) {
        throw AppError.rowVersionConflict('Translation settings');
      }
      const before = {
        teamLanguage: current?.default_language ?? 'en',
        enabled: current?.inbox_translate ?? true,
      };
      const after = {
        teamLanguage: body.teamLanguage ?? before.teamLanguage,
        enabled: body.enabled ?? before.enabled,
      };

      let recordId: number;
      if (current) {
        await tx.execute(sql`
          UPDATE workspace_settings
          SET default_language = ${after.teamLanguage}, inbox_translate = ${after.enabled}
          WHERE org_id = ${orgId}
        `);
        recordId = Number(current.id);
      } else {
        // A workspace that never saved its settings has no row yet; every other column has a default.
        const inserted = await tx.execute(sql`
          INSERT INTO workspace_settings (org_id, default_language, inbox_translate)
          VALUES (${orgId}, ${after.teamLanguage}, ${after.enabled})
          ON CONFLICT (org_id) DO NOTHING RETURNING id
        `);
        // Another request created the row between our read and this insert: our version (0) is stale.
        if (inserted.rows.length === 0) throw AppError.rowVersionConflict('Translation settings');
        recordId = Number((inserted.rows[0] as { id: number | string }).id);
      }

      const delta: Record<string, { old: unknown; new: unknown }> = {};
      if (before.teamLanguage !== after.teamLanguage) {
        delta.teamLanguage = { old: before.teamLanguage, new: after.teamLanguage };
      }
      if (before.enabled !== after.enabled) {
        delta.enabled = { old: before.enabled, new: after.enabled };
      }
      await this.audit.record(tx, {
        module: 'translation_settings',
        recordId,
        action: current ? 'update' : 'insert',
        delta,
      });
      await this.outbox.emit(tx, {
        aggregateModule: 'translation_settings',
        aggregateId: recordId,
        eventType: 'translation_settings.updated',
        payload: after,
      });
    });
    return this.get();
  }
}
