import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { ERROR_CODES } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { WABA_ENV, type WabaEnv } from '../../config/domains/whatsapp-cloud-api-waba.env';
import { DatabaseService } from '../../infra/db/database.service';
import {
  PinnacleError,
  PinnaclePartnerClient,
  type PinnacleRoute,
} from '../../infra/providers/whatsapp-cloud-api-waba/pinnacle-partner.client';
import { PINNACLE_CREDIT_LINE_DELAY_MS } from '../../infra/providers/whatsapp-cloud-api-waba/pinnacle-partner.rules';
import type { WabaRegistryProvider } from '../../infra/providers/whatsapp-cloud-api-waba/waba-registry-routes';
import { WabaHttp } from '../../infra/providers/whatsapp-cloud-api-waba/waba-http';
import { QUEUES } from '../../infra/queue/queues';

export interface PinnacleCreditLineJob {
  orgId: number;
  /** `wa_provider_configs.id` of the number, to record the outcome on. */
  rowId: number;
  providerKey: string;
  wabaId: string;
  businessId: string;
}

/** What a finished onboarding hands back: the client's own key (the number's channel token) and the Pinnacle login it was given. */
export interface PinnacleOnboarded {
  channelToken: string;
  username: string | null;
  password: string | null;
}

/** The partner key and address a Pinnacle-program provider is called with, or null when the registry row lacks them. */
export function pinnacleRouteOf(registry: WabaRegistryProvider): PinnacleRoute | null {
  if (!registry.providerToken || !registry.baseUrl) return null;
  return { baseUrl: registry.baseUrl.replace(/\/+$/, ''), partnerKey: registry.providerToken };
}

/**
 * Pinnacle's partner onboarding for a number that has just finished Embedded Signup (TW-WABA connect, provider program `pinnacle`):
 *
 *   1. read the WABA's template namespace from Meta;
 *   2. create the client's Pinnacle account, which answers with the client's own key (every send for this number carries it);
 *   3. hand Pinnacle the embedded-signup details (WABA, phone, configuration, token, solution);
 *   4. schedule the Meta credit-line share, which Pinnacle needs a few minutes after step 3.
 *
 * Steps 1 to 3 run during the connect, so a refusal surfaces to the person connecting (and nothing is stored); step 4 is a delayed
 * job whose outcome is written to the number's `meta_json` (`credit_line_assigned`, `credit_line_error`).
 */
@Injectable()
export class PinnacleOnboardingService {
  private readonly logger = new Logger(PinnacleOnboardingService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly http: WabaHttp,
    private readonly pinnacle: PinnaclePartnerClient,
    @Inject(WABA_ENV) private readonly env: WabaEnv,
    @InjectQueue(QUEUES.PINNACLE_CREDIT_LINE) private readonly queue: Queue<PinnacleCreditLineJob>,
  ) {}

  /** Whether this provider takes the flow at all. */
  static applies(registry: WabaRegistryProvider | null): registry is WabaRegistryProvider {
    return registry?.partnerProgram === 'pinnacle';
  }

  async onboard(a: {
    registry: WabaRegistryProvider;
    wabaId: string;
    phoneNumberId: string;
    displayPhoneNumber: string | null;
    businessId: string | null;
    /** The business-integration token Embedded Signup produced. */
    accessToken: string;
  }): Promise<PinnacleOnboarded> {
    const route = pinnacleRouteOf(a.registry);
    const solutionId = a.registry.partnerSolutionId;
    const configId = a.registry.onboardingConfigId ?? this.env.META_EMBEDDED_CONFIG_ID ?? null;
    const missing = [
      !route && 'the partner key (providerToken)',
      !solutionId && 'the solution id',
      !configId && 'the Embedded Signup configuration id',
    ].filter((m): m is string => Boolean(m));
    if (!route || !solutionId || !configId) {
      throw new AppError(
        ERROR_CODES.WAP_PARTNER_NOT_CONFIGURED,
        `Pinnacle onboarding is not set up on this platform: missing ${missing.join(', ')}. Ask the platform admin.`,
        HttpStatus.CONFLICT,
      );
    }

    // The platform's system user reads the namespace when there is one: a client token may not be allowed to.
    const namespace = await this.templateNamespace(
      a.wabaId,
      this.env.META_SYSTEM_USER_TOKEN ?? a.accessToken,
    );
    if (!namespace) {
      throw new AppError(
        ERROR_CODES.WAP_PARTNER_REFUSED,
        'Meta did not return the message template namespace of this WhatsApp Business Account, which Pinnacle needs. Try again in a minute.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const who = await this.requester();
    try {
      const account = await this.pinnacle.createAccount(route, {
        templateNamespace: namespace,
        wabaId: a.wabaId,
        wabaNumber: a.displayPhoneNumber ?? '',
        email: who.email,
        firstName: who.firstName,
        lastName: who.lastName,
        mobileNo: who.phone ?? a.displayPhoneNumber ?? '',
      });
      await this.pinnacle.sendEmbeddedDetails(route, {
        wabaId: a.wabaId,
        phoneNumberId: a.phoneNumberId,
        configId,
        accessToken: a.accessToken,
        solutionId,
        businessId: a.businessId,
      });
      return {
        channelToken: account.apiKey,
        username: account.username,
        password: account.password,
      };
    } catch (e) {
      if (e instanceof PinnacleError) {
        throw new AppError(
          ERROR_CODES.WAP_PARTNER_REFUSED,
          `Pinnacle could not onboard this number: ${e.message}`,
          e.transient ? HttpStatus.BAD_GATEWAY : HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw e;
    }
  }

  /** Queues the credit-line share, delayed. One job per number (a repeat connect of the same number does not queue twice). */
  async scheduleCreditLine(job: PinnacleCreditLineJob): Promise<void> {
    try {
      await this.queue.add('share', job, {
        jobId: `pinnacle-credit-${job.rowId}`,
        delay: PINNACLE_CREDIT_LINE_DELAY_MS,
        attempts: 6,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { age: 24 * 3600 },
        removeOnFail: { age: 7 * 24 * 3600 },
      });
    } catch (err) {
      // The number is connected and sends; the share can be retried by connecting again. Do not fail the connect over it.
      this.logger.error(
        { err: (err as Error).message, wabaId: job.wabaId },
        'could not queue the Pinnacle credit-line share',
      );
    }
  }

  private async templateNamespace(wabaId: string, token: string): Promise<string | null> {
    try {
      const res = await this.http.graph<{ message_template_namespace?: string }>(token, {
        method: 'GET',
        path: `/${wabaId}`,
        query: { fields: 'message_template_namespace' },
        timeoutMs: 10_000,
      });
      return res.message_template_namespace ?? null;
    } catch {
      return null;
    }
  }

  /** The signed-in person: Pinnacle's account is opened in their name. A phone is optional (users carry none by default). */
  private async requester(): Promise<{
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
  }> {
    const { orgId, userId } = RequestContextStore.require();
    const row = userId
      ? await this.db.tx(async (tx) => {
          const res = await tx.execute(
            sql`SELECT email::text AS email, full_name, settings ->> 'phone' AS phone FROM users WHERE org_id = ${orgId} AND id = ${userId}`,
          );
          return res.rows[0] as
            { email: string; full_name: string; phone: string | null } | undefined;
        })
      : undefined;
    const full = (row?.full_name ?? '').trim() || 'Workspace owner';
    const [first, ...rest] = full.split(/\s+/);
    return {
      email: row?.email ?? '',
      firstName: first ?? full,
      lastName: rest.join(' ') || '-',
      phone: row?.phone ?? null,
    };
  }
}
