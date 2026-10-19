import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { GetaPublishStep } from '@crm/contracts';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export interface SettingsRow {
  id: number;
  baseUrl: string | null;
  origin: string | null;
  authorizationEnc: string | null;
  getaHostEnc: string | null;
  chatbotRecordEnc: string | null;
  updatedAt: Date;
}

export type SyncStateColumn = 'idle' | 'pending' | 'live' | 'failed';

export interface SyncRow {
  id: number;
  flowId: number;
  publishVersion: number;
  state: SyncStateColumn;
  step: GetaPublishStep | null;
  failedStep: GetaPublishStep | null;
  lastError: string | null;
  attemptedAt: Date | null;
  botId: string | null;
  configurationUpdatedVersion: number;
  chatbotOverrideEnc: string | null;
}

/** What a save changes: `undefined` leaves a column alone, `null` clears it. */
export interface SettingsPatch {
  baseUrl?: string | null;
  origin?: string | null;
  authorizationEnc?: string | null;
  getaHostEnc?: string | null;
  chatbotRecordEnc?: string | null;
}

const toSettings = (r: Raw): SettingsRow => ({
  id: Number(r.id),
  baseUrl: str(r.base_url),
  origin: str(r.origin),
  authorizationEnc: str(r.authorization_enc),
  getaHostEnc: str(r.geta_host_enc),
  chatbotRecordEnc: str(r.chatbot_record_enc),
  updatedAt: new Date(r.updated_at as string),
});

const toSync = (r: Raw): SyncRow => ({
  id: Number(r.id),
  flowId: Number(r.flow_id),
  publishVersion: Number(r.publish_version),
  state: r.state as SyncStateColumn,
  step: (r.step as GetaPublishStep | null) ?? null,
  failedStep: (r.failed_step as GetaPublishStep | null) ?? null,
  lastError: str(r.last_error),
  attemptedAt: r.attempted_at ? new Date(r.attempted_at as string) : null,
  botId: str(r.bot_id),
  configurationUpdatedVersion: Number(r.configuration_updated_version),
  chatbotOverrideEnc: str(r.chatbot_override_enc),
});

/** Data access for the Geta publishing tables. Every query carries the org: RLS is the backstop, not the filter. */
@Injectable()
export class GetaPublishRepository {
  // --- workspace settings ----------------------------------------------------------------------------------------------

  async findSettings(tx: Tx, orgId: number): Promise<SettingsRow | null> {
    const res = await tx.execute(sql`
      SELECT id, base_url, origin, authorization_enc, geta_host_enc, chatbot_record_enc, updated_at
      FROM flb_geta_publish_settings WHERE org_id = ${orgId} LIMIT 1
    `);
    const row = res.rows[0] as Raw | undefined;
    return row ? toSettings(row) : null;
  }

  /** Inserts the row on the first save; later saves change only the columns the patch names. */
  async saveSettings(tx: Tx, orgId: number, patch: SettingsPatch): Promise<SettingsRow> {
    const has = (k: keyof SettingsPatch) => patch[k] !== undefined;
    const val = (v: string | null | undefined) => (v === undefined ? null : v);
    const res = await tx.execute(sql`
      INSERT INTO flb_geta_publish_settings
        (org_id, base_url, origin, authorization_enc, geta_host_enc, chatbot_record_enc)
      VALUES (${orgId}, ${val(patch.baseUrl)}, ${val(patch.origin)}, ${val(patch.authorizationEnc)},
              ${val(patch.getaHostEnc)}, ${val(patch.chatbotRecordEnc)})
      ON CONFLICT (org_id) DO UPDATE SET
        base_url = CASE WHEN ${has('baseUrl')} THEN EXCLUDED.base_url ELSE flb_geta_publish_settings.base_url END,
        origin = CASE WHEN ${has('origin')} THEN EXCLUDED.origin ELSE flb_geta_publish_settings.origin END,
        authorization_enc = CASE WHEN ${has('authorizationEnc')} THEN EXCLUDED.authorization_enc ELSE flb_geta_publish_settings.authorization_enc END,
        geta_host_enc = CASE WHEN ${has('getaHostEnc')} THEN EXCLUDED.geta_host_enc ELSE flb_geta_publish_settings.geta_host_enc END,
        chatbot_record_enc = CASE WHEN ${has('chatbotRecordEnc')} THEN EXCLUDED.chatbot_record_enc ELSE flb_geta_publish_settings.chatbot_record_enc END
      RETURNING id, base_url, origin, authorization_enc, geta_host_enc, chatbot_record_enc, updated_at
    `);
    return toSettings(res.rows[0] as Raw);
  }

  async deleteSettings(tx: Tx, orgId: number): Promise<number | null> {
    const res = await tx.execute(
      sql`DELETE FROM flb_geta_publish_settings WHERE org_id = ${orgId} RETURNING id`,
    );
    const row = res.rows[0] as Raw | undefined;
    return row ? Number(row.id) : null;
  }

  // --- per-flow sync ---------------------------------------------------------------------------------------------------

  async findSync(tx: Tx, orgId: number, flowId: number, lock = false): Promise<SyncRow | null> {
    const res = await tx.execute(sql`
      SELECT id, flow_id, publish_version, state, step, failed_step, last_error, attempted_at, bot_id,
             configuration_updated_version, chatbot_override_enc
      FROM flb_geta_publish_syncs WHERE org_id = ${orgId} AND flow_id = ${flowId}
      ${lock ? sql`FOR UPDATE` : sql``}
    `);
    const row = res.rows[0] as Raw | undefined;
    return row ? toSync(row) : null;
  }

  /**
   * A new publish of the flow: the version goes up by one and the row starts over (`pending` to be pushed, or `idle` when the
   * workspace has nothing to push with). The per-flow record is kept.
   */
  async beginPublish(
    tx: Tx,
    orgId: number,
    flowId: number,
    state: 'pending' | 'idle',
  ): Promise<SyncRow> {
    const res = await tx.execute(sql`
      INSERT INTO flb_geta_publish_syncs (org_id, flow_id, publish_version, state, step)
      VALUES (${orgId}, ${flowId}, 1, ${state}, ${state === 'pending' ? 'configuration_update' : null})
      ON CONFLICT (org_id, flow_id) DO UPDATE SET
        publish_version = flb_geta_publish_syncs.publish_version + 1,
        state = EXCLUDED.state, step = EXCLUDED.step, failed_step = NULL, last_error = NULL,
        attempted_at = NULL, bot_id = NULL
      RETURNING id, flow_id, publish_version, state, step, failed_step, last_error, attempted_at, bot_id,
                configuration_updated_version, chatbot_override_enc
    `);
    return toSync(res.rows[0] as Raw);
  }

  /** Retry of a failed push: same version, back to `pending`, at the step that failed. */
  async resume(tx: Tx, orgId: number, syncId: number, step: GetaPublishStep): Promise<void> {
    await tx.execute(sql`
      UPDATE flb_geta_publish_syncs SET state = 'pending', step = ${step}, last_error = NULL, attempted_at = NULL
      WHERE org_id = ${orgId} AND id = ${syncId}
    `);
  }

  /** The worker took the push on: records the step, the bot id and the time. Only for the version it was asked about. */
  async markRunning(
    tx: Tx,
    orgId: number,
    syncId: number,
    version: number,
    step: GetaPublishStep,
    botId: string,
  ): Promise<boolean> {
    return this.touch(
      tx,
      sql`UPDATE flb_geta_publish_syncs SET step = ${step}, bot_id = ${botId}, attempted_at = now()
          WHERE org_id = ${orgId} AND id = ${syncId} AND publish_version = ${version} AND state = 'pending'`,
    );
  }

  async markConfigurationDone(
    tx: Tx,
    orgId: number,
    syncId: number,
    version: number,
  ): Promise<boolean> {
    return this.touch(
      tx,
      sql`UPDATE flb_geta_publish_syncs SET configuration_updated_version = ${version}, step = 'publish_bot'
          WHERE org_id = ${orgId} AND id = ${syncId} AND publish_version = ${version} AND state = 'pending'`,
    );
  }

  async markLive(tx: Tx, orgId: number, syncId: number, version: number): Promise<boolean> {
    return this.touch(
      tx,
      sql`UPDATE flb_geta_publish_syncs SET state = 'live', step = 'publish_bot', failed_step = NULL, last_error = NULL
          WHERE org_id = ${orgId} AND id = ${syncId} AND publish_version = ${version} AND state = 'pending'`,
    );
  }

  async markFailed(
    tx: Tx,
    orgId: number,
    syncId: number,
    version: number,
    step: GetaPublishStep,
    message: string,
  ): Promise<boolean> {
    return this.touch(
      tx,
      sql`UPDATE flb_geta_publish_syncs SET state = 'failed', step = ${step}, failed_step = ${step}, last_error = ${message}
          WHERE org_id = ${orgId} AND id = ${syncId} AND publish_version = ${version} AND state = 'pending'`,
    );
  }

  /** Sets or clears the per-flow record; creates an `idle` row when the flow has none yet. */
  async setOverride(tx: Tx, orgId: number, flowId: number, sealed: string | null): Promise<void> {
    await tx.execute(sql`
      INSERT INTO flb_geta_publish_syncs (org_id, flow_id, chatbot_override_enc)
      VALUES (${orgId}, ${flowId}, ${sealed})
      ON CONFLICT (org_id, flow_id) DO UPDATE SET chatbot_override_enc = EXCLUDED.chatbot_override_enc
    `);
  }

  private async touch(tx: Tx, statement: ReturnType<typeof sql>): Promise<boolean> {
    const res = await tx.execute(sql`${statement} RETURNING id`);
    return res.rows.length > 0;
  }
}
