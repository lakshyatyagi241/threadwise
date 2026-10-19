import type { ErrorCode, GoogleCapability } from '@crm/contracts';

/**
 * Google Sheets, Docs, Forms and Calendar (Meet) for the flow's Google nodes (TW-FLR-044 to 047, 080). Reference kept the OAuth tokens in
 * the workspace and called Google from Laravel; the nodes here only talk to this port, so which account is used is the adapter's business:
 * the workspace's one Google account (`/google-account`), whose grant covers the capability each method needs.
 *
 * Every method throws on failure, always a `GoogleAccountError` with a stable `GOOGLE_*` code. `GOOGLE_ACCOUNT_NOT_CONNECTED` is the
 * "Connect Google" case: the node writes it into the run log with the way out and goes on exactly as Reference did (an apology to the
 * customer where Reference sent one).
 */
export const GOOGLE_WORKSPACE = Symbol('GOOGLE_WORKSPACE');
/** Where an adapter gets the workspace's Google access token. */
export const GOOGLE_ACCESS_TOKENS = Symbol('GOOGLE_ACCESS_TOKENS');

/** The codes a failed Google CALL carries (not the consent or drift codes of the account page). */
export type GoogleFailureCode = Exclude<
  Extract<ErrorCode, `GOOGLE_${string}`>,
  `GOOGLE_CONSENT_${string}` | 'GOOGLE_SYNC_NOT_DRIFTED'
>;

/** The files a node picker can list. */
export type GoogleFileKind = 'sheets' | 'docs' | 'forms';

export class GoogleAccountError extends Error {
  constructor(
    readonly code: GoogleFailureCode,
    message: string,
    /** The permission the account lacks (`GOOGLE_SCOPE_MISSING`) or the capability the failed call needed. */
    readonly capability: GoogleCapability | null = null,
    /** Seconds Google asked us to wait (`GOOGLE_RATE_LIMITED`), when it said. */
    readonly retryAfterSeconds: number | null = null,
    /** The HTTP status Google answered with, when it did. */
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'GoogleAccountError';
  }
}

export class GoogleNotConnectedError extends GoogleAccountError {
  constructor() {
    super('GOOGLE_ACCOUNT_NOT_CONNECTED', 'No Google account connected');
  }
}

/**
 * The workspace's Google grant, as the adapter needs it. `withToken` hands `fn` a valid access token for `capability` (refreshing it, and
 * repeating once when Google refuses it as expired) and throws a `GoogleAccountError` when the workspace has no usable grant for it.
 */
export interface GoogleAccessTokens {
  withToken<T>(
    orgId: number,
    capability: GoogleCapability,
    fn: (accessToken: string) => Promise<T>,
  ): Promise<T>;
  /** The calendar the workspace chose for bookings and Meet links (`primary` until it picks another). */
  calendarId(orgId: number): Promise<string>;
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

/** Several rows of one step, written in ONE call: all of them are appended, or none (a retried step must not duplicate the rows that went in). */
export interface SheetAppendRows extends Omit<SheetAppend, 'values'> {
  rows: string[][];
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
  /** Stable per step: Google dedupes the conference on it, and the event id is derived from it so a repeated step finds its own event. */
  requestId: string;
}

/** One submission of a Google Form: the answers by question title (a list when the question took several). */
export interface FormResponseItem {
  responseId: string;
  respondent: string | null;
  submittedAt: Date;
  answers: Record<string, string | string[]>;
}

export interface GoogleFileItem {
  id: string;
  name: string;
}

export interface GoogleWorkspacePort {
  appendSheetRow(orgId: number, req: SheetAppend): Promise<void>;
  /** The same for the rows of one step (an AI step's records): one `values:append` call, so the step is all-or-nothing. */
  appendSheetRows(orgId: number, req: SheetAppendRows): Promise<void>;
  /** Rows (header to cell) whose `matchColumn` equals `matchValue`; every row when no column is given. */
  readSheetRows(orgId: number, req: SheetRead): Promise<Array<Record<string, string>>>;
  /**
   * Copies the template, fills its `{{placeholders}}`, optionally shares it by link. The copy is the result: a placeholder fill or a share
   * that fails afterwards is reported in `warnings` and does not lose the link (Reference carried on past both).
   */
  generateDoc(orgId: number, req: DocGenerate): Promise<{ url: string; warnings: string[] }>;
  /** The form's public responder link. */
  formResponderUrl(orgId: number, formId: string): Promise<{ url: string }>;
  /** The form's submissions made at or after `since`, oldest first (at most 200), read through the connected account. */
  formResponses(orgId: number, formId: string, since: Date): Promise<FormResponseItem[]>;
  createMeet(orgId: number, req: MeetCreate): Promise<{ meetUrl: string; eventId: string }>;
  /** The account's files of one kind, newest first, for the flow builder's pickers. Needs the `drive_listing` capability. */
  listFiles(orgId: number, kind: GoogleFileKind): Promise<GoogleFileItem[]>;
}
