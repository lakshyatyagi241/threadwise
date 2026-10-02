import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type SetupBootstrapRequest,
  type SetupBootstrapResponse,
  type SetupPrerequisite,
  type SetupStatusResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { INST_ENV, type InstEnv } from '../../config/domains/install-update-licensing.env';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { AuthAuditService, PasswordService, PlatformStore, TenantDirectory } from '../auth';
import { MigrationStateService } from './migration-state.service';
import { ReleaseInfoService } from './release-info.service';
import { SetupRepository } from './setup.repository';
import { setupTokenMatches } from './setup-token';

export interface SetupSnapshot {
  state: 'open' | 'completed';
  completedAt: Date | null;
  completedVersion: string | null;
  prerequisites: SetupPrerequisite[];
}

const completedError = () =>
  new AppError(
    ERROR_CODES.SETUP_ALREADY_COMPLETED,
    'Setup has already been completed.',
    HttpStatus.CONFLICT,
  );

/**
 * First-run setup (TW-INST-001, -004, -007, -008, -013, -014, -015).
 *
 * Every rule is enforced by the request that writes. The Reference wizard guarded only its GET pages, so a client that
 * posted the later forms directly skipped the licence and requirements steps; here there is one write, and it
 * re-checks the lock, the token, the prerequisites and the input itself.
 */
@Injectable()
export class SetupService {
  constructor(
    private readonly store: PlatformStore,
    private readonly tenants: TenantDirectory,
    private readonly repo: SetupRepository,
    private readonly migrations: MigrationStateService,
    private readonly release: ReleaseInfoService,
    private readonly passwords: PasswordService,
    private readonly audit: AuthAuditService,
    private readonly outbox: OutboxService,
    @Inject(INST_ENV) private readonly env: InstEnv,
  ) {}

  /** Lock state plus, while open, what is still missing. Used by the status route and the operator System page. */
  async snapshot(): Promise<SetupSnapshot> {
    try {
      return await this.store.tx(async (tx) => {
        const s = await this.repo.state(tx);
        if (s.completedAt || s.operatorCount > 0) {
          return {
            state: 'completed' as const,
            completedAt: s.completedAt,
            completedVersion: s.completedVersion,
            prerequisites: [],
          };
        }
        return {
          state: 'open' as const,
          completedAt: null,
          completedVersion: null,
          prerequisites: await this.prerequisites(tx),
        };
      });
    } catch {
      // The database cannot even be asked: report that instead of a 500, and never claim "completed".
      return {
        state: 'open',
        completedAt: null,
        completedVersion: null,
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
    };
  }

  /** Proves the token before the person fills in the form; the bootstrap call checks it again. */
  async verifyToken(presented: string): Promise<void> {
    const s = await this.snapshot();
    if (s.state === 'completed') throw completedError();
    this.assertToken(presented);
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

  async bootstrap(input: SetupBootstrapRequest): Promise<SetupBootstrapResponse> {
    const before = await this.snapshot();
    if (before.state === 'completed') throw completedError();
    this.assertToken(input.setupToken);

    const failed = before.prerequisites.filter((p) => !p.ok);
    if (failed.length > 0) {
      throw new AppError(
        ERROR_CODES.SETUP_PREREQUISITES_FAILED,
        'The server is not ready for setup.',
        HttpStatus.CONFLICT,
        failed.map((p) => ({ path: p.key, message: p.detail ?? 'not ready' })),
      );
    }

    // Hashed before the transaction opens: argon2 is slow on purpose and must not hold row locks while it runs.
    const passwordHash = await this.passwords.hash(input.operator.password);
    const version = this.release.info.version;
    const done: { at: Date | null; operatorUuid: string | null } = { at: null, operatorUuid: null };

    const result = await this.tenants.provisionOrganization(
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
        done.at = await this.repo.claim(tx, {
          version,
          orgId: r.org.id,
          appUrl: process.env.WEB_APP_URL ?? null,
        });
        // A concurrent bootstrap that committed first leaves nothing to claim; an operator made by the CLI means the
        // platform already has an owner. Either way the throw rolls back the organization created above.
        if (!done.at || (await this.repo.state(tx)).operatorCount > 0) throw completedError();

        const operator = await this.repo.insertOperator(tx, {
          email: input.operator.email,
          fullName: input.operator.fullName,
          passwordHash,
        });
        await this.repo.linkOperator(tx, operator.id);
        done.operatorUuid = operator.uuid;

        await this.audit.record(tx, {
          event: 'platform.setup.completed',
          status: 'success',
          orgId: r.org.id,
          actorType: 'system',
          actorId: null,
          recordId: operator.id,
          payload: { operatorId: operator.uuid, orgId: r.org.uuid, version },
        });
        await this.outbox.emit(tx, {
          orgId: r.org.id,
          aggregateModule: 'install',
          aggregateId: r.org.id,
          eventType: 'platform.setup_completed',
          payload: { orgUuid: r.org.uuid, operatorUuid: operator.uuid, version },
        });
      },
    );

    return {
      completedAt: (done.at as Date | null)?.toISOString() ?? new Date().toISOString(),
      organization: { id: result.org.uuid, slug: result.org.slug, name: result.org.name },
      operator: { id: done.operatorUuid as string, email: input.operator.email },
    };
  }
}
