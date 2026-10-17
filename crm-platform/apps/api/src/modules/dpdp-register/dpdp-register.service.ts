import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import {
  AI_PROVIDERS,
  DPDP_ATTESTABLE_CHECKS,
  DPDP_CATALOG,
  type DpdpAttestableCheck,
  type DpdpAttestInput,
  type DpdpAttestationView,
  type DpdpHistoryResponse,
  type DpdpRegisterResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { AiKeyResolver } from '../ai-keys-usage-admin';
import {
  AuthAuditService,
  ENDED_SESSION_RETENTION_DAYS,
  PlatformStore,
  SecurityPolicyService,
} from '../auth';
import { sentryEnabled } from '../platform-infrastructure';
import { runProbes, type ProbeDeps } from './probes';
import { evaluate, type AttestationRecord } from './rules';

type Raw = Record<string, unknown>;

/** A dependency that has not answered by now is as good as failed: the register shows its check as unknown and returns. */
const PROBE_TIMEOUT_MS = 5_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** The attestations of one check that its history returns, newest first. */
const HISTORY_LIMIT = 100;

const toDate = (value: unknown): Date => (value instanceof Date ? value : new Date(String(value)));

/** The key as one an operator can attest; anything else (a live or code check, a typo) is a validation error, never a database call. */
function attestableCheck(key: string): DpdpAttestableCheck {
  if (!(DPDP_ATTESTABLE_CHECKS as readonly string[]).includes(key)) {
    throw AppError.validation('Request payload failed validation', [
      { path: 'key', message: 'Not a check that can be attested' },
    ]);
  }
  return key as DpdpAttestableCheck;
}

/**
 * The DPDP compliance register of the super admin console. It gathers what the platform reads about itself (the live probes), the
 * newest attestation per check and the declared code checks, and hands them to the pure rules. Nothing here decides a status.
 *
 * The attestation table is a platform table (forced RLS, privileged transactions only), so every read and write goes through
 * `PlatformStore.tx`.
 */
@Injectable()
export class DpdpRegisterService {
  private readonly logger = new Logger(DpdpRegisterService.name);

  constructor(
    private readonly store: PlatformStore,
    private readonly policy: SecurityPolicyService,
    private readonly audit: AuthAuditService,
    private readonly keys: AiKeyResolver,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async get(): Promise<DpdpRegisterResponse> {
    const [probes, attestations] = await Promise.all([
      runProbes(this.probeDeps()),
      this.newestAttestations(),
    ]);
    return evaluate({ catalog: DPDP_CATALOG, probes, attestations, now: new Date() });
  }

  async history(key: string): Promise<DpdpHistoryResponse> {
    const checkKey = attestableCheck(key);
    const rows = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT a.result, a.note, a.evidence_url, a.attested_at, a.expires_at, o.full_name
          FROM dpdp_register_attestations a
          JOIN platform_operators o ON o.id = a.attested_by
         WHERE a.check_key = ${checkKey}
         ORDER BY a.attested_at DESC
         LIMIT ${HISTORY_LIMIT}`);
      return res.rows as Raw[];
    });
    const data: DpdpAttestationView[] = rows.map((r) => ({
      result: r.result as 'pass' | 'fail',
      note: r.note as string,
      evidenceUrl: (r.evidence_url as string | null) ?? null,
      byName: r.full_name as string,
      at: toDate(r.attested_at).toISOString(),
      expiresAt: toDate(r.expires_at).toISOString(),
    }));
    return { data };
  }

  /** Appends one attestation and its security event in one transaction, then returns the register as it now reads. */
  async attest(key: string, input: DpdpAttestInput): Promise<DpdpRegisterResponse> {
    const checkKey = attestableCheck(key);
    const operatorId = RequestContextStore.require().actorId;
    if (operatorId === null) throw AppError.unauthenticated();
    const expiresAt = new Date(Date.now() + input.expiresInDays * MS_PER_DAY);

    await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        INSERT INTO dpdp_register_attestations (check_key, result, note, evidence_url, attested_by, expires_at)
        VALUES (${checkKey}, ${input.result}, ${input.note}, ${input.evidenceUrl ?? null}, ${operatorId},
                ${expiresAt.toISOString()}::timestamptz)
        RETURNING id`);
      // The table is the durable record; the event is pruned with the audit log. It names the row and leaves the note and link in it.
      await this.audit.record(tx, {
        event: 'dpdp_register.attested',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: {
          checkKey,
          result: input.result,
          expiresInDays: input.expiresInDays,
          hasEvidence: input.evidenceUrl !== undefined,
          attestationId: (res.rows[0] as Raw).id,
        },
      });
    });
    return this.get();
  }

  /** The newest attestation of every check, with the name of the operator who made it. */
  private async newestAttestations(): Promise<AttestationRecord[]> {
    const rows = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT DISTINCT ON (a.check_key)
               a.check_key, a.result, a.note, a.evidence_url, a.attested_at, a.expires_at, o.full_name
          FROM dpdp_register_attestations a
          JOIN platform_operators o ON o.id = a.attested_by
         ORDER BY a.check_key, a.attested_at DESC`);
      return res.rows as Raw[];
    });
    return rows.map((r) => ({
      checkKey: r.check_key as DpdpAttestableCheck,
      result: r.result as 'pass' | 'fail',
      note: r.note as string,
      evidenceUrl: (r.evidence_url as string | null) ?? null,
      byName: r.full_name as string,
      attestedAt: toDate(r.attested_at),
      expiresAt: toDate(r.expires_at),
    }));
  }

  /** What the probes read. Each asynchronous read is cut off after 5 seconds and logged, so one dependency cannot hang the page. */
  private probeDeps(): ProbeDeps {
    return {
      policy: () => this.within('security policy', () => this.policy.policy()),
      env: (key) => {
        const value: unknown = this.config.get(key as keyof Env, { infer: true });
        // The validated configuration holds the lifecycle switches as booleans; their text is what the app's own schema accepts.
        return value === undefined || value === null ? undefined : String(value);
      },
      platformKeyProviders: () =>
        this.within('platform AI keys', async () => {
          const llm = AI_PROVIDERS.filter((p) => p.group === 'llm');
          const found = await Promise.all(
            llm.map(async (p) =>
              (await this.keys.resolve(null, p.slug)).key !== null ? p.slug : null,
            ),
          );
          return found.filter((slug): slug is string => slug !== null);
        }),
      consentAdoption: () =>
        this.within('consent adoption', async () => {
          const res = await this.store.tx((tx) =>
            tx.execute(sql`
              SELECT count(*) FILTER (WHERE require_consent_for_marketing) AS on_count, count(*) AS total
                FROM contact_consent_settings`),
          );
          const row = res.rows[0] as Raw;
          return { on: Number(row.on_count), total: Number(row.total) };
        }),
      sentryEnabled,
      sessionRetentionDays: ENDED_SESSION_RETENTION_DAYS,
    };
  }

  /** Runs one read; rejects when it fails or takes longer than the timeout, after logging the cause. */
  private async within<T>(name: string, read: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${name} did not answer within ${PROBE_TIMEOUT_MS} ms`)),
        PROBE_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([Promise.resolve().then(read), timeout]);
    } catch (err) {
      this.logger.warn({ err, dependency: name }, 'DPDP register: a probe dependency failed');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
