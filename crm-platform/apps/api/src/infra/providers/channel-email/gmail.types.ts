/** The parts of Gmail API v1 responses the Email channel reads (users.messages, users.history, users.getProfile). Everything else is ignored. */

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPartBody {
  size?: number;
  /** base64url of the part's bytes (already transfer-decoded). Absent for a big attachment: fetch it by `attachmentId`. */
  data?: string;
  attachmentId?: string;
}

export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailPartBody;
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  /** Epoch milliseconds, as a string. */
  internalDate?: string;
  sizeEstimate?: number;
  payload?: GmailPart;
}

export interface GmailProfile {
  emailAddress: string;
  historyId: string;
  messagesTotal: number;
}

export interface GmailHistoryPage {
  /** Message ids added to the mailbox since the cursor, with the labels they had when added. */
  added: Array<{ id: string; threadId: string; labelIds: string[] }>;
  /** The mailbox's current history id: the next cursor once every page was read. */
  historyId: string | null;
  /** The highest history record id on this page: where a run that stopped early resumes (`startHistoryId` returns records AFTER it). */
  lastRecordId: string | null;
  nextPageToken: string | null;
}

export interface GmailListPage {
  messages: Array<{ id: string; threadId: string }>;
  nextPageToken: string | null;
}

export interface GmailSendResult {
  id: string;
  threadId: string;
}
