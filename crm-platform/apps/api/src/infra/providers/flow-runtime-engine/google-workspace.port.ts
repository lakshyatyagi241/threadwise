/**
 * Google Sheets, Docs, Forms and Calendar (Meet) for the flow's Google nodes (WD-FLR-044 to 047). WaDesk kept the OAuth tokens in the
 * workspace and called Google from Laravel; the nodes here only talk to this port, so which account is used is the adapter's business.
 *
 * Every method throws on failure, `GoogleNotConnectedError` when the workspace has no Google account: the node catches it and goes on
 * exactly as WaDesk did (a note in the run log, an apology to the customer where WaDesk sent one).
 */
export const GOOGLE_WORKSPACE = Symbol('GOOGLE_WORKSPACE');
/** Where an adapter gets the workspace's Google access token. null = no account connected. */
export const GOOGLE_ACCESS_TOKENS = Symbol('GOOGLE_ACCESS_TOKENS');

export class GoogleNotConnectedError extends Error {
  constructor() {
    super('No Google account connected');
  }
}

export interface GoogleAccessTokens {
  accessToken(orgId: number): Promise<string | null>;
}

/** The default: this repo has no Google account store yet, so no workspace is connected. */
export class NoGoogleAccount implements GoogleAccessTokens {
  async accessToken(): Promise<null> {
    return null;
  }
}

export interface SheetAppend {
  sheetId: string;
  /** '' = the sheet's first tab. */
  tabName: string;
  values: string[];
  /** The header label per value, index-aligned; used when `matchByHeader` is on. */
  columnHeaders: string[];
  matchByHeader: boolean;
}

export interface SheetRead {
  sheetId: string;
  tabName: string;
  matchColumn: string;
  matchValue: string;
  limit: number;
}

export interface DocGenerate {
  templateId: string;
  newTitle: string;
  vars: Record<string, string>;
  shareable: boolean;
}

export interface MeetCreate {
  title: string;
  startAt: Date;
  endAt: Date;
  sendInvites: boolean;
  timeZone: string;
  /** Stable per step: Google dedupes the conference on it. */
  requestId: string;
}

export interface GoogleWorkspacePort {
  appendSheetRow(orgId: number, req: SheetAppend): Promise<void>;
  /** Rows (header to cell) whose `matchColumn` equals `matchValue`; every row when no column is given. */
  readSheetRows(orgId: number, req: SheetRead): Promise<Array<Record<string, string>>>;
  /** Copies the template, fills its `{{placeholders}}`, optionally shares it by link. */
  generateDoc(orgId: number, req: DocGenerate): Promise<{ url: string }>;
  /** The form's public responder link. */
  formResponderUrl(orgId: number, formId: string): Promise<{ url: string }>;
  createMeet(orgId: number, req: MeetCreate): Promise<{ meetUrl: string; eventId: string }>;
}
