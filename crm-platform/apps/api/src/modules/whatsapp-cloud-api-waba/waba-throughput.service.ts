import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  WABA_THROUGHPUT_SETTINGS_DEFAULTS,
  updateWabaThroughputSettingsSchema,
  wabaThroughputSettingsSchema,
  type UpdateWabaNumberControlInput,
  type UpdateWabaThroughputSettingsInput,
  type WabaNumberThroughput,
  type WabaNumberThroughputDetail,
  type WabaThroughputOverview,
  type WabaThroughputSettings,
  type WabaThroughputSettingsResponse,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  WABA_ADMIN,
  type WabaAdminPort,
} from '../../infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import {
  ThroughputStore,
  type NumberLive,
} from '../../infra/providers/whatsapp-cloud-api-waba/throughput/throughput-store';
import {
  parseThroughput,
  throughputChanged,
} from '../../infra/providers/whatsapp-cloud-api-waba/throughput/throughput-rules';
import { AuthAuditService, PlatformSettingsService, PlatformStore } from '../auth';
import { WabaConnectionsRepository } from './waba-connections.repository';
import { WabaConnectService, authFor } from './waba-connect.service';
import {
  SEND_LIMITS_KEY,
  limitsOf,
  numberView,
  phoneNumberIdOf,
  publishedOf,
  syncDue,
  syncPatch,
  totalsOf,
  type NumberRow,
} from './waba-throughput-rules';
import {
  translateConnectError,
  WabaApiError,
} from '../../infra/providers/whatsapp-cloud-api-waba/waba-errors';

/** Platform settings key of the send-limit settings document (`_rv` is its row version). */
export const WABA_THROUGHPUT_KEY = 'waba.throughput';

type SettingsDoc = Partial<WabaThroughputSettings> & { _rv?: number; _at?: string };

interface RawRow {
  org_id: number | string;
  id: number | string;
  uuid: string;
  status: string;
  phone_number: string | null;
  display_label: string | null;
  meta_json: Record<string, unknown> | null;
  row_version: number | string;
  org_name: string;
}

/** Rows shown in the console list, and rows republished to Redis (every number must be enforced, shown or not). */
const LIST_LIMIT = 1000;
const PUBLISH_LIMIT = 50_000;

const COLUMNS = sql.raw(
  'c.org_id, c.id, c.uuid, c.status, c.phone_number, c.display_label, c.meta_json, c.row_version, o.name AS org_name',
);
const LISTED = sql.raw(
  `c.provider = 'waba' AND c.status <> 'disconnected' AND c.meta_json ->> 'phone_number_id' IS NOT NULL`,
);

const toNumberRow = (r: RawRow): NumberRow => ({
  orgId: Number(r.org_id),
  uuid: r.uuid,
  status: r.status,
  phone_number: r.phone_number,
  display_label: r.display_label,
  meta_json: r.meta_json,
  row_version: Number(r.row_version),
  workspace: r.org_name,
});

/** Each tick re-reads at most this many numbers from Meta, so one slow tick cannot run into the next. */
const SYNC_BATCH = 200;
const SYNC_CONCURRENCY = 4;

/**
 * The control plane of WhatsApp send limits (super admin). It owns what the send governor only reads:
 *
 *   settings   the platform-wide switches (`platform_settings`, row-versioned), published to Redis on every save;
 *   numbers    each connected number's throughput and messaging tier, re-read from Meta on a schedule and on Meta's own webhook,
 *              plus the operator's override and pause (`meta_json.send_limits`), published to Redis so a send never waits on Postgres;
 *   console    the overview and detail the super admin page polls, joining the stored numbers with the live counters.
 *
 * Postgres is the source of truth and Redis the hot copy: a flushed Redis is refilled by the next sync tick, and until then the governor
 * paces with the platform default rather than not at all.
 */
@Injectable()
export class WabaThroughputService {
  private readonly logger = new Logger(WabaThroughputService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly platform: PlatformStore,
    private readonly settingsStore: PlatformSettingsService,
    private readonly audit: AuthAuditService,
    private readonly connect: WabaConnectService,
    private readonly repo: WabaConnectionsRepository,
    private readonly store: ThroughputStore,
    @Inject(WABA_ADMIN) private readonly admin: WabaAdminPort,
  ) {}

  // --- settings --------------------------------------------------------------------------------------------------------------

  private valuesOf(doc: SettingsDoc | undefined): WabaThroughputSettings {
    const parsed = wabaThroughputSettingsSchema.safeParse({
      ...WABA_THROUGHPUT_SETTINGS_DEFAULTS,
      ...doc,
    });
    // A stored document that no longer fits the limits must not take the page or the sends down.
    return parsed.success ? parsed.data : { ...WABA_THROUGHPUT_SETTINGS_DEFAULTS };
  }

  async settings(): Promise<WabaThroughputSettingsResponse> {
    this.settingsStore.invalidate();
    const doc = await this.settingsStore.get<SettingsDoc>(WABA_THROUGHPUT_KEY);
    return { ...this.valuesOf(doc), rowVersion: doc?._rv ?? 0 };
  }

  async updateSettings(
    input: UpdateWabaThroughputSettingsInput,
    operatorId: number,
  ): Promise<WabaThroughputSettingsResponse> {
    const { rowVersion, ...next } = updateWabaThroughputSettingsSchema.parse(input);
    await this.settingsStore.inTx(async (tx) => {
      const found = await tx.execute(
        sql`SELECT value FROM platform_settings WHERE key = ${WABA_THROUGHPUT_KEY} FOR UPDATE`,
      );
      const current = (found.rows[0] as { value: SettingsDoc } | undefined)?.value;
      const version = current?._rv ?? 0;
      if (version !== rowVersion) throw AppError.rowVersionConflict('WhatsApp send limits');

      const before = this.valuesOf(current);
      const doc: SettingsDoc = { ...next, _rv: version + 1, _at: new Date().toISOString() };
      const json = JSON.stringify(doc);
      if (current) {
        await tx.execute(sql`
          UPDATE platform_settings
             SET value = ${json}::jsonb, updated_by = ${operatorId}, updated_at = now()
           WHERE key = ${WABA_THROUGHPUT_KEY}`);
      } else {
        const ins = await tx.execute(sql`
          INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
          VALUES (${WABA_THROUGHPUT_KEY}, ${json}::jsonb, false, ${operatorId}, now())
          ON CONFLICT (key) DO NOTHING
          RETURNING key`);
        if (ins.rows.length === 0) throw AppError.rowVersionConflict('WhatsApp send limits');
      }
      await this.audit.record(tx, {
        event: 'platform.waba_throughput_settings_updated',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: {
          fields: (Object.keys(next) as Array<keyof WabaThroughputSettings>).filter(
            (k) => next[k] !== before[k],
          ),
          rowVersion: version + 1,
        },
      });
    });
    const saved = await this.settings();
    // Every number's paced rate depends on the margin and the default, so all of them are republished.
    await this.publishAll(saved).catch((err) =>
      this.logger.warn({ err: String(err) }, 'republish failed'),
    );
    return saved;
  }

  // --- the console -----------------------------------------------------------------------------------------------------------

  async overview(search?: string): Promise<WabaThroughputOverview> {
    const settings = await this.settings();
    const rows = await this.rows(search);
    const ids = rows.map((r) => phoneNumberIdOf(r.meta_json)).filter((x): x is string => !!x);
    let liveAvailable = true;
    let live = new Map<string, NumberLive>();
    let tierUsed = new Map<string, number>();
    try {
      [live, tierUsed] = await Promise.all([this.store.live(ids), this.store.tierUsedMany(ids)]);
    } catch (err) {
      liveAvailable = false;
      this.logger.warn({ err: String(err) }, 'live counters unreadable');
    }
    const numbers = rows.map((r) => {
      const pn = phoneNumberIdOf(r.meta_json) ?? '';
      return numberView(r, settings, live.get(pn), tierUsed.get(pn) ?? 0);
    });
    return {
      settings,
      totals: totalsOf(numbers),
      numbers,
      liveAvailable,
      generatedAt: new Date().toISOString(),
    };
  }

  async detail(uuid: string): Promise<WabaNumberThroughputDetail> {
    const settings = await this.settings();
    const row = await this.rowByUuid(uuid);
    const pn = phoneNumberIdOf(row.meta_json) ?? '';
    let liveAvailable = true;
    let number: WabaNumberThroughput;
    let series: Awaited<ReturnType<ThroughputStore['series']>> = { perSecond: [], perMinute: [] };
    let events: Awaited<ReturnType<ThroughputStore['events']>> = [];
    try {
      const [live, tier, s, e] = await Promise.all([
        this.store.live([pn]),
        this.store.tierUsed(pn),
        this.store.series(pn),
        this.store.events(pn),
      ]);
      number = numberView(row, settings, live.get(pn), tier);
      series = s;
      events = e;
    } catch (err) {
      liveAvailable = false;
      this.logger.warn({ err: String(err) }, 'live counters unreadable');
      number = numberView(row, settings, undefined, 0);
    }
    return {
      number,
      perSecond: series.perSecond,
      perMinute: series.perMinute,
      events,
      liveAvailable,
      generatedAt: new Date().toISOString(),
    };
  }

  // --- operator actions ------------------------------------------------------------------------------------------------------

  /** Sets or clears a number's rate override and pauses or resumes its sends. Takes effect on the next send of every worker. */
  async updateControl(
    uuid: string,
    input: UpdateWabaNumberControlInput,
    operatorId: number,
  ): Promise<WabaNumberThroughput> {
    const before = await this.rowByUuid(uuid);
    const orgId = await this.orgIdOf(uuid);
    const prior = (before.meta_json?.[SEND_LIMITS_KEY] ?? {}) as Record<string, unknown>;
    const now = new Date().toISOString();
    const limits = {
      override_mps: input.overrideMps,
      paused: input.paused,
      pause_reason: input.paused ? input.pauseReason?.trim() || null : null,
      updated_at: now,
      updated_by: operatorId,
    };
    await this.db.txAs({ orgId }, async (tx) => {
      const res = await tx.execute(sql`
        UPDATE wa_provider_configs
           SET meta_json = coalesce(meta_json, '{}'::jsonb) || jsonb_build_object(${SEND_LIMITS_KEY}::text, ${JSON.stringify(limits)}::jsonb)
         WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid AND row_version = ${input.rowVersion}
         RETURNING id`);
      if (res.rows.length === 0) throw AppError.rowVersionConflict('WhatsApp number');
      await this.audit.record(tx, {
        event: 'platform.waba_send_limits_updated',
        orgId,
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: {
          connectionUuid: uuid,
          overrideMps: input.overrideMps,
          paused: input.paused,
          reason: limits.pause_reason,
        },
      });
    });
    const settings = await this.settings();
    const row = await this.rowByUuid(uuid);
    const pn = phoneNumberIdOf(row.meta_json);
    if (pn) {
      await this.store.publishNumber(pn, publishedOf(row.meta_json, settings));
      await this.logControlChange(pn, prior, input);
    }
    return numberView(row, settings, undefined, 0);
  }

  /** Re-reads one number's throughput and tier from Meta now ("Refresh from Meta"). */
  async refresh(uuid: string): Promise<WabaNumberThroughput> {
    const orgId = await this.orgIdOf(uuid);
    await this.syncNumber(orgId, uuid, { force: true, throwOnError: true });
    const settings = await this.settings();
    const row = await this.rowByUuid(uuid);
    const pn = phoneNumberIdOf(row.meta_json) ?? '';
    const [live, tier] = await Promise.all([
      this.store.live([pn]).catch(() => new Map()),
      this.store.tierUsed(pn).catch(() => 0),
    ]);
    return numberView(row, settings, live.get(pn), tier);
  }

  // --- reading Meta and publishing ----------------------------------------------------------------------------------------------

  /**
   * Reads a number's throughput, messaging tier, quality and platform type from Meta, stores them on the number and publishes the new
   * limits. A failed read is stored on the number (`throughput_sync_error`) and does not touch the limits already published.
   */
  async syncNumber(
    orgId: number,
    uuid: string,
    opts: { force?: boolean; throwOnError?: boolean } = {},
  ): Promise<void> {
    const resolved = await this.db.txAs({ orgId }, (tx) =>
      this.connect.resolveConnection(tx, orgId, { uuid }),
    );
    if (!resolved || !resolved.conn || !resolved.phoneNumberId) return;
    const settings = await this.settings();
    const before = parseThroughput(
      (await this.rowByUuid(uuid).catch(() => null))?.meta_json?.throughput,
    );
    try {
      const phone = await this.admin.getPhone(authFor(resolved.conn), resolved.phoneNumberId);
      const patch = syncPatch(phone, new Date());
      const next = await this.db.txAs({ orgId }, (tx) =>
        this.repo.update(tx, orgId, resolved.id, { metaPatch: patch }),
      );
      const after = parseThroughput(phone.throughput);
      const pn = resolved.phoneNumberId;
      if (next) await this.store.publishNumber(pn, publishedOf(next.meta_json, settings));
      if (throughputChanged(before, after)) {
        await this.store.pushEvent(
          pn,
          'throughput_upgraded',
          `${before.level ?? 'unknown'} -> ${after.level ?? 'unknown'}${after.mps ? ` (${after.mps}/s)` : ''}`,
        );
      }
    } catch (e) {
      const message =
        e instanceof WabaApiError
          ? translateConnectError(e)
          : e instanceof Error
            ? e.message
            : String(e);
      await this.db
        .txAs({ orgId }, (tx) =>
          this.repo.update(tx, orgId, resolved.id, {
            metaPatch: {
              throughput_synced_at: new Date().toISOString(),
              throughput_sync_error: message.slice(0, 300),
            },
          }),
        )
        .catch(() => undefined);
      if (opts.throwOnError) {
        throw new AppError(
          ERROR_CODES.WABA_PROVIDER_UNAVAILABLE,
          `Meta did not return the throughput: ${message}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      this.logger.warn({ orgId, uuid, err: message }, 'throughput sync failed');
    }
  }

  /** Meta's own news about a number (a quality or tier change, THROUGHPUT_UPGRADE): re-read it at once, without holding the webhook. */
  async onNumberEvent(orgId: number, configId: number, event: string | null): Promise<void> {
    try {
      const uuid = await this.db.txAs({ orgId }, async (tx) => {
        const row = await this.repo.findById(tx, orgId, configId);
        return row?.uuid ?? null;
      });
      if (!uuid) return;
      await this.syncNumber(orgId, uuid, { force: true });
      const row = await this.rowByUuid(uuid);
      const pn = phoneNumberIdOf(row.meta_json);
      if (pn && event) await this.store.pushEvent(pn, 'synced', `Meta event ${event}`);
    } catch (err) {
      this.logger.warn({ orgId, configId, err: String(err) }, 'could not apply the number event');
    }
  }

  /** One pass of the scheduler: republish every number's limits, and re-read the ones whose reading is older than the interval. */
  async tick(now = new Date()): Promise<{ published: number; synced: number }> {
    if (!(await this.store.tryLock(4 * 60_000))) return { published: 0, synced: 0 };
    const settings = await this.settings();
    await this.store.publishGlobal(settings);
    const rows = await this.rows(undefined, PUBLISH_LIMIT);
    const published = await this.publishRows(rows, settings);
    const due = rows
      .filter((r) => syncDue(r.meta_json, settings.syncIntervalMinutes, now))
      .slice(0, SYNC_BATCH);
    let synced = 0;
    for (let i = 0; i < due.length; i += SYNC_CONCURRENCY) {
      await Promise.all(
        due.slice(i, i + SYNC_CONCURRENCY).map(async (r) => {
          try {
            await this.syncNumber(r.orgId, r.uuid);
            synced++;
          } catch (err) {
            this.logger.warn(
              { orgId: r.orgId, uuid: r.uuid, err: String(err) },
              'throughput sync failed',
            );
          }
        }),
      );
    }
    return { published, synced };
  }

  private async publishAll(settings: WabaThroughputSettings): Promise<void> {
    await this.store.publishGlobal(settings);
    await this.publishRows(await this.rows(undefined, PUBLISH_LIMIT), settings);
  }

  /**
   * Publish every number's limits. One phone number id can sit on two rows (a reconnect in another workspace); the safer row wins:
   * a paused one is never overwritten by an unpaused one.
   */
  private async publishRows(rows: NumberRow[], settings: WabaThroughputSettings): Promise<number> {
    const byNumber = new Map<string, NumberRow>();
    for (const r of rows) {
      const pn = phoneNumberIdOf(r.meta_json);
      if (!pn) continue;
      const seen = byNumber.get(pn);
      if (!seen || (!limitsOf(seen.meta_json).paused && limitsOf(r.meta_json).paused))
        byNumber.set(pn, r);
    }
    for (const [pn, r] of byNumber)
      await this.store.publishNumber(pn, publishedOf(r.meta_json, settings));
    return byNumber.size;
  }

  private async logControlChange(
    pn: string,
    prior: Record<string, unknown>,
    input: UpdateWabaNumberControlInput,
  ): Promise<void> {
    const wasPaused = prior.paused === true;
    if (input.paused !== wasPaused) {
      await this.store.pushEvent(
        pn,
        input.paused ? 'paused' : 'resumed',
        input.paused ? input.pauseReason?.trim() || null : null,
      );
    }
    const was = typeof prior.override_mps === 'number' ? prior.override_mps : null;
    if (input.overrideMps !== was) {
      await this.store.pushEvent(
        pn,
        input.overrideMps === null ? 'override_cleared' : 'override_set',
        input.overrideMps === null ? null : `${input.overrideMps} messages per second`,
      );
    }
  }

  // --- reads across workspaces (operator only) ------------------------------------------------------------------------------------

  private async rows(search?: string, limit = LIST_LIMIT): Promise<NumberRow[]> {
    const q = search?.trim();
    const like = q ? `%${q.replace(/[%_\\]/g, '\\$&')}%` : null;
    const res = await this.platform.tx((tx) =>
      tx.execute(sql`
        SELECT ${COLUMNS}
          FROM wa_provider_configs c
          JOIN organizations o ON o.id = c.org_id
         WHERE ${LISTED}
           ${like ? sql`AND (o.name ILIKE ${like} OR c.phone_number ILIKE ${like} OR c.display_label ILIKE ${like} OR c.meta_json ->> 'phone_number_id' ILIKE ${like})` : sql``}
         ORDER BY o.name, c.id
         LIMIT ${limit}`),
    );
    return (res.rows as unknown as RawRow[]).map(toNumberRow);
  }

  private async rowByUuid(uuid: string): Promise<NumberRow> {
    const res = await this.platform.tx((tx) =>
      tx.execute(sql`
        SELECT ${COLUMNS}
          FROM wa_provider_configs c
          JOIN organizations o ON o.id = c.org_id
         WHERE c.provider = 'waba' AND c.uuid = ${uuid}::uuid`),
    );
    const r = (res.rows as unknown as RawRow[])[0];
    if (!r) throw AppError.notFound('WhatsApp number', uuid);
    return toNumberRow(r);
  }

  private async orgIdOf(uuid: string): Promise<number> {
    return (await this.rowByUuid(uuid)).orgId;
  }
}
