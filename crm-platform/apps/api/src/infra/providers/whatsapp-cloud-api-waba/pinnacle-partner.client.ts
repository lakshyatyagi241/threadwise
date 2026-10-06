import { Injectable, Logger } from '@nestjs/common';
import { WabaApiError } from './waba-errors';
import { WabaHttp } from './waba-http';
import {
  accountPayload,
  creditLinePayload,
  embeddedPayload,
  isPinnacleSuccess,
  pinnacleReason,
  readAccount,
  type PinnacleAccountInput,
  type PinnacleClientAccount,
  type PinnacleEmbeddedInput,
} from './pinnacle-partner.rules';

/** The provider's address and partner key, as the registry holds them. The key is a secret: never log it. */
export interface PinnacleRoute {
  /** No trailing slash, no version: `https://partnersv1.pinbot.ai`. */
  baseUrl: string;
  partnerKey: string;
}

/** Pinnacle refused or could not be reached. `message` is Pinnacle's own reason (or the transport's), already free of secrets. */
export class PinnacleError extends Error {
  override readonly name = 'PinnacleError';
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
  }
}

/**
 * Pinnacle's partner API (WABA onboarding for a client): create the client's account, hand over the embedded-signup details, share the
 * Meta credit line. Everything is keyed by the partner key; the client's own key comes back from `createAccount` and is the channel token
 * of the number. The address is the registry row's (already refused if not a public https name), requested through `WabaHttp` which
 * checks it again.
 */
@Injectable()
export class PinnaclePartnerClient {
  private readonly logger = new Logger(PinnaclePartnerClient.name);

  constructor(private readonly http: WabaHttp) {}

  async createAccount(
    route: PinnacleRoute,
    input: PinnacleAccountInput,
  ): Promise<PinnacleClientAccount> {
    const body = await this.post(route, '/create-user-account', accountPayload(input));
    const account = readAccount(body);
    if (!account) throw new PinnacleError(pinnacleReason(body), false);
    return account;
  }

  async sendEmbeddedDetails(route: PinnacleRoute, input: PinnacleEmbeddedInput): Promise<void> {
    const body = await this.post(route, '/client-embedded-detail-receiver', embeddedPayload(input));
    if (!isPinnacleSuccess(body)) throw new PinnacleError(pinnacleReason(body), false);
  }

  async shareCreditLine(
    route: PinnacleRoute,
    input: { businessId: string; wabaId: string; currency?: string },
  ): Promise<void> {
    const body = await this.post(route, '/share-creditline-api', creditLinePayload(input));
    if (!isPinnacleSuccess(body)) throw new PinnacleError(pinnacleReason(body), false);
  }

  private async post(route: PinnacleRoute, path: string, json: unknown): Promise<unknown> {
    const url = `${route.baseUrl}${path}`;
    // The registry saved this address after checking it; a name can be repointed since, so it is checked again before the partner key leaves.
    await this.http.assertProviderUrl(url);
    try {
      return await this.http.absolute(url, {
        method: 'POST',
        headers: { apikey: route.partnerKey, 'content-type': 'application/json' },
        json,
      });
    } catch (e) {
      if (e instanceof WabaApiError) {
        // A non-2xx carries Pinnacle's own words in the decoded body when it sent any.
        const reason = e.body ? pinnacleReason(e.body) : e.message;
        this.logger.warn({ path, status: e.status }, 'pinnacle partner call failed');
        throw new PinnacleError(reason, e.transient || e.status === 0 || e.status >= 500);
      }
      throw e;
    }
  }
}
