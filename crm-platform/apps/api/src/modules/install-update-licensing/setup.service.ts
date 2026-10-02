import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  SETUP_RUN_STEPS,
  type SetupBootstrapRequest,
  type SetupBootstrapResponse,
  type SetupDatabaseDefaults,
  type SetupDatabaseTestRequest,
  type SetupDatabaseTestResponse,
  type SetupPrerequisite,
  type SetupRequirementsResponse,
  type SetupRunRequest,
  type SetupRunResponse,
  type SetupStatusResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { INST_ENV, type InstEnv } from '../../config/domains/install-update-licensing.env';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  AuthAuditService,
  PasswordService,
  PlatformSettingsService,
  PlatformStore,
  TenantDirectory,
} from '../auth';
import { seedPlatformDefaults } from '../coupons-credits-referral-currency';
import { SettingsService } from '../platform-settings-branding-storage';
import { DatabaseTestService } from './database-test.service';
import { LicenceService } from './licence.service';
import { MigrationStateService } from './migration-state.service';
import { ReleaseInfoService } from './release-info.service';
import { RequirementsService, writableTempDir } from './requirements.service';
import { SetupRepository } from './setup.repository';
import { setupTokenMatches } from './setup-token';

export interface SetupSnapshot {
  state: 'open' | 'completed';
  completedAt: Date | null;
  completedVersion: string | null;
  runStep: number;
  prerequisites: SetupPrerequisite[];
}

/** Where the Node bridge settings live in the platform settings store (read through `InstallSettingsService`). */
export const NODE_BRIDGE_KEY = 'inst.node_bridge';
export const NODE_BRIDGE_TOKEN_KEY = 'inst.node_bridge.token';

const completedError = () =>
  new AppError(
    ERROR_CODES.SETUP_ALREADY_COMPLETED,
    'Setup has already been completed.',
    HttpStatus.CONFLICT,
  );

const notReady = (keys: Array<{ key: string; detail?: string }>) =>
  new AppError(
    ERROR_CODES.SETUP_PREREQUISITES_FAILED,
    'The server is not ready for setup.',
    HttpStatus.CONFLICT,
    keys.map((p) => ({ path: p.key, message: p.detail ?? 'not ready' })),
  );

/**
 * First-run setup (TW-INST-001 to -015).
 *
 * Every rule is enforced by the request that writes. The Reference wizard guarded only its GET pages, so a client that
 * posted the later forms directly skipped the licence and requirements steps, called the install sub-steps out of
 * order, and a reload of the run screen created a second workspace. Here every call re-checks the lock, the token and
 * the step order, and each step is idempotent.
 *
 * The six steps are the rows of Reference's run screen. Reference's "write .env, run migrations, seed, create admin,
 * link storage, finalize" become: save the configuration, confirm the migrations ran, confirm the seeded defaults,
 * create the operator and workspace, confirm storage is writable, lock. Migrations stay a deploy step (an HTTP request
 * must not hold DDL rights), and `.env` is never written: configuration lives in the platform settings.
 */
@Injectable()
export class SetupService {
  private readonly logger = new Logger(SetupService.name);

  constructor(
    private readonly store: PlatformStore,
    private readonly tenants: TenantDirectory,
    private readonly repo: SetupRepository,
    private readonly migrations: MigrationStateService,
    private readonly release: ReleaseInfoService,
    private readonly passwords: PasswordService,
    private readonly audit: AuthAuditService,
    private readonly outbox: OutboxService,
    private readonly licence: LicenceService,
    private readonly requirementsCheck: RequirementsService,
    private readonly databaseTest: DatabaseTestService,
    private readonly settings: PlatformSettingsService,
    private readonly general: SettingsService,
    @Inject(INST_ENV) private readonly env: InstEnv,
  ) {}

  /** Lock state plus, while open, what is still missing. Used by the status route and the operator System page. */
  async snapshot(): Promise<SetupSnapshot> {
    try {
      return await this.store.tx(async (tx) => {
        const s = await this.repo.state(tx);
        if (s.completedAt || s.foreignOperators > 0) {
          return {
            state: 'completed' as const,
            completedAt: s.completedAt,
            completedVersion: s.completedVersion,
            runStep: s.runStep,
            prerequisites: [],
          };
        }
        return {
          state: 'open' as const,
          completedAt: null,
          completedVersion: null,
          runStep: s.runStep,
          prerequisites: await this.prerequisites(tx),
        };
      });
    } catch {
      // The database cannot even be asked: report that instead of a 500, and never claim "completed".
      return {
        state: 'open',
        completedAt: null,
        completedVersion: null,
        runStep: 0,
        prerequisites: [{ key: 'database', ok: false, detail: 'unreachable' }],
      };
    }
  }

  async status(): Promise<SetupStatusResponse> {
    const s = await this.snapshot();
    return {
      state: s.state,
      completedAt: s.completedAt ? s.completedAt.toISOString() : null,
      tokenConfigured: this.env.SETUP_TOKEN !== undefined,
      prerequisites: s.prerequisites,
      licenceRequired: this.licence.required,
      runStep: s.runStep,
      version: this.release.info.version,
    };
  }

  /** Proves the token before the person fills in the form; every later call checks it again. */
  async verifyToken(presented: string): Promise<void> {
    await this.gate(presented);
  }

  /** The open-lock and token check every setup call starts with. */
  private async gate(presented: string): Promise<SetupSnapshot> {
    const s = await this.snapshot();
    if (s.state === 'completed') throw completedError();
    this.assertToken(presented);
    return s;
  }

  private assertToken(presented: string): void {
    if (this.env.SETUP_TOKEN === undefined) {
      throw new AppError(
        ERROR_CODES.SETUP_DISABLED,
        'Setup is disabled: SETUP_TOKEN is not configured on this server.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (!setupTokenMatches(presented, this.env.SETUP_TOKEN)) {
      throw new AppError(
        ERROR_CODES.SETUP_TOKEN_INVALID,
        'That setup token is not correct.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async prerequisites(tx: Tx): Promise<SetupPrerequisite[]> {
    const report = await this.migrations.report(tx);
    const pending = report.rows.filter((r) => r.state !== 'applied').length;
    // `unknown` (files not shipped) cannot prove anything is pending, but an empty ledger proves nothing ran.
    const migrationsOk =
      report.status === 'unknown' ? report.appliedCount > 0 : report.status === 'current';
    const defs = await this.repo.permissionDefCount(tx);
    const migrationDetail =
      report.status === 'unknown' ? 'none applied' : `${pending} not applied or changed`;
    return [
      { key: 'database', ok: true },
      { key: 'migrations', ok: migrationsOk, ...(migrationsOk ? {} : { detail: migrationDetail }) },
      // Provisioning grants the Admin role every capability key: with none seeded the first admin would be locked out.
      {
        key: 'permissions',
        ok: defs > 0,
        ...(defs > 0 ? {} : { detail: 'permission_defs is empty' }),
      },
    ];
  }

  // --- the screens' read and test calls (all token-gated, all closed once setup is complete) --------------------

  async requirements(token: string): Promise<SetupRequirementsResponse> {
    await this.gate(token);
    return this.requirementsCheck.check();
  }

  async databaseDefaults(token: string): Promise<SetupDatabaseDefaults> {
    await this.gate(token);
    return this.databaseTest.defaults();
  }

  async testDatabase(input: SetupDatabaseTestRequest): Promise<SetupDatabaseTestResponse> {
    await this.gate(input.setupToken);
    return this.databaseTest.test(input);
  }

  /** The licence step's "Verify & continue": the same check step 1 repeats, so skipping the page gains nothing. */
  async verifyLicence(token: string, code: string): Promise<void> {
    await this.gate(token);
    if (!this.licence.required) {
      throw new AppError(
        ERROR_CODES.LICENCE_NOT_ENABLED,
        'This deployment does not enforce a purchase code.',
        HttpStatus.CONFLICT,
      );
    }
    await this.licence.verifyOrThrow(code);
  }

  // --- the install run ---------------------------------------------------------------------------------------------

  async run(input: SetupRunRequest): Promise<SetupRunResponse> {
    const snap = await this.gate(input.setupToken);
    if (input.step > snap.runStep + 1) {
      throw new AppError(
        ERROR_CODES.SETUP_STEP_OUT_OF_ORDER,
        `Step ${input.step} cannot run before step ${snap.runStep + 1} has succeeded.`,
        HttpStatus.CONFLICT,
      );
    }
    try {
      switch (SETUP_RUN_STEPS[input.step - 1]) {
        case 'configuration':
          await this.configuration(input);
          break;
        case 'migrations':
          this.requireReady(snap, 'migrations');
          break;
        case 'defaults':
          this.requireReady(snap, 'permissions');
          // Currencies, demo coupons and credit-package bundles (TW-CPN-025): idempotent, never overwrites an operator's edits.
          await this.store.tx((tx) => seedPlatformDefaults(tx));
          break;
        case 'account':
          await this.account(input);
          break;
        case 'storage':
          if (!(await writableTempDir()))
            throw notReady([{ key: 'storage', detail: 'not writable' }]);
          break;
        case 'finalize':
          return { step: input.step, ok: true, result: await this.finalize(input) };
      }
      // Steps 4 and 6 record their own progress in the transaction that does the work.
      if (input.step !== 4) await this.store.tx((tx) => this.repo.advance(tx, input.step));
      return { step: input.step, ok: true };
    } catch (err) {
      if (err instanceof AppError) throw err;
      // The cause can name the database host or user, and the caller is unauthenticated: log it, answer generically.
      this.logger.error({ err, step: input.step }, `[INSTALL] step ${input.step} failed`);
      throw new AppError(
        ERROR_CODES.SETUP_STEP_FAILED,
        'Installation step failed. Check your details and the server logs, then try again.',
        HttpStatus.INTERNAL_SERVER_ERROR,
        [{ path: 'step', message: String(input.step) }],
      );
    }
  }

  /** The whole run in one call, for automation and the API contract: the steps in order, stopping at the first failure. */
  async bootstrap(input: SetupBootstrapRequest): Promise<SetupBootstrapResponse> {
    let last: SetupRunResponse | undefined;
    for (let step = 1; step <= SETUP_RUN_STEPS.length; step++) {
      last = await this.run({ ...input, step });
    }
    return last!.result!;
  }

  private requireReady(snap: SetupSnapshot, key: 'migrations' | 'permissions'): void {
    const p = snap.prerequisites.find((x) => x.key === key);
    if (!p?.ok) throw notReady([{ key, detail: p?.detail }]);
  }

  /** Step 1: the server must meet the requirements; then licence, application settings and the Node bridge are saved. */
  private async configuration(input: SetupRunRequest): Promise<void> {
    const reqs = await this.requirementsCheck.check();
    if (!reqs.allPassed) {
      const failing = [
        ...(reqs.runtime.ok ? [] : [{ key: 'runtime' }]),
        ...[...reqs.modules, ...reqs.services, ...reqs.directories]
          .filter((t) => !t.ok)
          .map((t) => ({ key: t.key })),
        ...(reqs.database.ok ? [] : [{ key: 'database' }]),
      ];
      throw notReady(failing);
    }
    if (this.licence.required) {
      await this.licence.verifyOrThrow(input.purchaseCode ?? '');
      await this.licence.remember(input.purchaseCode as string, null);
    }
    if (input.node) {
      await this.settings.set(
        NODE_BRIDGE_KEY,
        { serverUrl: input.node.serverUrl, port: input.node.port },
        null,
      );
      await this.settings.setSecret(NODE_BRIDGE_TOKEN_KEY, input.node.token, null);
    }
  }

  /**
   * Step 4: the platform owner, the first workspace and its admin. Repeatable: once created they are kept, so a retry
   * (or a reload that starts the run again) cannot make a second workspace, which is what Reference's did.
   */
  private async account(input: SetupRunRequest): Promise<void> {
    // A retry finds its own earlier work: the workspace address would be "taken" by the very run that made it.
    if ((await this.store.tx((tx) => this.repo.state(tx))).firstOperatorId !== null) return;

    // Hashed before the transaction opens: argon2 is slow on purpose and must not hold row locks while it runs.
    const passwordHash = await this.passwords.hash(input.operator.password);
    const version = this.release.info.version;
    class AlreadyProvisioned extends Error {}

    try {
      await this.tenants.provisionOrganization(
        {
          orgName: input.organization.name,
          slug: input.organization.slug,
          fullName: input.operator.fullName,
          email: input.operator.email,
          passwordHash,
          phoneE164: null,
          phoneVerified: false,
          // The setup token proved control of the deployment, so there is no mail round trip to wait for.
          emailVerifiedAt: new Date(),
          locale: input.organization.locale,
          orgSettings: { onboardingStep: 'done', timezone: input.organization.timezone },
          signupPlan: { defaultPlanSlug: null, trialDays: 0 },
        },
        async (tx, r) => {
          // Serialises concurrent runs. A run that committed first leaves its operator linked; an operator made by
          // the CLI means the platform already has an owner. Either way the throw rolls back the organization above.
          const row = await this.repo.lockRow(tx);
          if (row.completedAt || (await this.repo.state(tx)).foreignOperators > 0) {
            throw completedError();
          }
          if (row.firstOperatorId !== null) throw new AlreadyProvisioned();

          const operator = await this.repo.insertOperator(tx, {
            email: input.operator.email,
            fullName: input.operator.fullName,
            passwordHash,
          });
          await this.repo.linkProvisioned(tx, {
            operatorId: operator.id,
            orgId: r.org.id,
            appUrl: input.app?.url ?? process.env.WEB_APP_URL ?? null,
          });
          await this.audit.record(tx, {
            event: 'platform.setup.provisioned',
            status: 'success',
            orgId: r.org.id,
            actorType: 'system',
            actorId: null,
            recordId: operator.id,
            payload: { operatorId: operator.uuid, orgId: r.org.uuid, version },
          });
        },
      );
    } catch (err) {
      if (!(err instanceof AlreadyProvisioned)) throw err;
    }
  }

  /** Step 6: apply the application settings, take the lock, audit and emit in the same transaction. */
  private async finalize(input: SetupRunRequest): Promise<SetupBootstrapResponse> {
    const version = this.release.info.version;
    const done = await this.store.tx(async (tx) => {
      // Held to the end: a second finalize waits here, then finds the lock taken and answers 409.
      const row = await this.repo.lockRow(tx);
      if (row.completedAt) throw completedError();
      const state = await this.repo.state(tx);
      if (state.firstOperatorId === null || state.firstOrgId === null) {
        throw new AppError(
          ERROR_CODES.SETUP_STEP_OUT_OF_ORDER,
          'The account step has not run.',
          HttpStatus.CONFLICT,
        );
      }
      const orgId = state.firstOrgId;
      await this.applyGeneralSettings(input, state.firstOperatorId);

      const at = await this.repo.complete(tx, version);
      if (!at) throw completedError();
      const summary = await this.repo.summary(tx);
      if (!summary) throw completedError();
      await this.audit.record(tx, {
        event: 'platform.setup.completed',
        status: 'success',
        orgId,
        actorType: 'system',
        actorId: null,
        recordId: state.firstOperatorId,
        payload: { operatorId: summary.operator.uuid, orgId: summary.org.uuid, version },
      });
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: 'install',
        aggregateId: orgId,
        eventType: 'platform.setup_completed',
        payload: { orgUuid: summary.org.uuid, operatorUuid: summary.operator.uuid, version },
      });
      return { at, summary };
    });

    return {
      completedAt: done.at.toISOString(),
      organization: {
        id: done.summary.org.uuid,
        slug: done.summary.org.slug,
        name: done.summary.org.name,
      },
      operator: { id: done.summary.operator.uuid, email: done.summary.operator.email },
    };
  }

  /** Name, public URL, time zone and language become the platform's "General" settings (Reference wrote APP_* to .env). */
  private async applyGeneralSettings(input: SetupRunRequest, operatorId: number): Promise<void> {
    const current = await this.general.read('general');
    await this.general.patch(
      'general',
      {
        rowVersion: current.rowVersion,
        values: {
          ...(input.app ? { appName: input.app.name, appUrl: input.app.url } : {}),
          defaultTimezone: input.organization.timezone,
          defaultLanguage: input.organization.locale,
        },
        secrets: {},
      },
      operatorId,
    );
  }
}
