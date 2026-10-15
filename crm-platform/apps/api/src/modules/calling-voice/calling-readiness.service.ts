import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import {
  type CallingCheckSource,
  type CallingMetaReason,
  type CallingReadiness,
  type CallingReadinessList,
  type CallingSettings,
  type UpdateCallingSettingsInput,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { WABA_ENV, type WabaEnv } from '../../config/domains/whatsapp-cloud-api-waba.env';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { CALLING_GRAPH, type CallingGraph } from '../../infra/providers/calling-voice';
import {
  WABA_ADMIN,
  authOf,
  type TokenInspection,
  type WabaAdminPort,
  type WabaConnection,
} from '../../infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import { WabaApiError } from '../../infra/providers/whatsapp-cloud-api-waba/waba-errors';
import { AuditService } from '../../kernel/audit/audit.service';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { WabaConnectService, WabaDiagnosticsService } from '../whatsapp-cloud-api-waba';
import { CallRecordingSettingsService } from './call-recording-settings.service';
import { metaReason } from './calling-meta-errors';
import { CallingReadinessRepository, type ReadinessRow } from './calling-readiness.repository';
import {
  buildChecks,
  deriveStatus,
  nextCheckAt,
  readyForAutoEnable,
  type CallsFieldFacts,
  type PhoneFacts,
  type ReadinessFacts,
  type TokenFacts,
} from './calling-readiness.rules';
import { CallsRepository, type NumberRow } from './calls.repository';
import { caller, notFound, parseIceServersEnv } from './calling-support';

const MODULE = 'wa_provider_configs';
const SETTINGS_MODULE = 'wa_calling_settings';
/** A plan that lacks calling is looked at rarely: the plan can change, nothing else will. */
const PLAN_MISSING_RECHECK_MS = 24 * 3_600_000;
/** A page opening asks for a check by itself; two openings within this window share one look at Meta. A person's own click always looks. */
const HEALTH_CHECK_THROTTLE_MS = 60_000;
/** Meta replaces the app's whole field list on a write: one writer at a time, across every worker. */
const CALLS_FIELD_LOCK = 'calling:calls-field-write';
const CALLS_FIELD_LOCK_SECONDS = 60;
/** Compare-and-delete: a worker whose lock expired must not delete the lock another worker took since. */
const RELEASE_LOCK = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`;
/** Minutes to the next look after a check that could not read Meta while an automatic switch-on is pending (then the normal rhythm). */
const RETRY_BACKOFF_MINUTES: readonly number[] = [1, 5, 15];

const toDto = (
  r: ReadinessRow,
  over: Partial<Pick<CallingReadiness, 'callingEnabled' | 'checks'>> = {},
): CallingReadiness => ({
  numberId: r.numberUuid,
  phoneNumber: r.phoneNumber,
  displayLabel: r.displayLabel,
  connectionStatus: r.connectionStatus,
  status: r.status,
  callingEnabled: over.callingEnabled ?? r.callingEnabled,
  metaCallingStatus: r.metaStatus,
  checks: over.checks ?? r.checks,
  checkedAt: r.checkedAt?.toISOString() ?? null,
  source: r.source,
});

/**
 * The readiness of each WhatsApp number for calling (EXT-CALL-007 to 010): what stands between "connected" and "calls can be placed and
 * answered", as a checklist of codes. A check reads Meta (phone, token, subscription, calling settings), looks at the workspace
 * (plan, people who may call, recording rules) and the platform (TURN), keeps the result, and brings the local switch in line with
 * what Meta says. It runs when a number is connected, when a person asks, when the health page opens, and on a schedule.
 *
 * Never silent: a number is switched on by itself only after a connect, only when the plan has `waba_calling`, only when the
 * workspace's admin turned `autoEnableOnConnect` on, and only when nothing else blocks it; every such change is audited.
 */
@Injectable()
export class CallingReadinessService {
  private readonly logger = new Logger(CallingReadinessService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly calls: CallsRepository,
    private readonly repo: CallingReadinessRepository,
    private readonly waba: WabaConnectService,
    private readonly diagnostics: WabaDiagnosticsService,
    private readonly plans: PlanEntitlementService,
    private readonly audit: AuditService,
    private readonly recording: CallRecordingSettingsService,
    private readonly config: ConfigService,
    @Inject(WABA_ENV) private readonly env: WabaEnv,
    @Inject(WABA_ADMIN) private readonly admin: WabaAdminPort,
    @Inject(CALLING_GRAPH) private readonly graph: CallingGraph,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // --- reading -------------------------------------------------------------------------------------------------------------------

  async list(): Promise<CallingReadinessList> {
    const { orgId } = caller();
    const rows = await this.db.tx((tx) => this.repo.list(tx, orgId));
    return { rows: rows.map((r) => toDto(r)) };
  }

  async get(numberUuid: string): Promise<CallingReadiness> {
    const { orgId } = caller();
    const row = await this.db.tx((tx) => this.repo.byUuid(tx, orgId, numberUuid));
    if (!row) throw notFound('CALL_NUMBER_NOT_FOUND', 'Number');
    return toDto(row);
  }

  // --- the setting ---------------------------------------------------------------------------------------------------------------

  async settings(): Promise<CallingSettings> {
    const { orgId } = caller();
    const row = await this.db.tx((tx) => this.repo.settings(tx, orgId));
    return {
      autoEnableOnConnect: row?.autoEnableOnConnect ?? false,
      rowVersion: row?.rowVersion ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  async updateSettings(input: UpdateCallingSettingsInput): Promise<CallingSettings> {
    const { orgId, userId } = caller();
    // Turning it off is always allowed: a workspace that lost the plan must still be able to withdraw its say-so.
    if (input.autoEnableOnConnect) await this.plans.assertFeature(orgId, 'waba_calling');
    await this.db.tx(async (tx) => {
      const before = await this.repo.settings(tx, orgId);
      if ((before === null) !== (input.rowVersion === undefined)) {
        throw AppError.rowVersionConflict('Calling settings');
      }
      const after = before
        ? await this.repo.updateSettings(
            tx,
            orgId,
            input.autoEnableOnConnect,
            userId,
            input.rowVersion!,
          )
        : await this.repo.insertSettings(tx, orgId, input.autoEnableOnConnect, userId);
      if (!after) throw AppError.rowVersionConflict('Calling settings');
      await this.audit.record(tx, {
        module: SETTINGS_MODULE,
        recordId: orgId,
        action: before ? 'update' : 'insert',
        delta: {
          auto_enable_on_connect: {
            old: before?.autoEnableOnConnect ?? false,
            new: after.autoEnableOnConnect,
          },
        },
      });
    });
    return this.settings();
  }

  // --- checking ------------------------------------------------------------------------------------------------------------------

  /**
   * Looks at one number now (Meta included) and keeps the result. For a request (`call.calling.manage`) or, with a request context
   * made for the job, the worker. `autoEnable` is only ever true for the check that follows a connect: it marks the number's automatic
   * switch-on as PENDING, and every later check (the schedule's, a person's) keeps trying while it is pending, so a Meta that was not
   * readable yet, a blocker that gets fixed, or a refusal does not make it a one-shot. `repair` (adding the `calls` field to the
   * platform's Meta app) is only ever true in the worker: a request can read the subscription, never rewrite it.
   */
  async check(
    numberUuid: string,
    source: CallingCheckSource,
    opts: { autoEnable?: boolean; repair?: boolean } = {},
  ): Promise<CallingReadiness> {
    const { orgId } = caller();
    const last = await this.db.tx((tx) => this.repo.byUuid(tx, orgId, numberUuid));
    if (!last) throw notFound('CALL_NUMBER_NOT_FOUND', 'Number');
    if (
      source === 'health' &&
      last.checkedAt &&
      Date.now() - last.checkedAt.getTime() < HEALTH_CHECK_THROTTLE_MS
    ) {
      return toDto(last);
    }
    const planEnabled = await this.plans.featureEnabled(orgId, 'waba_calling');

    const loaded = await this.db.tx(async (tx) => {
      const number = await this.calls.numberByUuid(tx, orgId, numberUuid);
      if (!number) throw notFound('CALL_NUMBER_NOT_FOUND', 'Number');
      return {
        number,
        // The database's clock at the start: a switch written after this moment is somebody else's and is not overwritten.
        startedAt: await this.repo.dbNow(tx),
        diallers: await this.repo.diallers(tx, orgId),
        autoEnableSetting: (await this.repo.settings(tx, orgId))?.autoEnableOnConnect === true,
      };
    });
    const { number } = loaded;
    // Outside the transaction above, and not caught: a failure here (the registry, the database) is a retryable fault, not "no credentials".
    const resolved = await this.db.tx((tx) =>
      this.waba.resolveConnection(tx, orgId, { id: number.id }),
    );
    const conn = resolved?.conn && resolved.conn.phoneNumberId ? resolved.conn : null;
    const connection: ReadinessFacts['connection'] =
      number.status !== 'connected' ? 'not_connected' : conn ? 'ok' : 'no_credentials';

    const rec = await this.recording.read(orgId);
    const ice = this.config.get<string>('CALLING_ICE_SERVERS');
    const facts: ReadinessFacts = {
      planEnabled,
      connection,
      coexistenceLocal: isCoexistenceMeta(number.meta),
      phone: null,
      token: { kind: 'none' },
      subscribedApps: null,
      callsField: 'unverifiable',
      calling: null,
      ice: { configured: Boolean(ice?.trim()), servers: parseIceServersEnv(ice) },
      diallers: loaded.diallers,
      recording: { enabled: rec.enabled, hasNotice: Boolean(rec.noticeText) },
    };

    if (planEnabled && conn && connection === 'ok') {
      await this.readMeta(conn, facts, opts.repair === true);
    }

    let callingEnabled = number.callingEnabled;
    let enableRefusal: CallingMetaReason | null = null;
    const metaStatus = facts.calling?.status ?? null;

    // Meta is the source of truth for the switch: when it says something the local flag does not, the flag follows (so the Call button
    // is never shown on a number Meta will refuse, and never hidden on one that was switched on by hand over there).
    // Not after a person's own switch (`enable`): Meta's read may still lag behind the change that was just accepted. And only if the
    // number was not touched since this check began (a toggle that landed meanwhile wins, whatever value it wrote).
    if (
      planEnabled &&
      source !== 'enable' &&
      metaStatus &&
      (metaStatus === 'ENABLED') !== callingEnabled
    ) {
      callingEnabled = await this.syncSwitch(
        number,
        callingEnabled,
        metaStatus === 'ENABLED',
        'meta',
        source,
        {},
        loaded.startedAt,
      );
    }

    // The automatic switch-on: asked for by a connect, kept PENDING until it happens or is withdrawn, tried by every check meanwhile.
    const wantsAuto =
      planEnabled && loaded.autoEnableSetting && (opts.autoEnable || last.autoEnablePending);
    if (
      wantsAuto &&
      conn &&
      !callingEnabled &&
      metaStatus !== 'ENABLED' &&
      facts.calling !== null &&
      readyForAutoEnable(buildChecks(facts, new Date()))
    ) {
      try {
        const body = await this.graph.setCalling(conn, true);
        callingEnabled = await this.syncSwitch(
          number,
          callingEnabled,
          true,
          'auto_enable',
          source,
          body,
          loaded.startedAt,
        );
        facts.calling = { ...facts.calling, status: 'ENABLED' };
      } catch (err) {
        enableRefusal = err instanceof WabaApiError ? metaReason(err) : 'unknown';
        this.logger.warn(
          { orgId, number: number.uuid, reason: enableRefusal },
          'calling was not switched on by itself yet',
        );
      }
    }

    const now = new Date();
    const checks = buildChecks(facts, now, enableRefusal);
    const status = deriveStatus(checks);
    // Pending ends when it happened (calling is on), or when the plan or the workspace setting no longer allow it. Otherwise it stays.
    const pending = Boolean(wantsAuto) && !callingEnabled && facts.calling?.status !== 'ENABLED';
    // Meta could not be read while pending: look again soon (1, 5, 15 minutes), then at the normal rhythm.
    const unreadable =
      planEnabled &&
      connection === 'ok' &&
      (facts.phone === null || facts.calling === null || facts.calling.status === null);
    const backoff =
      pending && unreadable ? RETRY_BACKOFF_MINUTES[last.autoEnableAttempts] : undefined;
    const attempts = pending && unreadable ? last.autoEnableAttempts + 1 : 0;
    const normalNext = planEnabled
      ? nextCheckAt(status, now)
      : new Date(now.getTime() + PLAN_MISSING_RECHECK_MS);
    const next = backoff
      ? new Date(Math.min(normalNext.getTime(), now.getTime() + backoff * 60_000))
      : normalNext;

    await this.db.tx(async (tx) => {
      const before = await this.repo.statusForUpdate(tx, orgId, number.id);
      const kept = await this.repo.save(tx, orgId, number.id, {
        status,
        checks,
        metaStatus: facts.calling?.status ?? null,
        source,
        checkedAt: now,
        nextCheckAt: next,
        autoEnablePending: pending,
        autoEnableAttempts: attempts,
      });
      if (kept && before !== null && before !== status) {
        await this.audit.record(tx, {
          module: MODULE,
          recordId: number.id,
          action: 'update',
          delta: { calling_readiness: { old: before, new: status } },
        });
      }
    });

    const row = await this.db.tx((tx) => this.repo.byUuid(tx, orgId, numberUuid));
    if (!row) throw notFound('CALL_NUMBER_NOT_FOUND', 'Number');
    return toDto(row);
  }

  // --- internals -----------------------------------------------------------------------------------------------------------------

  /**
   * The reads of Meta, side by side: a failing one leaves its row as "could not be read" and never fails the check. The token is
   * what decides whether this number is on the platform's own Meta app (the one whose `calls` field this platform may add).
   */
  private async readMeta(
    conn: WabaConnection,
    facts: ReadinessFacts,
    repair: boolean,
  ): Promise<void> {
    const [phone, token, apps, settings] = await Promise.allSettled([
      (async () => this.admin.getPhone(authOf(conn), conn.phoneNumberId))(),
      conn.accessToken && !conn.registry
        ? this.admin.inspectToken(conn.accessToken)
        : Promise.resolve(null),
      this.admin.getSubscribedApps(conn),
      this.graph.getSettings(conn),
    ]);

    if (phone.status === 'fulfilled') {
      const p = phone.value;
      facts.phone = {
        status: p.status,
        codeVerificationStatus: p.codeVerificationStatus,
        platformType: p.platformType,
        accountMode: p.accountMode,
        qualityRating: p.qualityRating,
        messagingLimitTier: p.messagingLimitTier,
      } satisfies PhoneFacts;
    }
    const tokenRejected =
      phone.status === 'rejected' &&
      phone.reason instanceof WabaApiError &&
      phone.reason.code === 190;
    facts.token = tokenFacts(token, tokenRejected, Boolean(conn.accessToken && !conn.registry));
    if (apps.status === 'fulfilled') facts.subscribedApps = apps.value.length;
    if (settings.status === 'fulfilled') facts.calling = settings.value;
    facts.callsField = await this.callsField(conn, facts.token, repair);
  }

  /**
   * Whether the Meta app this number is on delivers the `calls` webhook field. Only a number whose token provably belongs to the
   * platform's own app (the token's app id equals `META_APP_ID`) is looked at: a number on a customer's own app, one reached through a
   * provider, or one whose token could not be inspected is `unverifiable`, and the card says to confirm it there. A request only reads.
   * The worker (`repair`) adds `calls`, and only `calls`, when the app already has a callback, under one lock across workers (Meta replaces
   * the whole field list on a write, so two writers could drop each other's field).
   */
  private async callsField(
    conn: WabaConnection,
    token: TokenFacts,
    repair: boolean,
  ): Promise<CallsFieldFacts> {
    if (conn.registry || conn.provider !== 'meta' || !conn.accessToken) return 'unverifiable';
    if (
      !this.env.META_APP_ID ||
      token.kind !== 'inspected' ||
      token.appId !== this.env.META_APP_ID
    ) {
      return 'unverifiable';
    }
    try {
      const first = await this.diagnostics.ensureFields(['calls'], { write: false });
      if (first === 'absent' && repair) {
        const mine = randomUUID();
        const got = await this.redis.set(
          CALLS_FIELD_LOCK,
          mine,
          'EX',
          CALLS_FIELD_LOCK_SECONDS,
          'NX',
        );
        if (got !== 'OK') return 'missing';
        try {
          // Read again under the lock, then write: what another writer added a moment ago is kept.
          const result = await this.diagnostics.ensureFields(['calls'], { write: true });
          return result === 'added' ? 'added' : result === 'present' ? 'present' : 'missing';
        } finally {
          await this.redis.eval(RELEASE_LOCK, 1, CALLS_FIELD_LOCK, mine).catch(() => undefined);
        }
      }
      switch (first) {
        case 'present':
          return 'present';
        case 'absent':
        case 'no_callback':
          return 'missing';
        default:
          return 'unverifiable';
      }
    } catch (err) {
      // Redis or the platform's settings being down must not fail a check: this row is then "could not be verified".
      this.logger.warn({ err: String(err) }, 'the calls webhook field could not be checked');
      return 'unverifiable';
    }
  }

  /**
   * Brings the local switch to `enabled`, audited and with Meta's body kept; returns what the switch reads afterwards. Conditional: it
   * only changes a flag that still reads what this check read, so a person's switch made while the check was waiting on Meta wins.
   */
  private async syncSwitch(
    number: NumberRow,
    from: boolean,
    enabled: boolean,
    why: 'meta' | 'auto_enable',
    source: CallingCheckSource,
    body: Record<string, unknown>,
    since: Date,
  ): Promise<boolean> {
    const { orgId } = caller();
    return this.db.tx(async (tx) => {
      const row = await this.calls.setCallingIf(
        tx,
        orgId,
        number.id,
        from,
        enabled,
        { ...body, syncedBy: why, source },
        since,
      );
      if (!row) {
        // Somebody else changed it first: leave theirs, and report what is there now.
        const now = await this.calls.numberById(tx, orgId, number.id);
        return now?.callingEnabled ?? from;
      }
      await this.audit.record(tx, {
        module: MODULE,
        recordId: number.id,
        action: 'update',
        delta: { calling_enabled: { old: from, new: enabled } },
      });
      return enabled;
    });
  }
}

function isCoexistenceMeta(meta: Record<string, unknown> | null): boolean {
  if (!meta) return false;
  if (meta.coexistence === true) return true;
  const t = String(meta.platform_type ?? '').toUpperCase();
  return t === 'COEXISTENCE' || t === 'SMB_APP';
}

function tokenFacts(
  inspected: PromiseSettledResult<TokenInspection | null>,
  rejectedByMeta: boolean,
  hasOwnToken: boolean,
): TokenFacts {
  if (rejectedByMeta) return { kind: 'invalid' };
  if (!hasOwnToken) return { kind: 'none' };
  if (inspected.status === 'rejected' || inspected.value === null) return { kind: 'unverifiable' };
  const v = inspected.value;
  if (!v.isValid) return { kind: 'invalid' };
  return { kind: 'inspected', scopes: v.scopes, expiresAt: v.expiresAt, appId: v.appId };
}
