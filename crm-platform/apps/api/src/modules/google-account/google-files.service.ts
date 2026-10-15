import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type FlbGoogleFilesResponse,
  type GoogleAccountSummary,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import {
  GOOGLE_WORKSPACE,
  GoogleAccountError,
  type GoogleFileKind,
  type GoogleWorkspacePort,
} from '../../infra/providers/flow-runtime-engine/google-workspace.port';
import { GoogleCalendarConnectService } from '../appointments-booking';

/**
 * What the flow builder asks the workspace's Google account (TW-FLB-055 to 058): the files to pick for a Sheets, Docs or Forms node, and
 * whether the account is usable at all so a node can warn before a flow runs. A failure leaves as an `AppError` carrying the `GOOGLE_*`
 * code (the builder falls back to a text field for the id on any of them).
 */
@Injectable()
export class GoogleFilesService {
  constructor(
    @Inject(GOOGLE_WORKSPACE) private readonly google: GoogleWorkspacePort,
    private readonly connect: GoogleCalendarConnectService,
  ) {}

  async list(kind: GoogleFileKind): Promise<FlbGoogleFilesResponse> {
    // Reference answered 503 `integration_disabled` while the platform's Google switch was off, whoever was connected.
    if ((await this.connect.account()).status === 'unavailable') {
      throw new AppError(
        ERROR_CODES.FLB_INTEGRATION_DISABLED,
        'Google integration is not set up for this platform.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    try {
      return { data: await this.google.listFiles(RequestContextStore.require().orgId, kind) };
    } catch (err) {
      throw err instanceof GoogleAccountError ? toApiError(err) : err;
    }
  }

  async summary(): Promise<GoogleAccountSummary> {
    const account = await this.connect.account();
    return {
      status: account.status,
      granted: account.capabilities.filter((c) => c.granted).map((c) => c.key),
    };
  }
}

const MESSAGES: Record<GoogleAccountError['code'], [HttpStatus, string]> = {
  GOOGLE_ACCOUNT_NOT_CONFIGURED: [
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Google is not set up for this platform.',
  ],
  GOOGLE_ACCOUNT_NOT_CONNECTED: [
    HttpStatus.CONFLICT,
    'No Google account is connected. Connect Google on the Google account page.',
  ],
  GOOGLE_ACCOUNT_NEEDS_RECONNECT: [
    HttpStatus.CONFLICT,
    'Google no longer accepts the connected account. Reconnect Google on the Google account page.',
  ],
  GOOGLE_SCOPE_MISSING: [
    HttpStatus.CONFLICT,
    'The connected Google account was not given this permission. Add it on the Google account page.',
  ],
  GOOGLE_API_NOT_ENABLED: [
    HttpStatus.SERVICE_UNAVAILABLE,
    "The platform's Google Cloud project has not enabled this API.",
  ],
  GOOGLE_RATE_LIMITED: [
    HttpStatus.TOO_MANY_REQUESTS,
    'Google is limiting requests. Try again soon.',
  ],
  GOOGLE_NOT_FOUND: [HttpStatus.BAD_GATEWAY, 'Google could not find that.'],
  GOOGLE_ACCESS_DENIED: [HttpStatus.BAD_GATEWAY, 'The connected Google account may not do that.'],
  GOOGLE_BAD_REQUEST: [HttpStatus.BAD_GATEWAY, 'Google rejected the request.'],
  GOOGLE_UNAVAILABLE: [HttpStatus.BAD_GATEWAY, 'Google did not answer. Try again in a moment.'],
};

/** A failure as the staff API answers it: the stable code and a sentence of ours, never Google's text. */
export function toApiError(err: GoogleAccountError): AppError {
  const [status, message] = MESSAGES[err.code];
  return new AppError(ERROR_CODES[err.code], message, status);
}
