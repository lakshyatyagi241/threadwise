import { Injectable } from '@nestjs/common';
import type { GoogleCapability } from '@crm/contracts';
import {
  GoogleAccountError,
  type GoogleAccessTokens,
} from '../../infra/providers/flow-runtime-engine/google-workspace.port';
import { CalendarNotConnectedError, GoogleCalendarTokens } from '../appointments-booking';

const WORDS: Record<GoogleCapability, string> = {
  calendar: 'Calendar',
  sheets: 'Sheets',
  docs: 'Docs',
  forms: 'Forms',
  drive_listing: 'the Drive file list',
};

/**
 * `GoogleAccessTokens` served by the workspace's one Google grant (the same sealed row, the same refresh and the same `invalid_grant`
 * handling as the appointments calendar). A workspace that cannot use Google for a capability gets a `GoogleAccountError` with the
 * code that says what to do: connect, reconnect, add the permission, or (operator) set up the client.
 */
@Injectable()
export class WorkspaceGoogleAccessTokens implements GoogleAccessTokens {
  constructor(private readonly tokens: GoogleCalendarTokens) {}

  async withToken<T>(
    orgId: number,
    capability: GoogleCapability,
    fn: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.tokens.withToken(orgId, (token) => fn(token), { capability });
    } catch (err) {
      throw err instanceof CalendarNotConnectedError ? unusable(err, capability) : err;
    }
  }

  async calendarId(orgId: number): Promise<string> {
    return (await this.tokens.connection(orgId))?.calendarId ?? 'primary';
  }
}

function unusable(
  err: CalendarNotConnectedError,
  capability: GoogleCapability,
): GoogleAccountError {
  switch (err.reason) {
    case 'none':
      return new GoogleAccountError(
        'GOOGLE_ACCOUNT_NOT_CONNECTED',
        'No Google account connected',
        capability,
      );
    case 'needs_reconnect':
      return new GoogleAccountError(
        'GOOGLE_ACCOUNT_NEEDS_RECONNECT',
        'Google no longer accepts the connected account',
        capability,
      );
    case 'not_configured':
      return new GoogleAccountError(
        'GOOGLE_ACCOUNT_NOT_CONFIGURED',
        'Google is not set up for this platform',
        capability,
      );
    case 'scope_missing':
      return new GoogleAccountError(
        'GOOGLE_SCOPE_MISSING',
        `The connected Google account was not given permission for ${WORDS[err.capability ?? capability]}`,
        err.capability ?? capability,
      );
  }
}
