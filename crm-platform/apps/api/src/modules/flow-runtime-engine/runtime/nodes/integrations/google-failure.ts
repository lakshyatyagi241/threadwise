import type { GoogleCapability } from '@crm/contracts';
import {
  GoogleAccountError,
  type GoogleFailureCode,
} from '../../../../../infra/providers/flow-runtime-engine/google-workspace.port';

const WHAT: Record<GoogleCapability, string> = {
  calendar: 'Google Calendar',
  sheets: 'Google Sheets',
  docs: 'Google Docs and Drive',
  forms: 'Google Forms',
  drive_listing: 'the Drive file list',
};

const sentence = (code: GoogleFailureCode, capability: GoogleCapability | null): string => {
  const what = capability ? WHAT[capability] : 'Google';
  switch (code) {
    case 'GOOGLE_ACCOUNT_NOT_CONNECTED':
      return 'No Google account connected [GOOGLE_ACCOUNT_NOT_CONNECTED]: an admin opens Google account in the menu and chooses "Connect Google".';
    case 'GOOGLE_ACCOUNT_NEEDS_RECONNECT':
      return 'Google no longer accepts the connected account [GOOGLE_ACCOUNT_NEEDS_RECONNECT]: an admin opens Google account and chooses "Reconnect Google".';
    case 'GOOGLE_ACCOUNT_NOT_CONFIGURED':
      return 'Google is not set up for this platform [GOOGLE_ACCOUNT_NOT_CONFIGURED]: the platform administrator adds the Google OAuth client.';
    case 'GOOGLE_SCOPE_MISSING':
      return `The connected Google account was not given permission for ${what} [GOOGLE_SCOPE_MISSING]: an admin opens Google account and chooses "Add permission".`;
    case 'GOOGLE_API_NOT_ENABLED':
      return `${what} is not enabled in the platform's Google Cloud project [GOOGLE_API_NOT_ENABLED]: the platform administrator enables the API.`;
    case 'GOOGLE_RATE_LIMITED':
      return `${what} is limiting requests right now [GOOGLE_RATE_LIMITED]: this step was not repeated.`;
    case 'GOOGLE_NOT_FOUND':
      return `${what} could not find it [GOOGLE_NOT_FOUND]: check the id or link, and that the connected Google account can open it.`;
    case 'GOOGLE_ACCESS_DENIED':
      return `The connected Google account may not do this in ${what} [GOOGLE_ACCESS_DENIED]: share the file with it as an editor.`;
    case 'GOOGLE_BAD_REQUEST':
      return `${what} rejected the request [GOOGLE_BAD_REQUEST]: check the tab name and the column names.`;
    case 'GOOGLE_UNAVAILABLE':
      return `${what} did not answer [GOOGLE_UNAVAILABLE].`;
  }
};

/**
 * What a Google node writes into the run log when Google did not do its work: a stable `[GOOGLE_*]` code to search for and what to do
 * about it. Never Google's own wording, never a token.
 */
export function googleFailureText(e: unknown): string {
  if (e instanceof GoogleAccountError) return sentence(e.code, e.capability);
  return e instanceof Error ? e.message : String(e);
}
